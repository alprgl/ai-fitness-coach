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

  // ---------- today rings (WHOOP-style) ----------

  function ring(value, max, color, big, small, sub) {
    var box = el("div", "c-ring");
    var R = 42, C = 2 * Math.PI * R, frac = Math.max(0, Math.min(1, value / max));
    var s = mk("svg", { viewBox: "0 0 110 110", role: "img", "aria-label": small + " " + big });
    s.appendChild(mk("circle", { cx: 55, cy: 55, r: R, fill: "none", stroke: css("--surface-2"), "stroke-width": 10 }));
    s.appendChild(mk("circle", { cx: 55, cy: 55, r: R, fill: "none", stroke: color, "stroke-width": 10, "stroke-linecap": "round",
      "stroke-dasharray": (C * frac).toFixed(1) + " " + C.toFixed(1), transform: "rotate(-90 55 55)" }));
    var t = mk("text", { x: 55, y: 60, "text-anchor": "middle", fill: css("--ink"), "font-size": 22, "font-weight": 600, "font-family": "IBM Plex Mono, monospace" });
    t.textContent = big;
    s.appendChild(t);
    box.appendChild(s);
    box.appendChild(el("div", "c-ring-k", small));
    box.appendChild(el("div", "c-ring-sub", sub));
    return box;
  }

  function ringsCard(Wh) {
    var rec = Wh.recovery[Wh.recovery.length - 1];
    var sl = Wh.sleep.filter(function (s) { return !s.nap; }).slice(-1)[0];
    var cyc = Wh.cycles[Wh.cycles.length - 1];
    var p = el("div", "panel c-card");
    p.appendChild(el("h3", "h-title", "SON DURUM · " + trDate(rec.date)));
    p.appendChild(el("p", "c-what", "WHOOP uygulamasındaki üç halka: recovery (hazırlık), uyku performansı (ihtiyacının ne kadarını uyudun) ve strain (bugüne kadarki yük, 21 üzerinden)."));
    var row = el("div", "c-rings");
    var z = zoneOf(rec.score);
    row.appendChild(ring(rec.score, 100, zoneColor(z), "%" + fmt(rec.score), "RECOVERY", ZONE_TR[z]));
    if (sl) row.appendChild(ring(sl.perf || 0, 100, css("--sleep-rem"), "%" + fmt(sl.perf || 0), "UYKU", fmt(sl.asleep, 1) + " sa uyku"));
    if (cyc) row.appendChild(ring(cyc.strain, 21, css("--accent"), fmt(cyc.strain, 1), "STRAIN", cyc.end ? "gün kapandı" : "gün sürüyor"));
    p.appendChild(row);
    return p;
  }

  // ---------- trend rows vs 28-day personal median ----------

  function median(xs) {
    var a = xs.filter(isFinite).slice().sort(function (x, y) { return x - y; });
    return a.length ? a[Math.floor(a.length / 2)] : NaN;
  }

  function spark(vals, color) {
    var w = 120, h = 30, n = vals.length;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var s = mk("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h, "aria-hidden": "true" });
    var d = vals.map(function (v, i) {
      return (i ? "L" : "M") + (n === 1 ? w / 2 : 3 + i / (n - 1) * (w - 6)).toFixed(1) + " " + (h - 4 - (v - lo) / (hi - lo) * (h - 8)).toFixed(1);
    }).join(" ");
    s.appendChild(mk("path", { d: d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    var lx = n === 1 ? w / 2 : w - 3, ly = h - 4 - (vals[n - 1] - lo) / (hi - lo) * (h - 8);
    s.appendChild(mk("circle", { cx: lx, cy: ly, r: 3, fill: color }));
    return s;
  }

  function trendRowsCard(Wh) {
    var rs = Wh.recovery, nights = Wh.sleep.filter(function (s) { return !s.nap; });
    var cyc = Wh.cycles.filter(function (c) { return c.end; });
    var metrics = [
      { k: "Recovery", vals: rs.map(function (r) { return r.score; }), unit: "%", d: 0, better: 1 },
      { k: "HRV", vals: rs.map(function (r) { return r.hrv; }), unit: " ms", d: 1, better: 1 },
      { k: "Dinlenik nabız", vals: rs.map(function (r) { return r.rhr; }), unit: " bpm", d: 0, better: -1 },
      { k: "Uyku", vals: nights.map(function (s) { return s.asleep; }), unit: " sa", d: 1, better: 1 },
      { k: "Uyku verimi", vals: nights.map(function (s) { return s.eff; }), unit: "%", d: 0, better: 1 },
      { k: "Günlük strain", vals: cyc.map(function (c) { return c.strain; }), unit: "", d: 1, better: 0 }
    ];
    var p = el("div", "panel c-card");
    p.appendChild(el("h3", "h-title", "TREND SATIRLARI · 28 GÜNLÜK KİŞİSEL MEDYAN"));
    p.appendChild(el("p", "c-what", "Her ölçünün son değeri, kendi son 28 günlük medyanınla karşılaştırılıyor; başkasının normaliyle değil. Küçük çizgi son 14 değerin gidişatı. ▲ iyi yönde, ▼ kötü yönde."));
    var list = el("div", "c-trends");
    metrics.forEach(function (m) {
      if (!m.vals.length) return;
      var last = m.vals[m.vals.length - 1], med = median(m.vals.slice(-29, -1));
      var delta = last - med;
      var good = !isFinite(delta) || Math.abs(delta) < 1e-9 || !m.better ? null : (delta > 0) === (m.better > 0);
      var row = el("div", "c-trend");
      row.appendChild(el("span", "c-trend-k", m.k));
      var v = el("span", "c-trend-v", (m.unit === "%" ? "%" + fmt(last, m.d) : fmt(last, m.d) + m.unit));
      row.appendChild(v);
      row.appendChild(el("span", "c-trend-d" + (good === true ? " up" : good === false ? " down" : ""),
        isFinite(med) ? signed(delta, m.d) + (good === true ? " ▲" : good === false ? " ▼" : "") + " · medyan " + fmt(med, m.d) : "medyan için veri az"));
      var sp = el("span", "c-trend-s");
      sp.appendChild(spark(m.vals.slice(-14), css("--accent")));
      row.appendChild(sp);
      list.appendChild(row);
    });
    p.appendChild(list);
    return p;
  }

  // ---------- workout heart-rate zones ----------

  function zonesCard(Wh) {
    var ws = Wh.workouts.filter(function (w) { return w.sport !== "increase_relaxation" && w.zones.reduce(function (a, b) { return a + b; }, 0) > 0; });
    if (!ws.length) return null;
    var zc = [css("--sleep-awake"), css("--zone-1"), css("--zone-2"), css("--zone-3"), css("--zone-4"), css("--zone-5")];
    var labels = ["Bölge 0", "Bölge 1", "Bölge 2", "Bölge 3", "Bölge 4", "Bölge 5"];
    var rowH = 26, ML = 92, MR = 14, MT = 6, H = MT + ws.length * (rowH + 8) + 22;
    var maxMin = Math.max.apply(null, ws.map(function (w) { return w.zones.reduce(function (a, b) { return a + b; }, 0); }));
    var svg = frame(H, "Antrenmanlarda nabız bölgeleri");
    var iw = W - ML - MR;
    ws.forEach(function (w, i) {
      var y = MT + i * (rowH + 8), x = ML;
      text(svg, ML - 8, y + rowH / 2 + 4, trDate(w.start.slice(0, 10)).slice(0, 5) + " " + w.start.slice(11, 16), "end");
      w.zones.forEach(function (m, z) {
        if (!m) return;
        var bw = m / maxMin * iw;
        var r = mk("rect", { x: x, y: y, width: Math.max(1, bw - 2), height: rowH, rx: 3, fill: zc[z] });
        var t = mk("title", {});
        t.textContent = labels[z] + ": " + m + " dk";
        r.appendChild(t);
        svg.appendChild(r);
        x += bw;
      });
    });
    text(svg, ML, H - 4, "0 dk", "start");
    text(svg, W - MR, H - 4, fmt(maxMin) + " dk", "end");
    var z2plus = ws.map(function (w) { return w.zones.slice(2).reduce(function (a, b) { return a + b; }, 0); });
    return card("ANTRENMANLARDA NABIZ BÖLGELERİ",
      "Her satır WHOOP'un kaydettiği bir antrenman; renkler maksimum nabzının yüzdesine göre bölgeler (0 çok hafif → 5 maksimum). " +
      "Kardiyo gelişimi bölge 2 ve üstündeki dakikalardan gelir; ağırlıkta çoğu süre setler arası dinlenmede 0–1'de geçer.",
      svg, "Son " + ws.length + " antrenmanda bölge 2+ süre: " + z2plus.join(", ") + " dakika. BikeErg Zone 2 seansları başladığında burada 20–40 dakikalık bölge 2 blokları göreceğiz.",
      ws.slice().reverse().map(function (w) { return [trDate(w.start.slice(0, 10)), w.sport, w.zones.join(" / ")]; }),
      ["Tarih", "Tür", "Dakika: B0 / B1 / B2 / B3 / B4 / B5"],
      legendOf(labels.map(function (l, i) { return { label: l, color: zc[i] }; })));
  }

  // ---------- training calendar heatmap ----------

  function heatmapCard() {
    var byDay = {};
    AD.sessions.forEach(function (s) { byDay[s.date] = (byDay[s.date] || 0) + AD.tonnage(s); });
    var end = localDate(new Date()), start = addDays(weekStart(end), -7 * 52);
    var vals = Object.keys(byDay).filter(function (d) { return d >= start; }).map(function (d) { return byDay[d]; }).sort(function (a, b) { return a - b; });
    var q = [0.25, 0.5, 0.75].map(function (f) { return vals[Math.floor(vals.length * f)] || 0; });
    var heat = [css("--heat-1"), css("--heat-2"), css("--heat-3"), css("--heat-4")];
    function level(v) { return v <= q[0] ? 0 : v <= q[1] ? 1 : v <= q[2] ? 2 : 3; }
    var cell = 11, gap = 2, ML = 30, MT = 18;
    var weeks = 53, H = MT + 7 * (cell + gap) + 4;
    var Wd = ML + weeks * (cell + gap) + 4;
    var svg = mk("svg", { viewBox: "0 0 " + Wd + " " + H, role: "img", "aria-label": "Antrenman takvimi ısı haritası" });
    ["Pzt", "", "Çar", "", "Cum", "", "Paz"].forEach(function (l, i) { if (l) text(svg, ML - 6, MT + i * (cell + gap) + 9, l, "end"); });
    var lastMonth = "";
    var days = [], d = start, count = 0;
    while (d <= end) {
      var wi = Math.floor(count / 7), di = count % 7;
      var x = ML + wi * (cell + gap), y = MT + di * (cell + gap);
      var v = byDay[d] || 0;
      var r = mk("rect", { x: x, y: y, width: cell, height: cell, rx: 2, fill: v ? heat[level(v)] : css("--surface-2") });
      var t = mk("title", {});
      t.textContent = trDate(d) + (v ? " · " + fmt(v) + " kg" : " · antrenman yok");
      r.appendChild(t);
      svg.appendChild(r);
      var m = d.slice(5, 7);
      if (di === 0 && m !== lastMonth) {
        text(svg, x, MT - 6, MONTHS[parseInt(m, 10) - 1], "start");
        lastMonth = m;
      }
      days.push(d);
      d = addDays(d, 1);
      count++;
    }
    var trained = days.filter(function (x) { return byDay[x]; }).length;
    var streak = 0, best = 0;
    // Longest run of weeks with at least 3 sessions.
    var wkCount = {};
    days.forEach(function (x) { if (byDay[x]) { var k = weekStart(x); wkCount[k] = (wkCount[k] || 0) + 1; } });
    var wk = weekStart(start);
    while (wk <= end) { if ((wkCount[wk] || 0) >= 3) { streak++; best = Math.max(best, streak); } else if (wk !== weekStart(end)) streak = 0; wk = addDays(wk, 7); }
    var legend = legendOf([{ color: css("--surface-2"), label: "yok" }].concat(heat.map(function (c, i) {
      return { color: c, label: ["hafif", "orta", "yüklü", "çok yüklü"][i] };
    })));
    var wrap = el("div", "c-heat-scroll");
    wrap.appendChild(svg);
    var p = card("ANTRENMAN TAKVİMİ · SON 12 AY",
      "Her kare bir gün; renk koyulaştıkça o günün tonajı artıyor (kendi günlerinin çeyreklerine göre). GitHub'daki katkı haritası gibi: boşluklar ara verdiğin dönemleri, koyu kümeler en yoğun haftalarını gösterir.",
      mk("svg", {}), "Son 12 ayda " + trained + " gün antrenman yaptın (" + days.length + " günün %" + fmt(trained / days.length * 100) + "'i). " +
      "Haftada en az 3 antrenmanlık en uzun serin " + best + " hafta" + (streak ? ", şu anki serin " + streak + " hafta." : "."),
      null, null, legend);
    var fig = p.querySelector("figure");
    fig.textContent = "";
    fig.appendChild(wrap);
    return p;
  }
  var MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

  // ---------- weekly sets per muscle group ----------

  // Direct (primary) muscle for each lift, plus half a set for the obvious helper.
  var MUSCLES = [
    [/leg curl|romanian|stiff leg|deadlift|back extension/i, { "Arka bacak": 1 }],
    [/hack squat|leg press|squat|lunge/i, { "Ön bacak": 1, "Kalça": 0.5 }],
    [/leg extension/i, { "Ön bacak": 1 }],
    [/calf/i, { "Baldır": 1 }],
    [/hip thrust|glute/i, { "Kalça": 1 }],
    [/reverse fly|face pull|rear delt/i, { "Omuz": 1 }],
    [/lateral raise|shoulder press|overhead press|arnold|upright row/i, { "Omuz": 1, "Triceps": 0 }],
    [/pushdown|triceps extension|skull|kickback|triceps dip|dip/i, { "Triceps": 1, "Göğüs": 0.5 }],
    [/fly|bench|chest press|push up|pec/i, { "Göğüs": 1, "Triceps": 0.5 }],
    [/pulldown|pull up|chin|row|pullover/i, { "Sırt": 1, "Biceps": 0.5 }],
    [/curl/i, { "Biceps": 1 }],
    [/crunch|plank|ab /i, { "Karın": 1 }]
  ];
  function musclesOf(name) {
    for (var i = 0; i < MUSCLES.length; i++) if (MUSCLES[i][0].test(name)) return MUSCLES[i][1];
    return null;
  }

  // How many sessions the log holds in the last n days — sparse logging makes volume look low.
  function loggedIn(n) {
    var from = addDays(localDate(new Date()), -n + 1);
    return AD.sessions.filter(function (s) { return s.date >= from; }).length;
  }
  function gapNote(n, expect) {
    var c = loggedIn(n);
    return c < expect ? " Not: son " + n + " günde defterde sadece " + c + " seans var; kaydedilmemiş antrenmanlar varsa bu değer olduğundan düşük görünür." : "";
  }

  function muscleCard() {
    var today = localDate(new Date());
    var wk = { }, avg4 = { };
    AD.sessions.forEach(function (s) {
      var age = (new Date(today + "T12:00:00") - new Date(s.date + "T12:00:00")) / 864e5;
      if (age < 0 || age >= 28) return;
      (s.exercises || []).forEach(function (e) {
        var m = musclesOf(e.name);
        if (!m) return;
        Object.keys(m).forEach(function (k) {
          if (!m[k]) return;
          avg4[k] = (avg4[k] || 0) + m[k] * e.sets.length / 4;
          if (age < 7) wk[k] = (wk[k] || 0) + m[k] * e.sets.length;
        });
      });
    });
    var groups = ["Göğüs", "Sırt", "Omuz", "Biceps", "Triceps", "Ön bacak", "Arka bacak", "Kalça", "Baldır"];
    var rowH = 20, ML = 92, MR = 60, MT = 18, H = MT + groups.length * (rowH + 8) + 20;
    var max = Math.max(24, Math.max.apply(null, groups.map(function (g) { return Math.max(avg4[g] || 0, wk[g] || 0); })) + 2);
    var iw = W - ML - MR;
    function X(v) { return ML + v / max * iw; }
    var svg = frame(H, "Kas grubuna göre haftalık set");
    svg.appendChild(mk("rect", { x: X(10), y: MT - 6, width: X(20) - X(10), height: groups.length * (rowH + 8), fill: css("--good"), "fill-opacity": .12 }));
    text(svg, X(15), MT - 8, "hedef 10–20 set", "middle", css("--good"));
    groups.forEach(function (g, i) {
      var y = MT + i * (rowH + 8), v = avg4[g] || 0, w7 = wk[g] || 0;
      text(svg, ML - 8, y + rowH / 2 + 4, g, "end", css("--ink"));
      if (v) {
        var r = mk("rect", { x: ML, y: y, width: Math.max(2, X(v) - ML), height: rowH, rx: 4, fill: css("--accent") });
        var t = mk("title", {});
        t.textContent = g + " · 4 haftalık ort. " + fmt(v, 1) + " set/hafta · son 7 gün " + fmt(w7, 1);
        r.appendChild(t);
        svg.appendChild(r);
      }
      svg.appendChild(mk("line", { x1: X(w7), x2: X(w7), y1: y - 2, y2: y + rowH + 2, stroke: css("--ink"), "stroke-width": 2 }));
      text(svg, W - MR + 6, y + rowH / 2 + 4, fmt(v, 1), "start", css("--ink"));
    });
    [0, 10, 20].forEach(function (v) { text(svg, X(v), H - 4, String(v), "middle"); });
    var low = groups.filter(function (g) { return (avg4[g] || 0) < 10; });
    var high = groups.filter(function (g) { return (avg4[g] || 0) > 22; });
    return card("KAS GRUBUNA GÖRE HAFTALIK SET",
      "Çubuk: son 4 haftada kas grubu başına haftalık ortalama çalışma seti; dik çizgi: son 7 gün. Doğrudan çalışan kas 1 set, yardımcı kas yarım set sayılır " +
      "(örneğin row'da sırt 1, biceps ½). Kas gelişimi için çoğu araştırma kas başına haftada 10–20 zorlu seti işaret ediyor; definasyonda alt uca yakın kalmak yeterli.",
      svg, (low.length ? "10 setin altında kalanlar: " + low.join(", ") + ". " : "Tüm gruplar 10 setin üstünde. ") +
        (high.length ? "22 setin üstünde: " + high.join(", ") + " — definasyonda toparlanmayı zorlayabilir. " : "") +
        "Kayıtlar Strong'daki hareket adlarından eşleştirildi." + gapNote(28, 16),
      groups.map(function (g) { return [g, fmt(avg4[g] || 0, 1), fmt(wk[g] || 0, 1)]; }), ["Kas", "4 hafta ort.", "Son 7 gün"]);
  }

  // ---------- acute : chronic workload ----------

  function acwrCard() {
    var byDay = {};
    AD.sessions.forEach(function (s) { byDay[s.date] = (byDay[s.date] || 0) + AD.tonnage(s); });
    var end = localDate(new Date()), pts = [];
    for (var i = 119; i >= 0; i--) {
      var d = addDays(end, -i), acute = 0, chronic = 0;
      for (var k = 0; k < 28; k++) { var v = byDay[addDays(d, -k)] || 0; chronic += v; if (k < 7) acute += v; }
      chronic /= 4;
      if (chronic > 0) pts.push({ key: d, v: acute / chronic, tip: trDate(d) + " · oran " + fmt(acute / chronic, 2) + " · son 7 gün " + fmt(acute) + " kg" });
    }
    if (pts.length < 2) return null;
    var last = pts[pts.length - 1].v;
    var svg = lineChart(pts, { label: "Akut-kronik yük oranı", digits: 1, band: { lo: 0.8, hi: 1.3, label: "0,8 – 1,3" } });
    var over = pts.filter(function (p) { return p.v > 1.5; }).length;
    return card("YÜK ORANI (AKUT : KRONİK)",
      "Son 7 günün tonajı, son 4 haftanın haftalık ortalamasına bölünür. 1 = alıştığın kadar yük; 0,8–1,3 dengeli bölge; 1,5 üstü ani yük artışı " +
      "(sakatlık riskiyle ilişkilendirilir, ama bu ilişki tartışmalı), 0,8 altı yükü azalttığın dönem. Tonaj ağırlık antrenmanı içindir; kardiyo dahil değil.",
      svg, "Bugün oran " + fmt(last, 2) + " — " + (last > 1.5 ? "ani bir yük artışı; birkaç gün hacmi sabit tut." : last > 1.3 ? "normalin biraz üstünde yüklüyorsun." :
        last >= 0.8 ? "dengeli bölgedesin." : "alıştığından az yükleniyorsun (ara, deload ya da kayıt eksiği).") +
        " Son 120 günde 1,5'i geçtiğin gün sayısı: " + over + "." + gapNote(14, 8),
      pts.slice(-30).reverse().map(function (p) { return [trDate(p.key), fmt(p.v, 2)]; }), ["Gün", "Oran"]);
  }

  // ---------- PR timeline ----------

  function prCard() {
    var best = {}, count = {}, prs = [];
    var sessions = AD.sessions.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    sessions.forEach(function (s) {
      (s.exercises || []).forEach(function (e) {
        // Only sets in the range where e1RM means something.
        var ok = e.sets.filter(function (x) { return x.r >= 2 && x.r <= 10 && x.w > 0; });
        if (!ok.length) return;
        var top = ok.reduce(function (a, x) { return x.w * (1 + x.r / 30) > a.w * (1 + a.r / 30) ? x : a; }, ok[0]);
        var v = top.w * (1 + top.r / 30);
        var prev = best[e.name] || 0;
        // Entry errors show up as a jump of a third or more in one session; don't crown them.
        if ((count[e.name] || 0) >= 5 && v > prev && v < prev * 1.33) {
          prs.push({ date: s.date, name: e.name, w: top.w, r: top.r, v: v, gain: (v - prev) / prev * 100 });
        }
        if (v < (prev || Infinity) * 1.33 || !prev) best[e.name] = Math.max(prev, v);
        count[e.name] = (count[e.name] || 0) + 1;
      });
    });
    var from = addDays(localDate(new Date()), -180);
    var recent = prs.filter(function (p) { return p.date >= from; }).reverse();
    var p = el("div", "panel c-card");
    p.appendChild(el("h3", "h-title", "REKOR ZAMAN ÇİZELGESİ · SON 6 AY"));
    p.appendChild(el("p", "c-what", "Bir hareketin 2–10 tekrarlık setlerden çıkan tahmini 1RM'i o güne kadarki en iyisini geçtiğinde bir rekor sayılır (en az 5 kaydı olan hareketlerde; tek seferde %33'ten büyük sıçramalar kayıt hatası sayılıp dışarıda kalır)."));
    if (!recent.length) {
      p.appendChild(el("p", "c-says", "Son 6 ayda yeni tahmini 1RM rekoru yok — definasyonda beklenen bir durum."));
      return p;
    }
    var list = el("ol", "c-prs");
    recent.slice(0, 14).forEach(function (r) {
      var li = el("li");
      li.appendChild(el("span", "c-pr-date", trDate(r.date)));
      li.appendChild(el("span", "c-pr-name", r.name));
      li.appendChild(el("span", "c-pr-set", fmt(r.w, 1) + " × " + r.r));
      li.appendChild(el("span", "c-pr-gain", "+" + fmt(r.gain, 1) + "%"));
      list.appendChild(li);
    });
    p.appendChild(list);
    var byMonth = {};
    recent.forEach(function (r) { var m = r.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; });
    var s = el("p", "c-says");
    s.appendChild(el("strong", null, "Senin verin: "));
    s.appendChild(document.createTextNode("Son 6 ayda " + recent.length + " rekor; aylara göre " +
      Object.keys(byMonth).sort().map(function (m) { return MONTHS[parseInt(m.slice(5), 10) - 1] + " " + byMonth[m]; }).join(", ") +
      ". Rekor sıklığının azalması definasyonda normal; asıl hedef mevcut seviyeyi korumak."));
    p.appendChild(s);
    return p;
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
      [ringsCard, trendRowsCard, recoveryCard, hrvCard, rhrCard, sleepStagesCard, sleepTimingCard, strainCard, zonesCard].forEach(function (fn) {
        try { var c = fn(health.W); if (c) host.appendChild(c); }
        catch (e) { host.appendChild(el("p", "h-note warn", "Bir grafik çizilemedi: " + e.message)); }
      });
      var wc = weightCard(health.B);
      if (wc) host.appendChild(wc);
    }

    host.appendChild(section("ANTRENMAN", AD.sessions.length + " seans"));
    [heatmapCard, muscleCard, acwrCard, prCard, tonnageChart, yearsChart].forEach(function (fn) {
      try { var c = fn(); if (c) host.appendChild(c); }
      catch (e) { host.appendChild(el("p", "h-note warn", "Bir grafik çizilemedi: " + e.message)); }
    });
    liftCards().forEach(function (c) { host.appendChild(c); });
  }

  document.addEventListener("health-ready", function () {
    if (document.body.classList.contains("view-charts")) renderAll();
  });

  if (location.hash === "#grafikler") setView("charts");
})();
