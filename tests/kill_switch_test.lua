local policy = dofile("luci-app-passwall2/luasrc/passwall2/kill_switch.lua")
local function contains(text, value) assert(text:find(value, 1, true), value) end
local function absent(text, value) assert(not text:find(value, 1, true), value) end
local active = assert(policy.render({enabled = "1", node = {address = "203.0.113.10", port = "443"},
	ntp_servers = {"192.0.2.123", "pool.ntp.org"}}))
contains(active, "policy drop;")
contains(active, "meta nfproto ipv6 drop")
contains(active, "ip daddr 203.0.113.10 tcp dport 443 accept")
contains(active, "ip daddr 192.0.2.123 udp dport 123 accept")
absent(active, "pool.ntp.org")
absent(active, "ct state established") -- Established direct flows must also be blocked.
absent(active, "udp dport 53 accept")

-- Removing a node or selecting an unsupported hostname cannot permit direct access.
local missing = assert(policy.render({enabled = "1", node = {address = "node.example", port = "443"}}))
contains(missing, "policy drop;")
absent(missing, "node.example")
absent(missing, "dport 443 accept")

-- Node replacement must revoke the old endpoint instead of accumulating bypasses.
local replaced = assert(policy.render({enabled = "1", node = {address = "203.0.113.11", port = "8443"}}))
absent(replaced, "203.0.113.10")
contains(replaced, "203.0.113.11 tcp dport 8443 accept")

-- Untrusted configuration must never inject nft syntax or broaden destinations.
for _, address in ipairs({"1.2.3.999", "1.2.3.4/0", "1.2.3.4; accept", "01.2.3.4", "::1"}) do
	assert(not policy.render({enabled = "1", endpoints = {"tcp:" .. address .. ":443"}}))
end
for _, port in ipairs({"0", "65536", "443-65535", "443; accept"}) do
	assert(not policy.render({enabled = "1", endpoints = {"tcp:203.0.113.10:" .. port}}))
end
assert(not policy.render({enabled = "1", devices = {'br-lan" accept; #'}}))
assert(not policy.render({enabled = "1", devices = {"lo"}}))
assert(not policy.render({enabled = "1", endpoints = {"icmp:203.0.113.10:443"}}))
assert(not policy.render({enabled = "corrupt"}))
assert(not policy.render({enabled = "1", endpoints = {false}}))

local extra = assert(policy.render({enabled = "1", devices = {"br-lan", "br-iot"},
	endpoints = {"tcp:203.0.113.10:443", "tcp:203.0.113.10:443", "udp:203.0.113.11:51820"}}))
contains(extra, '"br-iot"')
local _, count = extra:gsub("ip daddr 203%.0%.113%.10 tcp dport 443 accept", "")
assert(count == 1)
contains(extra, "udp dport 51820 accept")
local disabled = assert(policy.render({enabled = "0"}))
contains(disabled, "delete table inet passwall2_guard")
absent(disabled, "policy drop")

-- A home uplink exception permits only the two explicit private networks.
local home_route = {lan_device = "br-lan", lan_subnet = "192.168.6.0/24",
	uplink_device = "eth0", uplink_subnet = "192.168.50.0/24"}
local home = assert(policy.render({enabled = "1", local_routes = {home_route}}))
contains(home, 'iifname "br-lan" oifname "eth0" ip saddr 192.168.6.0/24 ip daddr 192.168.50.0/24 counter accept')
contains(home, 'iifname "eth0" oifname "br-lan" ip saddr 192.168.50.0/24 ip daddr 192.168.6.0/24 counter accept')
absent(home, "ct state established")
local output = home:match("chain output (.*)")
absent(output, "192.168.50.0/24") -- Router DNS and other output remain fail-closed.
for _, subnet in ipairs({"0.0.0.0/0", "192.0.0.0/8", "192.168.50.1/24", "192.168.50.0/33",
	"192.168.50.0/24; accept", "8.8.8.0/24", "192.168.6.0/24", "192.168.0.0/16", "::/0",
	"10.0.0.0/7", "172.16.0.0/11", "172.15.0.0/16", "172.32.0.0/16", "192.168.0.0/15"}) do
	home_route.uplink_subnet = subnet
	assert(not policy.render({enabled = "1", local_routes = {home_route}}), subnet)
end
home_route.uplink_subnet = "192.168.50.0/24"
for _, device in ipairs({"lo", "br-lan", 'eth0" accept; #'}) do
	home_route.uplink_device = device
	assert(not policy.render({enabled = "1", local_routes = {home_route}}), device)
end
home_route.uplink_device = "eth0"
home_route.lan_device = "untrusted"
assert(not policy.render({enabled = "1", local_routes = {home_route}}))
assert(not policy.render({enabled = "1", local_routes = {false}}))
assert(not policy.render({enabled = "1", local_routes = "invalid"}))
for _, subnets in ipairs({{"10.0.0.0/8", "172.16.0.0/12"}, {"192.168.6.170/32", "192.168.50.1/32"}}) do
	assert(policy.render({enabled = "1", local_routes = {{lan_device = "br-lan", uplink_device = "eth0",
		lan_subnet = subnets[1], uplink_subnet = subnets[2]}}}))
end
print("Kill switch policy tests passed")
