# 2026 世界杯 · 赛事研判 — 微信小程序版

> 原生小程序（无框架）。从网页版 `index.html` 移植，**全数据内嵌、零网络请求** → 不需要 ICP 备案、不需要服务器域名白名单。
> 定位：自己 + 小圈子，走「体验版」分发，**不公开上架**（已对赔率/竞猜措辞做去博彩化中性处理）。

## 目录结构
```
miniprogram/
├─ app.js / app.json / app.wxss      全局
├─ sitemap.json / project.config.json
├─ utils/
│   ├─ data.js      球队 T / 赛程 FX / 已知比分 KNOWN / 九维 DIMS / 研判 PRED（纯数据，可复用网页版）
│   └─ predict.js   纯函数 + view-model 构造器（buildToday/Tomorrow/Sched/Stand/Hit/Sheet）
└─ pages/index/
    ├─ index.js     组装 view-model + 交互（切Tab/筛选/详情抽屉）
    ├─ index.wxml   视图（matchCard 模板 + wx:for 绑定）
    └─ index.wxss   样式（移植自网页深色仪表盘）
```

## 你要做的两步（需本人微信操作，我替不了）

### ① 注册小程序 → 拿 AppID（约 10 分钟，免费）
1. 浏览器开 https://mp.weixin.qq.com → 右上「立即注册」→ 选「小程序」
2. 邮箱激活 → 主体类型选「个人」即可（无需企业资质）
3. 登录后：「开发 → 开发管理 → 开发设置」→ 复制 **AppID(小程序ID)**
4. 把 `project.config.json` 里的 `"appid": "touristappid"` 改成你的真实 AppID

### ② 微信开发者工具 → 导入 → 上传体验版
1. 下载安装「微信开发者工具」(稳定版)：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. 打开 → 扫码登录(用你的微信) → 「+ 新建/导入」→「导入项目」
   - 目录选 **本 `miniprogram/` 文件夹**
   - AppID 填你的真实 AppID
3. 预览：工具里直接「编译」看效果；点「预览」生成二维码，手机微信扫码真机体验
4. 分发体验版：点「上传」→ 填版本号(如 1.0.0)+备注 → 在 mp 后台「管理 → 版本管理 → 选为体验版」
5. 加体验成员：mp 后台「管理 → 成员管理 → 体验成员」把你和朋友的微信加进去 → 他们在「小程序 → 最近使用/搜索」即可打开

> ⚠ 体验版**不走上架审核**，所以赔率/研判内容不受内容审核拦截；但请勿点「提交审核」公开发布（公开版会因竞猜类内容被拒）。

## 日常更新（新比分 / 新研判）
小程序离线内嵌，更新 = 改数据 + 重新上传：
1. 新实际比分 → 编辑 `utils/data.js` 的 `KNOWN`（key 按 fixture 朝向 `队1|队2`，值 `[主,客]`）
2. 新场次研判 → 编辑 `utils/data.js` 的 `PRED`（结构同网页版）
3. 开发者工具「上传」→ 后台「选为体验版」即生效
> 这一步可由小奥代劳：你说「预测今天的」/报比分 → 小奥改 `data.js` → 你点上传。

## 已知取舍 / 待办
- **国旗用 emoji**：iOS/Android 微信原生渲染；电脑版微信/开发者工具模拟器可能不显示彩色旗，真机正常。
- **无实时比分**：网页版靠 openfootball/odds.json 网络拉取；小程序为绕开备案改为内嵌。要恢复"自动更新"需自建已备案域名 + 改用 `wx.request`（成本见会话评估）。
- **顶部跑马灯免责声明**已保留（fixed 吸顶）。
- 数据已回填至 Day3(6/15)；Day4(6/16)起待你报比分后回填。
