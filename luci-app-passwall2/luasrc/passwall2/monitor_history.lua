-- Bounded minute averages. Counter baselines never survive a collector restart.
local M = {interval = 60, retention = 86400, max_points = 1440, max_bytes = 131072}

local function finite(value, minimum, maximum)
	return type(value) == "number" and value == value and value >= minimum and value <= maximum
end

function M.restore(document)
	local state = {points = {}}
	if type(document) ~= "table" or document.version ~= 1 or type(document.points) ~= "table" or #document.points > M.max_points then return state end
	local last = -1
	for _, point in ipairs(document.points) do
		if type(point) ~= "table" or #point ~= 4 or not finite(point[1], 0, 1e11) or point[1] % M.interval ~= 0 or point[1] <= last
			or not finite(point[2], -1, 1e12) or not finite(point[3], -1, 1e12) or (point[4] ~= 0 and point[4] ~= 1) then return {points = {}} end
		state.points[#state.points + 1] = {point[1], point[2], point[3], point[4]}
		last = point[1]
	end
	return state
end

local function average(pending)
	return {pending.time, pending.seconds > 0 and math.floor(pending.rx / pending.seconds) or -1,
		pending.seconds > 0 and math.floor(pending.tx / pending.seconds) or -1, pending.gap and 1 or 0}
end

local function trim(points, now)
	local first = 1
	while points[first] and (points[first][1] <= now - M.retention or #points - first + 1 > M.max_points) do first = first + 1 end
	if first > 1 then
		local kept = {}
		for i = first, #points do kept[#kept + 1] = points[i] end
		return kept
	end
	return points
end

function M.update(state, sample)
	if type(sample) ~= "table" or not finite(sample.timestamp, 0, 1e11) or not finite(sample.uptime, 0, 1e12) then return false end
	local minute = math.floor(sample.timestamp / M.interval) * M.interval
	local last = state.pending and state.pending.time or (state.points[#state.points] or {})[1]
	-- OpenWrt can start with a stale clock. Keep the checkpoint until time catches up.
	if last and minute < last then state.previous = nil; return false end
	if not state.pending or minute > state.pending.time then
		if state.pending then state.points[#state.points + 1] = average(state.pending) end
		if state.points[#state.points] and state.points[#state.points][1] == minute then table.remove(state.points) end
		state.pending = {time = minute, seconds = 0, rx = 0, tx = 0}
	end
	local previous, traffic = state.previous, sample.traffic
	local dt = previous and sample.uptime - previous.uptime
	local valid = previous and type(sample.boot_id) == "string" and sample.boot_id == previous.boot_id
		and dt > 0 and dt <= 30 and math.abs(sample.timestamp - previous.timestamp - dt) <= 5
		and type(traffic) == "table" and type(previous.traffic) == "table" and traffic.device == previous.traffic.device
	if valid then
		for _, key in ipairs({"rx", "tx"}) do
			if not finite(traffic[key], 0, 9e15) or not finite(previous.traffic[key], 0, 9e15)
				or traffic[key] < previous.traffic[key] or (traffic[key] - previous.traffic[key]) / dt > 1e12 then valid = false end
		end
	end
	local pending = state.pending
	if valid then
		pending.rx = pending.rx + traffic.rx - previous.traffic.rx
		pending.tx = pending.tx + traffic.tx - previous.traffic.tx
		pending.seconds = pending.seconds + dt
	else pending.gap = true end
	state.previous = sample
	state.points = trim(state.points, minute)
	return true
end

function M.document(state, sample, saved_at)
	local points = {}
	for _, point in ipairs(state.points) do points[#points + 1] = point end
	if state.pending then points[#points + 1] = average(state.pending) end
	points = trim(points, math.floor(sample.timestamp / M.interval) * M.interval)
	return {version = 1, points = points, updated_at = sample.timestamp, sample_uptime = sample.uptime,
		boot_id = sample.boot_id, saved_at = saved_at}
end

function M.read(path)
	local fs = require "nixio.fs"
	local stat = fs.stat(path)
	if not stat or stat.size > M.max_bytes then return nil end
	local document = require("luci.jsonc").parse(fs.readfile(path) or "")
	if type(document) ~= "table" or document.version ~= 1 or type(document.points) ~= "table" then return nil end
	local checked = M.restore(document)
	if #checked.points ~= #document.points then return nil end
	return document
end

function M.write(path, document, durable)
	local fs = require "nixio.fs"
	local encoded = require("luci.jsonc").stringify(document)
	if not encoded or #encoded > M.max_bytes then return nil, "history exceeds size limit" end
	-- Same-filesystem rename keeps readers from seeing a partially written JSON file.
	local temporary = path .. ".new"
	if fs.writefile(temporary, encoded) ~= #encoded then fs.unlink(temporary); return nil, "cannot write complete history" end
	if not fs.chmod(temporary, "600") then fs.unlink(temporary); return nil, "cannot protect history" end
	if durable then
		local file = require("nixio").open(temporary, "r")
		local synced = file and file:sync()
		if file then file:close() end
		if not synced then fs.unlink(temporary); return nil, "cannot sync history" end
	end
	if not fs.rename(temporary, path) then fs.unlink(temporary); return nil, "cannot replace history" end
	if durable then
		local directory = require("nixio").open(path:match("^(.*)/"), "r")
		local synced = directory and directory:sync()
		if directory then directory:close() end
		if not synced then return nil, "cannot sync history directory" end
	end
	return true
end

return M
