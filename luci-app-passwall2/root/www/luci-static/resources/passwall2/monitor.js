(function () {
  "use strict";
  const root = document.getElementById("pw-monitor");
  if (!root) return;
  const el = (id) => document.getElementById("pm-" + id);
  const text = (id, value) => {
    el(id).textContent = value;
  };
  const number = (value) => typeof value === "number" && Number.isFinite(value);
  const bytes = (value) => {
    if (!number(value)) return "—";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return value.toFixed(i ? 1 : 0) + " " + units[i];
  };
  const mbps = (value) =>
    number(value) ? ((value * 8) / 1e6).toFixed(2) : "—";
  function badge(id, value, state) {
    text(id, value);
    el(id).className = "pm-badge " + (state || "");
  }
  let previous = null,
    history = [],
    lastSnapshot = null,
    lastProbe = null;
  let snapshotTimer, probeTimer, snapshotRequest, probeRequest;
  let devicesTimer, devicesRequest;
  let historyTimer, historyRequest;
  let chartSeconds = Number(el("range").value);
  const canvas = el("chart");

  function chart() {
    const palette = getComputedStyle(root);
    const color = (name) => palette.getPropertyValue("--pm-" + name).trim();
    const rect = canvas.getBoundingClientRect(),
      ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = Math.max(1, rect.height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const w = rect.width,
      h = rect.height,
      left = 42,
      right = w - 8,
      top = 12,
      bottom = h - 22;
    const end = lastSnapshot ? lastSnapshot.timestamp : Date.now() / 1000;
    const visible = history.filter((p) => p.time >= end - chartSeconds && p.time <= end);
    const peak = Math.max(
      1,
      ...visible.map((p) => (Math.max(p.down || 0, p.up || 0) * 8) / 1e6),
    );
    const scale = Math.ceil(peak * 1.15);
    ctx.font = "10px system-ui";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = top + ((bottom - top) * i) / 4;
      ctx.strokeStyle = color("line");
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = color("muted");
      ctx.fillText((scale * (1 - i / 4)).toFixed(scale < 4 ? 1 : 0), 1, y + 3);
    }
    ctx.fillText("Mbps", 0, h - 4);
    ctx.fillText(chartSeconds < 3600 ? "−10 分钟" : "−" + chartSeconds / 3600 + " 小时", left, h - 4);
    ctx.fillText("现在", Math.max(left, right - 22), h - 4);
    for (const [key, stroke] of [
      ["down", color("down")],
      ["up", color("up")],
    ]) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let drawing = false;
      let previousTime = null;
      for (const point of visible) {
        if (point.gap || (previousTime !== null && point.time - previousTime > 90)) drawing = false;
        previousTime = point.time;
        if (!number(point[key])) {
          drawing = false;
          continue;
        }
        const x = left + ((point.time - end + chartSeconds) / chartSeconds) * (right - left);
        const y = bottom - ((point[key] * 8) / 1e6 / scale) * (bottom - top);
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
      }
      ctx.stroke();
    }
  }

  function devices(data) {
    const body = el("devices");
    body.replaceChildren();
    const list = Array.isArray(data.devices) ? data.devices : [];
    const recent = list.filter(
      (d) =>
        !number(d.last_seen) || data.timestamp * 1000 - d.last_seen <= 120000,
    );
    text(
      "device-count",
      data.devices_source === "bandix"
        ? recent.length + " 台近期活跃设备"
        : "设备统计未就绪",
    );
    const note =
      data.devices_source === "disabled"
        ? "设备速率需要在 Bandix 中开启流量统计；总流量和链路检测仍正常工作。"
        : data.devices_source !== "bandix"
          ? "Bandix 暂不可用，设备数据未更新；不会把缺失数据显示为零流量。"
          : "外网流量由 Bandix 统计，累计值从其本次启动开始；仅展示最近 2 分钟活跃的设备。";
    text("devices-note", note);
    if (!recent.length) {
      const row = body.insertRow(),
        cell = row.insertCell();
      cell.colSpan = 6;
      cell.className = "pm-empty";
      cell.textContent =
        data.devices_source === "bandix"
          ? "暂无近期活跃设备"
          : "设备统计暂不可用";
      return;
    }
    for (const device of recent) {
      const row = body.insertRow();
      row.insertCell().textContent = device.name || device.ip || device.mac;
      const mac = document.createElement("small");
      mac.textContent = device.mac;
      row.cells[0].appendChild(mac);
      for (const value of [
        device.ip || "—",
        number(device.down) ? mbps(device.down) + " Mbps" : "—",
        number(device.up) ? mbps(device.up) + " Mbps" : "—",
        bytes(device.download),
        bytes(device.upload),
      ])
        row.insertCell().textContent = value;
    }
  }

  function probeView() {
    const p = lastProbe;
    if (lastSnapshot && !lastSnapshot.proxy_running) {
      badge("health", "代理已停止", "bad");
      text("exit", "—");
      text("exit-detail", "无可用代理出口");
      return;
    }
    if (!p || p.pending) {
      badge("health", "检测中");
      return;
    }
    if (p.ok) {
      badge("health", "可达", "good");
      text("exit", p.ip);
      text("exit-detail", (p.country || "未知地区") + " · 经当前节点检测");
    } else {
      badge("health", "检测失败", "bad");
      text("exit", "—");
      text("exit-detail", p.reason || "检测暂不可用");
    }
    text(
      "probe-note",
      (p.checked_at
        ? new Date(p.checked_at * 1000).toLocaleTimeString() + " 检测 · "
        : "") +
        (p.ok
          ? "HTTPS 请求耗时 " + p.duration_ms + " ms（非 Ping 延迟）。"
          : (p.reason || "检测请求失败") + "。") +
        "约每 30 秒经代理访问 Cloudflare。",
    );
  }

  function render(data) {
    lastSnapshot = data;
    let down = null,
      up = null,
      cpu = null;
    const dt = previous && data.uptime - previous.uptime;
    if (previous && data.boot_id === previous.boot_id && dt > 0 && dt < 15) {
      if (
        data.traffic &&
        previous.traffic &&
        data.traffic.device === previous.traffic.device
      ) {
        const rx = data.traffic.rx - previous.traffic.rx,
          tx = data.traffic.tx - previous.traffic.tx;
        if (number(data.traffic.rx) && number(previous.traffic.rx) && rx >= 0)
          down = rx / dt;
        if (number(data.traffic.tx) && number(previous.traffic.tx) && tx >= 0)
          up = tx / dt;
      }
      if (data.cpu && previous.cpu) {
        const total = data.cpu.total - previous.cpu.total,
          idle = data.cpu.idle - previous.cpu.idle;
        if (total > 0 && idle >= 0)
          cpu = Math.min(100, Math.max(0, 100 * (1 - idle / total)));
      }
    }
    previous = data;
    text("download", mbps(down));
    text("upload", mbps(up));
    text("cpu", number(cpu) ? cpu.toFixed(1) : "—");
    text(
      "temperature",
      number(data.temperature)
        ? "芯片温度 " + (data.temperature / 1000).toFixed(1) + " °C"
        : "系统全部 CPU 核心",
    );
    const mem = data.memory;
    text(
      "memory",
      mem && mem.total > 0 ? ((mem.used / mem.total) * 100).toFixed(1) : "—",
    );
    text(
      "memory-detail",
      mem ? bytes(mem.used) + " / " + bytes(mem.total) : "内存数据暂不可用",
    );
    text("node", data.node.name);
    text(
      "node-type",
      [data.node.core, data.node.protocol].filter(Boolean).join(" / "),
    );
    text(
      "interface",
      data.traffic
        ? data.traffic.device + " · 分钟平均速率"
        : "WAN 接口暂不可用",
    );
    badge(
      "proxy",
      data.proxy_running ? "运行中" : "已停止",
      data.proxy_running ? "good" : "bad",
    );
    badge(
      "guard",
      data.guard_active
        ? data.guard_enabled
          ? "保护已生效"
          : "规则仍在生效"
        : data.guard_enabled
          ? "保护未生效"
          : "未开启",
      data.guard_active ? "good" : "bad",
    );
    text(
      "connections",
      number(data.connections)
        ? data.connections +
            (data.connections_max ? " / " + data.connections_max : "")
        : "—",
    );
    const minutes = Math.floor((data.uptime || 0) / 60);
    text(
      "uptime",
      Math.floor(minutes / 1440) +
        " 天 " +
        Math.floor((minutes % 1440) / 60) +
        " 时 " +
        (minutes % 60) +
        " 分",
    );
    text(
      "updated",
      new Date(data.timestamp * 1000).toLocaleTimeString() + " 已更新",
    );
    el("error").hidden = true;
    probeView();
    chart();
  }

  async function request(url, controller) {
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
  async function sample() {
    if (document.hidden || snapshotRequest) return;
    clearTimeout(snapshotTimer);
    snapshotRequest = new AbortController();
    try {
      const data = await request(root.dataset.statusUrl, snapshotRequest);
      render(data);
    } catch (_) {
      if (!document.hidden) {
        el("error").hidden = false;
        text(
          "error",
          "无法更新路由器数据，以下内容可能已过期。请检查连接或重新登录。",
        );
        text("updated", "数据更新中断");
        text("download", "—");
        text("upload", "—");
        text("cpu", "—");
        previous = null;
        badge("proxy", "状态未知", "warn");
        badge("guard", "状态未知", "warn");
        badge("health", "状态未知", "warn");
      }
    } finally {
      snapshotRequest = null;
      if (!document.hidden) snapshotTimer = setTimeout(sample, 2000);
    }
  }
  async function sampleDevices() {
    if (document.hidden || devicesRequest) return;
    clearTimeout(devicesTimer);
    devicesRequest = new AbortController();
    try {
      devices(await request(root.dataset.devicesUrl, devicesRequest));
    } catch (error) {
      if (!document.hidden) {
        console.warn("PassWall2 device telemetry unavailable:", error.message);
        devices({ devices_source: "unavailable" });
      }
    } finally {
      devicesRequest = null;
      if (!document.hidden) devicesTimer = setTimeout(sampleDevices, 5000);
    }
  }
  async function sampleHistory() {
    if (document.hidden || historyRequest) return;
    clearTimeout(historyTimer);
    historyRequest = new AbortController();
    try {
      const data = await request(root.dataset.historyUrl, historyRequest);
      history = (Array.isArray(data.points) ? data.points : []).map((p) => ({
        time: p[0], down: p[1] >= 0 ? p[1] : null,
        up: p[2] >= 0 ? p[2] : null, gap: p[3] === 1,
      }));
      text("history-note", data.collecting
        ? "后台采集中 · 每分钟汇总 · 保留最近 24 小时"
        : "后台采集未更新 · 当前展示已保存的历史");
      chart();
    } catch (_) {
      if (!document.hidden) text("history-note", "历史更新中断 · 保留上次数据");
    } finally {
      historyRequest = null;
      if (!document.hidden) historyTimer = setTimeout(sampleHistory, 30000);
    }
  }
  async function check() {
    if (document.hidden || probeRequest) return;
    clearTimeout(probeTimer);
    probeRequest = new AbortController();
    try {
      lastProbe = await request(root.dataset.probeUrl, probeRequest);
      probeView();
    } catch (_) {
      if (!document.hidden) {
        lastProbe = { ok: false, reason: "检测请求未完成" };
        probeView();
      }
    } finally {
      probeRequest = null;
      if (!document.hidden)
        probeTimer = setTimeout(
          check,
          lastProbe && lastProbe.pending ? 3000 : 30000,
        );
    }
  }
  el("refresh").addEventListener("click", () => {
    sample();
    check();
    sampleDevices();
    sampleHistory();
  });
  el("range").addEventListener("change", () => {
    chartSeconds = Number(el("range").value);
    chart();
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(snapshotTimer);
    clearTimeout(probeTimer);
    clearTimeout(devicesTimer);
    clearTimeout(historyTimer);
    previous = null;
    if (document.hidden) {
      if (snapshotRequest) snapshotRequest.abort();
      if (probeRequest) probeRequest.abort();
      if (devicesRequest) devicesRequest.abort();
      if (historyRequest) historyRequest.abort();
    } else {
      sample();
      check();
      sampleDevices();
      sampleHistory();
    }
  });
  window.addEventListener("pagehide", () => {
    themeObserver.disconnect();
    clearTimeout(snapshotTimer);
    clearTimeout(probeTimer);
    clearTimeout(devicesTimer);
    clearTimeout(historyTimer);
    if (snapshotRequest) snapshotRequest.abort();
    if (probeRequest) probeRequest.abort();
    if (devicesRequest) devicesRequest.abort();
    if (historyRequest) historyRequest.abort();
  });
  new ResizeObserver(chart).observe(canvas.parentElement);
  // Aurora changes data-darkmode for both manual and device theme switching.
  // Observe ancestors only, avoiding redraws caused by telemetry DOM updates.
  const themeObserver = new MutationObserver(chart);
  for (
    let ancestor = root.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  )
    themeObserver.observe(ancestor, {
      attributes: true,
      attributeFilter: ["data-darkmode", "data-theme", "class", "style"],
    });
  sample();
  check();
  sampleDevices();
  sampleHistory();
})();
