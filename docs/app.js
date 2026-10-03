// Unlocks the page (password or Face ID), then fills the three tabs:
//   BUGÜN     — this morning's readiness; it also sets today's programme in the main script
//   TREND     — WHOOP, weight and cardio, each metric once, one line of meaning each
//   ANTRENMAN — calendar, weekly sets per muscle, recent records (above the log's own charts)
// Everything is decrypted and computed in the browser; nothing is sent anywhere.
(function () {
  "use strict";

  var AD = window.AD;
  if (!AD) return;
  var el = AD.el, fmt = AD.fmt, trDate = AD.trDate;
  var W = null, B = null;   // whoop { recovery, sleep, workouts, cycles, pulled }, body { weight, cardio }

  // ---------- helpers ----------

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function localDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function today() { return localDate(new Date()); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return localDate(d); }
  function weekStart(s) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return localDate(d); }
  function mean(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : NaN; }
  function sd(xs) {
    if (xs.length < 2) return NaN;
    var m = mean(xs);
    return Math.sqrt(xs.reduce(function (a, x) { return a + (x - m) * (x - m); }, 0) / (xs.length - 1));
  }
  function median(xs) {
    var a = xs.filter(isFinite).slice().sort(function (x, y) { return x - y; });
    return a.length ? a[Math.floor(a.length / 2)] : NaN;
  }
  function pearson(xs, ys) {
    if (xs.length < 3) return NaN;
    var mx = mean(xs), my = mean(ys), n = 0, dx = 0, dy = 0;
    for (var i = 0; i < xs.length; i++) {
      n += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) * (xs[i] - mx);
      dy += (ys[i] - my) * (ys[i] - my);
    }
    return dx && dy ? n / Math.sqrt(dx * dy) : NaN;
  }
  function signed(v, d, unit) {
    if (!isFinite(v)) return "—";
    return (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v), d || 0) + (unit || "");
  }
  function pct(v, d) { return "%" + fmt(v, d || 0); }
  function hourOf(iso) { return parseInt(iso.slice(11, 13), 10) + parseInt(iso.slice(14, 16), 10) / 60; }
  function clock(h) { var m = Math.round((((h % 24) + 24) % 24) * 60); return pad2(Math.floor(m / 60) % 24) + ":" + pad2(m % 60); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function zoneOf(s) { return s >= 67 ? "green" : s >= 34 ? "yellow" : "red"; }
  var ZONE_TR = { green: "yeşil", yellow: "sarı", red: "kırmızı" };
  function zoneColor(z) { return css(z === "green" ? "--good" : z === "yellow" ? "--brass" : "--danger"); }

  // ---------- data views ----------

  function recs() { return W.recovery; }
  function recOn(d) { for (var i = 0; i < W.recovery.length; i++) if (W.recovery[i].date === d) return W.recovery[i]; return null; }
  function nights() { return W.sleep.filter(function (s) { return !s.nap; }); }
  function sleepEndingOn(d) { return nights().filter(function (s) { return s.end.slice(0, 10) === d; }).slice(-1)[0] || null; }
  function lifts() { return AD.sessions.filter(function (s) { return AD.categoryOf(s.name); }); }
  function liftsOn(d) { return lifts().filter(function (s) { return s.date === d; }); }
  // WHOOP saw a lifting workout that never made it into Strong.
  function whoopLiftOn(d) {
    return W.workouts.filter(function (x) { return x.start.slice(0, 10) === d && x.sport !== "increase_relaxation" && x.strain >= 8; })[0] || null;
  }

  // Session performance: each lift's e1RM against the median of its previous five sessions
  // (within 180 days), averaged; 100 = your usual level.
  function perfIndex(session) {
    var from = addDays(session.date, -180), ratios = [];
    (session.exercises || []).forEach(function (ex) {
      if (!ex.sets.length) return;
      var prior = [];
      AD.sessions.forEach(function (s) {
        if (s.date >= session.date || s.date < from) return;
        (s.exercises || []).forEach(function (e) { if (e.name === ex.name && e.sets.length) prior.push(AD.bestE1rm(e.sets)); });
      });
      prior = prior.slice(-5);
      if (prior.length < 3) return;
      ratios.push(AD.bestE1rm(ex.sets) / median(prior) * 100);
    });
    return ratios.length >= 2 ? mean(ratios) : NaN;
  }

  // HRV baseline: ln(rMSSD) of the mornings before the last seven, normal range ±0.5 SD.
  function hrvStatus() {
    var ln = recs().filter(function (r) { return !r.calibrating; }).map(function (r) { return Math.log(r.hrv); });
    var last7 = ln.slice(-7), before = ln.slice(0, -7), out = { have: before.length, avg7: Math.exp(mean(last7)) };
    if (before.length >= 14) {
      var m = mean(before), s = sd(before), a = mean(last7);
      out.lo = Math.exp(m - 0.5 * s);
      out.hi = Math.exp(m + 0.5 * s);
      out.state = a < m - 0.5 * s ? "low" : a > m + 0.5 * s ? "high" : "normal";
    }
    return out;
  }

  // ---------- svg ----------

  var NS = "http://www.w3.org/2000/svg", VW = 720;
  function mk(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function frame(w, h, label) { return mk("svg", { viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": label }); }
  function text(svg, x, y, s, anchor, color) {
    var t = mk("text", { x: x, y: y, "text-anchor": anchor || "start", fill: color || css("--muted"), "font-size": 11, "font-family": "IBM Plex Mono, monospace" });
    t.textContent = s;
    svg.appendChild(t);
  }
  // Rounded at the data end, square on the baseline.
  function bar(x, y, w, h, fill) {
    var r = Math.max(0, Math.min(4, w / 2, h));
    return mk("path", { fill: fill, d: "M" + x + " " + (y + h) + " V" + (y + r) + " Q" + x + " " + y + " " + (x + r) + " " + y +
      " H" + (x + w - r) + " Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) + " V" + (y + h) + " Z" });
  }
  function titled(node, s) { var t = mk("title"); t.textContent = s; node.appendChild(t); return node; }

  var tip = $("chartTip");
  function showTip(x, y, s) {
    tip.textContent = s;
    tip.hidden = false;
    var half = tip.offsetWidth / 2;
    tip.style.left = Math.min(window.innerWidth - half - 8, Math.max(half + 8, x)) + "px";
    tip.style.top = Math.max(34, y) + "px";
  }
  // Hover/touch anywhere in a column picks the nearest point.
  function hover(svg, n, X, label, mark) {
    var hit = mk("rect", { x: 0, y: 0, width: VW, height: svg.viewBox.baseVal.height, fill: "transparent" });
    svg.appendChild(hit);
    function at(cx, cy) {
      var box = svg.getBoundingClientRect(), px = (cx - box.left) * (VW / box.width), best = 0, bd = Infinity;
      for (var i = 0; i < n; i++) { var d = Math.abs(X(i) - px); if (d < bd) { bd = d; best = i; } }
      showTip(cx, cy, label(best));
      if (mark) mark(best);
    }
    function off() { tip.hidden = true; if (mark) mark(-1); }
    hit.addEventListener("mousemove", function (e) { at(e.clientX, e.clientY); });
    hit.addEventListener("touchstart", function (e) { if (e.touches.length) at(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    hit.addEventListener("touchmove", function (e) { if (e.touches.length) at(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    hit.addEventListener("mouseleave", off);
    hit.addEventListener("touchend", off);
  }
  function grid(svg, lo, hi, Y, ML, MR, digits, steps) {
    for (var g = 0; g <= (steps || 3); g++) {
      var v = lo + (hi - lo) * g / (steps || 3);
      svg.appendChild(mk("line", { x1: ML, x2: VW - MR, y1: Y(v), y2: Y(v), stroke: css("--line") }));
      text(svg, ML - 8, Y(v) + 4, fmt(v, digits || 0), "end");
    }
  }
  function dates(svg, keys, X, y) {
    var n = keys.length, every = Math.max(1, Math.ceil(n / 6));
    keys.forEach(function (k, i) {
      if (i === 0 || i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2)) {
        text(svg, X(i), y, trDate(k).slice(0, 5), i === 0 ? "start" : i === n - 1 ? "end" : "middle");
      }
    });
  }

  // [{key, v, color?, tip}]
  function barChart(data, o) {
    var H = o.height || 200, ML = 46, MR = 12, MT = 14, MB = 26, ih = H - MT - MB, n = data.length;
    var hi = o.max || Math.max.apply(null, data.map(function (d) { return d.v; })) * 1.15 || 1;
    var slot = (VW - ML - MR) / n, bw = Math.max(2, Math.min(28, slot - 2));
    function X(i) { return ML + slot * i + slot / 2; }
    function Y(v) { return MT + ih - v / hi * ih; }
    var svg = frame(VW, H, o.label);
    grid(svg, 0, hi, Y, ML, MR, o.digits);
    data.forEach(function (d, i) { if (d.v) svg.appendChild(bar(X(i) - bw / 2, Y(d.v), bw, Y(0) - Y(d.v), d.color || css("--accent"))); });
    dates(svg, data.map(function (d) { return d.key; }), X, H - 6);
    hover(svg, n, X, function (i) { return data[i].tip; });
    return svg;
  }

  // [{key, v, tip, color?}] with an optional smoothed line and shaded band.
  function lineChart(data, o) {
    var H = o.height || 200, ML = 46, MR = 12, MT = 14, MB = 26, iw = VW - ML - MR, ih = H - MT - MB, n = data.length;
    var vals = data.map(function (d) { return d.v; }).concat(o.band ? [o.band.lo, o.band.hi] : []);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.2 || 2;
    lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
    function X(i) { return ML + (n === 1 ? iw / 2 : i / (n - 1) * iw); }
    function Y(v) { return MT + ih - (v - lo) / (hi - lo) * ih; }
    var svg = frame(VW, H, o.label);
    if (o.band) svg.appendChild(mk("rect", { x: ML, y: Y(o.band.hi), width: iw, height: Y(o.band.lo) - Y(o.band.hi), fill: css("--good"), "fill-opacity": .12 }));
    grid(svg, lo, hi, Y, ML, MR, o.digits);
    var line = o.smooth || data, d = "";
    line.forEach(function (p, i) { if (p.v !== null && isFinite(p.v)) d += (d ? " L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1); });
    svg.appendChild(mk("path", { d: d, fill: "none", stroke: css("--accent"), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    data.forEach(function (p, i) { svg.appendChild(mk("circle", { cx: X(i), cy: Y(p.v), r: 4, fill: p.color || css("--accent"), stroke: css("--surface"), "stroke-width": 2 })); });
    text(svg, X(n - 1), Y(data[n - 1].v) - 10, fmt(data[n - 1].v, o.digits || 0), "end", css("--ink"));
    dates(svg, data.map(function (p) { return p.key; }), X, H - 6);
    var ring = mk("circle", { r: 7, fill: "none", stroke: css("--accent"), "stroke-width": 2, opacity: 0 });
    svg.appendChild(ring);
    hover(svg, n, X, function (i) { return data[i].tip; }, function (i) {
      ring.setAttribute("opacity", i < 0 ? 0 : 1);
      if (i >= 0) { ring.setAttribute("cx", X(i)); ring.setAttribute("cy", Y(data[i].v)); }
    });
    return svg;
  }

  function spark(vals) {
    var w = 110, h = 28, n = vals.length, lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    function X(i) { return n === 1 ? w / 2 : 3 + i / (n - 1) * (w - 6); }
    function Y(v) { return h - 4 - (v - lo) / (hi - lo) * (h - 8); }
    var s = mk("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h, "aria-hidden": "true" });
    s.appendChild(mk("path", { d: vals.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" "),
      fill: "none", stroke: css("--accent"), "stroke-width": 2, "stroke-linejoin": "round" }));
    s.appendChild(mk("circle", { cx: X(n - 1), cy: Y(vals[n - 1]), r: 3, fill: css("--accent") }));
    return s;
  }

  // ---------- cards ----------

  // Title, one line on what it shows, the figure, one line on what it says, the numbers on demand.
  function card(title, what, fig, says, table, legend) {
    var p = el("div", "panel c-card");
    p.appendChild(el("h3", "h-title", title));
    if (what) p.appendChild(el("p", "c-what", what));
    if (legend) p.appendChild(legend);
    if (fig) {
      var f = el("figure", "chart");
      f.appendChild(fig);
      p.appendChild(f);
    }
    if (says) p.appendChild(el("p", "c-says", says));
    if (table && table.rows.length) {
      var det = el("details", "c-table"), t = el("table", "h-table"), tr = el("tr"), tb = el("tbody");
      det.appendChild(el("summary", null, "Sayılar"));
      table.head.forEach(function (h) { tr.appendChild(el("th", null, h)); });
      t.appendChild(el("thead")).appendChild(tr);
      table.rows.forEach(function (r) {
        var row = el("tr");
        r.forEach(function (c) { row.appendChild(el("td", null, c)); });
        tb.appendChild(row);
      });
      t.appendChild(tb);
      var wrap = el("div", "h-table-wrap");
      wrap.appendChild(t);
      det.appendChild(wrap);
      p.appendChild(det);
    }
    return p;
  }
  function legendOf(items) {
    var l = el("div", "c-legend");
    items.forEach(function (it) {
      var k = el("span", "c-key"), sw = el("span", "c-swatch");
      sw.style.background = it.color;
      k.appendChild(sw);
      k.appendChild(document.createTextNode(it.label));
      l.appendChild(k);
    });
    return l;
  }
  function stat(k, v, sub, cls) {
    var box = el("div", "stat");
    box.appendChild(el("div", "k", k));
    box.appendChild(el("div", "v" + (cls ? " " + cls : ""), v));
    box.appendChild(el("div", "sub", sub));
    return box;
  }
  function safe(host, fn) {
    try { var c = fn(); if (c) host.appendChild(c); }
    catch (e) { host.appendChild(el("p", "h-note warn", "Çizilemedi: " + e.message)); }
  }

  // ---------- BUGÜN ----------

  function renderToday() {
    var host = $("todayCard"), t = today(), rec = recOn(t);
    host.textContent = "";
    var p = el("div", "panel hero");
    var h = el("h3", "h-title", "BUGÜN");
    h.appendChild(el("span", "count", trDate(t) + " · WHOOP " + W.pulled.slice(11, 16) + " çekimi"));
    p.appendChild(h);
    if (!rec) {
      var last = recs().slice(-1)[0];
      p.appendChild(el("p", "h-note", "Bugünün recovery'si henüz yok" + (last ? " (son: " + trDate(last.date) + ", %" + last.score + ")" : "") + ". Veri her sabah 08:00'de çekilir."));
      host.appendChild(p);
      AD.setReadiness(null);
      return;
    }
    var zone = zoneOf(rec.score), prior = recs().filter(function (r) { return r.date < t; }).slice(-7);
    var hrv7 = mean(prior.map(function (r) { return r.hrv; })), rhr7 = mean(prior.map(function (r) { return r.rhr; }));
    var sl = sleepEndingOn(t), rail = el("div", "rail");
    rail.appendChild(stat("Recovery", pct(rec.score), ZONE_TR[zone], "h-zone " + zone));
    rail.appendChild(stat("HRV", fmt(rec.hrv, 1) + " ms", "7 gün " + fmt(hrv7, 1) + " (" + signed(rec.hrv - hrv7, 1) + ")"));
    rail.appendChild(stat("Dinlenik nabız", fmt(rec.rhr) + " bpm", "7 gün " + fmt(rhr7, 1) + " (" + signed(rec.rhr - rhr7, 1) + ")"));
    rail.appendChild(stat("Uyku", sl ? fmt(sl.asleep, 1) + " sa" : "—", sl ? sl.start.slice(11, 16) + "–" + sl.end.slice(11, 16) + " · " + pct(sl.eff) : "kayıt yok"));
    p.appendChild(rail);
    var plan = AD.planFor();
    p.appendChild(el("p", "h-advice " + zone, (plan.done ? "Bugünkü antrenman yapıldı · " : "Sıradaki: " + plan.label + " · ") + {
      green: "Yeşil: ağır gün, ana harekette zorlayabilirsin.",
      yellow: "Sarı: antrenman yap, hacim günü, RPE en fazla 8.",
      red: "Kırmızı: hafif gün — yük %10 aşağı, setler yarıya — ya da sadece yürüyüş."
    }[zone]));
    if (isFinite(rhr7) && rec.rhr >= rhr7 + 3) p.appendChild(el("p", "h-note warn", "Nabız 7 günlük ortalamanın " + fmt(rec.rhr - rhr7, 1) + " üstünde — hasta hissediyorsan hafif tut."));
    if (sl && sl.asleep < 6) p.appendChild(el("p", "h-note warn", "Uyku 6 saatin altında — ağır tekli/ikili yerine hacim çalış."));
    host.appendChild(p);
    AD.setReadiness({ zone: zone, score: rec.score, date: t });
  }

  // ---------- TREND ----------

  function summaryCard() {
    var cyc = W.cycles.filter(function (c) { return c.end; });
    var rows = [
      ["Recovery", recs().map(function (r) { return r.score; }), "%", 0, 1],
      ["HRV", recs().map(function (r) { return r.hrv; }), " ms", 1, 1],
      ["Dinlenik nabız", recs().map(function (r) { return r.rhr; }), " bpm", 0, -1],
      ["Uyku", nights().map(function (s) { return s.asleep; }), " sa", 1, 1],
      ["Uyku verimi", nights().map(function (s) { return s.eff; }), "%", 0, 1],
      ["Günlük strain", cyc.map(function (c) { return c.strain; }), "", 1, 0]
    ];
    var p = card("ÖZET", "Her ölçünün son değeri, kendi son 28 günlük medyanınla karşılaştırmalı. ▲ iyi yönde, ▼ kötü yönde.");
    var list = el("div", "c-trends");
    rows.forEach(function (m) {
      var vals = m[1];
      if (!vals.length) return;
      var last = vals[vals.length - 1], med = median(vals.slice(-29, -1)), delta = last - med;
      var good = !isFinite(delta) || !m[4] || Math.abs(delta) < 1e-9 ? null : (delta > 0) === (m[4] > 0);
      var row = el("div", "c-trend");
      row.appendChild(el("span", "c-trend-k", m[0]));
      row.appendChild(el("span", "c-trend-v", m[2] === "%" ? pct(last, m[3]) : fmt(last, m[3]) + m[2]));
      row.appendChild(el("span", "c-trend-d" + (good === true ? " up" : good === false ? " down" : ""),
        isFinite(med) ? signed(delta, m[3]) + (good === true ? " ▲" : good === false ? " ▼" : "") + "  medyan " + fmt(med, m[3]) : "—"));
      var sp = el("span", "c-trend-s");
      sp.appendChild(spark(vals.slice(-14)));
      row.appendChild(sp);
      list.appendChild(row);
    });
    p.appendChild(list);
    return p;
  }

  function recoveryCard() {
    var z = { green: 0, yellow: 0, red: 0 };
    var data = recs().map(function (r) {
      var zz = zoneOf(r.score);
      z[zz]++;
      return { key: r.date, v: r.score, color: zoneColor(zz), tip: trDate(r.date) + " · %" + r.score + " " + ZONE_TR[zz] };
    });
    return card("RECOVERY", "Sabah hazırlık skoru: yeşil 67+, sarı 34–66, kırmızı 34 altı.",
      barChart(data, { label: "Recovery", max: 100 }),
      data.length + " sabah: " + z.green + " yeşil, " + z.yellow + " sarı, " + z.red + " kırmızı.",
      { head: ["Sabah", "Recovery"], rows: recs().slice().reverse().map(function (r) { return [trDate(r.date), pct(r.score)]; }) },
      legendOf([{ color: zoneColor("green"), label: "yeşil" }, { color: zoneColor("yellow"), label: "sarı" }, { color: zoneColor("red"), label: "kırmızı" }]));
  }

  function hrvCard() {
    var rs = recs(), st = hrvStatus();
    var smooth = rs.map(function (r, i) {
      var w = rs.slice(Math.max(0, i - 6), i + 1);
      return { v: w.length >= 3 ? Math.exp(mean(w.map(function (q) { return Math.log(q.hrv); }))) : null };
    });
    var perf = lifts().slice(-3).map(perfIndex).filter(isFinite), perfAvg = mean(perf);
    var says = st.state === undefined
      ? "7 günlük ortalama " + fmt(st.avg7, 1) + " ms. Kişisel normal aralığın " + (14 - st.have) + " sabah sonra oluşacak (yeşil bant)."
      : st.state === "low" && perfAvg < 97
        ? "HRV normal aralığının altında ve kuvvet geriliyor — bu hafta deload: yük %10, setler %40 aşağı."
        : "7 günlük ortalama " + fmt(st.avg7, 1) + " ms, normal aralık " + fmt(st.lo, 1) + "–" + fmt(st.hi, 1) + ({ low: " — altında, uykuya dikkat.", high: " — üstünde, iyi toparlanıyorsun.", normal: " — içinde." })[st.state];
    return card("HRV", "Uykudaki kalp atım değişkenliği; yüksek = toparlanmış. Çizgi 7 günlük ortalama.",
      lineChart(rs.map(function (r) { return { key: r.date, v: r.hrv, color: zoneColor(zoneOf(r.score)), tip: trDate(r.date) + " · " + fmt(r.hrv, 1) + " ms" }; }),
        { label: "HRV", smooth: smooth, band: st.lo ? { lo: st.lo, hi: st.hi } : null }),
      says);
  }

  function sleepCard() {
    var ns = nights(), n = ns.length;
    var stages = [
      { k: "sws", label: "derin", color: css("--sleep-deep") }, { k: "rem", label: "REM", color: css("--sleep-rem") },
      { k: "light", label: "hafif", color: css("--sleep-light") }, { k: "awake", label: "uyanık", color: css("--sleep-awake") }
    ];
    var H = 220, ML = 46, MR = 12, MT = 14, MB = 26, ih = H - MT - MB;
    var hi = Math.max(10, Math.ceil(Math.max.apply(null, ns.map(function (s) { return s.bed; }))));
    var slot = (VW - ML - MR) / n, bw = Math.min(40, slot - 6);
    function X(i) { return ML + slot * i + slot / 2; }
    function Y(v) { return MT + ih - v / hi * ih; }
    var svg = frame(VW, H, "Uyku evreleri");
    grid(svg, 0, hi, Y, ML, MR, 0, hi / 2);
    ns.forEach(function (s, i) {
      var base = 0;
      stages.forEach(function (st, j) {
        var v = s[st.k] || 0;
        if (v <= 0) return;
        var y0 = Y(base + v), h = Y(base) - y0 - (base > 0 ? 2 : 0);
        svg.appendChild(j === stages.length - 1 ? bar(X(i) - bw / 2, y0, bw, Math.max(0, h), st.color)
          : mk("rect", { x: X(i) - bw / 2, y: y0, width: bw, height: Math.max(0, h), fill: st.color }));
        base += v;
      });
    });
    svg.appendChild(mk("line", { x1: ML, x2: VW - MR, y1: Y(7), y2: Y(7), stroke: css("--ink"), "stroke-dasharray": "5 4" }));
    text(svg, ML + 6, Y(7) - 6, "7 saat", "start", css("--ink"));
    dates(svg, ns.map(function (s) { return s.end.slice(0, 10); }), X, H - 6);
    hover(svg, n, X, function (i) {
      var s = ns[i];
      return trDate(s.end.slice(0, 10)) + " · " + fmt(s.asleep, 1) + " sa · derin " + fmt(s.sws, 1) + " · REM " + fmt(s.rem, 1);
    });
    var good = ns.filter(function (s) { return s.asleep >= 7; }).length;
    var rem = mean(ns.map(function (s) { return s.rem / Math.max(0.1, s.asleep) * 100; }));
    return card("UYKU SÜRESİ", "Her gece evrelerine bölünmüş; derin uyku kas onarımı, REM toparlanma ve öğrenme için.", svg,
      n + " gecenin " + good + " tanesinde 7 saati geçtin, ortalama " + fmt(mean(ns.map(function (s) { return s.asleep; })), 1) + " saat. REM payı " + pct(rem) +
        (rem < 20 ? " — geç yatıp erken kalkınca ilk REM gidiyor." : "."),
      { head: ["Gece", "Uyku", "Derin", "REM", "Uyanık"], rows: ns.slice().reverse().map(function (s) {
        return [trDate(s.end.slice(0, 10)), fmt(s.asleep, 1), fmt(s.sws, 1), fmt(s.rem, 1), fmt(s.awake, 1)];
      }) }, legendOf(stages));
  }

  function timingCard() {
    var ns = nights(), n = ns.length, T0 = 20, T1 = 34;
    function t(iso) { var h = hourOf(iso); return h < 14 ? h + 24 : h; }
    var H = 220, ML = 46, MR = 12, MT = 10, MB = 24, iw = VW - ML - MR, ih = H - MT - MB;
    var slot = iw / n, bw = Math.min(28, slot - 6);
    function X(i) { return ML + slot * i + slot / 2; }
    function Y(h) { return MT + (h - T0) / (T1 - T0) * ih; }
    var svg = frame(VW, H, "Yatış ve kalkış saatleri");
    svg.appendChild(mk("rect", { x: ML, y: Y(22.25), width: iw, height: Y(30) - Y(22.25), fill: css("--good"), "fill-opacity": .1 }));
    text(svg, ML + 6, Y(22.25) + 14, "hedef 22:15 – 06:00", "start", css("--good"));
    [20, 24, 28, 32].forEach(function (h) {
      svg.appendChild(mk("line", { x1: ML, x2: VW - MR, y1: Y(h), y2: Y(h), stroke: css("--line") }));
      text(svg, ML - 8, Y(h) + 4, clock(h), "end");
    });
    ns.forEach(function (s, i) {
      svg.appendChild(mk("rect", { x: X(i) - bw / 2, y: Y(t(s.start)), width: bw, height: Math.max(2, Y(t(s.end)) - Y(t(s.start))), rx: 4, fill: css("--sleep-rem") }));
    });
    dates(svg, ns.map(function (s) { return s.end.slice(0, 10); }), X, H - 6);
    hover(svg, n, X, function (i) { return trDate(ns[i].end.slice(0, 10)) + " · " + ns[i].start.slice(11, 16) + " → " + ns[i].end.slice(11, 16); });
    var beds = ns.map(function (s) { return t(s.start); });
    return card("UYKU DÜZENİ", "Çubuğun üstü yatış, altı kalkış. Aynı hizada dizilmeleri recovery'nin en güçlü belirleyicisi.", svg,
      "Yatış ortalama " + clock(mean(beds)) + ", sapma ±" + fmt(sd(beds) * 60) + " dk. Hedef ±30 dk.");
  }

  function weightCard() {
    var ws = B.weight.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!ws.length) return card("KİLO", null, null, "Henüz tartı yok. Sabah tuvaletten sonra tartıl ve koçuna yaz.");
    var smooth = ws.map(function (w) {
      var from = addDays(w.date, -6);
      return { v: mean(ws.filter(function (x) { return x.date >= from && x.date <= w.date; }).map(function (x) { return x.kg; })) };
    });
    var now = smooth[smooth.length - 1].v, back = ws.filter(function (w) { return w.date <= addDays(ws[ws.length - 1].date, -7); }).length;
    var rate = back ? now - smooth[back - 1].v : NaN;
    return card("KİLO", "Sabah tartıları; çizgi 7 günlük ortalama. Hedef haftada −0,4 / −0,6 kg.",
      ws.length > 1 ? lineChart(ws.map(function (w) { return { key: w.date, v: w.kg, tip: trDate(w.date) + " · " + fmt(w.kg, 1) + " kg" }; }), { label: "Kilo", smooth: smooth, digits: 1, height: 180 }) : null,
      "7 günlük ortalama " + fmt(now, 1) + " kg" + (isFinite(rate) ? ", haftalık " + signed(rate, 2, " kg") + " — " +
        (rate < -0.8 ? "fazla hızlı, kaloriyi 150–200 artır." : rate > -0.2 ? "yavaş, kaloriyi 150–200 azalt." : "hedefte.") : "."));
  }

  function cardioCard() {
    var cs = B.cardio.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!cs.length) return card("KARDİYO", null, null, "Henüz BikeErg kaydı yok. Seanstan sonra süre, ortalama watt ve nabzı yaz.");
    var eff = cs.map(function (c) { return { key: c.date, v: c.watts / c.hr, tip: trDate(c.date) + " · " + c.min + " dk · " + c.watts + " W · " + c.hr + " bpm" }; });
    var from = addDays(today(), -6), week = cs.filter(function (c) { return c.date >= from; }).reduce(function (a, c) { return a + c.min; }, 0);
    return card("KARDİYO", "Aynı nabızda basılan watt (W/bpm); yükseliyorsa kondisyon artıyor.",
      eff.length > 1 ? lineChart(eff, { label: "W/bpm", digits: 2, height: 170 }) : null,
      "Son seans " + cs[cs.length - 1].watts + " W / " + cs[cs.length - 1].hr + " bpm. Son 7 gün " + week + " dk" + (week < 50 ? " — hedef en az 50." : "."));
  }

  function insightsCard() {
    var p = card("İÇGÖRÜLER", "Veri biriktikçe açılır; o zamana kadar ne kadar kaldığını gösterir.");
    var list = el("ul", "c-insights");
    function item(s) { list.appendChild(el("li", null, s)); }

    var pairs = lifts().map(function (s) { var r = recOn(s.date); return r ? { x: r.score, y: perfIndex(s) } : null; })
      .filter(function (q) { return q && isFinite(q.y); });
    if (pairs.length < 10) item("Recovery → performans: " + pairs.length + "/10 seans.");
    else {
      var r = pearson(pairs.map(function (q) { return q.x; }), pairs.map(function (q) { return q.y; }));
      item("Recovery → performans: r = " + fmt(r, 2) + (r > 0.2 ? " — yeşil günlerde gerçekten daha güçlüsün; WHOOP'a göre yük ayarlamak işe yarıyor." : " — belirgin ilişki yok; ısınmadaki hissine daha çok güven."));
    }

    var cost = { push: [], pull: [], legs: [], rest: [] }, rs = recs();
    rs.forEach(function (r, i) {
      var prior = rs.slice(Math.max(0, i - 7), i);
      if (prior.length < 3) return;
      var prev = addDays(r.date, -1), ss = liftsOn(prev);
      var cat = ss.length ? AD.categoryOf(ss[0].name) : whoopLiftOn(prev) ? null : "rest";
      if (cat) cost[cat].push((r.hrv / mean(prior.map(function (q) { return q.hrv; })) - 1) * 100);
    });
    var LAB = { push: "itiş", pull: "çekiş", legs: "bacak" };
    var ready = ["push", "pull", "legs"].filter(function (k) { return cost[k].length >= 3; });
    if (ready.length < 3) item("Antrenman maliyeti (ertesi sabah HRV): itiş " + cost.push.length + "/3, çekiş " + cost.pull.length + "/3, bacak " + cost.legs.length + "/3 sabah.");
    else {
      var worst = ready.reduce(function (a, k) { return mean(cost[k]) < mean(cost[a]) ? k : a; }, ready[0]);
      item("En pahalı gün " + LAB[worst] + ": ertesi sabah HRV " + signed(mean(cost[worst]), 1, "%") + ". Ardından gelen günü hafif planla.");
    }

    var late = [], early = [];
    nights().forEach(function (sl) {
      var night = sl.start.slice(0, 10);
      if (hourOf(sl.start) < 12) night = addDays(night, -1);
      var s = liftsOn(night).filter(function (x) { return x.time; })[0], w = whoopLiftOn(night);
      if (!s && !w) return;
      var h = s ? hourOf("0000-00-00T" + s.time) : hourOf(w.start);
      (h >= 20 ? late : early).push(sl.eff);
    });
    if (late.length < 3 || early.length < 3) item("Geç antrenman → uyku: geç " + late.length + "/3, erken " + early.length + "/3 gece.");
    else item("20:00 sonrası antrenman gecelerinde uyku verimi " + signed(mean(late) - mean(early), 1, " puan") + " (erken antrenmana göre).");

    p.appendChild(list);
    return p;
  }

  function renderTrend() {
    var host = $("trendView");
    host.textContent = "";
    [summaryCard, recoveryCard, hrvCard, sleepCard, timingCard, weightCard, cardioCard, insightsCard].forEach(function (fn) { safe(host, fn); });
  }

  // ---------- ANTRENMAN ----------

  var MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

  function heatmapCard() {
    var byDay = {};
    AD.sessions.forEach(function (s) { byDay[s.date] = (byDay[s.date] || 0) + AD.tonnage(s); });
    var end = today(), start = addDays(weekStart(end), -7 * 52);
    var vals = Object.keys(byDay).filter(function (d) { return d >= start; }).map(function (d) { return byDay[d]; }).sort(function (a, b) { return a - b; });
    var q = [0.25, 0.5, 0.75].map(function (f) { return vals[Math.floor(vals.length * f)] || 0; });
    var heat = ["--heat-1", "--heat-2", "--heat-3", "--heat-4"].map(css);
    var cell = 11, gap = 2, ML = 30, MT = 18, H = MT + 7 * (cell + gap) + 2, Wd = ML + 53 * (cell + gap);
    var svg = frame(Wd, H, "Antrenman takvimi");
    ["Pzt", "", "Çar", "", "Cum", "", "Paz"].forEach(function (l, i) { if (l) text(svg, ML - 6, MT + i * (cell + gap) + 9, l, "end"); });
    var d = start, i = 0, lastM = "", trained = 0;
    while (d <= end) {
      var x = ML + Math.floor(i / 7) * (cell + gap), y = MT + (i % 7) * (cell + gap), v = byDay[d] || 0;
      if (v) trained++;
      svg.appendChild(titled(mk("rect", { x: x, y: y, width: cell, height: cell, rx: 2,
        fill: v ? heat[v <= q[0] ? 0 : v <= q[1] ? 1 : v <= q[2] ? 2 : 3] : css("--surface-2") }), trDate(d) + (v ? " · " + fmt(v) + " kg" : "")));
      if (i % 7 === 0 && d.slice(5, 7) !== lastM) { lastM = d.slice(5, 7); text(svg, x, MT - 6, MONTHS[+lastM - 1]); }
      d = addDays(d, 1);
      i++;
    }
    var p = card("TAKVİM", "Son 12 ay; kare koyulaştıkça o günün tonajı artıyor.", null,
      i + " günün " + trained + " tanesinde antrenman (" + pct(trained / i * 100) + ").", null,
      legendOf([{ color: css("--surface-2"), label: "yok" }].concat(heat.map(function (c, k) { return { color: c, label: ["hafif", "orta", "yüklü", "çok yüklü"][k] }; }))));
    var scroll = el("div", "c-heat-scroll");
    scroll.appendChild(svg);
    p.insertBefore(scroll, p.querySelector(".c-says"));
    return p;
  }

  // Primary muscle 1 set, obvious helper ½.
  var MUSCLES = [
    [/leg curl|romanian|stiff leg|deadlift|back extension/i, { "Arka bacak": 1 }],
    [/hack squat|leg press|squat|lunge/i, { "Ön bacak": 1, "Kalça": 0.5 }],
    [/leg extension/i, { "Ön bacak": 1 }],
    [/calf/i, { "Baldır": 1 }],
    [/hip thrust|glute/i, { "Kalça": 1 }],
    [/reverse fly|face pull|rear delt|lateral raise|shoulder press|overhead press|upright row/i, { "Omuz": 1 }],
    [/pushdown|triceps|skull|kickback|dip/i, { "Triceps": 1, "Göğüs": 0.5 }],
    [/fly|bench|chest press|push up|pec/i, { "Göğüs": 1, "Triceps": 0.5 }],
    [/pulldown|pull up|chin|row|pullover/i, { "Sırt": 1, "Biceps": 0.5 }],
    [/curl/i, { "Biceps": 1 }]
  ];
  function musclesOf(name) {
    for (var i = 0; i < MUSCLES.length; i++) if (MUSCLES[i][0].test(name)) return MUSCLES[i][1];
    return null;
  }

  function muscleCard() {
    var t = new Date(today() + "T12:00:00"), avg = {}, n = 0;
    AD.sessions.forEach(function (s) {
      var age = (t - new Date(s.date + "T12:00:00")) / 864e5;
      if (age < 0 || age >= 28) return;
      n++;
      (s.exercises || []).forEach(function (e) {
        var m = musclesOf(e.name);
        if (m) Object.keys(m).forEach(function (k) { avg[k] = (avg[k] || 0) + m[k] * e.sets.length / 4; });
      });
    });
    var groups = ["Göğüs", "Sırt", "Omuz", "Biceps", "Triceps", "Ön bacak", "Arka bacak", "Kalça", "Baldır"];
    var rowH = 18, ML = 88, MR = 44, MT = 18, H = MT + groups.length * (rowH + 7) + 16;
    var max = Math.max(24, Math.max.apply(null, groups.map(function (g) { return avg[g] || 0; })) + 2);
    function X(v) { return ML + v / max * (VW - ML - MR); }
    var svg = frame(VW, H, "Kas grubuna göre haftalık set");
    svg.appendChild(mk("rect", { x: X(10), y: MT - 4, width: X(20) - X(10), height: groups.length * (rowH + 7), fill: css("--good"), "fill-opacity": .12 }));
    text(svg, X(15), MT - 7, "hedef 10–20", "middle", css("--good"));
    groups.forEach(function (g, i) {
      var y = MT + i * (rowH + 7), v = avg[g] || 0;
      text(svg, ML - 8, y + rowH / 2 + 4, g, "end", css("--ink"));
      if (v) svg.appendChild(titled(mk("rect", { x: ML, y: y, width: Math.max(2, X(v) - ML), height: rowH, rx: 4, fill: css("--accent") }), g + " · " + fmt(v, 1) + " set/hafta"));
      text(svg, VW - MR + 6, y + rowH / 2 + 4, fmt(v, 1), "start", css("--ink"));
    });
    var low = groups.filter(function (g) { return (avg[g] || 0) < 10; });
    return card("KAS GRUBU SETLERİ", "Son 4 haftada kas başına haftalık set (yardımcı kas ½). Gelişim için 10–20 set.", svg,
      (low.length ? "10 altında: " + low.join(", ") + "." : "Hepsi hedefte.") +
        (n < 16 ? " Son 4 haftada defterde " + n + " seans var; eksik kayıt varsa düşük görünür." : ""));
  }

  function recordsCard() {
    var best = {}, count = {}, prs = [];
    AD.sessions.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (s) {
      (s.exercises || []).forEach(function (e) {
        var ok = e.sets.filter(function (x) { return x.r >= 2 && x.r <= 10 && x.w > 0; });
        if (!ok.length) return;
        var top = ok.reduce(function (a, x) { return x.w * (1 + x.r / 30) > a.w * (1 + a.r / 30) ? x : a; });
        var v = top.w * (1 + top.r / 30), prev = best[e.name] || 0;
        // A third or more in one session is an entry error, not a record.
        if ((count[e.name] || 0) >= 5 && v > prev && v < prev * 1.33) prs.push({ date: s.date, name: e.name, w: top.w, r: top.r, gain: (v / prev - 1) * 100 });
        if (!prev || v < prev * 1.33) best[e.name] = Math.max(prev, v);
        count[e.name] = (count[e.name] || 0) + 1;
      });
    });
    var from = addDays(today(), -180), recent = prs.filter(function (r) { return r.date >= from; }).reverse();
    var p = card("REKORLAR", "Son 6 ayda tahmini 1RM'in (2–10 tekrarlık setler) önceki en iyiyi geçtiği seanslar.", null,
      recent.length ? recent.length + " rekor. Definasyonda seyrekleşmesi normal; hedef seviyeyi korumak." : "Son 6 ayda rekor yok — definasyonda beklenen.");
    if (recent.length) {
      var list = el("ol", "c-prs");
      recent.slice(0, 8).forEach(function (r) {
        var li = el("li");
        li.appendChild(el("span", "c-pr-date", trDate(r.date)));
        li.appendChild(el("span", "c-pr-name", r.name));
        li.appendChild(el("span", "c-pr-set", fmt(r.w, 1) + " × " + r.r));
        li.appendChild(el("span", "c-pr-gain", "+" + fmt(r.gain, 1) + "%"));
        list.appendChild(li);
      });
      p.insertBefore(list, p.querySelector(".c-says"));
    }
    return p;
  }

  function renderTrain() {
    var host = $("trainView");
    host.textContent = "";
    [heatmapCard, muscleCard, recordsCard].forEach(function (fn) { safe(host, fn); });
  }

  // ---------- tabs ----------

  var VIEWS = { bugun: "today", trend: "trend", antrenman: "train" };
  function setView(v) {
    document.body.dataset.view = v;
    document.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-selected", t.dataset.view === v ? "true" : "false"); });
  }
  document.querySelectorAll(".tab").forEach(function (t) {
    t.onclick = function () {
      setView(t.dataset.view);
      history.replaceState(null, "", "#" + Object.keys(VIEWS).filter(function (k) { return VIEWS[k] === t.dataset.view; })[0]);
      window.scrollTo(0, 0);
    };
  });
  setView(VIEWS[location.hash.slice(1)] || "today");

  // ---------- unlock ----------

  var PW_KEY = "ad-health-pw", PK_KEY = "ad-health-passkey";
  var currentPw = null, fromPasskey = false;

  function bytes(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function b64(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function rand(n) { return window.crypto.getRandomValues(new Uint8Array(n)); }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // PBKDF2 → AES-CBC + HMAC, as written by tools/build_site.py; the MAC is checked first.
  function decrypt(blob, password) {
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return Promise.reject(new Error("Bu tarayıcı şifre çözmeyi desteklemiyor."));
    var iv = bytes(blob.iv), ct = bytes(blob.ct), signedBytes = new Uint8Array(iv.length + ct.length);
    signedBytes.set(iv, 0);
    signedBytes.set(ct, iv.length);
    return subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (k) { return subtle.deriveBits({ name: "PBKDF2", salt: bytes(blob.salt), iterations: blob.iter, hash: "SHA-256" }, k, 512); })
      .then(function (bits) {
        return subtle.importKey("raw", bits.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
          .then(function (mk2) { return subtle.verify("HMAC", mk2, bytes(blob.mac), signedBytes); })
          .then(function (ok) {
            if (!ok) throw new Error("Şifre yanlış.");
            return subtle.importKey("raw", bits.slice(0, 32), { name: "AES-CBC" }, false, ["decrypt"]);
          })
          .then(function (ek) { return subtle.decrypt({ name: "AES-CBC", iv: iv }, ek, ct); });
      })
      .then(function (gz) { return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); })
      .then(JSON.parse);
  }

  function unlock(password, remember) {
    var msg = $("lockMsg");
    msg.textContent = "Açılıyor…";
    return fetch("private.enc.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("Şifreli veri bulunamadı."); return r.json(); })
      .then(function (blob) { return decrypt(blob, password); })
      .then(function (data) {
        W = data.whoop;
        B = data.body || {};
        B.weight = B.weight || [];
        B.cardio = B.cardio || [];
        currentPw = password;
        if (remember) store(PW_KEY, password);
        msg.textContent = "";
        AD.boot(data.history || []);
        renderToday();
        renderTrend();
        renderTrain();
        offerFaceId();
      })
      .catch(function (e) {
        msg.textContent = e.message || "Açılamadı.";
        store(PW_KEY, null);
        if (e.message === "Şifre yanlış." && fromPasskey) { store(PK_KEY, null); $("faceIdBtn").hidden = true; }
      });
  }

  // ---------- Face ID ----------
  // No server to verify a passkey, so its PRF output — released only by Face ID — seals
  // the password in localStorage with AES-GCM. The plaintext password is never stored.

  function webauthnReady() { return !!(window.PublicKeyCredential && navigator.credentials && window.crypto && window.crypto.subtle); }
  function passkey() { try { return JSON.parse(load(PK_KEY) || "null"); } catch (e) { return null; } }
  function aesKey(raw) { return window.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }

  function prfKey(credId, salt) {
    return navigator.credentials.get({ publicKey: {
      challenge: rand(32), allowCredentials: [{ type: "public-key", id: credId }], userVerification: "required", timeout: 60000,
      extensions: { prf: { eval: { first: salt } } }
    } }).then(function (a) {
      var r = (a.getClientExtensionResults() || {}).prf;
      if (!r || !r.results || !r.results.first) throw new Error("Bu cihaz Face ID ile şifre saklamayı desteklemiyor (iOS 18+ Safari).");
      return aesKey(r.results.first);
    });
  }

  function seal(credId, salt, key) {
    var iv = rand(12);
    return window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(currentPw)).then(function (ct) {
      store(PK_KEY, JSON.stringify({ id: b64(credId), salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
      store(PW_KEY, null);
    });
  }

  function enableFaceId(btn) {
    var salt = rand(32);
    function done() { btn.disabled = true; btn.textContent = "Face ID açık ✓"; }
    function fail(e) {
      btn.disabled = false;
      btn.textContent = "Face ID'yi aç";
      btn.onclick = function () { enableFaceId(btn); };
      alert(e && e.name === "NotAllowedError" ? "Face ID iptal edildi." : (e.message || "Face ID açılamadı."));
    }
    btn.disabled = true;
    btn.textContent = "Face ID bekleniyor…";
    navigator.credentials.create({ publicKey: {
      rp: { name: "Antrenman Defteri" },
      user: { id: rand(16), name: "antrenman-defteri", displayName: "Antrenman Defteri" },
      challenge: rand(32),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60000, extensions: { prf: { eval: { first: salt } } }
    } }).then(function (cred) {
      var id = new Uint8Array(cred.rawId), prf = (cred.getClientExtensionResults() || {}).prf || {};
      if (prf.results && prf.results.first) return aesKey(prf.results.first).then(function (k) { return seal(id, salt, k); }).then(done);
      if (prf.enabled === false) throw new Error("Bu cihaz Face ID ile şifre saklamayı desteklemiyor (iOS 18+ Safari).");
      // Some platforms release the PRF secret only on sign-in, and Safari wants a fresh tap for it.
      btn.disabled = false;
      btn.textContent = "Bitirmek için dokun";
      btn.onclick = function () {
        btn.disabled = true;
        prfKey(id, salt).then(function (k) { return seal(id, salt, k); }).then(done).catch(fail);
      };
    }).catch(fail);
  }

  function offerFaceId() {
    var btn = $("faceIdSetup");
    if (!webauthnReady() || passkey()) return;
    btn.hidden = false;
    btn.onclick = function () { enableFaceId(btn); };
  }

  function unlockWithFaceId() {
    var rec = passkey();
    if (!rec) return;
    $("lockMsg").textContent = "Face ID bekleniyor…";
    prfKey(bytes(rec.id), bytes(rec.salt))
      .then(function (k) { return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(rec.iv) }, k, bytes(rec.ct)); })
      .then(function (pw) { fromPasskey = true; return unlock(new TextDecoder().decode(pw), false); })
      .catch(function (e) {
        $("lockMsg").textContent = e && e.name === "NotAllowedError" ? "Face ID iptal edildi — şifreyle de açabilirsin." : (e.message || "Face ID ile açılamadı.");
      });
  }

  $("lockForm").onsubmit = function (ev) {
    ev.preventDefault();
    fromPasskey = false;
    unlock($("lockPw").value, $("lockRemember").checked);
  };
  $("faceIdBtn").onclick = unlockWithFaceId;

  if (passkey() && webauthnReady()) $("faceIdBtn").hidden = false;
  else if (load(PW_KEY)) unlock(load(PW_KEY), true);
})();
