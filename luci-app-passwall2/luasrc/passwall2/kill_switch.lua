-- Dedicated-router fail-closed policy, independent of proxy process lifetime.
local M = {}

local function ipv4(value)
	if type(value) ~= "string" then return false end
	local a, b, c, d = value:match("^(%d+)%.(%d+)%.(%d+)%.(%d+)$")
	if not a then return false end
	for _, part in ipairs({a, b, c, d}) do
		if #part > 3 or tonumber(part) > 255 or (#part > 1 and part:sub(1, 1) == "0") then return false end
	end
	return true
end

local function list(value)
	if type(value) == "table" then return value end
	if value and value ~= "" then return {value} end
	return {}
end

local function device_name(value)
	return type(value) == "string" and #value <= 15 and value:match("^[%w_.:-]+$") and value ~= "lo"
end

-- Only complete RFC1918 subnets may bypass the proxy; reject host bits and
-- supernets that would also admit public Internet destinations.
local function private_subnet(value)
	if type(value) ~= "string" then return end
	local address, prefix = value:match("^([%d.]+)/(%d+)$")
	prefix = tonumber(prefix)
	if not ipv4(address) or not prefix or prefix < 1 or prefix > 32 then return end
	local first, octets = 0, {}
	for part in address:gmatch("%d+") do
		octets[#octets + 1] = tonumber(part)
		first = first * 256 + tonumber(part)
	end
	local size = 2 ^ (32 - prefix)
	if first % size ~= 0 then return end
	if (octets[1] == 10 and prefix >= 8)
		or (octets[1] == 172 and octets[2] >= 16 and octets[2] <= 31 and prefix >= 12)
		or (octets[1] == 192 and octets[2] == 168 and prefix >= 16) then
		return first, first + size - 1
	end
end

function M.render(config)
	local lines = {"add table inet passwall2_guard", "delete table inet passwall2_guard"}
	if config.enabled == nil or config.enabled == "0" then return table.concat(lines, "\n") .. "\n" end
	if config.enabled ~= "1" then return nil, "Invalid kill switch setting" end
	local devices = list(config.devices)
	if #devices == 0 then devices = {"br-lan"} end
	local quoted, trusted = {}, {}
	for _, device in ipairs(devices) do
		if not device_name(device) then
			return nil, "Invalid trusted LAN device"
		end
		quoted[#quoted + 1] = string.format('%q', device)
		trusted[device] = true
	end
	local local_routes = config.local_routes or {}
	if type(local_routes) ~= "table" then return nil, "Invalid local routes" end
	local forwarding = {}
	for _, route in ipairs(local_routes) do
		if type(route) ~= "table" or not trusted[route.lan_device] or not device_name(route.uplink_device)
			or trusted[route.uplink_device] then
			return nil, "Invalid local route devices"
		end
		local lan_first, lan_last = private_subnet(route.lan_subnet)
		local uplink_first, uplink_last = private_subnet(route.uplink_subnet)
		if not lan_first or not uplink_first or (lan_first <= uplink_last and uplink_first <= lan_last) then
			return nil, "Local routes require non-overlapping private IPv4 subnets"
		end
		local function direction(input, output, source, destination)
			forwarding[#forwarding + 1] = string.format(
				'        iifname %q oifname %q ip saddr %s ip daddr %s counter accept',
				input, output, source, destination)
		end
		direction(route.lan_device, route.uplink_device, route.lan_subnet, route.uplink_subnet)
		direction(route.uplink_device, route.lan_device, route.uplink_subnet, route.lan_subnet)
	end
	local endpoints, seen = {}, {}
	local function endpoint(protocol, address, port)
		port = tonumber(port)
		if not ipv4(address) or not port or port < 1 or port > 65535 or port % 1 ~= 0 then
			return false
		end
		local rule = string.format("        ip daddr %s %s dport %d accept", address, protocol, port)
		if not seen[rule] then endpoints[#endpoints + 1] = rule; seen[rule] = true end
		return true
	end
	local node = config.node or {}
	if ipv4(node.address) then
		if not endpoint("tcp", node.address, node.port) or not endpoint("udp", node.address, node.port) then
			return nil, "Invalid selected node port"
		end
	end
	for _, value in ipairs(list(config.endpoints)) do
		if type(value) ~= "string" then return nil, "Invalid extra endpoint" end
		local protocol, address, port = value:match("^(%a+):([%d.]+):(%d+)$")
		if (protocol ~= "tcp" and protocol ~= "udp") or not endpoint(protocol, address, port) then
			return nil, "Invalid extra endpoint; use tcp:IPv4:port or udp:IPv4:port"
		end
	end
	-- Hostname resolution must never create an unproxied DNS bootstrap path.
	-- Missing/unsupported nodes intentionally produce a deny-only policy.
	local lan = "{ " .. table.concat(quoted, ", ") .. " }"
	lines[#lines + 1] = "table inet passwall2_guard {"
	lines[#lines + 1] = "    chain forward {"
	lines[#lines + 1] = "        type filter hook forward priority -10; policy drop;"
	lines[#lines + 1] = "        iifname " .. lan .. " oifname " .. lan .. " accept"
	for _, rule in ipairs(forwarding) do lines[#lines + 1] = rule end
	lines[#lines + 1] = "    }"
	lines[#lines + 1] = "    chain output {"
	lines[#lines + 1] = "        type filter hook output priority -10; policy drop;"
	lines[#lines + 1] = '        oifname "lo" accept'
	lines[#lines + 1] = "        oifname " .. lan .. " accept"
	lines[#lines + 1] = "        meta nfproto ipv6 drop"
	for _, rule in ipairs(endpoints) do lines[#lines + 1] = rule end
	for _, address in ipairs(list(config.ntp_servers)) do
		if ipv4(address) then lines[#lines + 1] = "        ip daddr " .. address .. " udp dport 123 accept" end
	end
	lines[#lines + 1] = "        udp sport 68 udp dport 67 accept"
	lines[#lines + 1] = "    }"
	lines[#lines + 1] = "}"
	return table.concat(lines, "\n") .. "\n"
end

return M
