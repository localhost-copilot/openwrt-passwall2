-- Read-only telemetry. No routing, service or firewall configuration changes.
local M = {}

function M.cpu(text)
	local values = {}
	for value in (text:match("^cpu%s+([^\n]+)") or ""):gmatch("%d+") do
		values[#values + 1] = tonumber(value)
	end
	if #values < 4 then return nil end
	local total = 0
	-- guest/guest_nice are already included in user/nice.
	for i = 1, math.min(8, #values) do total = total + values[i] end
	return {total = total, idle = values[4] + (values[5] or 0)}
end

function M.memory(text)
	local values = {}
	for name, value in text:gmatch("([%w_]+):%s+(%d+)") do values[name] = tonumber(value) * 1024 end
	if not values.MemTotal or not values.MemAvailable then return nil end
	return {total = values.MemTotal, used = math.max(0, values.MemTotal - values.MemAvailable)}
end

function M.trace(text)
	local ip = text:match("\nip=([%d.]+)\n") or text:match("^ip=([%d.]+)\n")
	if not ip or not ip:match("^%d+%.%d+%.%d+%.%d+$") then return nil end
	local count = 0
	for part in ip:gmatch("[^.]+") do
		if not part:match("^%d+$") or tonumber(part) > 255 then return nil end
		count = count + 1
	end
	if count ~= 4 or ip:find("..", 1, true) then return nil end
	return {ip = ip, country = text:match("\nloc=([A-Z][A-Z])\n")}
end

function M.devices(payload)
	local devices = {}
	if type(payload) ~= "table" or payload.status ~= "success" or type(payload.data) ~= "table" or type(payload.data.d) ~= "table" then
		return nil
	end
	for _, item in ipairs(payload.data.d) do
		if item.conn ~= "router" and type(item.mac) == "string" then
			devices[#devices + 1] = {
				name = item.host ~= "" and item.host or item.ip4 or item.mac,
				ip = item.ip4, mac = item.mac,
				down = tonumber(item.w_rx_r), up = tonumber(item.w_tx_r),
				download = tonumber(item.w_rx_b), upload = tonumber(item.w_tx_b),
				last_seen = tonumber(item.last)
			}
		end
	end
	table.sort(devices, function(a, b) return (a.down or 0) + (a.up or 0) > (b.down or 0) + (b.up or 0) end)
	return devices
end

local function running(fs)
	for path in fs.glob("/proc/[0-9]*/cmdline") do
		local cmd = fs.readfile(path) or ""
		if cmd:find("/tmp/etc/passwall2/bin/", 1, true) and cmd:find("/acl_default.json", 1, true) then return true end
	end
	return false
end

function M.traffic_snapshot()
	local fs = require "nixio.fs"
	local wan = require("luci.util").ubus("network.interface.wan", "status", {}) or {}
	local interface = wan.l3_device or wan.device
	local traffic
	if wan.up and type(interface) == "string" and #interface <= 15 and interface:match("^[%w_.:-]+$") then
		local prefix = "/sys/class/net/" .. interface .. "/statistics/"
		traffic = {device = interface, rx = tonumber(fs.readfile(prefix .. "rx_bytes")), tx = tonumber(fs.readfile(prefix .. "tx_bytes"))}
	end
	return {timestamp = os.time(), uptime = tonumber((fs.readfile("/proc/uptime") or ""):match("^[%d.]+")),
		boot_id = (fs.readfile("/proc/sys/kernel/random/boot_id") or ""):match("[%w-]+"), traffic = traffic}
end

function M.snapshot()
	local fs = require "nixio.fs"
	local sys = require "luci.sys"
	local uci = require("uci").cursor()
	local global = uci:get_all("passwall2", "@global[0]") or {}
	local node = global.node and uci:get_all("passwall2", global.node) or {}
	local sample = M.traffic_snapshot()
	local guard = sys.exec("nft list table inet passwall2_guard 2>/dev/null")
	local _, drops = guard:gsub("policy drop", "")
	return {
		timestamp = sample.timestamp, uptime = sample.uptime, boot_id = sample.boot_id,
		cpu = M.cpu(fs.readfile("/proc/stat") or ""), memory = M.memory(fs.readfile("/proc/meminfo") or ""),
		temperature = tonumber(fs.readfile("/sys/class/thermal/thermal_zone0/temp")),
		traffic = sample.traffic,
		proxy_running = running(fs), proxy_enabled = global.enabled == "1",
		guard_enabled = global.kill_switch == "1", guard_active = drops >= 2,
		node = {name = node.remarks or "未选择节点", core = node.type, protocol = node.protocol},
		connections = tonumber(fs.readfile("/proc/sys/net/netfilter/nf_conntrack_count")),
		connections_max = tonumber(fs.readfile("/proc/sys/net/netfilter/nf_conntrack_max"))
	}
end

function M.history()
	local history = require "luci.passwall2.monitor_history"
	local document = history.read("/tmp/passwall2-monitor/history.json") or history.read("/etc/passwall2/monitor-history.json") or {points = {}}
	local sample = M.traffic_snapshot()
	document.collecting = document.boot_id == sample.boot_id and type(document.sample_uptime) == "number" and sample.uptime ~= nil
		and sample.uptime >= document.sample_uptime and sample.uptime - document.sample_uptime <= 30
	document.interval, document.retention = history.interval, history.retention
	return document
end

function M.device_snapshot()
	local uci = require("uci").cursor()
	local devices, source = nil, "disabled"
	if uci:get("bandix", "traffic", "enabled") == "1" then
		local port = tonumber(uci:get("bandix", "general", "port")) or 8686
		if port >= 1 and port <= 65535 and port == math.floor(port) then
			local response = require("luci.sys").exec("curl --noproxy '*' -fsS --connect-timeout 1 --max-time 3 http://127.0.0.1:" .. port .. "/api/traffic/devices 2>/dev/null")
			devices = M.devices(require("luci.jsonc").parse(response))
		end
		source = devices and "bandix" or "unavailable"
	end
	return {timestamp = os.time(), devices = devices or {}, devices_source = source}
end

function M.probe()
	local fs = require "nixio.fs"
	local nixio = require "nixio"
	local json = require "luci.jsonc"
	local sys = require "luci.sys"
	local config_path = "/tmp/etc/passwall2/acl/acl_default.json"
	local stat = fs.stat(config_path) or {}
	local config = json.parse(fs.readfile(config_path) or "") or {}
	local port
	for _, inbound in ipairs(config.inbounds or {}) do
		if inbound.protocol == "socks" and inbound.listen == "127.0.0.1" then port = tonumber(inbound.port); break end
	end
	-- Never fall back to a direct request when the local proxy is absent.
	if not running(fs) or not port or port < 1 or port > 65535 or port ~= math.floor(port) then
		return {ok = false, checked_at = os.time(), reason = "代理未运行或未提供本地 SOCKS 入口"}
	end
	local directory = "/tmp/passwall2-monitor"
	fs.mkdir(directory, "700")
	local cache_path = directory .. "/probe.json"
	local lock = nixio.open(directory .. "/probe.lock", "w", "600")
	if not lock then return {ok = false, reason = "检测暂不可用"} end
	local cache = json.parse(fs.readfile(cache_path) or "")
	local key = tostring(stat.mtime) .. ":" .. tostring(stat.ino) .. ":" .. port
	if cache and cache.key == key and os.time() >= cache.checked_at and os.time() - cache.checked_at < 30 then
		lock:close(); cache.key = nil; return cache
	end
	if not lock:lock("tlock") then lock:close(); return {pending = true} end
	local response = sys.exec("curl --noproxy '' -4 -fsS --connect-timeout 3 --max-time 6 --max-filesize 4096 --proxy socks5h://127.0.0.1:" .. port .. " https://www.cloudflare.com/cdn-cgi/trace -w '\\nprobe_seconds=%{time_total}\\n' 2>/dev/null")
	local trace = M.trace(response)
	local result = {ok = trace ~= nil, checked_at = os.time(), key = key}
	if trace then
		result.ip, result.country = trace.ip, trace.country
		result.duration_ms = math.floor((tonumber(response:match("probe_seconds=([%d.]+)")) or 0) * 1000)
	else result.reason = "经节点访问检测站失败" end
	fs.writefile(cache_path, json.stringify(result))
	lock:close()
	result.key = nil
	return result
end

return M
