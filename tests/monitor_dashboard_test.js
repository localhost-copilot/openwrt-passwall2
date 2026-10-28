// Run all three production scripts; keep DOM/canvas plumbing small and deterministic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const directory = "luci-app-passwall2/root/www/luci-static/resources/passwall2/";
const epoch = 1800000000;
const points = [[epoch - 240, 1000, 100, 1], [epoch - 180, 2000, 200, 0], [epoch - 120, 3000, 300, 1], [epoch - 60, 4000, 400, 0]];
const settle = () => new Promise(setImmediate);

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; this.attributes = {}; this.value = ""; this.ownText = ""; }
  set textContent(value) { this.children.forEach((child) => { child.parentElement = null; }); this.children = []; this.ownText = String(value); }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  appendChild(child) { this.insertBefore(child, null); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  insertBefore(child, before) { child.remove(); const at = before ? this.children.indexOf(before) : this.children.length; this.children.splice(at, 0, child); child.parentElement = this; }
  remove() { if (this.parentElement) { const list = this.parentElement.children; list.splice(list.indexOf(this), 1); this.parentElement = null; } }
  replaceChildren(...children) { this.textContent = ""; this.append(...children); }
  insertCell() { return this.appendChild(new Element("td")); }
  get cells() { return this.children; }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  getBoundingClientRect() { return {left: 0, width: 600, height: 180}; }
  scrollIntoView() { this.scrolled = true; }
}

async function openDashboard(storage = new Map()) {
  const elements = new Map(), timers = new Map(), draws = [], documentEvents = {}, windowEvents = {};
  let nextTimer = 0, currentPath, fetchFailure = false, deferred = null;
  let snapshot = {timestamp: epoch, uptime: 1000, boot_id: "a", traffic: {device: "eth0", rx: 10000, tx: 1000},
    wan: {up: true, device: "eth0", speed: 1000}, node: {name: "Test"}, proxy_running: true, guard_enabled: true, guard_active: true};
  let deviceData = {devices_source: "disabled"};
  let probeData = {ok: true, ip: "203.0.113.1", duration_ms: 200};
  function element(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }
  const buttons = [600, 3600, 86400].map((seconds) => { const button = new Element("button"); button.dataset.seconds = String(seconds); return button; });
  const root = element("pw-monitor");
  root.dataset = {statusUrl: "status", devicesUrl: "devices", probeUrl: "probe", historyUrl: "history"};
  root.querySelector = (selector) => element(selector.slice(1));
  root.querySelectorAll = () => buttons;
  element("pm-device-sort").value = "rate";
  element("pm-chart").parentElement = new Element();
  Object.defineProperty(element("pm-chart"), "width", {set() { draws.push([]); }});
  const ctx = {
    scale() {}, fillText() {}, save() {}, restore() {}, fill() {}, closePath() {}, arc() {},
    beginPath() { currentPath = []; }, moveTo(x, y) { currentPath.push(["move", x, y]); }, lineTo(x, y) { currentPath.push(["line", x, y]); },
    stroke() { if (this.strokeStyle === "--pm-down") draws.at(-1).push(currentPath); },
  };
  element("pm-chart").getContext = () => ctx;
  const document = {getElementById: element, hidden: false, createElement: (tag) => new Element(tag), addEventListener(name, callback) { documentEvents[name] = callback; }};
  const context = {
    document,
    window: {devicePixelRatio: 1, addEventListener(name, callback) { windowEvents[name] = callback; }},
    localStorage: {getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    getComputedStyle: () => ({getPropertyValue: (name) => name}),
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    AbortController, console,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; }, clearTimeout(id) { timers.delete(id); },
    async fetch(url) {
      if (url === "status" && fetchFailure) throw new Error("offline");
      let data = url === "status" ? snapshot : url === "history" ? {points, collecting: true}
        : url === "devices" ? deviceData : probeData;
      if (url === "status" && deferred) { const promise = deferred; deferred = null; data = await promise; }
      return {ok: true, async json() { return data; }};
    },
  };
  vm.createContext(context);
  for (const name of ["monitor-chart.js", "monitor-devices.js", "monitor.js"]) vm.runInContext(fs.readFileSync(directory + name, "utf8"), context);
  await settle();
  return {
    element, draws, buttons, snapshot, storage,
    setSnapshot(next) { snapshot = next; }, failStatus(value) { fetchFailure = value; },
    setDevices(data) { deviceData = data; },
    setProbe(data) { probeData = data; },
    deferStatus() { let resolve; deferred = new Promise((done) => { resolve = done; }); return resolve; },
    async visibility(hidden) { document.hidden = hidden; documentEvents.visibilitychange(); await settle(); },
    async tick(delay) { const entry = [...timers].find(([, value]) => value.delay === delay); assert(entry, "expected scheduled poll " + delay); timers.delete(entry[0]); entry[1].callback(); await settle(); },
  };
}

(async () => {
  const page = await openDashboard();
  const drawn = page.draws.at(-1);
  assert.equal(drawn.flat().filter((point) => point[0] === "line").length, 2, "saved history renders immediately, with a break across reboot");
  const reopened = await openDashboard();
  assert.deepEqual(reopened.draws.at(-1), drawn, "reopening retains the router's history");
  page.setSnapshot({...page.snapshot, uptime: 1004, boot_id: "b", traffic: {device: "eth0", rx: 20000, tx: 2000}});
  await page.tick(2000);
  assert.equal(page.element("pm-download").textContent, "—", "different boots cannot share a counter baseline");
  assert.deepEqual(page.draws.at(-1), drawn, "a reboot must not erase older history");
  page.buttons[2].events.click();
  const sameBrowser = await openDashboard(page.storage);
  assert.equal(sameBrowser.buttons[2].getAttribute("aria-pressed"), "true", "time range preference survives reopening without a router write");

  const canvas = page.element("pm-chart");
  canvas.events.keydown({key: "End", preventDefault() {}});
  assert.equal(page.element("pm-chart-tip").hidden, false, "keyboard users can inspect history");
  assert.match(page.element("pm-chart-tip").textContent, /分钟平均/);
  canvas.events.keydown({key: "Escape", preventDefault() {}});
  assert.equal(page.element("pm-chart-tip").hidden, true);
  page.setProbe({pending: true});
  await page.tick(30000);
  // The first 30-second timer may belong to history; the other is the probe.
  if (page.element("pm-health").textContent !== "检测中") await page.tick(30000);
  page.setProbe({ok: true, ip: "203.0.113.2", duration_ms: 300});
  await page.tick(3000);
  assert.equal(page.element("pm-exit").textContent, "203.0.113.2", "a probe pending in another tab must retry promptly");

  const clients = [
    {mac: "aa", name: "Phone", ip: "192.0.2.2", down: 4000, up: 100, download: 10},
    {mac: "bb", name: "<script>test</script>", ip: "192.0.2.3", down: 2000, up: 200, download: 100},
  ];
  page.setDevices({devices_source: "bandix", timestamp: epoch, devices: clients});
  await page.tick(5000);
  assert.equal(page.element("pm-devices").children.length, 2);
  const topButton = page.element("pm-top-devices").children[0];
  await page.tick(5000);
  assert.equal(page.element("pm-top-devices").children[0], topButton, "polling reuses focused ranking buttons");
  const search = page.element("pm-device-search");
  search.value = "192.0.2.3"; search.events.input();
  assert.equal(page.element("pm-devices").children.length, 1);
  assert.equal(page.element("pm-devices").children[0].cells[0].children[0].textContent, clients[1].name, "device names stay literal text");
  search.value = ""; search.events.input();
  page.element("pm-device-sort").value = "download"; page.element("pm-device-sort").events.change();
  assert.equal(page.element("pm-devices").children[0].cells[0].children[0].textContent, clients[1].name);
  topButton.events.click();
  assert.equal(search.value, "aa");
  assert.equal(page.element("pm-devices").children.length, 1, "ranking links filter the full table");

  page.failStatus(true); await page.tick(2000);
  assert.equal(page.element("pm-status").textContent, "连接中断");
  assert.equal(page.element("pm-exit").textContent, "—", "an old probe cannot imply healthy connectivity while status is unavailable");
  assert.equal(page.draws.at(-1).flat().filter((point) => point[0] === "line").length, 2, "fetch failures retain history");
  page.failStatus(false);
  const release = page.deferStatus();
  await page.tick(2000);
  await page.visibility(true); await page.visibility(false);
  release({...page.snapshot, wan: {up: false}}); await settle();
  assert.equal(page.element("pm-status").textContent, "连接中断", "a cancelled request must not repaint after returning to the page");
  await page.tick(0);
  assert.equal(page.element("pm-status").textContent, "代理运行中", "rapid visibility changes must resume polling");
  console.log("Monitor dashboard tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
