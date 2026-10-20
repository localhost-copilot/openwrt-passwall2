local uci = require("uci").cursor()
local policy = require "luci.passwall2.kill_switch"
local global = uci:get_all("passwall2", "@global[0]") or {}
local ntp = uci:get_all("system", "ntp") or {}
local rules, err = policy.render({
	enabled = global.kill_switch,
	devices = global.kill_switch_lan_devices,
	endpoints = global.kill_switch_endpoints,
	node = global.node and uci:get_all("passwall2", global.node) or {},
	ntp_servers = ntp.server
})
if not rules then
	io.stderr:write("PassWall2 kill switch: " .. err .. "\n")
	os.exit(1)
end
io.write(rules)
