#!/usr/bin/env node
/*
 * sync-openfootball.js — 从 openfootball 拉取 2026 世界杯赛果, 对齐我们的球队码,
 * 生成/校验内嵌 KNOWN(比分, 用 ft 90分) 与 KOADV(淘汰赛点球/加时晋级方)。
 *
 * 架构(方案 1-A): 线上妙搭 dashboard 客户端直接 fetch openfootball CDN 实时覆盖比分,
 * 本脚本只用于:(a) 校验内嵌 KNOWN 与 openfootball 是否一致;(b) 一轮打完后
 * 重新生成 KNOWN/KOADV 文本, 手工贴回 index.html + miniprogram/utils/data.js。
 * 不需要任何 API key。
 *
 * 用法:
 *   node scripts/sync-openfootball.js            # 校验模式: 报告与内嵌 KNOWN 的差异
 *   node scripts/sync-openfootball.js --emit     # 额外打印可粘贴的 KNOWN / KOADV 文本
 */
const https = require("https");
const path = require("path");

const OF_URLS = [
  "https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json",
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json",
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error("HTTP " + r.statusCode)); }
      let s = ""; r.on("data", (d) => (s += d)); r.on("end", () => resolve(JSON.parse(s)));
    }).on("error", reject);
  });
}

async function fetchOF() {
  let lastErr;
  for (const u of OF_URLS) { try { return await get(u); } catch (e) { lastErr = e; } }
  throw lastErr;
}

// 晋级方: 90分平则看加时(et)再看点球(p)。返回 'a'|'b'|null
function advSide(score) {
  if (!score || !score.ft) return null;
  if (score.ft[0] !== score.ft[1]) return null;         // 90分已分胜负, 无需注明
  if (score.et && score.et[0] !== score.et[1]) return score.et[0] > score.et[1] ? "a" : "b";
  if (score.p && score.p[0] !== score.p[1]) return score.p[0] > score.p[1] ? "a" : "b";
  return null;
}

(async () => {
  const d = require(path.join(__dirname, "..", "miniprogram", "utils", "data.js"));
  const of = await fetchOF();

  // 无序对 -> 我方 fixture 朝向
  const fxIdx = {};
  d.FX.forEach((f) => { fxIdx[[f[2], f[3]].sort().join("~")] = { t1: f[2], t2: f[3], stage: f[1] }; });

  const KNOWN = {}; const KOADV = {};
  const unmapped = new Set(); const noFixture = []; const diffs = [];

  of.matches.forEach((m) => {
    const c1 = d.N2C[d.norm(m.team1)], c2 = d.N2C[d.norm(m.team2)];
    if (!c1) unmapped.add(m.team1);
    if (!c2) unmapped.add(m.team2);
    if (!c1 || !c2) return;
    const ft = m.score && m.score.ft;
    if (!ft) return;
    const idx = fxIdx[[c1, c2].sort().join("~")];
    if (!idx) { noFixture.push(m.team1 + " vs " + m.team2); return; }
    // 朝向对齐到我方 fixture
    const flip = idx.t1 !== c1;
    const our = flip ? [ft[1], ft[0]] : [ft[0], ft[1]];
    const key = idx.t1 + "|" + idx.t2;
    KNOWN[key] = our;
    // 淘汰赛晋级方
    const side = advSide(m.score);
    if (side) {
      const winCode = side === "a" ? c1 : c2;
      KOADV[key] = winCode;
    }
    // 差异校验
    const cur = d.KNOWN[key];
    if (!cur) diffs.push(`${key} = ${our.join("-")}  (NEW · ${idx.stage})`);
    else if (cur[0] !== our[0] || cur[1] !== our[1]) diffs.push(`${key} = ${our.join("-")}  (内嵌为 ${cur.join("-")} · ${idx.stage})`);
  });

  console.log(`openfootball matches: ${of.matches.length}, 映射入库 KNOWN: ${Object.keys(KNOWN).length}, KOADV: ${Object.keys(KOADV).length}`);
  console.log("未映射队名(应仅剩未定的 W/L 占位):", [...unmapped].filter((x) => !/^[WL]\d/.test(x)));
  if (noFixture.length) console.log("⚠ 有赛果但我方无对应 fixture:", noFixture);
  console.log("\n=== 与内嵌 KNOWN 的差异 ===");
  console.log(diffs.length ? diffs.join("\n") : "无差异 ✓ (内嵌 KNOWN 与 openfootball ft 完全一致)");

  if (process.argv.includes("--emit")) {
    const fmt = (o) => JSON.stringify(o).replace(/"([a-z0-9|-]+)":/g, '"$1":').replace(/,/g, ", ");
    console.log("\n=== KNOWN (ft 90分, 可粘贴) ===\n" + fmt(KNOWN));
    console.log("\n=== KOADV (点球/加时晋级方, 可粘贴) ===\n" + fmt(KOADV));
  }
})().catch((e) => { console.error("同步失败:", e.message); process.exit(1); });
