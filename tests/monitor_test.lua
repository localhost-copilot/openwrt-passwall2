local monitor = dofile("luci-app-passwall2/luasrc/passwall2/monitor.lua")
local cpu = monitor.cpu("cpu 100 20 30 400 50 6 7 8 90 10\ncpu0 1 2 3 4\n")
assert(cpu.total == 621 and cpu.idle == 450, "guest time must not be double counted")
assert(monitor.cpu("") == nil)
local memory = monitor.memory("MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 350 kB\n")
assert(memory.total == 1024000 and memory.used == 665600, "reclaimable memory is available")
assert(monitor.memory("MemTotal: 1000 kB\n") == nil, "missing data is not zero usage")
local trace = monitor.trace("fl=test\nip=203.0.113.4\nloc=US\nprobe_seconds=0.21\n")
assert(trace.ip == "203.0.113.4" and trace.country == "US")
for _, value in ipairs({"", "<html>Login</html>", "ip=999.1.1.1\n", "ip=1.2.3.4.\n", "ip=1..2.3.4\n"}) do
	assert(monitor.trace(value) == nil, "bad probe must not report healthy")
end
assert(monitor.devices({status = "error"}) == nil)
assert(monitor.devices({status = "success", data = {d = {}}}) ~= nil)
local devices = monitor.devices({status = "success", data = {d = {
	{conn = "router", mac = "router", w_rx_r = 100000},
	{conn = "wired", mac = "client", ip4 = "192.0.2.1", host = "<script>", w_rx_r = 1234, w_tx_r = 100, w_rx_b = 5000, w_tx_b = 300},
}}})
assert(#devices == 1 and devices[1].down == 1234 and devices[1].up == 100)
assert(devices[1].download == 5000 and devices[1].upload == 300)
print("Monitor data tests passed")
