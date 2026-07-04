# 2026 世界杯预测项目 Claude Code 交接说明

更新时间：2026-07-04 22:35 CST

## 当前目标

本项目已从 ECS 版本迁移到飞书妙搭为主要线上版本。后续维护重点：

- 不再更新 ECS 版本。
- GitHub 源码仍作为主数据和自动化入口。
- 妙搭线上应用作为用户访问入口。
- 定时自动刷新由 GitHub Actions 调用妙搭 `__refresh` 接口完成。

## 仓库与线上地址

主仓库：

- 本地路径：`/Users/osk/Demos/worldcup-2026`
- GitHub：`github.com/aiosk/worldcup-2026-predictor`
- 分支：`main`

妙搭全栈仓库：

- 本地路径：`/Users/osk/Demos/worldcup-2026-miaoda-fullstack`
- 妙搭 app id：`app_179er0n0zcj`
- 分支：`sprint/default`
- 线上地址：`https://t0nif2phaxz.aiforce.cloud/app/app_179er0n0zcj`
- 当前访问范围：public，免登录

## 关键文件

主仓库：

- `index.html`：主页面，内嵌赛程、比分、预测、前端逻辑。
- `miniprogram/utils/data.js`：小程序/数据模块版本，需和 `index.html` 的 `FX / KNOWN / PRED` 保持一致。
- `.github/workflows/miaoda-refresh.yml`：GitHub Actions 定时刷新妙搭数据。

妙搭仓库：

- `server/assets/dashboard.html`：妙搭线上页面资源，从主仓库 `index.html` 同步而来。
- `server/assets/data.js`：妙搭数据资源，从主仓库 `miniprogram/utils/data.js` 同步而来。
- `server/modules/view/view.controller.ts`：妙搭后端接口，包括 `__scores`、`__odds`、`__refresh`。

注意：从主仓库复制 `index.html` 到妙搭 `server/assets/dashboard.html` 后，必须恢复妙搭专用动态接口路径：

```js
const API_BASE=(location.pathname.match(/^\/app\/[^/]+/)||[""])[0];
fetch(API_BASE+"/__scores?t="+Date.now(), { cache:"no-store" })
fetch(API_BASE+"/__odds?t="+Date.now(), { cache:"no-store" })
```

主仓库静态页使用 `scores.json` / `odds.json`，妙搭线上必须走 `__scores` / `__odds`，否则不会读妙搭数据库和动态更新时间。

## 当前 1/8 决赛赛程状态

已修正并线上验证的 16 强赛程，时间均为北京时间：

- `2026-07-05 01:00` 加拿大 vs 摩洛哥，休斯顿
- `2026-07-05 05:00` 巴拉圭 vs 法国，费城
- `2026-07-06 04:00` 巴西 vs 挪威，纽约/新泽西
- `2026-07-06 08:00` 墨西哥 vs 英格兰，墨西哥城
- `2026-07-07 03:00` 西班牙 vs 葡萄牙，阿灵顿
- `2026-07-07 08:00` 比利时 vs 美国，西雅图
- `2026-07-08 00:00` 埃及 vs 阿根廷，亚特兰大
- `2026-07-08 04:00` 瑞士 vs 哥伦比亚，温哥华

最近修正点：

- 之前误把 `2026-07-05 05:00` 写成 `巴西 vs 挪威`。
- 已修正为 `巴拉圭 vs 法国`。
- `巴西 vs 挪威` 已移到 `2026-07-06 04:00`。

对应提交：

- 主仓库：`4001cbb fix: correct round of 16 schedule order`
- 妙搭仓库：`2030883 fix: correct round of 16 schedule order`
- 妙搭发布：`7658674474359131322`

参考核对来源：

- https://www.sbnation.com/soccer/1121525/2026-world-cup-round-of-16-scores-schedule
- https://www.theguardian.com/football/2026/jul/04/argentina-cape-verde-world-cup-2026-last-32-match-report
- https://www.theguardian.com/football/2026/jul/04/colombia-ghana-world-cup-2026-last-32-match-report

## 数据结构说明

核心数据都在 JS 常量内：

- `FX`：赛程。格式为 `[ISO时间, 阶段, 队伍A, 队伍B, 场地]`。
- `KNOWN`：已完赛比分。格式为 `"a|b": [a进球, b进球]`。
- `PRED`：预测。key 必须和赛程方向一致，例如赛程是 `py|fr`，预测 key 也应为 `py|fr`。

修改赛程时必须检查：

```bash
node -e "const d=require('./miniprogram/utils/data.js'); const r16=d.FX.filter(f=>f[1]==='R16').map(f=>f[2]+'|'+f[3]); console.log(r16); console.log('missingPred', r16.filter(k=>!d.PRED[k]));"
```

期望：

- `missingPred []`
- R16 顺序为：`ca|ma, py|fr, br|no, mx|eng, es|pt, be|us, eg|ar, ch|co`

## 妙搭数据库

表：

```sql
worldcup_state(
  kind varchar(32) primary key,
  payload jsonb not null,
  updated_at timestamptz not null
)
```

重要 rows：

- `scores`：动态比分覆盖层和更新时间。
- `odds`：动态赔率覆盖层和更新时间。
- `fixids` / `snap`：自动刷新时的 fixture id 和赔率快照辅助数据。

查询示例：

```bash
lark-cli apps +db-execute \
  --app-id app_179er0n0zcj \
  --environment online \
  --sql "SELECT kind, payload FROM worldcup_state WHERE kind IN ('scores','odds')" \
  --yes \
  --as user
```

当前线上 DB 元信息：

- `scores._updated`：`2026-07-04 22:26 (修正16强赛程)`
- `odds._updated`：`2026-07-04 22:26 (修正16强赛程/预测)`
- `odds._targets`：`ca|ma, py|fr, br|no, mx|eng, es|pt, be|us, eg|ar, ch|co`

## 自动刷新机制

GitHub Actions：

- 文件：`.github/workflows/miaoda-refresh.yml`
- 时间：北京时间约 11:05 和 18:05
- 调用目标：妙搭 `__refresh`

刷新接口：

```text
GET https://t0nif2phaxz.aiforce.cloud/app/app_179er0n0zcj/__refresh?token=...
```

接口逻辑：

- 自动检查已经结束但还没写入比分的比赛。
- 自动尝试获取未来已确认比赛赔率。
- 只有真正写入比分或赔率时才更新时间，避免“只执行没更新”导致右上角时间误导。

重要限制：

- 妙搭自定义后端接口线上只稳定支持 `GET + 非 /api 路径`。
- 不要改成 POST 或 `/api/*`，否则线上网关可能返回 SPA HTML 或 404。

## 数据源：openfootball（2026-07-04 决策 A2，已取代 API-Football）

**结论：比分数据源改为 openfootball，彻底弃用 API-Football。**

排查过程：
- `APIFOOTBALL_KEY` 本身**有效**（账号 xjwu1018@gmail.com，Free 套餐 active 到 2027-06-14）。
- 之前的 `Invalid API key` 是**调用方式错**（用了 RapidAPI host/header；正确应走
  `https://v3.football.api-sports.io` + header `x-apisports-key`）。
- 但真正的硬墙：**Free 套餐拿不到 2026 赛季**——`"Free plans do not have access to
  this season, try from 2022 to 2024."`。fixtures 和 odds 都被墙。付费才行。

因此不再为 15 场淘汰赛养付费 API，改用 **openfootball**（免 key、CORS 友好、完整覆盖
2026 含全部淘汰赛、结构化 ft/ht/et/p）：

- **比分**：`index.html` / `dashboard.html` 客户端 `loadOF()` 直接 fetch
  `https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json`
  （回退 raw.githubusercontent），实时覆盖，无需后端/DB/cron。
- **赔率 / 爆冷轨**：不再自动拉盘口，改由内嵌 `PRED[].odds` 手工维护（本就是小奥分析的价值所在）。
- **点球/加时晋级方**：openfootball `score.et` / `score.p` 自动带出；内嵌 `KOADV` 兜底离线。

比分口径（决策 2）：统一显示 **ft(90分)** 比分，淘汰赛晋级方另由 et/p 判定并在详情页注明
（如 `be|sn` 显示 2-2，注"比利时 加时 3-2 晋级"）。命中率的"赢家"判定对淘汰赛按晋级方
（`awKO()`），修好了历史点球场被误判为平局漏计的老 bug。

校验/再生成工具：`node scripts/sync-openfootball.js`（`--emit` 打印可粘贴的 KNOWN/KOADV）。

**API key 已无用途**——如需彻底清理可从妙搭 env 删除。不要在文档/提交中明文写 key。

## 落地到线上妙搭（执行机操作 · 方案 1-A）

本轮改动全部落在 GitHub 主仓库（`index.html` + `data.js` + `scripts/`）。执行机同步到妙搭：

1. `git pull`（主仓库）拿到最新 `index.html`（含 openfootball 客户端层 + KO 晋级逻辑）。
2. `cp index.html → 妙搭 server/assets/dashboard.html`。
3. **⚠ 与旧流程不同**：1-A 下**不要**再把比分改回 `__scores`——保留 `loadOF()` 直取
   openfootball 即可。`__odds`/`__scores`/`__refresh`/API-Football env/GitHub Actions
   `miaoda-refresh.yml` 都可以停用/删除（scores.json 404 已被 `loadScores()` catch，无害）。
4. `npm run build:server` → push `sprint/default` → `lark-cli apps +release-create`。
5. 验证：打开线上页，详情页看 `be|sn` 显示 2-2 且注"比利时 加时 3-2 晋级"，命中率条正常。

注：本机（MacBook 方案机）lark-cli/miaoda 解析不到该妙搭 app 的 workspace
（`get workspace id failed by app id`），故妙搭前端替换必须在执行机做。

## 常用命令

主仓库检查：

```bash
cd /Users/osk/Demos/worldcup-2026
node -e "const d=require('./miniprogram/utils/data.js'); const r16=d.FX.filter(f=>f[1]==='R16').map(f=>f[0]+' '+f[2]+'|'+f[3]+' '+f[4]); console.log(r16.join('\n'));"
git status --short
```

同步到妙搭资产：

```bash
cp /Users/osk/Demos/worldcup-2026/index.html \
  /Users/osk/Demos/worldcup-2026-miaoda-fullstack/server/assets/dashboard.html

cp /Users/osk/Demos/worldcup-2026/miniprogram/utils/data.js \
  /Users/osk/Demos/worldcup-2026-miaoda-fullstack/server/assets/data.js
```

同步后必须检查/恢复 `dashboard.html` 中的 `API_BASE + "/__scores"` 和 `API_BASE + "/__odds"`。

构建妙搭：

```bash
cd /Users/osk/Demos/worldcup-2026-miaoda-fullstack
npm run build:server
```

推送和发布：

```bash
cd /Users/osk/Demos/worldcup-2026
git add index.html miniprogram/utils/data.js
git commit -m "..."
git push

cd /Users/osk/Demos/worldcup-2026-miaoda-fullstack
git add server/assets/dashboard.html server/assets/data.js
git commit -m "..."
git push origin sprint/default
lark-cli apps +release-create --app-id app_179er0n0zcj --as user
```

轮询发布：

```bash
lark-cli apps +release-get \
  --app-id app_179er0n0zcj \
  --release-id <release_id> \
  --as user
```

线上验证：

```bash
curl -k -L --connect-timeout 10 -s \
  "https://t0nif2phaxz.aiforce.cloud/app/app_179er0n0zcj" \
  -o /tmp/worldcup-miaoda.html

rg -n '"2026-07-05T05:00:00\+08:00"|"2026-07-06T04:00:00\+08:00"|"\w+\|\w+"' \
  /tmp/worldcup-miaoda.html

curl -k -L --connect-timeout 10 -s \
  "https://t0nif2phaxz.aiforce.cloud/app/app_179er0n0zcj/__scores"

curl -k -L --connect-timeout 10 -s \
  "https://t0nif2phaxz.aiforce.cloud/app/app_179er0n0zcj/__odds"
```

## 交接建议

后续规划修改时，建议先做这几件事：

1. 把 `FX / KNOWN / PRED` 从内嵌 JS 抽成单一 JSON/TS 数据源，避免 `index.html` 和 `data.js` 双写。
2. 给妙搭资产同步做脚本，自动复制并自动恢复 `__scores/__odds` 路径。
3. 增加赛程一致性测试：每场 KO 赛必须有 `PRED`，已结束比赛必须有 `KNOWN` 或动态 `scores`。
4. 修复 API-Football key/套餐问题后，再验证 GitHub Actions 的 11:05/18:05 自动刷新是否真正写入比分和赔率。
5. 自动刷新成功后，页面右上角更新时间应只在有实际数据变更时更新。
