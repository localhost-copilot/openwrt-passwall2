local history = dofile("luci-app-passwall2/luasrc/passwall2/monitor_history.lua")
local epoch = 1800000000 -- Minute-aligned wall clock.
local function sample(seconds, options)
	options = options or {}
	return {timestamp = epoch + seconds, uptime = options.uptime or seconds + 100,
		boot_id = options.boot_id or "boot-a", traffic = not options.offline and {
			device = options.device or "eth0", rx = options.rx or seconds * 2000, tx = options.tx or seconds * 500}}
end
local function document(state, value)
	return history.document(state, value, epoch)
end

local state = history.restore(nil)
for seconds = 0, 120, 10 do assert(history.update(state, sample(seconds))) end
local saved = document(state, sample(120))
assert(saved.points[2][2] == 2000 and saved.points[2][3] == 500, "rates are averages of counter deltas")
assert(saved.points[1][4] == 1 and saved.points[2][4] == 0, "initial baseline is a discontinuity")
assert(history.update(state, sample(130, {rx = 0, tx = 0})))
assert(document(state, sample(130)).points[3][4] == 1, "counter reset must break the line without negative rates")

for _, options in ipairs({{boot_id = "boot-b"}, {device = "wwan0"}, {offline = true}, {uptime = 1}}) do
	local current = history.restore(saved)
	history.update(current, sample(130))
	history.update(current, sample(140, options))
	local points = document(current, sample(140)).points
	assert(points[#points][4] == 1, "reboot, WAN replacement and offline samples must break the line")
end

-- Simulate a fresh process after checkpoint restore: no old counter may become a baseline.
local restored = history.restore(saved)
history.update(restored, sample(180, {boot_id = "boot-b", uptime = 20, rx = 200, tx = 50}))
local points = document(restored, sample(180)).points
assert(#points == 4 and points[2][2] == 2000, "history survives collector restart")
assert(points[4][2] == -1 and points[4][4] == 1, "first restored sample is unknown, not a traffic spike")
assert(not history.update(restored, sample(0)), "stale boot clock must wait instead of deleting saved history")
assert(#restored.points == 3)

-- Missing samples stay a gap; a clock jump must not become a large average.
local interrupted = history.restore(nil)
history.update(interrupted, sample(0))
history.update(interrupted, sample(120))
assert(document(interrupted, sample(120)).points[2][2] == -1)
history.update(interrupted, sample(190, {uptime = 230}))
assert(document(interrupted, sample(190)).points[3][2] == -1)

-- Two days of continuous collection must remain bounded to one day, including the open minute.
local long = history.restore(nil)
for seconds = 0, 172800, 10 do history.update(long, sample(seconds)) end
local bounded = document(long, sample(172800))
assert(#bounded.points == 1440, "retention must not grow with uptime")
assert(bounded.points[1][1] > epoch + 86400)
assert(#history.restore(bounded).points == 1440, "a full checkpoint can be restored")
assert(#history.restore({version = 99, points = bounded.points}).points == 0)
for _, point in ipairs({{epoch, 0/0, 0, 0}, {epoch, -2, 0, 0}, {epoch, 0, math.huge, 0}, {epoch + 1, 0, 0, 0}}) do
	assert(#history.restore({version = 1, points = {point}}).points == 0, "corrupt checkpoint must be ignored")
end
assert(#history.restore({version = 1, points = {saved.points[2], saved.points[1]}}).points == 0, "unordered history must be ignored")

-- Failed writes must leave the previous checkpoint readable.
local files = {["/history.json"] = "previous checkpoint"}
local fail_write, fail_rename, encoded = false, false, "new checkpoint"
package.loaded["nixio.fs"] = {
	writefile = function(path, value)
		if fail_write == "partial" then files[path] = value:sub(1, 2); return 2 end
		if fail_write then return nil end
		files[path] = value; return #value
	end,
	chmod = function() return true end,
	unlink = function(path) files[path] = nil end,
	rename = function(from, to) if fail_rename then return nil end; files[to] = files[from]; files[from] = nil; return true end
}
package.loaded["luci.jsonc"] = {stringify = function() return encoded end}
fail_write = true
assert(not history.write("/history.json", saved) and files["/history.json"] == "previous checkpoint")
fail_write = "partial"
assert(not history.write("/history.json", saved) and files["/history.json"] == "previous checkpoint", "a disk-full short write must preserve the checkpoint")
fail_write, fail_rename = false, true
assert(not history.write("/history.json", saved) and files["/history.json"] == "previous checkpoint")
fail_rename = false
encoded = string.rep("x", history.max_bytes + 1)
assert(not history.write("/history.json", saved) and files["/history.json"] == "previous checkpoint", "oversized data must not reach disk")
encoded = "new checkpoint"
assert(history.write("/history.json", saved) and files["/history.json"] == encoded and not files["/history.json.new"])
print("Monitor history tests passed")
