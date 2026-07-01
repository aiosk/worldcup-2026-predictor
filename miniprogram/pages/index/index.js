const P = require("../../utils/predict.js");
const D = require("../../utils/data.js");

const GROUPS = [...new Set(D.FX.map(f => f[1]))].sort();

Page({
  data: {
    tab: "today",
    updTxt: "",
    today: { label: "", cards: [] },
    tmrw: { label: "", cards: [] },
    sched: [],
    stand: [],
    hit: {},
    // 筛选
    groupOptions: ["全部小组", ...GROUPS.map(g => g + " 组")],
    groupIdx: 0,
    teamQ: "",
    // 详情
    sheetOpen: false,
    sheet: null
  },

  onLoad() { this.refreshAll(); },

  onPullDownRefresh() {
    this.refreshAll();
    wx.stopPullDownRefresh();
  },

  refreshAll() {
    const now = P.bjNow();
    this.setData({
      today: P.buildToday(),
      tmrw: P.buildTomorrow(),
      sched: this.computeSched(),
      stand: P.buildStand(),
      hit: P.buildHit(),
      updTxt: "数据更新于 " + P.pad(now.getHours()) + ":" + P.pad(now.getMinutes())
    });
  },

  computeSched() {
    const grp = this.data.groupIdx > 0 ? GROUPS[this.data.groupIdx - 1] : "";
    return P.buildSched(grp, this.data.teamQ);
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.s }); },

  onGroupChange(e) {
    this.setData({ groupIdx: Number(e.detail.value) }, () => {
      this.setData({ sched: this.computeSched() });
    });
  },

  onTeamInput(e) {
    this.setData({ teamQ: e.detail.value }, () => {
      this.setData({ sched: this.computeSched() });
    });
  },

  toggleDay(e) {
    const i = e.currentTarget.dataset.i;
    const key = "sched[" + i + "].open";
    this.setData({ [key]: !this.data.sched[i].open });
  },

  openSheet(e) {
    const { a, b, i } = e.currentTarget.dataset;
    this.setData({ sheet: P.buildSheet(a, b, i), sheetOpen: true });
  },

  closeSheet() { this.setData({ sheetOpen: false }); },

  noop() {},

  onShareAppMessage() {
    return { title: "2026 世界杯 · 赛事研判（仅供娱乐）", path: "/pages/index/index" };
  }
});
