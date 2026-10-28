(function () {
  "use strict";
  const ui = (window.Passwall2Monitor = window.Passwall2Monitor || {});
  const number = (value) => typeof value === "number" && Number.isFinite(value);
  function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  ui.Devices = class {
    constructor(root, formatBytes, formatRate) {
      this.el = (id) => root.querySelector("#pm-" + id);
      this.bytes = formatBytes;
      this.rate = formatRate;
      this.data = {devices_source: "unavailable"};
      this.rows = new Map();
      this.topRows = new Map();
      this.el("device-search").addEventListener("input", () => this.table());
      this.el("device-sort").addEventListener("change", () => this.table());
    }

    update(data) {
      this.data = data;
      this.recent = (Array.isArray(data.devices) ? data.devices : []).filter((device) =>
        !number(device.last_seen) || data.timestamp * 1000 - device.last_seen <= 120000);
      this.el("device-count").textContent = data.devices_source === "bandix" ? this.recent.length + " 台近期活跃设备" : "设备统计未就绪";
      this.el("devices-note").textContent = data.devices_source === "disabled"
        ? "在 Bandix 中开启流量统计后可查看设备速率。"
        : data.devices_source !== "bandix" ? "Bandix 暂不可用，设备数据未更新。"
          : "外网流量由 Bandix 统计，累计值从其本次启动开始；展示最近 2 分钟活跃的设备。";
      this.top();
      this.table();
    }

    empty(container, message, table) {
      const element = node(table ? "tr" : "p", table ? "" : "pm-empty");
      if (table) { const cell = node("td", "pm-empty", message); cell.colSpan = 6; element.appendChild(cell); }
      else element.textContent = message;
      container.replaceChildren(element);
    }

    top() {
      const container = this.el("top-devices");
      const rate = (device) => (number(device.up) ? Math.max(0, device.up) : 0) + (number(device.down) ? Math.max(0, device.down) : 0);
      const active = [...this.recent].filter((device) => rate(device) > 0).sort((a, b) => rate(b) - rate(a));
      const total = active.reduce((sum, device) => sum + rate(device), 0);
      if (!active.length) {
        this.topRows.clear();
        this.empty(container, this.data.devices_source === "bandix" ? "暂无活跃流量" : "设备统计暂不可用");
        return;
      }
      const keep = new Set();
      for (const device of active.slice(0, 4)) {
        const key = device.mac;
        keep.add(key);
        let row = this.topRows.get(key);
        if (!row) {
          const button = node("button", "pm-top-client"); button.type = "button";
          const line = node("span", "pm-client-line");
          const name = node("span", "pm-client-name"), speed = node("span", "pm-client-speed");
          line.append(name, speed);
          const share = node("span", "pm-share"); share.setAttribute("aria-hidden", "true");
          const up = node("i", "pm-share-up"), down = node("i", "pm-share-down");
          share.append(up, down); button.append(line, share);
          row = {button, name, speed, up, down};
          button.addEventListener("click", () => {
            this.el("device-search").value = key;
            this.table();
            this.el("device-section").scrollIntoView({block: "start", behavior: "auto"});
          });
          this.topRows.set(key, row);
        }
        row.name.textContent = device.name || device.ip || device.mac;
        row.speed.textContent = this.rate(rate(device)) + " Mbps";
        row.button.title = row.name.textContent + "\n↑ " + this.rate(device.up) + " Mbps  ↓ " + this.rate(device.down) + " Mbps";
        row.up.style.width = (number(device.up) ? Math.max(0, device.up) / total * 100 : 0) + "%";
        row.down.style.width = (number(device.down) ? Math.max(0, device.down) / total * 100 : 0) + "%";
      }
      for (const key of this.topRows.keys()) if (!keep.has(key)) this.topRows.delete(key);
      // Reuse button identities; DOM reordering can still blur one in older browsers.
      const focused = document.activeElement;
      const ordered = active.slice(0, 4).map((device) => this.topRows.get(device.mac).button);
      for (const child of [...container.children]) if (!ordered.includes(child)) child.remove();
      ordered.forEach((button, index) => { if (container.children[index] !== button) container.insertBefore(button, container.children[index] || null); });
      if (focused && ordered.includes(focused) && document.activeElement !== focused) focused.focus({preventScroll: true});
    }

    table() {
      const body = this.el("devices");
      const query = this.el("device-search").value.trim().toLocaleLowerCase();
      const sort = this.el("device-sort").value;
      const list = (this.recent || []).filter((device) => [device.name, device.ip, device.mac].join(" ").toLocaleLowerCase().includes(query));
      const rate = (device) => (device.down || 0) + (device.up || 0);
      list.sort((a, b) => sort === "name" ? String(a.name || a.ip || a.mac).localeCompare(String(b.name || b.ip || b.mac))
        : sort === "download" ? (b.download || 0) - (a.download || 0)
          : sort === "upload" ? (b.upload || 0) - (a.upload || 0) : rate(b) - rate(a));
      if (!list.length) {
        this.rows.clear();
        this.empty(body, this.data.devices_source !== "bandix" ? "设备统计暂不可用" : query ? "没有匹配的设备" : "暂无近期活跃设备", true);
        return;
      }
      const keep = new Set();
      const ordered = [];
      for (const device of list) {
        keep.add(device.mac);
        let row = this.rows.get(device.mac);
        if (!row) {
          const element = document.createElement("tr");
          for (let i = 0; i < 6; i++) element.insertCell();
          const name = node("span", ""), mac = node("small", "");
          element.cells[0].append(name, mac);
          row = {element, name, mac};
          this.rows.set(device.mac, row);
        }
        row.name.textContent = device.name || device.ip || device.mac;
        row.mac.textContent = device.mac;
        const values = [device.ip || "—", this.rate(device.down) + " Mbps", this.rate(device.up) + " Mbps", this.bytes(device.download), this.bytes(device.upload)];
        values.forEach((value, index) => { row.element.cells[index + 1].textContent = value; });
        ordered.push(row.element);
      }
      for (const key of this.rows.keys()) if (!keep.has(key)) this.rows.delete(key);
      for (const child of [...body.children]) if (!ordered.includes(child)) child.remove();
      ordered.forEach((row, index) => { if (body.children[index] !== row) body.insertBefore(row, body.children[index] || null); });
    }
  };
})();
