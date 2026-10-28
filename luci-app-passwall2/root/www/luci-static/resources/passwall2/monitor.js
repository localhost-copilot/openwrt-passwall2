(function () {
  "use strict";
  const root = document.getElementById("pw-monitor");
  if (!root) return;
  const el = (id) => root.querySelector("#pm-" + id);
  const text = (id, value) => { el(id).textContent = value; };
  const number = (value) => typeof value === "number" && Number.isFinite(value);
  const bytes = (value) => {
    if (!number(value)) return "—";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return value.toFixed(i ? 1 : 0) + " " + units[i];
  };
  const mbps = (value) => number(value) ? (value * 8 / 1e6).toFixed(2) : "—";
  const chart = new window.Passwall2Monitor.Chart(root, mbps);
  const devices = new window.Passwall2Monitor.Devices(root, bytes, mbps);
  let previous = null, lastSnapshot = null, lastProbe = null, snapshotFresh = false;
  function card(id, value, state) {
    text(id, value);
    el(id + "-card").dataset.state = state;
  }
  function status(value, state) { text("status", value); el("status").dataset.state = state; }

  function probeView() {
    const p = lastProbe;
    if (!snapshotFresh || !lastSnapshot) {
      card("exit", "—", "pending"); text("health", "状态未知");
      text("exit-detail", "等待路由器状态更新");
      return;
    }
    if (!lastSnapshot.proxy_running || !lastSnapshot.wan.up) {
      card("exit", "—", "bad"); text("health", "不可用");
      text("exit-detail", lastSnapshot.wan.up ? "代理已停止" : "上联网络已断开");
      return;
    }
    if (!p || p.pending) {
      card("exit", "—", "pending"); text("health", "检测中");
      text("exit-detail", "经当前代理检测");
      return;
    }
    card("exit", p.ok ? p.ip : "—", p.ok ? "good" : "bad");
    text("health", p.ok ? "可达" : "检测失败");
    text("exit-detail", p.ok ? (p.country || "未知地区") + " · HTTPS " + p.duration_ms + " ms" : p.reason || "检测暂不可用");
    text("probe-note", (p.checked_at ? new Date(p.checked_at * 1000).toLocaleTimeString() + " 检测 · " : "")
      + "约每 30 秒经代理访问 Cloudflare；HTTPS 请求耗时不等同于 Ping 延迟。");
  }

  function render(data) {
    lastSnapshot = data;
    snapshotFresh = true;
    let down = null, up = null, cpu = null;
    const dt = previous && data.uptime - previous.uptime;
    if (previous && data.boot_id === previous.boot_id && dt > 0 && dt < 15) {
      if (data.traffic && previous.traffic && data.traffic.device === previous.traffic.device) {
        const rx = data.traffic.rx - previous.traffic.rx, tx = data.traffic.tx - previous.traffic.tx;
        if (number(data.traffic.rx) && number(previous.traffic.rx) && rx >= 0) down = rx / dt;
        if (number(data.traffic.tx) && number(previous.traffic.tx) && tx >= 0) up = tx / dt;
      }
      if (data.cpu && previous.cpu) {
        const total = data.cpu.total - previous.cpu.total, idle = data.cpu.idle - previous.cpu.idle;
        if (total > 0 && idle >= 0) cpu = Math.min(100, Math.max(0, 100 * (1 - idle / total)));
      }
    }
    previous = data;
    text("download", mbps(down)); text("upload", mbps(up));
    text("cpu", number(cpu) ? cpu.toFixed(1) : "—");
    text("temperature", number(data.temperature) ? "芯片温度 " + (data.temperature / 1000).toFixed(1) + " °C" : "系统全部 CPU 核心");
    const memory = data.memory;
    text("memory", memory && memory.total > 0 ? (memory.used / memory.total * 100).toFixed(1) : "—");
    text("memory-detail", memory ? bytes(memory.used) + " / " + bytes(memory.total) : "内存数据暂不可用");
    const traffic = data.traffic;
    text("traffic-total", traffic && number(traffic.rx) && number(traffic.tx) ? bytes(traffic.rx + traffic.tx) : "—");
    text("total-up", traffic ? bytes(traffic.tx) : "—"); text("total-down", traffic ? bytes(traffic.rx) : "—");
    text("connections", number(data.connections) ? data.connections.toLocaleString() : "—");
    text("connections-detail", data.connections_max ? "上限 " + data.connections_max.toLocaleString() : "系统连接追踪");
    const wan = data.wan;
    const speed = wan.speed > 0 ? (wan.speed >= 1000 ? wan.speed / 1000 + " Gbps" : wan.speed + " Mbps") : "已连接";
    card("wan", wan.up ? speed : "已断开", wan.up ? "good" : "bad");
    const detail = [wan.address, wan.gateway && "→ " + wan.gateway].filter(Boolean).join(" ") || wan.device || "WAN 暂不可用";
    text("wan-detail", detail); el("wan-detail").title = detail;
    text("interface", (wan.device || "WAN") + " · 分钟平均速率");
    card("proxy", data.proxy_running ? "运行中" : "已停止", data.proxy_running ? "good" : "bad");
    text("node", data.node.name); el("node").title = data.node.name;
    text("node-type", [data.node.core, data.node.protocol].filter(Boolean).join(" / "));
    card("guard", data.guard_active ? "已生效" : data.guard_enabled ? "未生效" : "未开启", data.guard_active ? "good" : data.guard_enabled ? "bad" : "warn");
    text("guard-detail", data.guard_active ? data.guard_enabled ? "外网直连受限" : "保护规则仍在生效" : data.guard_enabled ? "请检查保护规则" : "未启用断线保护");
    if (!wan.up) status("上联断开", "bad");
    else if (!data.proxy_running) status("代理已停止", "bad");
    else if (data.guard_enabled && !data.guard_active) status("保护异常", "bad");
    else status("代理运行中", "good");
    const minutes = Math.floor((data.uptime || 0) / 60);
    text("uptime", "已运行 " + Math.floor(minutes / 1440) + " 天 " + Math.floor(minutes % 1440 / 60) + " 时 " + minutes % 60 + " 分");
    text("updated", new Date(data.timestamp * 1000).toLocaleTimeString() + " 更新");
    el("error").hidden = true;
    chart.setNow(data.timestamp);
    probeView();
  }

  function unavailable() {
    previous = null; snapshotFresh = false;
    el("error").hidden = false;
    text("error", "无法更新路由器数据，以下内容可能已过期。请检查连接或重新登录。");
    text("updated", "数据更新中断");
    for (const id of ["download", "upload", "cpu"]) text(id, "—");
    for (const id of ["wan", "proxy", "guard"]) card(id, "状态未知", "pending");
    status("连接中断", "warn");
    probeView();
  }

  // One request per source; pausing cancels it and late responses cannot repaint stale state.
  function poll(url, receive, interval, failed) {
    let timer, pending = null, active = true;
    async function refresh() {
      if (!active || document.hidden || pending) return;
      clearTimeout(timer);
      const entry = {controller: new AbortController(), cancelled: false};
      pending = entry;
      const timeout = setTimeout(() => entry.controller.abort(), 9000);
      try {
        const response = await fetch(url, {credentials: "same-origin", cache: "no-store", signal: entry.controller.signal});
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        if (active && !document.hidden && !entry.cancelled) receive(data);
      } catch (_) {
        if (active && !document.hidden && !entry.cancelled) failed();
      } finally {
        clearTimeout(timeout); pending = null;
        if (active && !document.hidden) timer = setTimeout(refresh, entry.cancelled ? 0 : typeof interval === "function" ? interval() : interval);
      }
    }
    return {
      refresh,
      pause() { active = false; clearTimeout(timer); if (pending) { pending.cancelled = true; pending.controller.abort(); } },
      resume() { active = true; refresh(); }
    };
  }
  const pollers = [
    poll(root.dataset.statusUrl, render, 2000, unavailable),
    poll(root.dataset.devicesUrl, (data) => devices.update(data), 5000, () => devices.update({devices_source: "unavailable"})),
    poll(root.dataset.historyUrl, (data) => {
      chart.setData(data);
      text("history-note", data.collecting ? "后台采集中 · 最近 24 小时 · 每分钟汇总" : "后台采集未更新 · 当前展示已保存的历史");
    }, 30000, () => text("history-note", "历史更新中断 · 保留上次数据")),
    poll(root.dataset.probeUrl, (data) => { lastProbe = data; probeView(); }, () => lastProbe && lastProbe.pending ? 3000 : 30000,
      () => { lastProbe = {ok: false, reason: "检测请求未完成"}; probeView(); })
  ];
  el("refresh").addEventListener("click", () => pollers.forEach((item) => item.refresh()));
  document.addEventListener("visibilitychange", () => {
    previous = null;
    pollers.forEach((item) => document.hidden ? item.pause() : item.resume());
  });
  window.addEventListener("pagehide", () => { pollers.forEach((item) => item.pause()); chart.destroy(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) { previous = null; chart.connect(); pollers.forEach((item) => item.resume()); } });
  pollers.forEach((item) => item.resume());
})();
