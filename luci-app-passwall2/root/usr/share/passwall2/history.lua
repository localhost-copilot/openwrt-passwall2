#!/usr/bin/lua
-- This collector only reads interface counters; it never changes proxy/network state.
local fs = require "nixio.fs"
local nixio = require "nixio"
local history = require "luci.passwall2.monitor_history"
local monitor = require "luci.passwall2.monitor"
local runtime = "/tmp/passwall2-monitor"
local ram_path = runtime .. "/history.json"
local disk_path = "/etc/passwall2/monitor-history.json"

local function report(message)
	nixio.syslog("err", "passwall2 history: " .. message)
end

local function checkpoint()
	local lock = nixio.open(runtime .. "/checkpoint.lock", "w", "600")
	if not lock then return nil, "cannot open checkpoint lock" end
	if not lock:lock("tlock") then lock:close(); return nil, "checkpoint already in progress" end
	local document = history.read(ram_path)
	local ok, err
	if document then
		document.saved_at = os.time()
		ok, err = history.write(disk_path, document, true)
	else err = "no valid samples to save" end
	lock:close()
	return ok and document.saved_at, err
end

fs.mkdir(runtime, "700")
fs.mkdir("/etc/passwall2", "700")
if arg[1] == "flush" then
	local saved, err = checkpoint()
	if not saved then report(err) end
	os.exit(saved and 0 or 1)
end
if arg[1] ~= "collect" then error("expected collect or flush") end

local lock = assert(nixio.open(runtime .. "/collector.lock", "w", "600"))
if not lock:lock("tlock") then os.exit(0) end
local restored = history.read(ram_path) or history.read(disk_path)
local state = history.restore(restored)
local saved_at = restored and restored.saved_at
local last_checkpoint = monitor.traffic_snapshot().uptime or 0
while true do
	local sample = monitor.traffic_snapshot()
	if history.update(state, sample) then
		local ok, err = history.write(ram_path, history.document(state, sample, saved_at))
		if not ok then report(err) end
		-- Use monotonic uptime: NTP adjustments must not cause a flash-write loop.
		if sample.uptime - last_checkpoint >= 1800 then
			local saved, save_error = checkpoint()
			if saved then saved_at = saved else report(save_error) end
			last_checkpoint = sample.uptime
		end
	end
	nixio.nanosleep(10)
end
