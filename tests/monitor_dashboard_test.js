// Exercise the actual dashboard script with persisted API data and a minimal DOM.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("luci-app-passwall2/root/www/luci-static/resources/passwall2/monitor.js", "utf8");
const epoch = 1800000000;
const points = [
  [epoch - 240, 1000, 100, 1], [epoch - 180, 2000, 200, 0],
  [epoch - 120, 3000, 300, 1], [epoch - 60, 4000, 400, 0],
];

async function openDashboard() {
  const elements = new Map(), timers = new Map(), paths = [];
  let nextTimer = 0, currentPath;
  let snapshot = {timestamp: epoch, uptime: 1000, boot_id: "a", traffic: {device: "eth0", rx: 10000, tx: 1000}, node: {name: "Test"}};
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", value: "3600", events: {}, parentElement: null,
      addEventListener(name, callback) { this.events[name] = callback; },
      replaceChildren() {},
      insertRow() { return {insertCell() { return {}; }}; },
      getBoundingClientRect() { return {width: 600, height: 202}; },
    });
    return elements.get(id);
  }
  const ctx = {
    scale() {}, fillText() {},
    beginPath() { currentPath = []; },
    moveTo(x, y) { currentPath.push(["move", x, y]); },
    lineTo(x, y) { currentPath.push(["line", x, y]); },
    stroke() { if (this.strokeStyle === "--pm-down") paths.push(currentPath); },
  };
  element("pm-chart").getContext = () => ctx;
  element("pw-monitor").dataset = {statusUrl: "status", devicesUrl: "devices", probeUrl: "probe", historyUrl: "history"};
  const context = {
    document: {getElementById: element, hidden: false, addEventListener() {}},
    window: {devicePixelRatio: 1, addEventListener() {}},
    getComputedStyle: () => ({getPropertyValue: (name) => name}),
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} disconnect() {} },
    AbortController, console,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url) {
      const data = url === "status" ? snapshot : url === "history" ? {points, collecting: true}
        : url === "devices" ? {devices_source: "disabled"} : {ok: true, ip: "203.0.113.1"};
      return {ok: true, async json() { return data; }};
    },
  };
  vm.runInNewContext(source, context);
  await new Promise(setImmediate);
  return {
    element, paths,
    async tickStatus(next) {
      snapshot = next;
      const [id, timer] = [...timers].find(([, value]) => value.delay === 2000);
      timers.delete(id); timer.callback(); await new Promise(setImmediate);
    },
    snapshot,
  };
}

(async () => {
  const page = await openDashboard();
  let drawn = page.paths.at(-1);
  assert.equal(drawn.filter((p) => p[0] === "line").length, 2, "saved history must render immediately, including a break across reboot");
  assert.equal(drawn.filter((p) => p[0] === "move").length, 2);
  const reopened = await openDashboard();
  assert.deepEqual(reopened.paths.at(-1), drawn, "reopening must retain the router's history");
  await page.tickStatus({...page.snapshot, uptime: 1004, boot_id: "b", traffic: {device: "eth0", rx: 20000, tx: 2000}});
  assert.equal(page.element("pm-download").textContent, "—", "different boot IDs must not share a counter baseline");
  assert.equal(page.paths.at(-1).length, drawn.length, "live reboot detection must retain old history");
  const range = page.element("pm-range");
  range.value = "86400"; range.events.change();
  assert.equal(page.paths.at(-1).filter((p) => p[0] === "line").length, 2, "range switching must use retained data");
  console.log("Monitor dashboard tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
