// "Grafikler" tab: every chart comes with what it shows and what your own data says.
// Training charts draw straight from the public log (window.AD); the WHOOP charts wait
// for health.js to decrypt the private data and announce it with "health-ready".
(function () {
  "use strict";

  var AD = window.AD;
  if (!AD) return;
  var el = AD.el, fmt = AD.fmt, trDate = AD.trDate;
  var NS = "http://www.w3.org/2000/svg";

  // ---------- tabs ----------

  function setView(view) {
    document.body.classList.toggle("view-charts", view === "charts");
    document.querySelectorAll(".tab").forEach(function (t) {
      t.setAttribute("aria-selected", t.dataset.view === view ? "true" : "false");
    });
    if (view === "charts") renderAll();
  }
  document.querySelectorAll(".tab").forEach(function (t) {
    t.onclick = function () {
      history.replaceState(null, "", t.dataset.view === "charts" ? "#grafikler" : "#");
      setView(t.dataset.view);
    };
  });

  // ---------- helpers ----------

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function localDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return localDate(d); }
  function weekStart(s) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return localDate(d); }
  function mean(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : NaN; }
  function sd(xs) {
    if (xs.length < 2) return NaN;
    var m = mean(xs);
    return Math.sqrt(xs.reduce(function (a, x) { return a + (x - m) * (x - m); }, 0) / (xs.length - 1));
  }
  function signed(v, d, unit) {
    return (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v), d || 0) + (unit || "");
  }
  function clock(h) {
    h = ((h % 24) + 24) % 24;
    var m = Math.round(h * 60);
    return pad2(Math.floor(m / 60) % 24) + ":" + pad2(m % 60);
  }
  function hourOf(iso) { return parseInt(iso.slice(11, 13), 10) + parseInt(iso.slice(14, 16), 10) / 60; }
  function zoneOf(s) { return s >= 67 ? "green" : s >= 34 ? "yellow" : "red"; }
  var ZONE_TR = { green: "yeşil", yellow: "sarı", red: "kırmızı" };
  function zoneColor(z) { return css(z === "green" ? "--good" : z === "yellow" ? "--brass" : "--danger"); }

  function mk(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function text(svg, x, y, s, anchor, color) {
    var t = mk("text", { x: x, y: y, "text-anchor": anchor || "start", fill: color || css("--muted"),
                         "font-size": 11, "font-family": "IBM Plex Mono, monospace" });
    t.textContent = s;
    svg.appendChild(t);
    return t;
  }
  // A bar whose data end is rounded and whose base sits square on the baseline.
  function bar(x, y, w, h, r, fill) {
    r = Math.max(0, Math.min(r, w / 2, h));
    var d = "M" + x + " " + (y + h) + " V" + (y + r) + " Q" + x + " " + y + " " + (x + r) + " " + y +
            " H" + (x + w - r) + " Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) + " V" + (y + h) + " Z";
    return mk("path", { d: d, fill: fill });
  }

  var tip = document.getElementById("chartTip");
  function showTip(x, y, s) {
    tip.textContent = s;
    tip.hidden = false;
    var half = tip.offsetWidth / 2;
    tip.style.left = Math.min(window.innerWidth - half - 8, Math.max(half + 8, x)) + "px";
    tip.style.top = Math.max(34, y) + "px";
  }
  function hideTip() { tip.hidden = true; }

  // Hover columns wider than the marks: pick the nearest index along x.
  function hover(svg, W, n, X, onPick, marker) {
    var hit = mk("rect", { x: 0, y: 0, width: W, height: svg.viewBox.baseVal.height, fill: "transparent" });
    svg.appendChild(hit);
    function at(cx, cy) {
      var box = svg.getBoundingClientRect();
      var px = (cx - box.left) * (W / box.width), best = 0, bd = Infinity;
      for (var i = 0; i < n; i++) { var d = Math.abs(X(i) - px); if (d < bd) { bd = d; best = i; } }
      showTip(cx, cy, onPick(best));
      if (marker) marker(best);
    }
    hit.addEventListener("mousemove", function (e) { at(e.clientX, e.clientY); });
    hit.addEventListener("touchstart", function (e) { if (e.touches.length) at(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    hit.addEventListener("touchmove", function (e) { if (e.touches.length) at(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    function off() { hideTip(); if (marker) marker(-1); }
    hit.addEventListener("mouseleave", off);
    hit.addEventListener("touchend", off);
  }

  // One chart card: title, what it shows, the chart, what your data says, and the numbers as a table.
  function card(title, what, svg, says, rows, head, legend) {
    var p = el("div", "panel c-card");
    p.appendChild(el("h3", "h-title", title));
    p.appendChild(el("p", "c-what", what));
    if (legend) p.appendChild(legend);
    var fig = el("figure", "chart");
    fig.appendChild(svg);
    p.appendChild(fig);
    if (says) {
      var s = el("p", "c-says");
      s.appendChild(el("strong", null, "Senin verin: "));
      s.appendChild(document.createTextNode(says));
      p.appendChild(s);
    }
    if (rows && rows.length) {
      var det = el("details", "c-table");
      det.appendChild(el("summary", null, "Tablo olarak gör"));
      var t = el("table", "h-table"), tr = el("tr");
      head.forEach(function (h) { tr.appendChild(el("th", null, h)); });
      t.appendChild(el("thead")).appendChild(tr);
      var tb = el("tbody");
      rows.forEach(function (r) {
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
      var i = el("span", "c-key");
      var sw = el("span", "c-swatch");
      sw.style.background = it.color;
      i.appendChild(sw);
      i.appendChild(document.createTextNode(it.label));
      l.appendChild(i);
    });
    return l;
  }

  // ---------- chart builders ----------

  var W = 720;

  function frame(H, label) {
    var svg = mk("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": label });
    return svg;
  }

  function yGrid(svg, lo, hi, Y, ML, MR, digits, ticks) {
    var n = ticks || 3;
    for (var g = 0; g <= n; g++) {
      var v = lo + (hi - lo) * g / n;
      svg.appendChild(mk("line", { x1: ML, x2: W - MR, y1: Y(v), y2: Y(v), stroke: css("--line"), "stroke-width": 1 }));
      text(svg, ML - 8, Y(v) + 4, fmt(v, digits || 0), "end");
    }
  }

  function xDates(svg, dates, X, y) {
    var n = dates.length, every = Math.max(1, Math.ceil(n / 6));
    dates.forEach(function (d, i) {
      if (i === 0 || i === n - 1 || i % every === 0 && n - 1 - i >= every / 2) {
        text(svg, X(i), y, trDate(d).slice(0, 5), i === 0 ? "start" : i === n - 1 ? "end" : "middle");
      }
    });
  }

  // Bars: [{key, v, color, tip}]
  function barChart(data, opt) {
    var H = opt.height || 220, ML = 50, MR = 14, MT = 16, MB = 28;
    var iw = W - ML - MR, ih = H - MT - MB, n = data.length;
    var hi = opt.max || Math.max.apply(null, data.map(function (d) { return d.v; }).concat([opt.ref ? opt.ref.v : 0])) * 1.1 || 1;
    var lo = 0;
    var slot = iw / n, bw = Math.max(2, Math.min(28, slot - 2));
    function X(i) { return ML + slot * i + slot / 2; }
    function Y(v) { return MT + ih - (v - lo) / (hi - lo) * ih; }
    var svg = frame(H, opt.label);
    yGrid(svg, lo, hi, Y, ML, MR, opt.digits);
    data.forEach(function (d, i) {
      if (!d.v) return;
      svg.appendChild(bar(X(i) - bw / 2, Y(d.v), bw, Y(0) - Y(d.v), 4, d.color || css("--accent")));
    });
    if (opt.ref) {
      svg.appendChild(mk("line", { x1: ML, x2: W - MR, y1: Y(opt.ref.v), y2: Y(opt.ref.v), stroke: css("--ink"), "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
      text(svg, ML + 6, Y(opt.ref.v) - 6, opt.ref.label, "start", css("--ink"));
    }
    xDates(svg, data.map(function (d) { return d.key; }), X, H - 8);
    var ring = mk("rect", { fill: "none", stroke: css("--ink"), "stroke-width": 1.5, rx: 3, opacity: 0 });
    svg.appendChild(ring);
    hover(svg, W, n, X, function (i) { return data[i].tip; }, function (i) {
      if (i < 0) { ring.setAttribute("opacity", 0); return; }
      ring.setAttribute("x", X(i) - bw / 2 - 3); ring.setAttribute("width", bw + 6);
      ring.setAttribute("y", MT); ring.setAttribute("height", ih); ring.setAttribute("opacity", .35);
    });
    return svg;
  }

  // Line: [{key, v, tip}] plus an optional smoothed series and a shaded band.
  function lineChart(data, opt) {
    var H = opt.height || 220, ML = 50, MR = 14, MT = 16, MB = 28;
    var iw = W - ML - MR, ih = H - MT - MB, n = data.length;
    var vals = data.map(function (d) { return d.v; });
    if (opt.band) vals = vals.concat([opt.band.lo, opt.band.hi]);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.2 || 2;
    lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
    function X(i) { return ML + (n === 1 ? iw / 2 : i / (n - 1) * iw); }
    function Y(v) { return MT + ih - (v - lo) / (hi - lo) * ih; }
    var svg = frame(H, opt.label);
    if (opt.band) {
      svg.appendChild(mk("rect", { x: ML, y: Y(opt.band.hi), width: iw, height: Y(opt.band.lo) - Y(opt.band.hi), fill: css("--good"), "fill-opacity": .12 }));
      text(svg, W - MR, Y(opt.band.hi) - 5, opt.band.label, "end", css("--good"));
    }
    yGrid(svg, lo, hi, Y, ML, MR, opt.digits);
    var main = opt.smooth ? opt.smooth : data;
    var path = "";
    main.forEach(function (d, i) { if (d.v !== null && isFinite(d.v)) path += (path ? " L" : "M") + X(i).toFixed(1) + " " + Y(d.v).toFixed(1); });
    svg.appendChild(mk("path", { d: path, fill: "none", stroke: css("--accent"), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    if (opt.smooth || opt.dots) {
      data.forEach(function (d, i) {
        svg.appendChild(mk("circle", { cx: X(i), cy: Y(d.v), r: 4, fill: d.color || css("--accent"), stroke: css("--surface"), "stroke-width": 2 }));
      });
    }
    // Label only the latest value.
    var last = data[n - 1];
    text(svg, X(n - 1), Y(last.v) - 10, fmt(last.v, opt.digits || 0), "end", css("--ink"));
    xDates(svg, data.map(function (d) { return d.key; }), X, H - 8);
    var cross = mk("line", { y1: MT, y2: MT + ih, stroke: css("--muted"), "stroke-width": 1, opacity: 0 });
    var dot = mk("circle", { r: 6, fill: "none", stroke: css("--accent"), "stroke-width": 2, opacity: 0 });
    svg.appendChild(cross);
    svg.appendChild(dot);
    hover(svg, W, n, X, function (i) { return data[i].tip; }, function (i) {
      var on = i >= 0 ? 1 : 0;
      cross.setAttribute("opacity", on); dot.setAttribute("opacity", on);
      if (!on) return;
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(data[i].v));
    });
    return svg;
  }

  // ---------- training charts (public) ----------

  function tonnageChart() {
    var weeks = {}, cur = weekStart(localDate(new Date()));
    for (var i = 25; i >= 0; i--) weeks[addDays(cur, -7 * i)] = { t: 0, n: 0 };
    AD.sessions.forEach(function (s) {
      var k = weekStart(s.date);
      if (weeks[k]) { weeks[k].t += AD.tonnage(s); weeks[k].n++; }
    });
    var keys = Object.keys(weeks).sort();
    var data = keys.map(function (k) {
      return { key: k, v: weeks[k].t, tip: trDate(k) + " haftası · " + fmt(weeks[k].t) + " kg · " + weeks[k].n + " seans" };
    });
    var full = data.slice(0, -1);
    var avg8 = mean(full.slice(-8).map(function (d) { return d.v; }));
    var best = full.reduce(function (a, d) { return d.v > a.v ? d : a; }, { v: 0 });
    var zero = full.filter(function (d) { return !d.v; }).length;
    var says = "Son 8 tam haftanın ortalaması " + fmt(avg8) + " kg. En yüklü hafta " + trDate(best.key) + " (" + fmt(best.v) + " kg). " +
      (zero ? zero + " hafta hiç kayıt yok — o haftalarda ya ara verdin ya da Strong'a girmedin. " : "") +
      "Bu hafta şu ana kadar " + fmt(data[data.length - 1].v) + " kg.";
    return card("HAFTALIK TONAJ · SON 6 AY",
      "Her çubuk bir hafta: o hafta kaldırdığın toplam kilo (ağırlık × tekrar, tüm setler). Antrenman hacminin en kaba ölçüsü; " +
      "kesikli çizgi son 8 haftanın ortalaması. Definasyonda tonajın düşmemesi, kası koruduğunun işaretidir.",
      barChart(data, { label: "Haftalık tonaj", ref: { v: avg8, label: "8 hafta ort." } }), says,
      data.slice().reverse().map(function (d) { return [trDate(d.key), fmt(d.v) + " kg", String(weeks[d.key].n)]; }), ["Hafta", "Tonaj", "Seans"]);
  }

  function yearsChart() {
    var years = {};
    AD.sessions.forEach(function (s) { var y = s.date.slice(0, 4); years[y] = (years[y] || 0) + 1; });
    var keys = Object.keys(years).sort();
    var thisYear = String(new Date().getFullYear());
    var data = keys.map(function (y) { return { key: y + "-01-01", v: years[y], tip: y + " · " + years[y] + " seans" }; });
    var svg = barChart(data, { label: "Yıllara göre seans", height: 200 });
    // The date axis would print 01.01 — relabel with the year.
    svg.querySelectorAll("text").forEach(function (t) { if (/^01\.01$/.test(t.textContent)) t.remove(); });
    var n = data.length, iw = W - 64, slot = iw / n;
    keys.forEach(function (y, i) { text(svg, 50 + slot * i + slot / 2, 192, y, "middle"); });
    var dayOfYear = (new Date() - new Date(thisYear + "-01-01")) / 864e5;
    var pace = years[thisYear] ? years[thisYear] / dayOfYear * 7 : 0;
    var full = keys.filter(function (y) { return y !== thisYear && y !== keys[0]; });
    var bestY = full.reduce(function (a, y) { return years[y] > (years[a] || 0) ? y : a; }, full[0]);
    return card("YILLARA GÖRE ANTRENMAN",
      "Her çubuk bir yıl: Strong'a kaydettiğin seans sayısı. İstikrarın, yani yıllar içinde salona ne kadar düzenli gittiğinin resmi.",
      svg, AD.sessions.length + " seans, " + keys[0] + "'dan beri. " + thisYear + " temposu haftada " + fmt(pace, 1) +
      " seans. En düzenli tam yıl " + bestY + " (" + years[bestY] + " seans, haftada " + fmt(years[bestY] / 52, 1) + ").",
      keys.slice().reverse().map(function (y) { return [y, String(years[y])]; }), ["Yıl", "Seans"]);
  }

  var KEY_LIFTS = ["Incline Bench Press (Smith Machine)", "Lat Pulldown (Cable)", "Hack Squat", "Chest Fly"];

  function liftCards() {
    var from = addDays(localDate(new Date()), -365);
    return KEY_LIFTS.map(function (name) {
      var pts = [];
      AD.sessions.forEach(function (s) {
        if (s.date < from) return;
        (s.exercises || []).forEach(function (e) {
          if (e.name !== name || !e.sets.length) return;
          var v = AD.bestE1rm(e.sets), top = e.sets.reduce(function (a, x) { return x.w * (1 + x.r / 30) > a.w * (1 + a.r / 30) ? x : a; }, e.sets[0]);
          pts.push({ key: s.date, v: v, tip: trDate(s.date) + " · " + fmt(top.w, 1) + " × " + top.r + " · e1RM " + fmt(v, 1) });
        });
      });
      // A few logged sets are entry errors (pounds typed as kilos, a stray zero); anything
      // 35% above the year's median is left out rather than drawn as a record.
      var sortedV = pts.map(function (p) { return p.v; }).sort(function (a, b) { return a - b; });
      var med = sortedV[Math.floor(sortedV.length / 2)];
      var dropped = pts.filter(function (p) { return p.v > med * 1.35; }).length;
      pts = pts.filter(function (p) { return p.v <= med * 1.35; });
      if (pts.length < 2) return null;
      var first = pts[0].v, last = pts[pts.length - 1].v;
      var peak = pts.reduce(function (a, p) { return p.v > a.v ? p : a; }, pts[0]);
      var says = "Bir yılda " + signed((last - first) / first * 100, 1, "%") + " (" + fmt(first, 1) + " → " + fmt(last, 1) + "). Zirve " +
        trDate(peak.key) + " (" + fmt(peak.v, 1) + "); son seans zirvenin %" + fmt(last / peak.v * 100) + " seviyesinde" +
        (last / peak.v >= 0.92 ? "." : last / peak.v >= 0.8 ? " — definasyonda bu kadar geri çekilme normal, hedef daha fazla düşmemesi." :
          " — büyük bir fark: ya zirvedeki kayıt hatalı ya da gerçekten geriledin. Bir sonraki ağır günde bakalım.") +
        (dropped ? " (Hatalı görünen " + dropped + " kayıt grafiğe alınmadı.)" : "");
      return card(name.toUpperCase() + " · SON 12 AY",
        "Tahmini tek tekrar maksimumu (e1RM): her seansın en iyi setinden ağırlık × (1 + tekrar ÷ 30). Tek bir sayıyla kuvvetin nereye gittiğini gösterir; 3–8 tekrarlık setlerde en güvenilir.",
        lineChart(pts, { label: name + " e1RM", dots: true, digits: 0, height: 190 }), says,
        pts.slice().reverse().map(function (p) { return [trDate(p.key), fmt(p.v, 1)]; }), ["Tarih", "e1RM"]);
    }).filter(Boolean);
  }

  // ---------- WHOOP charts (private) ----------

  function recoveryCard(Wh) {
    var rs = Wh.recovery;
    var data = rs.map(function (r) {
      var z = zoneOf(r.score);
      return { key: r.date, v: r.score, color: zoneColor(z), tip: trDate(r.date) + " · recovery %" + r.score + " (" + ZONE_TR[z] + ")" };
    });
    var z = { green: 0, yellow: 0, red: 0 };
    rs.forEach(function (r) { z[zoneOf(r.score)]++; });
    var last3 = mean(rs.slice(-3).map(function (r) { return r.score; })), prev3 = mean(rs.slice(-6, -3).map(function (r) { return r.score; }));
    return card("RECOVERY",
      "WHOOP'un her sabah verdiği hazırlık skoru (0–100). HRV, dinlenik nabız, uyku ve solunumdan hesaplanır. " +
      "Yeşil (67+) zorlamak için, sarı (34–66) normal antrenman için, kırmızı (<34) geri çekilmek için.",
      barChart(data, { label: "Günlük recovery", max: 100 }),
      rs.length + " sabah: " + z.green + " yeşil, " + z.yellow + " sarı, " + z.red + " kırmızı. " +
      (isFinite(prev3) ? "Son 3 sabahın ortalaması %" + fmt(last3) + ", önceki 3 sabah %" + fmt(prev3) + " — " +
        (last3 > prev3 + 3 ? "yukarı gidiyor." : last3 < prev3 - 3 ? "aşağı gidiyor." : "yatay.") : ""),
      rs.slice().reverse().map(function (r) { return [trDate(r.date), "%" + r.score, ZONE_TR[zoneOf(r.score)]]; }), ["Sabah", "Recovery", "Bölge"],
      legendOf([{ color: zoneColor("green"), label: "yeşil 67+" }, { color: zoneColor("yellow"), label: "sarı 34–66" }, { color: zoneColor("red"), label: "kırmızı <34" }]));
  }

  function roll7(rs, key) {
    return rs.map(function (r, i) {
      var w = rs.slice(Math.max(0, i - 6), i + 1);
      return { key: r.date, v: w.length >= 3 ? mean(w.map(function (q) { return q[key]; })) : null };
    });
  }

  function hrvCard(Wh) {
    var rs = Wh.recovery;
    var data = rs.map(function (r) { return { key: r.date, v: r.hrv, color: zoneColor(zoneOf(r.score)), tip: trDate(r.date) + " · HRV " + fmt(r.hrv, 1) + " ms" }; });
    var sm = roll7(rs, "hrv");
    var hi = rs.reduce(function (a, r) { return r.hrv > a.hrv ? r : a; }, rs[0]);
    var lastSm = sm.filter(function (s) { return s.v !== null; }).slice(-1)[0];
    return card("HRV (KALP ATIM DEĞİŞKENLİĞİ)",
      "Uykunun son derin evresinde ölçülen, kalp atımları arasındaki sürenin değişkenliği (ms). Yüksek = sinir sistemin dinlenmiş, toparlanmış. " +
      "Günlük değer çok oynar; asıl bakılacak şey çizgi, yani 7 günlük ortalama. Noktaların rengi o sabahın recovery bölgesi.",
      lineChart(data, { label: "HRV", smooth: sm.map(function (s) { return { key: s.key, v: s.v }; }), digits: 0 }),
      "En yüksek HRV'n " + fmt(hi.hrv, 1) + " ms (" + trDate(hi.date) + "). " +
      (lastSm ? "7 günlük ortalaman " + fmt(lastSm.v, 1) + " ms. " : "") +
      "34 yaşında bir erkek için 45–60 arası tipik; hedef 3 ayda ortalamayı 55–60'a taşımak. Kişisel normal aralığın 14 sabahtan sonra oluşacak.",
      rs.slice().reverse().map(function (r) { return [trDate(r.date), fmt(r.hrv, 1) + " ms"]; }), ["Sabah", "HRV"]);
  }

  function rhrCard(Wh) {
    var rs = Wh.recovery;
    var data = rs.map(function (r) { return { key: r.date, v: r.rhr, tip: trDate(r.date) + " · dinlenik nabız " + r.rhr + " bpm" }; });
    var first = rs[0].rhr, last = rs[rs.length - 1].rhr, min = Math.min.apply(null, rs.map(function (r) { return r.rhr; }));
    return card("DİNLENİK NABIZ",
      "Uykuda ölçülen en düşük nabız seviyesi (bpm). Düşük = kalp daha verimli. Kondisyon arttıkça aylar içinde yavaşça iner; " +
      "birkaç gün üst üste 3–5 atım yükselirse yorgunluk, hastalık ya da alkol işaretidir.",
      lineChart(data, { label: "Dinlenik nabız", dots: true, digits: 0 }),
      "İlk sabah " + first + ", son sabah " + last + " bpm; en düşük " + min + ". Zone 2 kardiyoyla 6 ayda hedef 45'in altı.",
      rs.slice().reverse().map(function (r) { return [trDate(r.date), r.rhr + " bpm"]; }), ["Sabah", "Nabız"]);
  }

  function sleepStagesCard(Wh) {
    var nights = Wh.sleep.filter(function (s) { return !s.nap; });
    var stages = [
      { k: "sws", label: "derin", color: css("--sleep-deep") },
      { k: "rem", label: "REM", color: css("--sleep-rem") },
      { k: "light", label: "hafif", color: css("--sleep-light") },
      { k: "awake", label: "uyanık", color: css("--sleep-awake") }
    ];
    var H = 240, ML = 50, MR = 14, MT = 16, MB = 28, iw = W - ML - MR, ih = H - MT - MB, n = nights.length;
    var hi = Math.max(10, Math.ceil(Math.max.apply(null, nights.map(function (s) { return s.bed; }))));
    var slot = iw / n, bw = Math.min(46, slot - 6);
    function X(i) { return ML + slot * i + slot / 2; }
    function Y(v) { return MT + ih - v / hi * ih; }
    var svg = frame(H, "Uyku evreleri");
    yGrid(svg, 0, hi, Y, ML, MR, 0, hi / 2);
    nights.forEach(function (s, i) {
      var base = 0;
      stages.forEach(function (st, j) {
        var v = s[st.k] || 0;
        if (v <= 0) return;
        var top = j === stages.length - 1;
        var y0 = Y(base + v), h = Y(base) - Y(base + v) - (base > 0 ? 2 : 0);
        svg.appendChild(top ? bar(X(i) - bw / 2, y0, bw, Math.max(0, h), 4, st.color)
                            : mk("rect", { x: X(i) - bw / 2, y: y0, width: bw, height: Math.max(0, h), fill: st.color }));
        base += v;
      });
    });
    svg.appendChild(mk("line", { x1: ML, x2: W - MR, y1: Y(7), y2: Y(7), stroke: css("--ink"), "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
    text(svg, ML + 6, Y(7) - 6, "7 saat", "start", css("--ink"));
    xDates(svg, nights.map(function (s) { return s.end.slice(0, 10); }), X, H - 8);
    hover(svg, W, n, X, function (i) {
      var s = nights[i];
      return trDate(s.end.slice(0, 10)) + " · uyku " + fmt(s.asleep, 1) + " sa · derin " + fmt(s.sws, 1) + " · REM " + fmt(s.rem, 1) + " · uyanık " + fmt(s.awake, 1);
    });
    var good = nights.filter(function (s) { return s.asleep >= 7; }).length;
    var tot = mean(nights.map(function (s) { return s.asleep; }));
    var deep = mean(nights.map(function (s) { return s.sws / Math.max(0.1, s.asleep) * 100; }));
    var rem = mean(nights.map(function (s) { return s.rem / Math.max(0.1, s.asleep) * 100; }));
    return card("UYKU EVRELERİ",
      "Her çubuk bir gece, yatakta geçen süre evrelere bölünmüş. Derin uyku kas onarımı ve büyüme hormonu için, REM öğrenme ve ruh hali için kritik. " +
      "REM gecenin son saatlerinde yoğunlaşır: geç yatıp erken kalkınca ilk o kaybolur.",
      svg, "7 saati geçen gece: " + good + " / " + n + "; ortalama gerçek uyku " + fmt(tot, 1) + " saat. Derin uyku payın %" + fmt(deep) +
        " (tipik %13–23 — seninki güçlü), REM payın %" + fmt(rem) + " (tipik %20–25).",
      nights.slice().reverse().map(function (s) {
        return [trDate(s.end.slice(0, 10)), fmt(s.asleep, 1), fmt(s.sws, 1), fmt(s.rem, 1), fmt(s.light, 1), fmt(s.awake, 1)];
      }), ["Gece", "Uyku", "Derin", "REM", "Hafif", "Uyanık"], legendOf(stages));
  }

  function sleepTimingCard(Wh) {
    var nights = Wh.sleep.filter(function (s) { return !s.nap; });
    // Clock time runs down the chart from 20:00 to 12:00 next day; after-midnight hours add 24.
    var T0 = 20, T1 = 36;
    function t(iso) { var h = hourOf(iso); return h < 14 ? h + 24 : h; }
    var H = 260, ML = 50, MR = 14, MT = 12, MB = 26, iw = W - ML - MR, ih = H - MT - MB, n = nights.length;
    var slot = iw / n, bw = Math.min(30, slot - 6);
    function X(i) { return ML + slot * i + slot / 2; }
    function Y(h) { return MT + (h - T0) / (T1 - T0) * ih; }
    var svg = frame(H, "Yatış ve kalkış saatleri");
    svg.appendChild(mk("rect", { x: ML, y: Y(22.25), width: iw, height: Y(30) - Y(22.25), fill: css("--good"), "fill-opacity": .10 }));
    text(svg, ML + 6, Y(22.25) + 14, "hedef 22:15 – 06:00", "start", css("--good"));
    [20, 24, 28, 32, 36].forEach(function (h) {
      svg.appendChild(mk("line", { x1: ML, x2: W - MR, y1: Y(h), y2: Y(h), stroke: css("--line") }));
      text(svg, ML - 8, Y(h) + 4, clock(h), "end");
    });
    nights.forEach(function (s, i) {
      var a = t(s.start), b = t(s.end);
      svg.appendChild(mk("rect", { x: X(i) - bw / 2, y: Y(a), width: bw, height: Math.max(2, Y(b) - Y(a)), rx: 4, fill: css("--sleep-rem") }));
    });
    xDates(svg, nights.map(function (s) { return s.end.slice(0, 10); }), X, H - 6);
    hover(svg, W, n, X, function (i) {
      var s = nights[i];
      return trDate(s.end.slice(0, 10)) + " · " + s.start.slice(11, 16) + " → " + s.end.slice(11, 16) + " · tutarlılık %" + (s.cons === null ? "—" : s.cons);
    });
    var beds = nights.map(function (s) { return t(s.start); }), wakes = nights.map(function (s) { return t(s.end); });
    var inTarget = nights.filter(function (s) { var a = t(s.start); return a >= 21.75 && a <= 23; }).length;
    return card("YATIŞ VE KALKIŞ SAATLERİ",
      "Her çubuk bir gece: üst ucu uykuya daldığın, alt ucu uyandığın saat. Çubuklar aynı hizada ne kadar dizilirse uyku düzenin o kadar iyi; " +
      "iç saat düzeni recovery'nin en güçlü belirleyicilerinden. Yeşil bant hedef pencere.",
      svg, "Yatış saatin ortalama " + clock(mean(beds)) + ", sapması ±" + fmt(sd(beds) * 60) + " dakika; kalkış ortalama " + clock(mean(wakes)) +
        ", sapma ±" + fmt(sd(wakes) * 60) + " dakika. 21:45–23:00 arası yatılan gece: " + inTarget + " / " + n + ". Hedef: sapmayı ±30 dakikanın altına indirmek.",
      nights.slice().reverse().map(function (s) { return [trDate(s.end.slice(0, 10)), s.start.slice(11, 16), s.end.slice(11, 16), s.cons === null ? "—" : "%" + s.cons]; }),
      ["Gece", "Yatış", "Kalkış", "Tutarlılık"]);
  }

  function strainCard(Wh) {
    var cs = Wh.cycles.filter(function (c) { return c.end; });
    var trainDays = {};
    AD.sessions.forEach(function (s) { trainDays[s.date] = s.name; });
    Wh.workouts.forEach(function (w) { if (w.strain >= 8 && w.sport !== "increase_relaxation") trainDays[w.start.slice(0, 10)] = trainDays[w.start.slice(0, 10)] || "antrenman"; });
    var data = cs.map(function (c) {
      var d = c.start.slice(0, 10), day = hourOf(c.start) >= 18 ? addDays(d, 1) : d;
      return { key: day, v: c.strain, color: trainDays[day] ? css("--accent") : css("--faint"),
               tip: trDate(day) + " · strain " + fmt(c.strain, 1) + " · " + fmt(c.kcal) + " kcal" + (trainDays[day] ? " · " + trainDays[day] : " · antrenmansız") };
    });
    var tr = data.filter(function (d) { return trainDays[d.key]; }), rest = data.filter(function (d) { return !trainDays[d.key]; });
    return card("GÜNLÜK STRAIN",
      "WHOOP'un gün boyu kalbine binen yükü 0–21 ölçeğinde toplaması. 10–14 orta, 14–18 yüksek, 18+ çok yüksek. " +
      "Turuncu çubuk antrenman günü, gri çubuk antrenmansız gün.",
      barChart(data, { label: "Günlük strain", max: 21, digits: 0 }),
      "Antrenman günlerinde ortalama " + (tr.length ? fmt(mean(tr.map(function (d) { return d.v; })), 1) : "—") +
      ", antrenmansız günlerde " + (rest.length ? fmt(mean(rest.map(function (d) { return d.v; })), 1) : "—") +
      ". Antrenmansız günlerin 5–7 civarında kalması gün içinde az hareket ettiğini gösteriyor; günlük 7–8 bin adım bunu 8–10'a taşır.",
      data.slice().reverse().map(function (d) { return [trDate(d.key), fmt(d.v, 1), trainDays[d.key] || "—"]; }), ["Gün", "Strain", "Antrenman"],
      legendOf([{ color: css("--accent"), label: "antrenman günü" }, { color: css("--faint"), label: "antrenmansız" }]));
  }

  function weightCard(B) {
    var ws = (B.weight || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (ws.length < 2) return null;
    var data = ws.map(function (w) { return { key: w.date, v: w.kg, tip: trDate(w.date) + " · " + fmt(w.kg, 1) + " kg" }; });
    var sm = ws.map(function (w) {
      var from = addDays(w.date, -6);
      return { key: w.date, v: mean(ws.filter(function (x) { return x.date >= from && x.date <= w.date; }).map(function (x) { return x.kg; })) };
    });
    var lost = sm[0].v - sm[sm.length - 1].v;
    return card("KİLO",
      "Sabah tartıları (noktalar) ve 7 günlük ortalaması (çizgi). Günlük kilo su ve tuzla 1–2 kg oynar; kararı çizgiye göre ver.",
      lineChart(data, { label: "Kilo", smooth: sm, digits: 1 }),
      "7 günlük ortalamada toplam " + signed(-lost, 1, " kg") + ". Hedef hız haftada 0,4–0,6 kg.",
      ws.slice().reverse().map(function (w) { return [trDate(w.date), fmt(w.kg, 1) + " kg"]; }), ["Tarih", "Kilo"]);
  }

  // ---------- render ----------

  function section(title, count) {
    var h = el("h2", null, title + " ");
    if (count) h.appendChild(el("span", "count", count));
    return h;
  }

  function renderAll() {
    var host = document.getElementById("chartsView");
    host.textContent = "";
    host.appendChild(el("p", "c-intro", "Grafiklerin üzerine gel ya da dokun: o günün değerleri çıkar. Her grafiğin altında ne gösterdiği ve senin verinin ne dediği yazıyor; ham sayılar için \"Tablo olarak gör\"."));

    var health = window.ADH;
    host.appendChild(section("SAĞLIK · WHOOP", health ? health.W.recovery.length + " sabah" : "şifreli"));
    if (!health) {
      var lock = el("div", "panel");
      lock.appendChild(el("p", "h-note", "WHOOP grafikleri şifreli veriden çiziliyor. \"Defter\" sekmesindeki Sağlık kutusundan şifreyle ya da Face ID ile aç, grafikler burada belirir."));
      host.appendChild(lock);
    } else {
      [recoveryCard, hrvCard, rhrCard, sleepStagesCard, sleepTimingCard, strainCard].forEach(function (fn) {
        try { host.appendChild(fn(health.W)); }
        catch (e) { host.appendChild(el("p", "h-note warn", "Bir grafik çizilemedi: " + e.message)); }
      });
      var wc = weightCard(health.B);
      if (wc) host.appendChild(wc);
    }

    host.appendChild(section("ANTRENMAN", AD.sessions.length + " seans"));
    [tonnageChart, yearsChart].forEach(function (fn) { host.appendChild(fn()); });
    liftCards().forEach(function (c) { host.appendChild(c); });
  }

  document.addEventListener("health-ready", function () {
    if (document.body.classList.contains("view-charts")) renderAll();
  });

  if (location.hash === "#grafikler") setView("charts");
})();
