-- Run the collector itself: wall-clock jumps must not increase flash write frequency.
local history = dofile("luci-app-passwall2/luasrc/passwall2/monitor_history.lua")
local ram = "/tmp/passwall2-monitor/history.json"
local disk = "/etc/passwall2/monitor-history.json"
local files, documents, writes = {}, {}, {}
local epoch, index = 1800000000, 0
local uptimes = {100, 110, 120, 1800, 1900, 1910}
local original_arg = arg
local stopped = {}
package.loaded["luci.passwall2.monitor_history"] = history
package.loaded["luci.passwall2.monitor"] = {traffic_snapshot = function()
	index = index + 1
	local uptime = uptimes[index]
	return {timestamp = epoch + uptime + (index > 2 and 3600 or 0), uptime = uptime,
		boot_id = "collector-test", traffic = {device = "eth0", rx = uptime * 100, tx = uptime * 10}}
end}
package.loaded["nixio.fs"] = {
	mkdir = function() return true end,
	stat = function(path) if files[path] then return {size = #files[path]} end end,
	readfile = function(path) return files[path] end,
	writefile = function(path, value) files[path] = value; return #value end,
	chmod = function() return true end,
	unlink = function(path) files[path] = nil end,
	rename = function(from, to) files[to] = files[from]; files[from] = nil; writes[#writes + 1] = to; return true end
}
package.loaded["luci.jsonc"] = {
	stringify = function(document)
		local key = tostring(#documents + 1)
		documents[#documents + 1] = document
		return key
	end,
	parse = function(encoded) return documents[tonumber(encoded)] end
}
package.loaded["nixio"] = {
	open = function() return {lock = function() return true end, close = function() end, sync = function() return true end} end,
	syslog = function(_, message) error(message) end,
	nanosleep = function() if index == #uptimes then error(stopped) end end
}
arg = {"collect"}
local ok, err = pcall(dofile, "luci-app-passwall2/root/usr/share/passwall2/history.lua")
arg = original_arg
assert(not ok and err == stopped, "collector must reach the end of simulated samples")
local checkpoints = 0
for _, path in ipairs(writes) do if path == disk then checkpoints = checkpoints + 1 end end
assert(checkpoints == 1, "one hour of clock adjustment must not trigger extra flash writes")
assert(history.read(disk).sample_uptime == 1900, "checkpoint interval uses monotonic uptime")
assert(history.read(ram).sample_uptime == 1910, "RAM history keeps updating between flash checkpoints")
print("Monitor collector tests passed")
