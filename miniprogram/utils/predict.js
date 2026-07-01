// ===================== 逻辑层：纯函数 + view-model 构造器（移植自 index.html） =====================
const D = require("./data.js");
const { ZH, EN, EMOJI, norm, FX, KNOWN, DIMS, PRED } = D;

const sk = (a, b) => [a, b].sort().join("~");
const fxKey = (a, b) => a + "|" + b;
// 淘汰赛阶段标签 + bracket 签位解析(签位未定时占位,解析为真实队码后自动出旗+预测)
const KO = { R32: "32强", R16: "16强", QF: "1/4决赛", SF: "半决赛", P3: "季军赛", FIN: "决赛" };
const isKO = g => Object.prototype.hasOwnProperty.call(KO, g);
const grpLabel = g => isKO(g) ? KO[g] : g + "组";
function koLabel(c) {
  if (ZH[c]) return ZH[c];
  if (/^1[A-L]$/.test(c)) return c[1] + "组①";
  if (/^2[A-L]$/.test(c)) return c[1] + "组②";
  if (/^3[A-L]+$/.test(c)) return "三名(" + c.slice(1).split("").join("/") + ")";
  if (/^w\d+$/.test(c)) return "M" + c.slice(1) + "胜";
  if (/^l\d+$/.test(c)) return "M" + c.slice(1) + "负";
  return c;
}
function invPred(p) { return { ...p, pred: [p.pred[1], p.pred[0]], prob: [p.prob[2], p.prob[1], p.prob[0]], dims: p.dims }; }
function pred(a, b) { return PRED[fxKey(a, b)] || (PRED[fxKey(b, a)] ? invPred(PRED[fxKey(b, a)]) : null); }

// 实际比分（朝向 队1,队2）或 null —— 仅读内嵌 KNOWN（无网络）
function actual(a, b) {
  const k = fxKey(a, b), kr = fxKey(b, a);
  if (KNOWN[k]) return KNOWN[k];
  if (KNOWN[kr]) return [KNOWN[kr][1], KNOWN[kr][0]];
  return null;
}

// ---------- 时间 / 状态 ----------
function bjNow() { const n = new Date(); return new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 8 * 3600000); }
const pad = n => String(n).padStart(2, "0");
const fxDate = iso => iso.slice(0, 10);
const fxTime = iso => iso.slice(11, 16);
function dayLabel(iso) { const d = new Date(iso); const w = "日一二三四五六"[d.getDay()]; return (d.getMonth() + 1) + "/" + d.getDate() + " 周" + w; }
function status(iso, hasScore) {
  if (hasScore) return "ft";
  const k = new Date(iso), now = new Date();
  if (now < k) return "up";
  if (now >= k && now < new Date(k.getTime() + 2.5 * 3600000)) return "live";
  return "ft0";
}
const STLBL = { live: "进行中", ft: "已结束", up: "未开始", ft0: "待更新" };

// ---------- 推导小工具 ----------
function wlScore(a, b, s) { return s[0] > s[1] ? ZH[a] : s[0] < s[1] ? ZH[b] : "平"; }
function wlCode(c) { return (!c || c === "draw") ? "平" : ZH[c]; }
function gTot(s) { return s[0] + s[1]; }
function ouZh(t) { return t > 2.5 ? "大" : "小"; }
function oWin(a, b) { const p = pred(a, b); if (!p || !p.odds) return ""; const w = p.odds.winner; return w === "draw" ? "平局" : ZH[w] + "胜"; }
function w8Win(a, b) { const p = pred(a, b); if (!p) return ""; const s = Math.sign(p.pred[0] - p.pred[1]); return s > 0 ? ZH[a] + "胜" : s < 0 ? ZH[b] + "胜" : "平局"; }
function diverge(a, b) { const p = pred(a, b); if (!p || !p.odds) return false; const s = Math.sign(p.pred[0] - p.pred[1]); const w8 = s > 0 ? a : s < 0 ? b : "draw"; return w8 !== p.odds.winner; }
function markVM(a, b) {
  const p = pred(a, b), ac = actual(a, b); if (!p || !ac) return null;
  const pw = Math.sign(p.pred[0] - p.pred[1]), aw = Math.sign(ac[0] - ac[1]);
  if (p.pred[0] === ac[0] && p.pred[1] === ac[1]) return { cls: "h", txt: "✓ 全中" };
  if (pw === aw) return { cls: "p", txt: "◐ 赢家对" };
  return { cls: "x", txt: "✗ 未中" };
}

// ---------- 卡片 view-model ----------
function buildCard(fx, slim) {
  const [iso, g, a, b, v] = fx;
  const ac = actual(a, b);
  const st = status(iso, !!ac);
  const stc = st === "ft0" ? "ft" : st;
  const p = pred(a, b);
  const vm = {
    a, b, iso, g, v, slim: !!slim,
    zhA: ZH[a] || koLabel(a), zhB: ZH[b] || koLabel(b), fA: EMOJI[a] || "", fB: EMOJI[b] || "",
    koA: !ZH[a], koB: !ZH[b], gLabel: grpLabel(g),
    time: fxTime(iso), day: dayLabel(iso),
    st, stc, stLbl: STLBL[st],
    hasScore: !!ac, sA: ac ? ac[0] : "", sB: ac ? ac[1] : "",
    scoreSub: ac ? (st === "live" ? "进行中·待官方" : "全场") : "",
    hasPred: !!p
  };
  if (p) {
    const rows = [];
    rows.push({ lab: "九维", labCls: "e", vCls: "ve", score: p.pred[0] + "-" + p.pred[1], wl: wlScore(a, b, p.pred), ou: ouZh(gTot(p.pred)) });
    if (p.x) rows.push({ lab: "市场", labCls: "m", vCls: "vm", score: p.x.os[0] + "-" + p.x.os[1], wl: wlCode(p.odds.winner), ou: p.x.oou === "over" ? "大" : "小" });
    if (p.upset) rows.push({ lab: "冷门" + p.upset.prob + "%", labCls: "u", vCls: "vu", score: p.upset.pred[0] + "-" + p.upset.pred[1], wl: wlCode(p.upset.winner), ou: p.upset.ou === "over" ? "大" : "小" });
    vm.rows = rows;
    vm.conf = p.conf;
    vm.dv = diverge(a, b);
    vm.mark = markVM(a, b);
    vm.miniNine = "九维 " + p.pred[0] + "-" + p.pred[1] + "·" + wlScore(a, b, p.pred) + "·" + ouZh(gTot(p.pred));
    vm.miniMarket = p.x ? ("市场 " + p.x.os[0] + "-" + p.x.os[1] + "·" + wlCode(p.odds.winner) + "·" + (p.x.oou === "over" ? "大" : "小")) : "";
    vm.miniUpset = p.upset ? ("冷门 " + p.upset.pred[0] + "-" + p.upset.pred[1] + "·" + wlCode(p.upset.winner) + "(" + p.upset.prob + "%)") : "";
  }
  return vm;
}

function dateMatches(d) { return FX.filter(f => fxDate(f[0]) === d).sort((x, y) => x[0] < y[0] ? -1 : 1); }
function nextMatchDay(after) { const fut = [...new Set(FX.map(f => fxDate(f[0])))].filter(d => d > after).sort(); return fut[0] || null; }

function buildToday() {
  const today = bjNow().toISOString().slice(0, 10);
  const list = dateMatches(today);
  return { label: "今日比分 · " + (list[0] ? dayLabel(list[0][0]) : today.slice(5).replace("-", "/")), cards: list.map(f => buildCard(f, false)) };
}
function buildTomorrow() {
  const today = bjNow().toISOString().slice(0, 10);
  let tmrw = new Date(bjNow().getTime() + 86400000).toISOString().slice(0, 10);
  let list = dateMatches(tmrw);
  if (!list.length) { const nd = nextMatchDay(today); if (nd) { tmrw = nd; list = dateMatches(nd); } }
  return { label: "明日研判 · " + (list[0] ? dayLabel(list[0][0]) : tmrw.slice(5).replace("-", "/")), cards: list.map(f => buildCard(f, false)) };
}

function buildSched(grpFilter, qRaw) {
  const q = norm(qRaw || "");
  const fx = FX.filter(f => {
    if (grpFilter && f[1] !== grpFilter) return false;
    if (q) { const hay = norm((ZH[f[2]] || koLabel(f[2])) + (ZH[f[3]] || koLabel(f[3])) + (EN[f[2]] || "") + (EN[f[3]] || "")); if (!hay.includes(q)) return false; }
    return true;
  });
  const byDay = {};
  fx.forEach(f => { (byDay[fxDate(f[0])] = byDay[fxDate(f[0])] || []).push(f); });
  const today = bjNow().toISOString().slice(0, 10);
  const days = Object.keys(byDay).sort();
  const firstFuture = days.filter(x => x >= today)[0];
  return days.map(d => {
    const ms = byDay[d].sort((x, y) => x[0] < y[0] ? -1 : 1);
    const open = d === today || (!days.includes(today) && firstFuture === d);
    return { date: d, label: dayLabel(ms[0][0]), count: ms.length, open, cards: ms.map(f => buildCard(f, true)) };
  });
}

function buildStand() {
  const groups = {};
  FX.filter(f => !isKO(f[1])).forEach(f => { (groups[f[1]] = groups[f[1]] || new Set()).add(f[2]), groups[f[1]].add(f[3]); });
  const tbl = {};
  Object.keys(groups).forEach(g => { tbl[g] = {}; [...groups[g]].forEach(c => tbl[g][c] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pt: 0 }); });
  FX.filter(f => !isKO(f[1])).forEach(f => {
    const [iso, g, a, b] = f, ac = actual(a, b); if (!ac) return;
    const A = tbl[g][a], B = tbl[g][b];
    A.p++; B.p++; A.gf += ac[0]; A.ga += ac[1]; B.gf += ac[1]; B.ga += ac[0];
    if (ac[0] > ac[1]) { A.w++; B.l++; A.pt += 3; } else if (ac[0] < ac[1]) { B.w++; A.l++; B.pt += 3; } else { A.d++; B.d++; A.pt++; B.pt++; }
  });
  return Object.keys(tbl).sort().map(g => {
    const rows = Object.entries(tbl[g]).map(([c, s]) => ({ c, ...s, gd: s.gf - s.ga }))
      .sort((x, y) => y.pt - x.pt || y.gd - x.gd || y.gf - x.gf || ZH[x.c].localeCompare(ZH[y.c]))
      .map((r, i) => ({ ...r, rk: i + 1, zh: ZH[r.c], flag: EMOJI[r.c], qual: i < 2, gdTxt: (r.gd > 0 ? "+" : "") + r.gd }));
    return { g, rows };
  });
}

// 本届冷门气候：已完赛中"热门未取胜"的比例（阶段性现象量化，非"连冷传染"）
function upsetClimate() {
  let played = 0, fails = 0;
  FX.forEach(f => {
    const p = pred(f[2], f[3]), ac = actual(f[2], f[3]); if (!p || !p.odds || !ac) return;
    const fav = p.odds.winner; if (fav === "draw" || !fav) return; played++;
    const favWon = (fav === f[2] && ac[0] > ac[1]) || (fav === f[3] && ac[1] > ac[0]); if (!favWon) fails++;
  });
  return { played, fails, rate: played ? Math.round(fails / played * 100) : 0 };
}
function buildHit() {
  let tot = 0, win = 0, ex = 0;
  FX.forEach(f => {
    const p = pred(f[2], f[3]), ac = actual(f[2], f[3]); if (!p || !ac) return;
    tot++; const pw = Math.sign(p.pred[0] - p.pred[1]), aw = Math.sign(ac[0] - ac[1]);
    if (pw === aw) win++; if (p.pred[0] === ac[0] && p.pred[1] === ac[1]) ex++;
  });
  const c = upsetClimate();
  const lbl = c.played < 3 ? "积累中" : c.rate >= 45 ? "🔥偏热" : c.rate >= 30 ? "偏冷" : "正常";
  return { tot, win, ex, climate: c, climateLbl: lbl, climateHot: c.played >= 3 && c.rate >= 45 };
}

// ---------- 详情 view-model ----------
function buildSheet(a, b, iso) {
  const fx = FX.find(f => f[2] === a && f[3] === b && f[0] === iso) || FX.find(f => f[2] === a && f[3] === b);
  const g = fx ? fx[1] : "", v = fx ? fx[4] : "", ac = actual(a, b), p = pred(a, b), st = status(iso, !!ac);
  const vm = {
    a, b, iso, g, v, zhA: ZH[a] || koLabel(a), zhB: ZH[b] || koLabel(b), fA: EMOJI[a] || "", fB: EMOJI[b] || "",
    koA: !ZH[a], koB: !ZH[b], gLabel: grpLabel(g),
    day: dayLabel(iso), time: fxTime(iso),
    hasScore: !!ac, big: ac ? (ac[0] + " - " + ac[1]) : fxTime(iso),
    bigSub: ac ? (st === "live" ? "进行中·比分待官方" : "全场") : "未开赛",
    hasPred: !!p
  };
  if (!p) return vm;

  const x = p.x, u = p.upset, hasU = !!u, hasOdds = !!p.odds;
  // 九维主块
  vm.nine = {
    score: p.pred[0] + "-" + p.pred[1], conf: p.conf, alt: p.alt,
    gk: gTot(p.pred) + "球·" + ouZh(gTot(p.pred)) + "2.5",
    prob: p.prob,
    cmp: ac ? { acA: ac[0], acB: ac[1], pA: p.pred[0], pB: p.pred[1], mark: markVM(a, b) } : null
  };
  // 市场块
  vm.odds = hasOdds ? {
    winText: oWin(a, b), conf: p.odds.conf,
    kpiScore: x ? (x.os[0] + "-" + x.os[1]) : "", kpiOu: x ? (x.oou === "over" ? "大2.5" : "小2.5") : "",
    prob: p.odds.prob, move: p.odds.move, sharp: p.odds.sharp
  } : null;
  // 两轨一致/分歧
  vm.cross = hasOdds ? (diverge(a, b)
    ? { type: "diverge", text: '⚡ 两轨分歧：九维度看「' + w8Win(a, b) + '」，市场看「' + oWin(a, b) + '」——重点关注场次' }
    : { type: "agree", text: '✓ 两轨一致：基本面与市场同向，置信度更高' }) : null;
  // 三轨对照矩阵
  vm.hasMatrix = !!(x && hasOdds);
  if (vm.hasMatrix) {
    vm.hasU = hasU;
    vm.matrix = [
      { label: "比分", v8: p.pred[0] + "-" + p.pred[1], vo: x.os[0] + "-" + x.os[1], vu: hasU ? (u.pred[0] + "-" + u.pred[1]) : "", dv: p.pred[0] !== x.os[0] || p.pred[1] !== x.os[1] },
      { label: "半场胜负", v8: wlScore(a, b, x.ht8), vo: wlCode(x.oht), vu: "—", dv: wlScore(a, b, x.ht8) !== wlCode(x.oht) },
      { label: "全场胜负", v8: wlScore(a, b, p.pred), vo: wlCode(p.odds.winner), vu: hasU ? wlCode(u.winner) : "", dv: wlScore(a, b, p.pred) !== wlCode(p.odds.winner) },
      { label: "进球数", v8: gTot(p.pred) + "球·" + ouZh(gTot(p.pred)) + "2.5", vo: (x.oou === "over" ? "大" : "小") + "2.5", vu: hasU ? ((u.ou === "over" ? "大" : "小") + "2.5") : "", dv: ouZh(gTot(p.pred)) !== (x.oou === "over" ? "大" : "小") }
    ];
    vm.upstrip = hasU ? { prob: u.prob, why: u.why } : null;
  }
  // 九维独立分析
  const dims9 = p.dims.slice(); while (dims9.length < DIMS.length) dims9.push(["", "该维度本场未单列(中性)"]);
  vm.dims = dims9.map((d, i) => ({ name: DIMS[i], note: d[1], leanTxt: d[0] ? ("▲ " + ZH[d[0]]) : "中性", leanCls: d[0] ? "t" : "n" }));
  vm.verdict = p.verdict;
  return vm;
}

module.exports = {
  bjNow, pad,
  buildToday, buildTomorrow, buildSched, buildStand, buildHit, buildSheet
};
