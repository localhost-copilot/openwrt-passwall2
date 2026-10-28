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

-- netifd can retain an address briefly after a cable disconnects. Carrier wins.
local wan = {up = true, l3_device = "eth0", ["ipv4-address"] = {{address = "192.0.2.2"}}, route = {{target = "0.0.0.0", mask = 0, nexthop = "192.0.2.1"}}}
local files = {["/proc/uptime"] = "123.45 200", ["/proc/sys/kernel/random/boot_id"] = "boot-a\n",
	["/sys/class/net/eth0/carrier"] = "0", ["/sys/class/net/eth0/speed"] = "-1",
	["/sys/class/net/eth0/statistics/rx_bytes"] = "10000", ["/sys/class/net/eth0/statistics/tx_bytes"] = "1000"}
package.loaded["nixio.fs"] = {readfile = function(path) return files[path] end}
package.loaded["luci.util"] = {ubus = function() return wan end}
local sample = monitor.traffic_snapshot()
assert(not sample.wan.up and sample.traffic == nil, "carrier loss must not look connected because the DHCP lease remains")
files["/sys/class/net/eth0/carrier"] = "1"
files["/sys/class/net/eth0/speed"] = "1000"
sample = monitor.traffic_snapshot()
assert(sample.wan.up and sample.wan.speed == 1000 and sample.traffic.rx == 10000)
assert(sample.wan.address == "192.0.2.2" and sample.wan.gateway == "192.0.2.1")
-- Virtual interfaces have byte counters but need not have an Ethernet carrier/speed file.
wan.l3_device = "pppoe-wan"
files["/sys/class/net/pppoe-wan/statistics/rx_bytes"] = "12000"
files["/sys/class/net/pppoe-wan/statistics/tx_bytes"] = "2000"
sample = monitor.traffic_snapshot()
assert(sample.wan.up and sample.wan.speed == nil and sample.traffic.device == "pppoe-wan")
print("Monitor data tests passed")
