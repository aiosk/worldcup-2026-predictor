#!/usr/bin/env node
/*
 * auto-predict.js — 淘汰赛下一轮预测的云端大脑(GitHub Actions 里跑, 脱离本机)。
 *
 * 流程: 拉 openfootball → 找"已解析出真实球队、但还没预测"的下一轮 KO 场次
 *   → λ(泊松+Dixon-Coles) 算比分/概率 → DeepSeek 生成十一维深度维度+市场+爆冷+verdict
 *   → 写 pred-overlay.json(累积) + 追加 PREDICTIONS.md。
 * 前端(dashboard.html)通过 CDN fetch pred-overlay.json 合并进 PRED —— 妙搭零改动、零授权。
 *
 * 环境变量: DEEPSEEK_API_KEY (GitHub secret)。
 * 用法:
 *   node scripts/auto-predict.js            # 检测并生成下一轮(有则写文件)
 *   node scripts/auto-predict.js --test ma|fr   # 对指定一场生成并打印(不写文件,验证用)
 *   node scripts/auto-predict.js --dry        # 检测但不写文件, 打印将生成哪些
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const d = require(path.join(ROOT, "miniprogram/utils/data.js"));
const OVERLAY = path.join(ROOT, "pred-overlay.json");
const OF_URLS = [
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json",
  "https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json",
];
const KEY = process.env.DEEPSEEK_API_KEY || "";
const HOSTS = new Set(["us", "mx", "ca"]);
const ROUND_ZH = { R16: "16强", QF: "1/4决赛", SF: "半决赛", P3: "季军赛", FIN: "决赛" };

/* ---------- HTTP ---------- */
function getJSON(url) {
  return new Promise((res, rej) => {
    https.get(url, (r) => { if (r.statusCode !== 200) { r.resume(); return rej(new Error("HTTP " + r.statusCode)); } let s = ""; r.on("data", c => s += c); r.on("end", () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on("error", rej);
  });
}
async function fetchOF() { let e; for (const u of OF_URLS) { try { return await getJSON(u); } catch (x) { e = x; } } throw e; }
function postDeepSeek(payload) {
  const body = JSON.stringify(payload);
  return new Promise((res, rej) => {
    const req = https.request("https://api.deepseek.com/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY, "Content-Length": Buffer.byteLength(body) }, timeout: 120000,
    }, (r) => { let s = ""; r.on("data", c => s += c); r.on("end", () => { try { res(JSON.parse(s)); } catch (e) { rej(new Error("bad DS json: " + s.slice(0, 200))); } }); });
    req.on("error", rej); req.on("timeout", () => req.destroy(new Error("DS timeout")));
    req.write(body); req.end();
  });
}

/* ---------- λ: 攻防率 + 泊松 + Dixon-Coles ---------- */
function computeRates(finished) {
  // finished: [{a,b,ga,gb}] 已完赛(ft, 单场封顶4). 返回 {gf,ga,n} per code + μ
  const T = {}; let totG = 0, totTG = 0;
  const bump = (c) => (T[c] || (T[c] = { gf: 0, ga: 0, n: 0 }));
  finished.forEach(m => {
    const ga = Math.min(4, m.ga), gb = Math.min(4, m.gb);
    const A = bump(m.a), B = bump(m.b);
    A.gf += ga; A.ga += gb; A.n++; B.gf += gb; B.ga += ga; B.n++;
    totG += ga + gb; totTG += 2;
  });
  const mu = totG / Math.max(1, totTG); // 每队每场均进球
  return { T, mu };
}
function rate(T, mu, c, k = 1.6) {
  const t = T[c] || { gf: mu, ga: mu, n: 0 };
  const att = (t.gf + k * mu) / (t.n + k); // 向 μ 收缩
  const def = (t.ga + k * mu) / (t.n + k);
  return { att, def };
}
const fact = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const pois = (kk, l) => Math.exp(-l) * Math.pow(l, kk) / fact(kk);
const RHO = -0.13;
function dcModel(l1, l2) {
  const M = 7; let W = 0, D = 0, L = 0, bw = [1, 0], bwp = 0, bd = [0, 0], bdp = 0, bl = [0, 1], blp = 0;
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
    let p = pois(i, l1) * pois(j, l2);
    if (i === 0 && j === 0) p *= 1 - l1 * l2 * RHO; else if (i === 1 && j === 0) p *= 1 + l2 * RHO; else if (i === 0 && j === 1) p *= 1 + l1 * RHO; else if (i === 1 && j === 1) p *= 1 - RHO;
    if (i > j) { W += p; if (p > bwp) { bwp = p; bw = [i, j]; } } else if (i === j) { D += p; if (p > bdp) { bdp = p; bd = [i, j]; } } else { L += p; if (p > blp) { blp = p; bl = [i, j]; } }
  }
  const s = W + D + L; W = W / s * 100; D = D / s * 100; L = L / s * 100;
  const top = Math.max(W, D, L), sc = top === W ? bw : top === D ? bd : bl;
  let pr = [Math.round(W), Math.round(D), Math.round(L)];
  const diff = 100 - (pr[0] + pr[1] + pr[2]); pr[pr.indexOf(Math.max(...pr))] += diff; // 凑整=100
  return { pred: sc, prob: pr };
}
function lambdaPredict(rates, a, b) {
  const { T, mu } = rates;
  const ra = rate(T, mu, a), rb = rate(T, mu, b);
  const KO = 0.93;
  let l1 = (ra.att / mu) * (rb.def / mu) * mu * KO;
  let l2 = (rb.att / mu) * (ra.def / mu) * mu * KO;
  if (HOSTS.has(a)) l1 += 0.13; if (HOSTS.has(b)) l2 += 0.13; // 真东道主主场
  return dcModel(l1, l2);
}

/* ---------- DeepSeek 深度维度 ---------- */
const DIMS = d.DIMS; // 11 维顺序
function buildPrompt(a, b, ctx, lam) {
  const zh = c => d.ZH[c] || c, en = c => d.EN[c] || c;
  return `你是资深足球战术分析师。为 2026 世界杯${ctx.roundZh} ${zh(a)}(${en(a)}) vs ${zh(b)}(${en(b)}) 生成三轨预测。
场地: ${ctx.venue}. λ模型已算出九维比分 ${lam.pred[0]}-${lam.pred[1]}, 胜平负% ${lam.prob.join("/")}(以此为准, 你的分析须与之自洽; 小样本明显失真才可在verdict注明覆盖).
本队本届战绩(进-失/场次): ${zh(a)} ${ctx.form[a] || "无"}; ${zh(b)} ${ctx.form[b] || "无"}. 晋级之路: ${ctx.path || "无"}.

严格输出JSON(不要解释文字), 结构:
{
 "conf": "高|中|中低|低",
 "alt": "次选 X-Y / ...",
 "dims": [["code","note"] ...恰好11项, 顺序=${DIMS.join("/")}],
 "odds": {"winner":"${a}|${b}|draw","prob":[胜,平,负凑100],"conf":"高|中|低","move":"盘口移动一句","sharp":"聪明钱/RLM一句"},
 "upset": {"pred":[x,y],"winner":"${a}|${b}|(空串=平)","ou":"over|under","prob":整数百分比,"why":"爆冷理由一句"},
 "verdict": "综合裁决2-4句"
}
dims 规则: code 只能是 "${a}"/"${b}"/""(中性); 每维 note ≥50字, 含①具体(球员+俱乐部/身价/真实数字)②机制(为何影响本场)③用**加粗**写一句胜负手/所以呢/盲区. 控球率维注明"控球≠强弱". 无实时伤病源就写"需赛前核实+谁缺阵会怎样", 不硬编。中文。`;
}
async function genDims(a, b, ctx, lam) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {   // DeepSeek 偶尔返回非11维/坏JSON → 重试(新调用),末次容错
    try {
      const r = await postDeepSeek({
        model: "deepseek-chat",
        messages: [{ role: "system", content: "你输出严格JSON,不带markdown代码围栏,不带任何解释。dims 必须恰好11项。" }, { role: "user", content: buildPrompt(a, b, ctx, lam) }],
        temperature: 0.6, max_tokens: 3000,
      });
      if (r.error) throw new Error("DeepSeek: " + JSON.stringify(r.error));
      let txt = r.choices[0].message.content.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const obj = JSON.parse(txt);
      if (!Array.isArray(obj.dims)) throw new Error("dims 不是数组");
      let dims = obj.dims.map(x => Array.isArray(x) ? [x[0] || "", String(x[1] || "")] : [x.code || "", String(x.note || "")]);
      if (dims.length > 11 && attempt === 3) dims = dims.slice(0, 11); // 末次仍多返回→取前11(按DIMS顺序)
      if (dims.length !== 11) throw new Error("dims 非11项: " + dims.length);
      obj.dims = dims;
      return obj;
    } catch (e) { lastErr = e; console.log("  ↻ genDims 第" + attempt + "次失败:", e.message); }
  }
  throw lastErr;
}

/* ---------- 组装 PRED ---------- */
function assemble(a, b, lam, ds) {
  const tot = lam.pred[0] + lam.pred[1];
  return {
    pred: lam.pred, alt: ds.alt || "", conf: ds.conf || "中", prob: lam.prob,
    dims: ds.dims,
    odds: ds.odds || { winner: lam.prob[0] >= lam.prob[2] ? a : b, prob: lam.prob, conf: "中", move: "", sharp: "" },
    x: { ht8: [0, 0], os: lam.pred.slice(), oht: "", oou: tot > 2.5 ? "over" : "under" },
    upset: ds.upset || null,
    verdict: ds.verdict || "",
  };
}

/* ---------- 主流程 ---------- */
function code(m, side) { const n = (side === 1 ? m.team1 : m.team2); return d.N2C[d.norm(n)]; }
async function main() {
  const args = process.argv.slice(2);
  const of = await fetchOF();
  // 已完赛(ft) 用于 λ 攻防率
  const finished = [];
  of.matches.forEach(m => { const c1 = code(m, 1), c2 = code(m, 2); const ft = m.score && m.score.ft; if (c1 && c2 && ft) finished.push({ a: c1, b: c2, ga: ft[0], gb: ft[1] }); });
  const rates = computeRates(finished);
  // 本届战绩 form + 晋级路径(供 DeepSeek)
  const form = {}; Object.keys(rates.T).forEach(c => { const t = rates.T[c]; form[c] = `${t.gf}-${t.ga}/${t.n}场`; });

  // 现有预测(baked-in + overlay)
  const overlay = fs.existsSync(OVERLAY) ? JSON.parse(fs.readFileSync(OVERLAY, "utf8")) : { fx: {}, preds: {}, _log: [] };
  overlay.fx = overlay.fx || {}; overlay.preds = overlay.preds || {}; overlay._log = overlay._log || [];
  const have = new Set([...Object.keys(d.PRED), ...Object.keys(overlay.preds)]);

  // --test <key>: 单场验证, 不写
  const testIdx = args.indexOf("--test");
  if (testIdx >= 0) {
    const key = args[testIdx + 1]; const [a, b] = key.split("|");
    const fx = d.FX.find(f => (f[2] === a && f[3] === b)) || {};
    const ctx = { roundZh: ROUND_ZH[fx[1]] || "淘汰赛", venue: fx[4] || "中立场", form, path: "" };
    const lam = lambdaPredict(rates, a, b);
    console.log("λ:", JSON.stringify(lam));
    const ds = await genDims(a, b, ctx, lam);
    console.log(JSON.stringify(assemble(a, b, lam, ds), null, 1));
    return;
  }

  // 自解析 bracket(不等 openfootball 更新 QF 签位): 从 openfootball 已完赛 KO 的 ft/et/p 定晋级方,
  // 再按 FX 的 wN 槽位(R16=match89-96, QF=97-100, SF=101-102)逐轮解析真实球队。
  const ofByPair = {};
  of.matches.forEach(m => {
    const c1 = code(m, 1), c2 = code(m, 2), s = m.score; if (!c1 || !c2 || !s || !s.ft) return;
    let w; const ft = s.ft;
    if (ft[0] !== ft[1]) w = ft[0] > ft[1] ? c1 : c2;
    else if (s.et && s.et[0] !== s.et[1]) w = s.et[0] > s.et[1] ? c1 : c2;
    else if (s.p && s.p[0] !== s.p[1]) w = s.p[0] > s.p[1] ? c1 : c2;
    if (w) ofByPair[[c1, c2].sort().join("~")] = { a: c1, b: c2, w };
  });
  const fxByRound = {};
  d.FX.forEach(f => { if (ROUND_ZH[f[1]]) (fxByRound[f[1]] = fxByRound[f[1]] || []).push(f); });
  const resolved = { R16: [], QF: [], SF: [], P3: [], FIN: [] };
  (fxByRound.R16 || []).forEach(f => resolved.R16.push({ a: f[2], b: f[3] })); // R16 内嵌已是真实球队
  function slotTeam(slot) {
    if (/^[a-z]{2}(-[a-z]+)?$/.test(slot) && d.ZH[slot]) return slot; // 已是真实 code
    const m = slot.match(/^([wl])(\d+)$/); if (!m) return null;
    const num = +m[2]; let rk, idx;
    if (num >= 89 && num <= 96) { rk = "R16"; idx = num - 89; }
    else if (num >= 97 && num <= 100) { rk = "QF"; idx = num - 97; }
    else if (num >= 101 && num <= 102) { rk = "SF"; idx = num - 101; }
    else return null;
    const g = resolved[rk][idx]; if (!g || !g.a || !g.b) return null;      // feeder 未解析
    const adv = ofByPair[[g.a, g.b].sort().join("~")]; if (!adv) return null; // feeder 未打完
    return m[1] === "w" ? adv.w : (adv.w === g.a ? g.b : g.a);
  }
  const todo = [];
  ["QF", "SF", "P3", "FIN"].forEach(rk => {
    (fxByRound[rk] || []).forEach((f, idx) => {
      const a = slotTeam(f[2]), b = slotTeam(f[3]);
      if (!a || !b) return;                     // 任一 feeder 未定 → 跳过
      resolved[rk][idx] = { a, b };             // 供下一轮解析
      const key = a + "|" + b, keyR = b + "|" + a;
      if (have.has(key) || have.has(keyR)) return;
      todo.push({ key, a, b, round: rk, iso: f[0], venue: f[4] || "中立场" });
    });
  });

  if (!todo.length) { console.log("NOCHANGE: 无新解析的待预测场次"); return; }
  console.log("待预测:", todo.map(t => t.round + " " + t.key).join(", "));
  if (args.includes("--dry")) return;

  const done = [];
  for (const t of todo) {
    try {
      const lam = lambdaPredict(rates, t.a, t.b);
      const ds = await genDims(t.a, t.b, { roundZh: ROUND_ZH[t.round], venue: t.venue, form, path: "" }, lam);
      overlay.preds[t.key] = assemble(t.a, t.b, lam, ds);
      overlay.fx[t.key] = { round: t.round, iso: t.iso, venue: t.venue };
      done.push(`${t.round} ${t.key} → ${lam.pred[0]}-${lam.pred[1]} (${lam.prob.join("/")})`);
      console.log("✓", t.key, lam.pred.join("-"));
    } catch (e) { console.log("✗", t.key, e.message); }
  }
  if (!done.length) { console.log("NOCHANGE: 全部生成失败"); process.exit(1); }
  overlay._log.push({ at: new Date().toISOString().slice(0, 16), games: done });
  fs.writeFileSync(OVERLAY, JSON.stringify(overlay, null, 1));
  // 追加 PREDICTIONS.md
  const md = `\n### 🤖 自动生成 · ${done[0].split(" ")[0]}（DeepSeek+λ, ${new Date().toISOString().slice(0, 10)}）\n` + done.map(x => "- " + x).join("\n") + "\n";
  fs.appendFileSync(path.join(ROOT, "PREDICTIONS.md"), md);
  console.log("WROTE:", done.length, "场 → pred-overlay.json");
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
