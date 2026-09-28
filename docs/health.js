// Health panel: decrypts docs/private.enc.json in the browser and turns WHOOP data,
// weigh-ins and cardio logs into the analyses below, joined to the training log the
// main script exposes as window.AD. Nothing here is sent anywhere.
(function () {
  "use strict";

  var AD = window.AD;
  if (!AD) return;

  var PW_KEY = "ad-health-pw";
  var W = null;   // whoop: { recovery, sleep, workouts, cycles, pulled }
  var B = null;   // body:  { weight, cardio }

  // ---------- small helpers ----------

  function $(id) { return document.getElementById(id); }
  var el = AD.el, fmt = AD.fmt, trDate = AD.trDate;

  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function localDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function today() { return localDate(new Date()); }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + n);
    return localDate(d);
  }
  function mean(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : NaN; }
  function sd(xs) {
    if (xs.length < 2) return NaN;
    var m = mean(xs);
    return Math.sqrt(xs.reduce(function (a, x) { return a + (x - m) * (x - m); }, 0) / (xs.length - 1));
  }
  function pearson(xs, ys) {
    if (xs.length < 3) return NaN;
    var mx = mean(xs), my = mean(ys), num = 0, dx = 0, dy = 0;
    for (var i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) * (xs[i] - mx);
      dy += (ys[i] - my) * (ys[i] - my);
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
  }
  function num(v, d) { return isFinite(v) ? fmt(v, d === undefined ? 1 : d) : "—"; }
  function signed(v, d, unit) {
    if (!isFinite(v)) return "—";
    return (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v), d === undefined ? 1 : d) + (unit || "");
  }
  function zoneOf(score) { return score >= 67 ? "green" : score >= 34 ? "yellow" : "red"; }
  var ZONE_TR = { green: "yeşil", yellow: "sarı", red: "kırmızı" };
  function hhmm(isoStr) { return isoStr ? isoStr.slice(11, 16) : "—"; }
  function hourOf(isoStr) { return parseInt(isoStr.slice(11, 13), 10) + parseInt(isoStr.slice(14, 16), 10) / 60; }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function zoneColor(z) { return z === "green" ? css("--good") : z === "yellow" ? css("--brass") : css("--danger"); }

  function note(text, cls) { return el("p", "h-note" + (cls ? " " + cls : ""), text); }

  function stat(k, v, sub, cls) {
    var box = el("div", "stat");
    box.appendChild(el("div", "k", k));
    box.appendChild(el("div", "v" + (cls ? " " + cls : ""), v));
    if (sub !== undefined) box.appendChild(el("div", "sub", sub));
    return box;
  }

  function panel(title, count) {
    var p = el("div", "panel h-panel");
    var h = el("h3", "h-title", title);
    if (count) h.appendChild(el("span", "count", count));
    p.appendChild(h);
    return p;
  }

  function table(head, rows) {
    var t = el("table", "h-table");
    var tr = el("tr");
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
    return wrap;
  }

  // ---------- data views ----------

  function recoveries() { return W.recovery.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }
  function recoveryOn(date) {
    for (var i = 0; i < W.recovery.length; i++) if (W.recovery[i].date === date) return W.recovery[i];
    return null;
  }
  function mainSleeps() { return W.sleep.filter(function (s) { return !s.nap; }); }
  function sleepEndingOn(date) {
    var s = mainSleeps().filter(function (x) { return x.end.slice(0, 10) === date; });
    return s.length ? s[s.length - 1] : null;
  }
  function strengthSessions() {
    return AD.sessions.filter(function (s) { return AD.categoryOf(s.name); });
  }
  function sessionsOn(date) { return strengthSessions().filter(function (s) { return s.date === date; }); }

  // How a session compares with your usual level on the same lifts: 100 = the median
  // estimated 1RM of that lift's previous five sessions (within 180 days), averaged over
  // every lift with enough history. A median of recent sessions, not the all-time best,
  // so a light volume day or an old high-rep record doesn't drag every session down.
  function perfIndex(session) {
    var from = addDays(session.date, -180), ratios = [];
    (session.exercises || []).forEach(function (ex) {
      if (!ex.sets.length) return;
      var prior = [];
      AD.sessions.forEach(function (s) {
        if (s.date >= session.date || s.date < from) return;
        (s.exercises || []).forEach(function (e) {
          if (e.name === ex.name && e.sets.length) prior.push(AD.bestE1rm(e.sets));
        });
      });
      prior = prior.slice(-5).sort(function (a, b) { return a - b; });
      if (prior.length < 3) return;
      var med = prior[Math.floor(prior.length / 2)];
      if (med > 0) ratios.push(AD.bestE1rm(ex.sets) / med * 100);
    });
    return ratios.length >= 2 ? mean(ratios) : NaN;
  }

  // Days WHOOP saw a lifting workout, for the days the log has nothing (not every
  // session makes it into Strong).
  function whoopLiftOn(date) {
    var w = W.workouts.filter(function (x) {
      return x.start.slice(0, 10) === date && x.sport !== "increase_relaxation" && x.strain >= 8;
    });
    return w.length ? w[0] : null;
  }

  // Personal HRV baseline: ln(rMSSD) over the mornings before the last seven, with the
  // normal range at ±0.5 SD — the smallest change worth acting on in HRV-guided training.
  function hrvStatus() {
    var rs = recoveries().filter(function (r) { return !r.calibrating; });
    var ln = rs.map(function (r) { return Math.log(r.hrv); });
    var last7 = ln.slice(-7), before = ln.slice(0, -7);
    var out = { n: rs.length, need: 14, avg7: Math.exp(mean(last7)), days7: last7.length };
    if (before.length >= 14) {
      var m = mean(before), s = sd(before);
      out.base = Math.exp(m);
      out.lo = Math.exp(m - 0.5 * s);
      out.hi = Math.exp(m + 0.5 * s);
      var a = mean(last7);
      out.state = a < m - 0.5 * s ? "low" : a > m + 0.5 * s ? "high" : "normal";
    }
    return out;
  }

  // ---------- 1. today ----------

  function renderToday() {
    var host = $("healthTodayCard");
    host.textContent = "";
    var t = today();
    var rec = recoveryOn(t);
    var latest = recoveries().slice(-1)[0];
    var p = el("div", "panel hero h-today");
    var h = el("h3", "h-title", "BUGÜN");
    h.appendChild(el("span", "count", "WHOOP · " + trDate(t)));
    p.appendChild(h);

    if (!rec) {
      p.appendChild(note(latest
        ? "Bugünün recovery kaydı henüz yok (son kayıt " + trDate(latest.date) + "). Veri her sabah çekildikten sonra burada görünür."
        : "Henüz recovery kaydı yok."));
      host.appendChild(p);
      AD.setReadiness(null);
      return;
    }

    var zone = zoneOf(rec.score);
    var prior = recoveries().filter(function (r) { return r.date < t; }).slice(-7);
    var hrv7 = mean(prior.map(function (r) { return r.hrv; }));
    var rhr7 = mean(prior.map(function (r) { return r.rhr; }));
    var sl = sleepEndingOn(t);

    var rail = el("div", "rail");
    var score = stat("Recovery", "%" + fmt(rec.score), ZONE_TR[zone], "h-zone " + zone);
    rail.appendChild(score);
    rail.appendChild(stat("HRV", num(rec.hrv) + " ms", "7 gün ort. " + num(hrv7) + " (" + signed(rec.hrv - hrv7) + ")"));
    rail.appendChild(stat("Dinlenik nabız", fmt(rec.rhr) + " bpm", "7 gün ort. " + num(rhr7) + " (" + signed(rec.rhr - rhr7) + ")"));
    rail.appendChild(stat("Uyku", sl ? num(sl.asleep) + " sa" : "—",
      sl ? hhmm(sl.start) + "–" + hhmm(sl.end) + " · verim %" + fmt(sl.eff) : "kayıt yok"));
    p.appendChild(rail);

    var plan = AD.planFor(new Date().getDay());
    var planText = plan ? plan.label + " (" + (plan.mode === "heavy" ? "yoğunluk" : "hacim") + " günü)" : "dinlenme günü";
    var advice = {
      green: "Yeşil gün — program olduğu gibi. Ana harekette ağırlığı ya da tekrarı zorlamak için iyi gün.",
      yellow: "Sarı gün — normal çalış ama tükenişe gitme: her sette RPE en fazla 8. Aşağıdaki program buna göre ayarlandı.",
      red: "Kırmızı gün — yükü %10 düşür, set sayısını yarıya indir, RPE 7'de kes. Ya da bugün sadece yürüyüş. Aşağıdaki program buna göre ayarlandı."
    }[zone];
    p.appendChild(el("p", "h-advice " + zone, "Bugün: " + planText + ". " + advice));

    var flags = [];
    if (isFinite(rhr7) && rec.rhr >= rhr7 + 3) flags.push("Dinlenik nabız 7 günlük ortalamanın " + fmt(rec.rhr - rhr7, 1) + " bpm üstünde — hastalık belirtin varsa hafif tut.");
    if (rec.spo2 && rec.spo2 < 94) flags.push("SpO₂ %" + fmt(rec.spo2, 1) + " — tek başına önemsiz, iki gün üst üste düşükse bakalım.");
    if (sl && sl.asleep < 6) flags.push("Uyku 6 saatin altında — ağır tekrarlar yerine hacim ağırlıklı çalış.");
    if (sl && sl.debt >= 1.5) flags.push("Uyku borcu " + fmt(sl.debt, 1) + " saat.");
    flags.forEach(function (f) { p.appendChild(note("• " + f, "warn")); });

    host.appendChild(p);
    AD.setReadiness({ zone: zone, score: rec.score, date: t });
  }

  // ---------- 2. recovery vs performance ----------

  function renderPerformance(host) {
    var p = panel("RECOVERY PERFORMANSI ETKİLİYOR MU?");
    var pairs = [];
    strengthSessions().forEach(function (s) {
      var r = recoveryOn(s.date);
      if (!r) return;
      var pi = perfIndex(s);
      if (isFinite(pi)) pairs.push({ x: r.score, y: pi, zone: zoneOf(r.score), s: s, r: r });
    });
    p.querySelector(".h-title").appendChild(el("span", "count", pairs.length + " seans"));
    p.appendChild(note("Her nokta bir antrenman: yatayda o sabahki recovery, dikeyde seansın performansı " +
      "(100 = aynı hareketlerde son 5 seansındaki olağan seviyen)."));

    if (pairs.length) p.appendChild(scatter(pairs));

    if (pairs.length < 10) {
      p.appendChild(note("Şimdilik " + pairs.length + " seans eşleşti. İlişkiyi okumak için en az 10–15 seans lazım; " +
        "WHOOP'lu her antrenman bir nokta ekliyor."));
    } else {
      var r = pearson(pairs.map(function (q) { return q.x; }), pairs.map(function (q) { return q.y; }));
      var strength = Math.abs(r) < 0.2 ? "yok denecek kadar zayıf" : Math.abs(r) < 0.4 ? "zayıf" : Math.abs(r) < 0.6 ? "orta" : "güçlü";
      var byZone = {};
      pairs.forEach(function (q) { (byZone[q.zone] = byZone[q.zone] || []).push(q.y); });
      p.appendChild(note("Korelasyon r = " + fmt(r, 2) + " — " + strength + " bir ilişki" +
        (r > 0.2 ? ": recovery yükseldikçe performansın da artıyor, WHOOP'a göre yük ayarlamak sende işe yarıyor." :
          r < -0.2 ? ": ters yönde — muhtemelen tesadüf ya da başka bir etken; daha fazla veriyle bakalım." :
            ": recovery skoru senin performansını pek öngörmüyor. Isınmadaki histen (RPE, bar hızı) daha fazla faydalan.")));
      p.appendChild(table(["Bölge", "Seans", "Ort. performans"], ["green", "yellow", "red"].map(function (z) {
        var ys = byZone[z] || [];
        return [ZONE_TR[z], String(ys.length), ys.length ? "%" + fmt(mean(ys), 1) : "—"];
      })));
    }
    host.appendChild(p);
  }

  function scatter(pairs) {
    var Wd = 720, Ht = 240, ML = 46, MR = 14, MT = 14, MB = 30, iw = Wd - ML - MR, ih = Ht - MT - MB;
    var ys = pairs.map(function (q) { return q.y; });
    var lo = Math.min(90, Math.floor(Math.min.apply(null, ys) - 2)), hi = Math.max(105, Math.ceil(Math.max.apply(null, ys) + 2));
    function X(v) { return ML + v / 100 * iw; }
    function Y(v) { return MT + ih - (v - lo) / (hi - lo) * ih; }
    var s = svg(Wd, Ht, "Recovery ve performans saçılım grafiği");
    [[0, 34, "red"], [34, 67, "yellow"], [67, 100, "green"]].forEach(function (b) {
      s.appendChild(svgEl("rect", { x: X(b[0]), y: MT, width: X(b[1]) - X(b[0]), height: ih, fill: zoneColor(b[2]), "fill-opacity": .07 }));
    });
    s.appendChild(svgEl("line", { x1: ML, x2: Wd - MR, y1: Y(100), y2: Y(100), stroke: css("--line"), "stroke-dasharray": "4 4" }));
    axisText(s, ML - 8, Y(100) + 4, "100", "end");
    axisText(s, ML - 8, Y(lo) + 4, fmt(lo), "end");
    axisText(s, ML - 8, Y(hi) + 4, fmt(hi), "end");
    [0, 34, 67, 100].forEach(function (v) { axisText(s, X(v), Ht - 8, "%" + v, "middle"); });
    pairs.forEach(function (q) {
      var c = svgEl("circle", { cx: X(q.x), cy: Y(q.y), r: 5.5, fill: zoneColor(q.zone), stroke: css("--surface"), "stroke-width": 2 });
      var t = svgEl("title", {});
      t.textContent = trDate(q.s.date) + " " + q.s.name + " · recovery %" + q.x + " · performans %" + fmt(q.y, 1);
      c.appendChild(t);
      s.appendChild(c);
    });
    return figure(s);
  }

  // ---------- 3. session cost ----------

  function renderCost(host) {
    var p = panel("ANTRENMANLARIN MALİYETİ");
    p.appendChild(note("Her sabahın HRV'si, önceki 7 sabahın ortalamasıyla karşılaştırılır ve bir önceki güne ne yaptığına göre gruplanır. " +
      "Eksi değer = o antrenmandan ertesi sabaha yorgunluk taşıdın."));
    var rs = recoveries(), groups = { push: [], pull: [], legs: [], other: [], rest: [] };
    rs.forEach(function (r, i) {
      var prior = rs.slice(Math.max(0, i - 7), i);
      if (prior.length < 3) return;
      var base = mean(prior.map(function (q) { return q.hrv; }));
      var prev = addDays(r.date, -1), yesterday = sessionsOn(prev);
      var cat = yesterday.length ? AD.categoryOf(yesterday[0].name) : whoopLiftOn(prev) ? "other" : "rest";
      groups[cat].push({ d: (r.hrv - base) / base * 100, score: r.score });
    });
    var LABEL = { push: "İtiş sonrası", pull: "Çekiş sonrası", legs: "Bacak sonrası", other: "Deftere girmemiş antrenman", rest: "Dinlenme sonrası" };
    var rows = [], any = false;
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.length) any = true;
      rows.push([LABEL[k], String(g.length),
        g.length ? signed(mean(g.map(function (x) { return x.d; })), 1, "%") : "—",
        g.length ? "%" + fmt(mean(g.map(function (x) { return x.score; }))) : "—"]);
    });
    p.appendChild(table(["Önceki gün", "Sabah", "HRV farkı", "Ort. recovery"], rows));
    if (!any) p.appendChild(note("Karşılaştırma için en az 4 sabahlık kayıt gerekiyor."));
    else p.appendChild(note("Her grupta 5+ sabah birikince fark anlamlı hale gelir. En pahalı antrenman günü, haftalık sıralamayı ona göre ayarlamanın ipucu."));
    host.appendChild(p);
  }

  // ---------- 4. HRV trend & deload ----------

  function renderTrend(host) {
    var st = hrvStatus();
    var p = panel("HRV TRENDİ VE DELOAD", W.recovery.length + " sabah");
    var rs = recoveries();
    if (rs.length >= 2) p.appendChild(hrvChart(rs, st));

    var perf = strengthSessions().slice(-3).map(perfIndex).filter(isFinite);
    var perfAvg = mean(perf);
    if (st.state === undefined) {
      p.appendChild(note("Kişisel normal aralığın oluşuyor: " + Math.max(0, st.n - 7) + " / " + st.need +
        " sabah (son 7 günün dışında). O zamana kadar deload kararı kuvvet trendine ve hissine göre."));
    } else {
      var msg = { low: "7 günlük HRV ortalaman (" + num(st.avg7) + ") normal aralığının altında.",
                  normal: "7 günlük HRV ortalaman (" + num(st.avg7) + ") normal aralığında (" + num(st.lo) + "–" + num(st.hi) + ").",
                  high: "7 günlük HRV ortalaman (" + num(st.avg7) + ") normal aralığının üstünde — iyi toparlanıyorsun." }[st.state];
      p.appendChild(note(msg, st.state === "low" ? "warn" : ""));
    }
    if (perf.length) p.appendChild(note("Son 3 seansın performans ortalaması %" + fmt(perfAvg, 1) + " (100 = son seanslardaki olağan seviyen)."));
    var deload = st.state === "low" && isFinite(perfAvg) && perfAvg < 97;
    p.appendChild(el("p", "h-advice " + (deload ? "red" : "green"), deload
      ? "DELOAD ÖNERİLİYOR: HRV düşük ve kuvvet geriliyor. Bu hafta yükü %10, set sayısını %40 azalt; kalori açığını da gözden geçir."
      : "Deload gerekmiyor."));
    host.appendChild(p);
  }

  function hrvChart(rs, st) {
    var Wd = 720, Ht = 220, ML = 46, MR = 14, MT = 14, MB = 30, iw = Wd - ML - MR, ih = Ht - MT - MB;
    var vals = rs.map(function (r) { return r.hrv; });
    if (st.lo) vals = vals.concat([st.lo, st.hi]);
    var lo = Math.floor(Math.min.apply(null, vals) - 4), hi = Math.ceil(Math.max.apply(null, vals) + 4);
    var n = rs.length;
    function X(i) { return ML + (n === 1 ? iw / 2 : i / (n - 1) * iw); }
    function Y(v) { return MT + ih - (v - lo) / (hi - lo) * ih; }
    var s = svg(Wd, Ht, "HRV zaman grafiği");
    if (st.lo) s.appendChild(svgEl("rect", { x: ML, y: Y(st.hi), width: iw, height: Y(st.lo) - Y(st.hi), fill: css("--good"), "fill-opacity": .12 }));
    [lo, Math.round((lo + hi) / 2), hi].forEach(function (v) {
      s.appendChild(svgEl("line", { x1: ML, x2: Wd - MR, y1: Y(v), y2: Y(v), stroke: css("--line") }));
      axisText(s, ML - 8, Y(v) + 4, fmt(v), "end");
    });
    // 7-day rolling mean on the log scale, drawn once three mornings exist.
    var roll = rs.map(function (r, i) {
      var w = rs.slice(Math.max(0, i - 6), i + 1);
      return w.length >= 3 ? Math.exp(mean(w.map(function (q) { return Math.log(q.hrv); }))) : null;
    });
    var d = "";
    roll.forEach(function (v, i) { if (v !== null) d += (d ? " L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); });
    if (d) s.appendChild(svgEl("path", { d: d, fill: "none", stroke: css("--accent"), "stroke-width": 2.5, "stroke-linejoin": "round" }));
    rs.forEach(function (r, i) {
      var c = svgEl("circle", { cx: X(i), cy: Y(r.hrv), r: 4, fill: zoneColor(zoneOf(r.score)), stroke: css("--surface"), "stroke-width": 1.5 });
      var t = svgEl("title", {});
      t.textContent = trDate(r.date) + " · HRV " + r.hrv + " · recovery %" + r.score;
      c.appendChild(t);
      s.appendChild(c);
    });
    axisText(s, X(0), Ht - 8, trDate(rs[0].date), "start");
    if (n > 1) axisText(s, X(n - 1), Ht - 8, trDate(rs[n - 1].date), "end");
    var fig = figure(s);
    fig.appendChild(el("figcaption", null, "Noktalar günlük HRV (rengi recovery bölgesi), çizgi 7 günlük ortalama" +
      (st.lo ? ", yeşil bant kişisel normal aralığın." : ".")));
    return fig;
  }

  // ---------- 5. training time vs sleep ----------

  function renderTiming(host) {
    var p = panel("ANTRENMAN SAATİ VE UYKU");
    p.appendChild(note("Antrenmanın başladığı saate göre o gecenin uykusu ve ertesi sabahın HRV'si. Saat Strong kaydından, yoksa WHOOP'tan."));
    var buckets = { early: [], evening: [], late: [], rest: [] };
    mainSleeps().forEach(function (sl) {
      var night = sl.start.slice(0, 10), startH = hourOf(sl.start);
      // A sleep that starts after midnight belongs to the previous day's evening.
      if (startH < 12) night = addDays(night, -1);
      var sess = sessionsOn(night).filter(function (s) { return s.time; });
      var wl = whoopLiftOn(night);
      var rec = recoveryOn(sl.end.slice(0, 10));
      var row = { eff: sl.eff, asleep: sl.asleep, bed: startH < 12 ? startH + 24 : startH, hrv: rec ? rec.hrv : NaN };
      if (!sess.length && !wl) { buckets.rest.push(row); return; }
      var h = sess.length ? hourOf("0000-00-00T" + sess[0].time) : hourOf(wl.start);
      buckets[h < 17 ? "early" : h < 20 ? "evening" : "late"].push(row);
    });
    var LABEL = { early: "17:00'den önce", evening: "17:00–19:59", late: "20:00 ve sonrası", rest: "Antrenmansız gün" };
    var rows = Object.keys(buckets).map(function (k) {
      var b = buckets[k];
      var bed = mean(b.map(function (x) { return x.bed; }));
      return [LABEL[k], String(b.length),
        isFinite(bed) ? pad2(Math.floor(bed) % 24) + ":" + pad2(Math.round((bed % 1) * 60) % 60) : "—",
        b.length ? num(mean(b.map(function (x) { return x.asleep; }))) + " sa" : "—",
        b.length ? "%" + fmt(mean(b.map(function (x) { return x.eff; }))) : "—",
        num(mean(b.map(function (x) { return x.hrv; }).filter(isFinite)))];
    });
    p.appendChild(table(["Antrenman", "Gece", "Ort. yatış", "Uyku", "Verim", "Sabah HRV"], rows));
    var late = buckets.late, early = buckets.early;
    if (late.length >= 3 && early.length >= 3) {
      var dEff = mean(late.map(function (x) { return x.eff; })) - mean(early.map(function (x) { return x.eff; }));
      p.appendChild(note("Geç antrenman gecelerinde uyku verimin erken antrenmanlara göre " + signed(dEff, 1, " puan") + "."));
    } else {
      p.appendChild(note("Karşılaştırma için her gruptan en az 3 gece gerekiyor."));
    }
    host.appendChild(p);
  }

  // ---------- 6. cut ----------

  function rolling7(entries, key) {
    return entries.map(function (e) {
      var from = addDays(e.date, -6);
      var w = entries.filter(function (x) { return x.date >= from && x.date <= e.date; });
      return { date: e.date, v: mean(w.map(function (x) { return x[key]; })) };
    });
  }

  function renderCut(host) {
    var p = panel("DEFİNASYON", B.weight.length + " tartı");
    var ws = B.weight.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!ws.length) {
      p.appendChild(note("Henüz tartı kaydı yok. Her sabah tuvaletten sonra tartıl ve kilonu koçuna yaz; 7 günlük ortalama burada izlenir."));
    } else {
      var roll = rolling7(ws, "kg");
      var last = ws[ws.length - 1], lastAvg = roll[roll.length - 1].v;
      var weekAgo = roll.filter(function (r) { return r.date <= addDays(last.date, -7); }).slice(-1)[0];
      var rate = weekAgo ? lastAvg - weekAgo.v : NaN;
      var rail = el("div", "rail");
      rail.appendChild(stat("Son tartı", fmt(last.kg, 1) + " kg", trDate(last.date)));
      rail.appendChild(stat("7 gün ort.", fmt(lastAvg, 1) + " kg", roll.length + " kayıt üzerinden"));
      rail.appendChild(stat("Haftalık hız", isFinite(rate) ? signed(rate, 2, " kg") : "—", "hedef −0,4 / −0,6"));
      rail.appendChild(stat("Vücut ağırlığına göre", isFinite(rate) ? signed(rate / lastAvg * 100, 2, "%") : "—", "haftalık"));
      p.appendChild(rail);
      if (roll.length >= 2) p.appendChild(lineFigure(roll, "7 günlük kilo ortalaması (kg)", 1));
      if (isFinite(rate)) {
        p.appendChild(el("p", "h-advice " + (rate < -0.8 || rate > -0.2 ? "yellow" : "green"),
          rate < -0.8 ? "Fazla hızlı veriyorsun — kas kaybı riski. Kaloriyi 150–200 kcal artır." :
            rate > -0.2 ? "Kilo neredeyse sabit — kaloriyi 150–200 kcal azalt ya da adımı artır." :
              "Hız hedef aralığında. Böyle devam."));
      }
    }
    // Strength and HRV beside the scale: all three falling together means the deficit is too deep.
    var perf = strengthSessions().filter(function (s) { return s.date >= "2026-09-01"; })
      .map(function (s) { return { date: s.date, v: perfIndex(s) }; }).filter(function (x) { return isFinite(x.v); });
    if (perf.length >= 2) p.appendChild(lineFigure(perf, "Seans performansı (%, 100 = olağan seviyen)", 1));
    host.appendChild(p);
  }

  // ---------- 7. cardio ----------

  function renderCardio(host) {
    var p = panel("KARDİYO · BIKEERG", B.cardio.length + " seans");
    var cs = B.cardio.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!cs.length) {
      p.appendChild(note("Henüz kardiyo kaydı yok. Her BikeErg seansından sonra süre, ortalama watt ve ortalama nabzı koçuna yaz. " +
        "Asıl ölçü: aynı nabızda basılan watt. Zamanla artıyorsa aerobik kondisyonun gelişiyor."));
    } else {
      var eff = cs.map(function (c) { return { date: c.date, v: c.watts / c.hr }; });
      var first = eff[0].v, last = eff[eff.length - 1].v;
      var rail = el("div", "rail");
      var z2 = cs.filter(function (c) { return c.hr >= 110 && c.hr <= 128; });
      rail.appendChild(stat("Son seans", fmt(cs[cs.length - 1].watts) + " W", "nabız " + fmt(cs[cs.length - 1].hr)));
      rail.appendChild(stat("Verim", fmt(last, 2) + " W/bpm", cs.length > 1 ? signed((last - first) / first * 100, 1, "%") + " ilk seansa göre" : "ilk seans"));
      rail.appendChild(stat("Zone 2", z2.length + " / " + cs.length, "110–128 bpm içinde"));
      var from = addDays(today(), -6);
      rail.appendChild(stat("Bu hafta", fmt(cs.filter(function (c) { return c.date >= from; }).reduce(function (a, c) { return a + c.min; }, 0)) + " dk", "son 7 gün"));
      p.appendChild(rail);
      if (eff.length >= 2) p.appendChild(lineFigure(eff, "Watt / nabız — yükseliyorsa kondisyon artıyor", 2));
      p.appendChild(table(["Tarih", "Süre", "Watt", "Nabız", "W/bpm"], cs.slice(-6).reverse().map(function (c) {
        return [trDate(c.date), fmt(c.min) + " dk", fmt(c.watts), fmt(c.hr), fmt(c.watts / c.hr, 2)];
      })));
    }
    host.appendChild(p);
  }

  // ---------- 8. weekly report ----------

  function weekStart(dateStr) {
    var d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return localDate(d);
  }

  function weekStats(from) {
    var to = addDays(from, 6);
    var inWeek = function (d) { return d >= from && d <= to; };
    var rs = W.recovery.filter(function (r) { return inWeek(r.date); });
    var sl = mainSleeps().filter(function (s) { return inWeek(s.end.slice(0, 10)); });
    var ss = strengthSessions().filter(function (s) { return inWeek(s.date); });
    var cs = B.cardio.filter(function (c) { return inWeek(c.date); });
    var ws = B.weight.filter(function (w) { return inWeek(w.date); });
    var prs = [];
    ss.forEach(function (s) {
      (s.exercises || []).forEach(function (ex) {
        if (!ex.sets.length) return;
        var v = AD.bestE1rm(ex.sets), before = 0, count = 0;
        AD.sessions.forEach(function (o) {
          if (o.date >= s.date) return;
          (o.exercises || []).forEach(function (e) {
            if (e.name === ex.name && e.sets.length) { before = Math.max(before, AD.bestE1rm(e.sets)); count++; }
          });
        });
        if (count >= 5 && v > before) prs.push(ex.name + " (" + fmt(v, 1) + ")");
      });
    });
    var zones = { green: 0, yellow: 0, red: 0 };
    rs.forEach(function (r) { zones[zoneOf(r.score)]++; });
    return {
      from: from, to: to, days: rs.length,
      rec: mean(rs.map(function (r) { return r.score; })),
      hrv: mean(rs.map(function (r) { return r.hrv; })),
      rhr: mean(rs.map(function (r) { return r.rhr; })),
      sleep: mean(sl.map(function (s) { return s.asleep; })),
      cons: mean(sl.map(function (s) { return s.cons; }).filter(function (x) { return x !== null; })),
      zones: zones, sessions: ss.length,
      tonnage: ss.reduce(function (a, s) { return a + AD.tonnage(s); }, 0),
      cardio: cs.reduce(function (a, c) { return a + c.min; }, 0),
      weight: mean(ws.map(function (w) { return w.kg; })),
      prs: prs
    };
  }

  function renderWeekly(host) {
    var thisWeek = weekStart(today());
    var a = weekStats(addDays(thisWeek, -7)), b = weekStats(addDays(thisWeek, -14));
    var cur = weekStats(thisWeek);
    var p = panel("HAFTALIK RAPOR", trDate(a.from) + " – " + trDate(a.to));
    function row(label, va, vb, d, unit, better) {
      var delta = va - vb;
      var mark = !isFinite(delta) || Math.abs(delta) < 1e-9 ? "" : (better === 0 ? "" : (delta > 0) === (better > 0) ? " ▲" : " ▼");
      var show = function (v) { return unit === "%" ? "%" + fmt(v, d) : fmt(v, d) + unit; };
      return [label, isFinite(va) ? show(va) : "—", isFinite(vb) ? show(vb) : "—",
        isFinite(delta) ? signed(delta, d, unit === "%" ? " puan" : unit) + mark : "—"];
    }
    p.appendChild(table(["", "Geçen hafta", "Önceki", "Fark"], [
      row("Recovery", a.rec, b.rec, 0, "%", 1),
      row("HRV", a.hrv, b.hrv, 1, " ms", 1),
      row("Dinlenik nabız", a.rhr, b.rhr, 1, "", -1),
      row("Uyku", a.sleep, b.sleep, 1, " sa", 1),
      row("Uyku tutarlılığı", a.cons, b.cons, 0, "%", 1),
      row("Antrenman", a.sessions, b.sessions, 0, "", 0),
      row("Tonaj", a.tonnage, b.tonnage, 0, " kg", 0),
      row("Kardiyo", a.cardio, b.cardio, 0, " dk", 1),
      row("Kilo (ort.)", a.weight, b.weight, 1, " kg", -1)
    ]));
    var bullets = [];
    if (a.days) bullets.push("Recovery dağılımı: " + a.zones.green + " yeşil, " + a.zones.yellow + " sarı, " + a.zones.red + " kırmızı gün (" + a.days + " sabah).");
    else bullets.push("Geçen hafta WHOOP kaydı yok — rapor ilk tam haftadan sonra dolacak.");
    if (a.prs.length) bullets.push("Rekorlar: " + a.prs.join(", ") + ".");
    if (isFinite(a.sleep) && a.sleep < 7) bullets.push("Uyku ortalaması 7 saatin altında — önümüzdeki haftanın bir numaralı işi.");
    if (a.cardio < 50 && a.days) bullets.push("Kardiyo hedefi haftada en az 2 seans (≈60 dk).");
    bullets.forEach(function (t) { p.appendChild(note("• " + t)); });
    p.appendChild(note("Bu hafta şu ana kadar: " + cur.sessions + " antrenman, " + fmt(cur.tonnage) + " kg tonaj, " +
      (isFinite(cur.rec) ? "ortalama recovery %" + fmt(cur.rec) : "recovery yok") + ".", "faint"));
    host.appendChild(p);
  }

  // ---------- svg bits ----------

  var NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function svg(w, h, label) {
    var s = svgEl("svg", { viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": label });
    return s;
  }
  function axisText(s, x, y, text, anchor) {
    var t = svgEl("text", { x: x, y: y, "text-anchor": anchor, fill: css("--muted"), "font-size": 11, "font-family": "IBM Plex Mono, monospace" });
    t.textContent = text;
    s.appendChild(t);
  }
  function figure(s) {
    var f = el("figure", "chart");
    f.appendChild(s);
    return f;
  }
  function lineFigure(pts, caption, digits) {
    var Wd = 720, Ht = 180, ML = 50, MR = 14, MT = 14, MB = 28, iw = Wd - ML - MR, ih = Ht - MT - MB;
    var vs = pts.map(function (q) { return q.v; });
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    var padV = (hi - lo) * 0.2 || 1;
    lo -= padV; hi += padV;
    var n = pts.length;
    function X(i) { return ML + (n === 1 ? iw / 2 : i / (n - 1) * iw); }
    function Y(v) { return MT + ih - (v - lo) / (hi - lo) * ih; }
    var s = svg(Wd, Ht, caption);
    [lo, hi].forEach(function (v) {
      s.appendChild(svgEl("line", { x1: ML, x2: Wd - MR, y1: Y(v), y2: Y(v), stroke: css("--line") }));
      axisText(s, ML - 8, Y(v) + 4, fmt(v, digits), "end");
    });
    s.appendChild(svgEl("path", {
      d: pts.map(function (q, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(q.v).toFixed(1); }).join(" "),
      fill: "none", stroke: css("--accent"), "stroke-width": 2, "stroke-linejoin": "round"
    }));
    pts.forEach(function (q, i) {
      var c = svgEl("circle", { cx: X(i), cy: Y(q.v), r: 3.5, fill: css("--accent") });
      var t = svgEl("title", {});
      t.textContent = trDate(q.date) + " · " + fmt(q.v, digits);
      c.appendChild(t);
      s.appendChild(c);
    });
    axisText(s, X(0), Ht - 6, trDate(pts[0].date), "start");
    if (n > 1) axisText(s, X(n - 1), Ht - 6, trDate(pts[n - 1].date), "end");
    var f = figure(s);
    f.appendChild(el("figcaption", null, caption));
    return f;
  }

  // ---------- render ----------

  function renderAll() {
    $("healthLock").hidden = true;
    renderToday();
    var host = $("healthAnalysis");
    host.textContent = "";
    host.hidden = false;
    var h2 = el("h2", null, "ANALİZ ");
    h2.appendChild(el("span", "count", "WHOOP son çekim " + W.pulled.replace("T", " ")));
    host.appendChild(h2);
    [renderWeekly, renderTrend, renderPerformance, renderCost, renderTiming, renderCut, renderCardio]
      .forEach(function (fn) {
        try { fn(host); }
        catch (e) { host.appendChild(note("Bu bölüm çizilemedi: " + e.message, "warn")); }
      });
  }

  // ---------- decrypt ----------

  function bytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function decrypt(blob, password) {
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return Promise.reject(new Error("Bu tarayıcı şifre çözmeyi desteklemiyor."));
    var iv = bytes(blob.iv), ct = bytes(blob.ct), mac = bytes(blob.mac);
    return subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (k) {
        return subtle.deriveBits({ name: "PBKDF2", salt: bytes(blob.salt), iterations: blob.iter, hash: "SHA-256" }, k, 512);
      })
      .then(function (bits) {
        var encKey = bits.slice(0, 32), macKey = bits.slice(32);
        var signed = new Uint8Array(iv.length + ct.length);
        signed.set(iv, 0);
        signed.set(ct, iv.length);
        return subtle.importKey("raw", macKey, { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
          .then(function (mk) { return subtle.verify("HMAC", mk, mac, signed); })
          .then(function (ok) {
            if (!ok) throw new Error("Şifre yanlış.");
            return subtle.importKey("raw", encKey, { name: "AES-CBC" }, false, ["decrypt"]);
          })
          .then(function (ek) { return subtle.decrypt({ name: "AES-CBC", iv: iv }, ek, ct); });
      })
      .then(function (gz) {
        var stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
        return new Response(stream).text();
      })
      .then(JSON.parse);
  }

  var currentPw = null;

  function unlock(password, remember) {
    var msg = $("healthMsg");
    msg.textContent = "Açılıyor…";
    return fetch("private.enc.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("Şifreli veri bulunamadı."); return r.json(); })
      .then(function (blob) { return decrypt(blob, password); })
      .then(function (data) {
        W = data.whoop;
        B = data.body || { weight: [], cardio: [] };
        B.weight = B.weight || [];
        B.cardio = B.cardio || [];
        currentPw = password;
        try {
          if (remember) localStorage.setItem(PW_KEY, password);
        } catch (e) { /* private mode: just don't remember */ }
        msg.textContent = "";
        renderAll();
        offerFaceId();
      })
      .catch(function (e) {
        msg.textContent = e.message || "Açılamadı.";
        try { localStorage.removeItem(PW_KEY); } catch (e2) { /* ignore */ }
        // A password change on the site leaves the Face ID copy stale: drop it.
        if (e.message === "Şifre yanlış." && fromPasskey) forgetPasskey();
      });
  }

  // ---------- Face ID (passkey + WebAuthn PRF) ----------
  //
  // A static page has no server to check a passkey against, so the passkey is used for
  // what it can do offline: its PRF extension returns a secret that only this device's
  // Face ID can release. That secret seals the site password in localStorage with
  // AES-GCM; unlocking with Face ID unseals it. The plaintext password is not stored.

  var PK_KEY = "ad-health-passkey";
  var fromPasskey = false;

  function b64(buf) {
    var u = new Uint8Array(buf), bin = "";
    for (var i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return btoa(bin);
  }
  function rand(n) { return window.crypto.getRandomValues(new Uint8Array(n)); }
  function passkeyRecord() {
    try { return JSON.parse(localStorage.getItem(PK_KEY) || "null"); } catch (e) { return null; }
  }
  function forgetPasskey() {
    try { localStorage.removeItem(PK_KEY); } catch (e) { /* ignore */ }
    $("healthFaceId").hidden = true;
  }
  function webauthnReady() {
    return !!(window.PublicKeyCredential && navigator.credentials && window.crypto && window.crypto.subtle);
  }

  function prfSecret(credId, salt) {
    return navigator.credentials.get({ publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: "public-key", id: credId }],
      userVerification: "required",
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } }
    } }).then(function (a) {
      var ext = a.getClientExtensionResults();
      var out = ext && ext.prf && ext.prf.results && ext.prf.results.first;
      if (!out) throw new Error("Bu cihaz Face ID ile şifre saklamayı desteklemiyor (iOS 18+ Safari gerekir).");
      return aesFromPrf(out);
    });
  }

  function aesFromPrf(out) {
    return window.crypto.subtle.importKey("raw", out, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  function sealPassword(credId, salt, key) {
    var iv = rand(12);
    return window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(currentPw))
      .then(function (ct) {
        localStorage.setItem(PK_KEY, JSON.stringify({ id: b64(credId), salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
        localStorage.removeItem(PW_KEY);
      });
  }

  function enableFaceId(btn) {
    var salt = rand(32);
    function fail(e) {
      btn.disabled = false;
      btn.textContent = "Face ID'yi etkinleştir";
      btn.onclick = function () { enableFaceId(btn); };
      alert(e && e.name === "NotAllowedError" ? "Face ID iptal edildi." : (e.message || "Face ID etkinleştirilemedi."));
    }
    function done() { btn.disabled = true; btn.textContent = "Face ID açık ✓"; }
    btn.disabled = true;
    btn.textContent = "Face ID bekleniyor…";
    navigator.credentials.create({ publicKey: {
      rp: { name: "Antrenman Defteri" },
      user: { id: rand(16), name: "antrenman-defteri", displayName: "Antrenman Defteri" },
      challenge: rand(32),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } }
    } }).then(function (cred) {
      var credId = new Uint8Array(cred.rawId);
      var prf = (cred.getClientExtensionResults() || {}).prf || {};
      if (prf.results && prf.results.first) {
        return aesFromPrf(prf.results.first).then(function (key) { return sealPassword(credId, salt, key); }).then(done);
      }
      if (prf.enabled === false) throw new Error("Bu cihaz Face ID ile şifre saklamayı desteklemiyor (iOS 18+ Safari gerekir).");
      // Some platforms only hand out the PRF secret on a sign-in, and Safari wants a fresh
      // tap for that — so the second half waits for one.
      btn.disabled = false;
      btn.textContent = "Tamamlamak için dokun";
      btn.onclick = function () {
        btn.disabled = true;
        btn.textContent = "Face ID bekleniyor…";
        prfSecret(credId, salt).then(function (key) { return sealPassword(credId, salt, key); }).then(done).catch(fail);
      };
    }).catch(fail);
  }

  function unlockWithFaceId() {
    var rec = passkeyRecord();
    if (!rec) return;
    var msg = $("healthMsg");
    msg.textContent = "Face ID bekleniyor…";
    prfSecret(bytes(rec.id), bytes(rec.salt))
      .then(function (key) { return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(rec.iv) }, key, bytes(rec.ct)); })
      .then(function (pw) {
        fromPasskey = true;
        return unlock(new TextDecoder().decode(pw), false);
      })
      .catch(function (e) {
        msg.textContent = e && e.name === "NotAllowedError" ? "Face ID iptal edildi — şifreyle de açabilirsin." : (e.message || "Face ID ile açılamadı.");
      });
  }

  function offerFaceId() {
    if (!webauthnReady() || passkeyRecord()) return;
    var h2 = document.querySelector("#healthAnalysis h2");
    if (!h2) return;
    var btn = el("button", "ghost", "Face ID'yi etkinleştir");
    btn.type = "button";
    btn.style.marginLeft = "auto";
    btn.onclick = function () { enableFaceId(btn); };
    h2.appendChild(btn);
  }

  $("healthForm").onsubmit = function (ev) {
    ev.preventDefault();
    fromPasskey = false;
    unlock($("healthPw").value, $("healthRemember").checked);
  };
  $("healthFaceId").onclick = unlockWithFaceId;

  if (passkeyRecord() && webauthnReady()) {
    $("healthFaceId").hidden = false;
  } else {
    var saved = null;
    try { saved = localStorage.getItem(PW_KEY); } catch (e) { /* ignore */ }
    if (saved) unlock(saved, true);
  }
})();
