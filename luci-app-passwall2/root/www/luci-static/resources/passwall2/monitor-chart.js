(function () {
  "use strict";
  const ui = (window.Passwall2Monitor = window.Passwall2Monitor || {});
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const clock = (value) => new Date(value * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  // Owns only the bounded history view. Live counters and polling live in monitor.js.
  ui.Chart = class {
    constructor(root, formatRate) {
      this.root = root;
      this.rate = formatRate;
      this.canvas = root.querySelector("#pm-chart");
      this.tip = root.querySelector("#pm-chart-tip");
      this.empty = root.querySelector("#pm-chart-empty");
      this.buttons = [...root.querySelectorAll("#pm-range button")];
      this.points = [];
      this.now = Date.now() / 1000;
      this.seconds = 3600;
      this.selected = null;
      try {
        const saved = Number(localStorage.getItem("passwall2.monitor.range"));
        if ([600, 3600, 86400].includes(saved)) this.seconds = saved;
      } catch (_) { /* Storage can be disabled; history still comes from the router. */ }
      for (const button of this.buttons) {
        button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === this.seconds));
        button.addEventListener("click", () => {
          this.seconds = Number(button.dataset.seconds);
          for (const item of this.buttons) item.setAttribute("aria-pressed", String(item === button));
          try { localStorage.setItem("passwall2.monitor.range", String(this.seconds)); } catch (_) {}
          this.selected = null;
          this.draw();
        });
      }
      this.canvas.addEventListener("pointermove", (event) => this.pointAt(event.clientX));
      this.canvas.addEventListener("pointerleave", () => { this.selected = null; this.draw(); });
      this.canvas.addEventListener("blur", () => { this.selected = null; this.draw(); });
      this.canvas.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
        event.preventDefault();
        const points = this.visible();
        let index = points.findIndex((point) => point.time === this.selected);
        if (event.key === "Escape") this.selected = null;
        else if (points.length) {
          if (event.key === "Home") index = 0;
          else if (event.key === "End" || index < 0) index = points.length - 1;
          else index = Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
          this.selected = points[index].time;
        }
        this.draw();
      });
      this.resize = new ResizeObserver(() => this.draw());
      this.theme = new MutationObserver(() => this.draw());
      this.connect();
    }

    connect() {
      this.resize.observe(this.canvas.parentElement);
      for (let ancestor = this.root.parentElement; ancestor; ancestor = ancestor.parentElement) {
        this.theme.observe(ancestor, { attributes: true, attributeFilter: ["data-darkmode", "data-theme", "class", "style"] });
      }
    }

    destroy() { this.resize.disconnect(); this.theme.disconnect(); this.tip.hidden = true; }

    setData(data) {
      this.points = (Array.isArray(data.points) ? data.points : []).slice(-1440)
        .filter((point) => Array.isArray(point) && finite(point[0]))
        .map((point) => ({ time: point[0], down: finite(point[1]) && point[1] >= 0 ? point[1] : null,
          up: finite(point[2]) && point[2] >= 0 ? point[2] : null, gap: point[3] === 1 }));
      this.draw();
    }

    setNow(timestamp) { if (finite(timestamp)) this.now = timestamp; this.draw(); }

    visible() { return this.points.filter((point) => point.time >= this.now - this.seconds && point.time <= this.now); }

    pointAt(clientX) {
      const rect = this.canvas.getBoundingClientRect();
      const time = this.now - this.seconds + ((clientX - rect.left - 38) / Math.max(1, rect.width - 46)) * this.seconds;
      const nearest = this.visible().reduce((best, point) => !best || Math.abs(point.time - time) < Math.abs(best.time - time) ? point : best, null);
      // Empty periods must not borrow a value from the other side of an outage.
      this.selected = nearest && Math.abs(nearest.time - time) <= 90 ? nearest.time : null;
      this.draw();
    }

    draw() {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(rect.width * ratio);
      this.canvas.height = Math.round(rect.height * ratio);
      const ctx = this.canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      const palette = getComputedStyle(this.root);
      const color = (name) => palette.getPropertyValue("--pm-" + name).trim();
      const left = 38, right = rect.width - 8, top = 10, bottom = rect.height - 22;
      const points = this.visible();
      const peak = Math.max(1, ...points.map((point) => Math.max(point.down || 0, point.up || 0) * 8 / 1e6));
      const ceiling = Math.ceil(peak * 1.15);
      const x = (point) => left + (point.time - this.now + this.seconds) / this.seconds * (right - left);
      const y = (value) => bottom - (value * 8 / 1e6 / ceiling) * (bottom - top);
      ctx.font = "10px system-ui";
      ctx.lineWidth = 1;
      ctx.fillStyle = color("muted");
      for (let i = 0; i <= 2; i++) {
        const at = top + (bottom - top) * i / 2;
        ctx.strokeStyle = color("line");
        ctx.beginPath(); ctx.moveTo(left, at); ctx.lineTo(right, at); ctx.stroke();
        ctx.fillText((ceiling * (1 - i / 2)).toFixed(ceiling < 4 ? 1 : 0), 0, at + 3);
      }
      ctx.fillText("Mbps", 0, rect.height - 3);
      for (let i = 0; i <= 2; i++) {
        const label = clock(this.now - this.seconds + this.seconds * i / 2);
        ctx.fillText(label, left + (right - left) * i / 2 - (i === 2 ? 30 : i === 1 ? 15 : 0), rect.height - 3);
      }
      for (const key of ["down", "up"]) {
        const segments = [];
        let run = [];
        for (const point of points) {
          if (point.gap || (run.length && point.time - run[run.length - 1].time > 90) || !finite(point[key])) {
            if (run.length) segments.push(run);
            run = [];
          }
          if (finite(point[key])) run.push(point);
        }
        if (run.length) segments.push(run);
        for (const segment of segments) {
          if (key === "down" && segment.length > 1) {
            ctx.save();
            ctx.fillStyle = color(key); ctx.globalAlpha = 0.1;
            ctx.beginPath(); ctx.moveTo(x(segment[0]), bottom);
            for (const point of segment) ctx.lineTo(x(point), y(point[key]));
            ctx.lineTo(x(segment[segment.length - 1]), bottom); ctx.closePath(); ctx.fill(); ctx.restore();
          }
          ctx.strokeStyle = color(key); ctx.lineWidth = 1.6;
          ctx.beginPath();
          segment.forEach((point, index) => { if (index) ctx.lineTo(x(point), y(point[key])); else ctx.moveTo(x(point), y(point[key])); });
          ctx.stroke();
          if (segment.length === 1) {
            ctx.fillStyle = color(key); ctx.beginPath(); ctx.arc(x(segment[0]), y(segment[0][key]), 2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      this.empty.hidden = points.some((point) => finite(point.down) || finite(point.up));
      this.empty.textContent = "暂无有效历史，正在后台采集";
      const selected = points.find((point) => point.time === this.selected);
      this.tip.hidden = !selected;
      if (selected) {
        ctx.strokeStyle = color("muted"); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x(selected), top); ctx.lineTo(x(selected), bottom); ctx.stroke();
        this.tip.textContent = clock(selected.time) + " · 分钟平均\n↑ 上传  " + this.rate(selected.up) + " Mbps\n↓ 下载  " + this.rate(selected.down) + " Mbps";
        this.tip.style.left = Math.max(0, Math.min(rect.width - 170, x(selected) + 10)) + "px";
        this.canvas.setAttribute("aria-label", this.tip.textContent.replace(/\n/g, "，"));
      } else this.canvas.setAttribute("aria-label", "WAN 上传与下载历史速率。左右方向键查看采样值。");
    }
  };
})();
