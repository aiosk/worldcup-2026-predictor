#!/usr/bin/env node
/* 世界杯：API-Football → odds.json 机械市场层 + scores.json 轻量比分层
 *
 * 运行位置：
 * - 仓库内：node server/update-odds.js
 * - 服务器：/root/wc-odds/update-odds.js，同目录放一份 data.js 和 .env
 *
 * 设计目标：
 * - 从 data.js 读取当前 FX/KNOWN/PRED，不再硬编码小组赛。
 * - 只更新“已确认对阵”的未来比赛，跳过 w73/l101/签位占位。
 * - odds.json 作为线上覆盖层，页面加载时会覆盖内嵌 PRED.odds / PRED.x。
 * - 保留人工写的 sharp，只覆盖 winner/prob/conf/move/os/oht/oou 等机械数据。
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const SITE_DIR = process.env.WC_SITE_DIR || "/var/www/worldcup";
const ODDS_JSON = process.env.WC_ODDS_JSON || path.join(SITE_DIR, "odds.json");
const SCORES_JSON = process.env.WC_SCORES_JSON || path.join(SITE_DIR, "scores.json");
const SNAP = process.env.WC_SNAP_JSON || path.join(DIR, "snap.json");
const IDCACHE = process.env.WC_FIXIDS_JSON || path.join(DIR, "fixids.json");
const LEAGUE = Number(process.env.APIFOOTBALL_LEAGUE || 1);
const LOOKAHEAD_DAYS = Number(process.env.WC_ODDS_LOOKAHEAD_DAYS || 14);
const MAX_ODDS_MATCHES = Number(process.env.WC_MAX_ODDS_MATCHES || 16);
const SCORE_LOOKBACK_DAYS = Number(process.env.WC_SCORE_LOOKBACK_DAYS || 4);
const API_SLEEP_MS = Number(process.env.WC_API_SLEEP_MS || 1200);

function loadData() {
  const candidates = [
    process.env.WC_DATA_JS,
    path.join(DIR, "data.js"),
    path.join(DIR, "..", "miniprogram", "utils", "data.js"),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      return { file: f, data: require(f) };
    } catch (e) {
      if (e.code !== "MODULE_NOT_FOUND" && e.code !== "ENOENT") throw e;
    }
  }
  throw new Error("Cannot find data.js. Set WC_DATA_JS or copy data.js next to update-odds.js.");
}

let KEY = process.env.APIFOOTBALL_KEY || "";
try {
  if (!KEY) {
    const e = fs.readFileSync(path.join(DIR, ".env"), "utf8");
    const m = e.match(/APIFOOTBALL_KEY=(.+)/);
    if (m) KEY = m[1].trim();
  }
} catch (e) {}
if (!KEY) {
  console.error("NO APIFOOTBALL_KEY");
  process.exit(1);
}

const { file: dataFile, data } = loadData();
const { FX, KNOWN, PRED, ZH, N2C, norm } = data;
const knownTeams = new Set(Object.keys(ZH || {}));
const normalize = typeof norm === "function"
  ? norm
  : s => (s || "").toLowerCase().replace(/[^a-z]/g, "");

function get(p) {
  return new Promise((res, rej) => {
    https.get("https://v3.football.api-sports.io" + p, { headers: { "x-apisports-key": KEY } }, r => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => {
        try { res(JSON.parse(d)); } catch (e) { rej(e); }
      });
    }).on("error", rej);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = (f, def) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return def; }
};
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + "\n");
const bjStamp = now => new Date(now + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
const fxKey = (a, b) => `${a}|${b}`;
const matchKey = (a, b) => [a, b].sort().join("|");
const isConfirmed = c => knownTeams.has(c);
const isKnown = (a, b) => Boolean(KNOWN[fxKey(a, b)] || KNOWN[fxKey(b, a)]);
const isFinalStatus = st => st === "FT" || st === "AET" || st === "PEN";

function devig(odds) {
  if (odds.some(o => !Number.isFinite(o) || o <= 1)) return null;
  const inv = odds.map(x => 1 / x);
  const s = inv.reduce((a, b) => a + b, 0);
  const raw = inv.map(x => x / s * 100);
  const base = raw.map(Math.floor);
  let left = 100 - base.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (left > 0) { base[i]++; left--; }
  });
  return base;
}

function pick(bookmakers, name) {
  for (const b of bookmakers) {
    const bet = (b.bets || []).find(x => x.name === name);
    if (bet) return { book: b.name, values: bet.values || [] };
  }
  return null;
}

function refBook(bookmakers) {
  return bookmakers.find(b => b.name === "Pinnacle")
    || bookmakers.find(b => b.name === "Bet365")
    || bookmakers[0];
}

function teamCode(name) {
  return N2C[normalize(name)];
}

function valueOdd(values, label) {
  const v = values.find(x => String(x.value).toLowerCase() === label.toLowerCase());
  return v ? Number(v.odd) : NaN;
}

function mapFixture(f) {
  const home = teamCode(f.teams && f.teams.home && f.teams.home.name);
  const away = teamCode(f.teams && f.teams.away && f.teams.away.name);
  if (!home || !away) return null;
  return {
    id: f.fixture.id,
    home,
    away,
    key: matchKey(home, away),
    gh: f.goals.home,
    ga: f.goals.away,
    st: f.fixture.status.short,
  };
}

function cacheGet(idc, m) {
  const v = idc[m.key] || idc[m.setKey];
  if (!v) return null;
  if (typeof v === "number") return { id: v, home: m.a, away: m.b };
  return v;
}

function cacheSet(idc, m, api) {
  idc[m.key] = { id: api.id, home: api.home, away: api.away };
  idc[m.setKey] = { id: api.id, home: api.home, away: api.away };
}

function orientProb(apiHomeProb, apiDrawProb, apiAwayProb, apiHome, m) {
  return apiHome === m.a ? [apiHomeProb, apiDrawProb, apiAwayProb] : [apiAwayProb, apiDrawProb, apiHomeProb];
}

function orientScore(score, apiHome, m) {
  if (!score) return null;
  return apiHome === m.a ? score : [score[1], score[0]];
}

function scoreFromExactScore(values) {
  let best = null;
  values.forEach(v => {
    const od = Number(v.odd);
    if (!Number.isFinite(od)) return;
    if (best === null || od < best.od) best = { od, val: String(v.value) };
  });
  if (!best) return null;
  const mm = best.val.match(/(\d+)\D+(\d+)/);
  return mm ? [Number(mm[1]), Number(mm[2])] : null;
}

function marketMove(prev, cur, m) {
  if (!prev) return null;
  const labels = [`${ZH[m.a]}胜`, "平局", `${ZH[m.b]}胜`];
  let best = { i: -1, delta: 0 };
  for (let i = 0; i < 3; i++) {
    const delta = (prev[i] - cur[i]) / prev[i];
    if (delta > best.delta) best = { i, delta };
  }
  if (best.delta > 0.02) return `${labels[best.i]}收窄 ${prev[best.i]}→${cur[best.i]}(资金流入)`;
  return "盘口基本持平";
}

function buildTargets(now, scores) {
  const rows = FX.map((f, i) => {
    const [iso, round, a, b, venue] = f;
    return { i: i + 1, iso, round, a, b, venue, ko: new Date(iso).getTime(), key: fxKey(a, b), setKey: matchKey(a, b) };
  }).filter(m => isConfirmed(m.a) && isConfirmed(m.b));

  const settled = m => isKnown(m.a, m.b) || (scores[m.key] && isFinalStatus(scores[m.key].st));
  const recentScores = rows.filter(m => {
    const dt = now - m.ko;
    return dt >= -15 * 60e3 && dt <= SCORE_LOOKBACK_DAYS * 86400e3 && !settled(m);
  });
  const futureOdds = rows.filter(m => {
    const dt = m.ko - now;
    return dt > 0 && dt <= LOOKAHEAD_DAYS * 86400e3 && !settled(m) && PRED[m.key];
  }).sort((a, b) => a.ko - b.ko).slice(0, MAX_ODDS_MATCHES);

  const bySet = new Map();
  [...recentScores, ...futureOdds].forEach(m => bySet.set(m.setKey, m));
  return { recentScores, futureOdds, apiTargets: [...bySet.values()] };
}

(async () => {
  const now = Date.now();
  const bj = bjStamp(now);
  const scores = readJSON(SCORES_JSON, {});
  const idc = readJSON(IDCACHE, {});
  const { recentScores, futureOdds, apiTargets } = buildTargets(now, scores);

  console.log(`[${bj}] data=${dataFile}`);
  console.log(`  比分候选 ${recentScores.length} 场；赔率候选 ${futureOdds.length} 场：${futureOdds.map(m => m.key).join(",") || "-"}`);
  if (!apiTargets.length) {
    console.log(`[${bj}] 无已确认未来赛事/近期未结算赛事，0 API调用退出`);
    return;
  }

  const dates = [...new Set(apiTargets.map(m => new Date(m.ko).toISOString().slice(0, 10)))];
  const bySet = {};
  const dateErrors = {};
  for (const dt of dates) {
    let r;
    try {
      r = await get(`/fixtures?date=${dt}`);
    } catch (e) {
      console.log("  fixtures错误", dt, e.message);
      dateErrors[dt] = e.message;
      continue;
    }
    if (r.errors && Object.keys(r.errors).length) {
      dateErrors[dt] = JSON.stringify(r.errors);
      console.log(`  fixtures受限 ${dt}: ${dateErrors[dt]}`);
      continue;
    }
    await sleep(API_SLEEP_MS);
    (r.response || []).forEach(f => {
      if (!f.league || f.league.id !== LEAGUE) return;
      const api = mapFixture(f);
      if (!api) return;
      bySet[api.key] = api;
    });
  }

  let scoreWrites = 0;
  let scoreClears = 0;
  apiTargets.forEach(m => {
    const api = bySet[m.setKey];
    if (!api) return;
    cacheSet(idc, m, api);
    if (isFinalStatus(api.st) && api.gh != null) {
      const s = api.home === m.a ? [api.gh, api.ga] : [api.ga, api.gh];
      scores[m.key] = { s, st: api.st };
      scoreWrites++;
    } else if (scores[m.key] && !isFinalStatus(scores[m.key].st)) {
      delete scores[m.key];
      scoreClears++;
    }
  });
  if (scoreWrites || scoreClears || recentScores.length) {
    scores._updated = bj;
    writeJSON(SCORES_JSON, scores);
    console.log(`  比分写入 ${scoreWrites} 场，清理非终态 ${scoreClears} 场 → ${SCORES_JSON}`);
  }
  writeJSON(IDCACHE, idc);

  if (!futureOdds.length) {
    console.log(`[${bj}] 无需赔率更新`);
    return;
  }

  const odds = readJSON(ODDS_JSON, {});
  const snap = readJSON(SNAP, {});
  let updated = 0;

  for (const m of futureOdds) {
    const api = bySet[m.setKey] || cacheGet(idc, m);
    if (!api || !api.id) {
      const dt = new Date(m.ko).toISOString().slice(0, 10);
      const why = dateErrors[dt] ? `API未开放该日期(${dateErrors[dt]})` : "API未返回该对阵";
      console.log(`  未更新 ${m.key}: ${why}`);
      continue;
    }
    let r;
    try {
      r = await get(`/odds?fixture=${api.id}`);
    } catch (e) {
      console.log("  odds错误", m.key, e.message);
      continue;
    }
    await sleep(API_SLEEP_MS);

    const resp = (r.response || [])[0];
    if (!resp || !resp.bookmakers || !resp.bookmakers.length) {
      console.log(`  无赔率: ${m.key}`);
      continue;
    }

    const bms = resp.bookmakers;
    const rb = refBook(bms);
    const mw = pick([rb], "Match Winner") || pick(bms, "Match Winner");
    if (!mw) {
      console.log(`  无胜平负: ${m.key}`);
      continue;
    }

    const hOdd = valueOdd(mw.values, "Home");
    const dOdd = valueOdd(mw.values, "Draw");
    const aOdd = valueOdd(mw.values, "Away");
    const apiProb = devig([hOdd, dOdd, aOdd]);
    if (!apiProb) {
      console.log(`  胜平负赔率异常: ${m.key}`);
      continue;
    }
    const prob = orientProb(apiProb[0], apiProb[1], apiProb[2], api.home, m);
    const wi = prob.indexOf(Math.max(...prob));
    const winner = wi === 0 ? m.a : wi === 2 ? m.b : "draw";
    const mx = Math.max(...prob);
    const conf = mx >= 70 ? "高" : mx >= 50 ? "中" : "低";

    const ou = pick(bms, "Goals Over/Under");
    let oou = "under";
    if (ou) {
      const over = ou.values.find(v => String(v.value).toLowerCase() === "over 2.5");
      const under = ou.values.find(v => String(v.value).toLowerCase() === "under 2.5");
      if (over && under) oou = Number(over.odd) < Number(under.odd) ? "over" : "under";
    }

    const ex = pick(bms, "Exact Score");
    const os = ex ? orientScore(scoreFromExactScore(ex.values), api.home, m) : null;

    let oht = null;
    const ht = pick(bms, "Halftime Result") || pick(bms, "1st Half Winner") || pick(bms, "First Half Winner");
    if (ht) {
      const hp = devig([valueOdd(ht.values, "Home"), valueOdd(ht.values, "Draw"), valueOdd(ht.values, "Away")]);
      if (hp) {
        const p = orientProb(hp[0], hp[1], hp[2], api.home, m);
        const hi = p.indexOf(Math.max(...p));
        oht = hi === 0 ? m.a : hi === 2 ? m.b : "";
      }
    }

    const prev = snap[m.key];
    const curOdds = api.home === m.a ? [hOdd, dOdd, aOdd] : [aOdd, dOdd, hOdd];
    const move = marketMove(prev, curOdds, m) || `建立基线(${mw.book || rb.name} 1X2 ${curOdds[0]}/${curOdds[1]}/${curOdds[2]})`;
    snap[m.key] = curOdds;

    const e = odds[m.key] || {};
    e.winner = winner;
    e.prob = prob;
    e.conf = conf;
    e.move = move;
    e.oou = oou;
    if (os) e.os = os;
    if (oht !== null) e.oht = oht;
    if (!e.sharp) e.sharp = "机械层数据(待人工/LLM深度博弈判断)";
    e._book = mw.book || rb.name;
    e._fixture = api.id;
    odds[m.key] = e;
    updated++;

    console.log(`  ✓赔率 ${m.key} ${e._book} 去水${prob.join("/")} ${winner} ${oou} 比分${os ? os.join("-") : "-"} | ${move}`);
  }

  odds._updated = `${bj} (自动市场层)`;
  odds._targets = futureOdds.map(m => m.key);
  writeJSON(ODDS_JSON, odds);
  writeJSON(SNAP, snap);
  console.log(`  赔率更新 ${updated}/${futureOdds.length} 场 → ${ODDS_JSON}`);
  console.log(`[${bj}] 完成`);
})().catch(e => {
  console.error("FATAL", e);
  process.exit(1);
});
