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
print("Kill switch policy tests passed")
