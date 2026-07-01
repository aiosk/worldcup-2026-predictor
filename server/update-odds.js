#!/usr/bin/env node
/* 世界杯：API-Football → ① scores.json(近实时比分) ② odds.json机械层(去水/移动/比分/大小球)
 * 省配额：只在「相关比赛」(近12h内未结算 或 开赛前3h)时调API；都结算+无临场比赛则0调用退出。
 * 一次 /fixtures?date 同时拿比分+fixture id；odds 仅对开赛前3h未完赛的场次单独抓。
 * 保留 LLM 写的 sharp；只覆盖 winner/prob/conf/move/os/oht/oou。读同目录 .env 的 APIFOOTBALL_KEY。
 */
const https=require("https"),fs=require("fs"),path=require("path");
const DIR=__dirname;
const ODDS_JSON="/var/www/worldcup/odds.json";
const SCORES_JSON="/var/www/worldcup/scores.json";
const SNAP=path.join(DIR,"snap.json"), IDCACHE=path.join(DIR,"fixids.json");
const LEAGUE=1, WINDOW_H=3;

let KEY=process.env.APIFOOTBALL_KEY||"";
try{if(!KEY){const e=fs.readFileSync(path.join(DIR,".env"),"utf8");const m=e.match(/APIFOOTBALL_KEY=(.+)/);if(m)KEY=m[1].trim();}}catch(e){}
if(!KEY){console.error("NO KEY");process.exit(1);}

const T=[
 ["mx","墨西哥",["Mexico"]],["za","南非",["South Africa"]],["kr","韩国",["South Korea","Korea Republic","Korea"]],["cz","捷克",["Czechia","Czech Republic"]],
 ["ca","加拿大",["Canada"]],["ch","瑞士",["Switzerland"]],["ba","波黑",["Bosnia and Herzegovina","Bosnia"]],["qa","卡塔尔",["Qatar"]],
 ["br","巴西",["Brazil"]],["ma","摩洛哥",["Morocco"]],["gb-sct","苏格兰",["Scotland"]],["ht","海地",["Haiti"]],
 ["us","美国",["USA","United States"]],["py","巴拉圭",["Paraguay"]],["au","澳大利亚",["Australia"]],["tr","土耳其",["Turkey","Türkiye","Turkiye"]],
 ["de","德国",["Germany"]],["ci","科特迪瓦",["Ivory Coast","Côte d'Ivoire"]],["ec","厄瓜多尔",["Ecuador"]],["cw","库拉索",["Curacao","Curaçao"]],
 ["nl","荷兰",["Netherlands"]],["jp","日本",["Japan"]],["se","瑞典",["Sweden"]],["tn","突尼斯",["Tunisia"]],
 ["be","比利时",["Belgium"]],["eg","埃及",["Egypt"]],["ir","伊朗",["Iran","IR Iran"]],["nz","新西兰",["New Zealand"]],
 ["es","西班牙",["Spain"]],["sa","沙特",["Saudi Arabia"]],["uy","乌拉圭",["Uruguay"]],["cv","佛得角",["Cape Verde","Cabo Verde"]],
 ["fr","法国",["France"]],["sn","塞内加尔",["Senegal"]],["iq","伊拉克",["Iraq"]],["no","挪威",["Norway"]],
 ["ar","阿根廷",["Argentina"]],["dz","阿尔及利亚",["Algeria"]],["at","奥地利",["Austria"]],["jo","约旦",["Jordan"]],
 ["pt","葡萄牙",["Portugal"]],["cd","刚果(金)",["DR Congo","Congo DR","Congo Kinshasa"]],["uz","乌兹别克斯坦",["Uzbekistan"]],["co","哥伦比亚",["Colombia"]],
 ["eng","英格兰",["England"]],["hr","克罗地亚",["Croatia"]],["gh","加纳",["Ghana"]],["pa","巴拿马",["Panama"]]
];
const ZH={},N2C={};const norm=s=>(s||"").toLowerCase().replace(/[^a-z]/g,"");
T.forEach(([c,zh,al])=>{ZH[c]=zh;al.forEach(a=>N2C[norm(a)]=c);N2C[norm(zh)]=c;});

const FX=[
 ["2026-06-14T03:00:00+08:00","qa","ch"],["2026-06-14T06:00:00+08:00","br","ma"],["2026-06-14T09:00:00+08:00","ht","gb-sct"],["2026-06-14T12:00:00+08:00","au","tr"],
 ["2026-06-15T01:00:00+08:00","de","cw"],["2026-06-15T04:00:00+08:00","nl","jp"],["2026-06-15T07:00:00+08:00","ci","ec"],["2026-06-15T10:00:00+08:00","se","tn"],
 ["2026-06-16T00:00:00+08:00","es","cv"],["2026-06-16T03:00:00+08:00","be","eg"],["2026-06-16T06:00:00+08:00","sa","uy"],["2026-06-16T09:00:00+08:00","ir","nz"],
 ["2026-06-17T03:00:00+08:00","fr","sn"],["2026-06-17T06:00:00+08:00","iq","no"],["2026-06-17T09:00:00+08:00","ar","dz"],["2026-06-17T12:00:00+08:00","at","jo"],
 ["2026-06-18T01:00:00+08:00","pt","cd"],["2026-06-18T04:00:00+08:00","eng","hr"],["2026-06-18T07:00:00+08:00","gh","pa"],["2026-06-18T10:00:00+08:00","uz","co"],
 ["2026-06-19T00:00:00+08:00","cz","za"],["2026-06-19T03:00:00+08:00","ch","ba"],["2026-06-19T06:00:00+08:00","ca","qa"],["2026-06-19T09:00:00+08:00","mx","kr"],
 ["2026-06-20T03:00:00+08:00","us","au"],["2026-06-20T06:00:00+08:00","gb-sct","ma"],["2026-06-20T08:30:00+08:00","br","ht"],["2026-06-20T11:00:00+08:00","tr","py"],
 ["2026-06-21T01:00:00+08:00","nl","se"],["2026-06-21T04:00:00+08:00","de","ci"],["2026-06-21T08:00:00+08:00","ec","cw"],["2026-06-21T12:00:00+08:00","tn","jp"],
 ["2026-06-22T00:00:00+08:00","es","sa"],["2026-06-22T03:00:00+08:00","be","ir"],["2026-06-22T06:00:00+08:00","uy","cv"],["2026-06-22T09:00:00+08:00","nz","eg"],
 ["2026-06-23T01:00:00+08:00","ar","at"],["2026-06-23T05:00:00+08:00","fr","iq"],["2026-06-23T08:00:00+08:00","no","sn"],["2026-06-23T11:00:00+08:00","jo","dz"],
 ["2026-06-24T01:00:00+08:00","pt","uz"],["2026-06-24T04:00:00+08:00","eng","gh"],["2026-06-24T07:00:00+08:00","pa","hr"],["2026-06-24T10:00:00+08:00","co","cd"],
 ["2026-06-25T03:00:00+08:00","ch","ca"],["2026-06-25T03:00:00+08:00","ba","qa"],["2026-06-25T06:00:00+08:00","gb-sct","br"],["2026-06-25T06:00:00+08:00","ma","ht"],["2026-06-25T09:00:00+08:00","cz","mx"],["2026-06-25T09:00:00+08:00","za","kr"],
 ["2026-06-26T04:00:00+08:00","cw","ci"],["2026-06-26T04:00:00+08:00","ec","de"],["2026-06-26T07:00:00+08:00","jp","se"],["2026-06-26T07:00:00+08:00","tn","nl"],["2026-06-26T10:00:00+08:00","tr","us"],["2026-06-26T10:00:00+08:00","py","au"],
 ["2026-06-27T03:00:00+08:00","no","fr"],["2026-06-27T03:00:00+08:00","sn","iq"],["2026-06-27T08:00:00+08:00","cv","sa"],["2026-06-27T08:00:00+08:00","uy","es"],["2026-06-27T11:00:00+08:00","eg","ir"],["2026-06-27T11:00:00+08:00","nz","be"],
 ["2026-06-28T05:00:00+08:00","pa","eng"],["2026-06-28T05:00:00+08:00","hr","gh"],["2026-06-28T07:30:00+08:00","co","pt"],["2026-06-28T07:30:00+08:00","cd","uz"],["2026-06-28T10:00:00+08:00","dz","at"],["2026-06-28T10:00:00+08:00","jo","ar"]
];

function get(p){return new Promise((res,rej)=>{https.get("https://v3.football.api-sports.io"+p,{headers:{"x-apisports-key":KEY}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d))}catch(e){rej(e)}});}).on("error",rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const readJSON=(f,def)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){return def}};
function devig(o){const inv=o.map(x=>1/x);const s=inv.reduce((a,b)=>a+b,0);return inv.map(x=>Math.round(x/s*100));}
function pick(bms,name){for(const b of bms){const bet=(b.bets||[]).find(x=>x.name===name);if(bet)return{book:b.name,values:bet.values};}return null;}
function refBook(bms){return bms.find(b=>b.name==="Pinnacle")||bms.find(b=>b.name==="Bet365")||bms[0];}

(async()=>{
  const now=Date.now();
  const ms=FX.map(([iso,a,b])=>({iso,a,b,ko:new Date(iso).getTime(),key:a+"|"+b}));
  const scores=readJSON(SCORES_JSON,{});
  // 需要拉数据的比赛：近12h内开赛且未在scores里结算(FT) 或 开赛前3h内
  const settled=k=>scores[k]&&scores[k].st==="FT";
  const need=ms.filter(m=>{
    const dt=now-m.ko;
    const recentUnsettled = dt>=-15*60e3 && dt<=12*3600e3 && !settled(m.key);
    const preKO = m.ko-now>0 && m.ko-now<=WINDOW_H*3600e3;
    return recentUnsettled||preKO;
  });
  const bj=new Date(now+8*3600e3).toISOString().slice(0,16).replace("T"," ");
  if(!need.length){console.log(`[${bj}] 无需更新(均已结算/无临场),0 API调用退出`);return;}
  console.log(`[${bj}] 相关比赛: ${need.map(m=>m.key).join(",")}`);

  // 按需拉 fixtures?date（同时拿比分+id），每个UTC日期只拉一次
  const dates=[...new Set(need.map(m=>new Date(m.ko).toISOString().slice(0,10)))];
  const byKey={}; const idc=readJSON(IDCACHE,{});
  for(const dt of dates){
    let r; try{r=await get(`/fixtures?date=${dt}`);}catch(e){console.log("  fixtures错误",dt,e.message);continue;} await sleep(1200);
    (r.response||[]).forEach(f=>{ if(!f.league||f.league.id!==LEAGUE)return;
      const c1=N2C[norm(f.teams.home.name)],c2=N2C[norm(f.teams.away.name)]; if(!c1||!c2)return;
      const key=c1+"|"+c2; idc[key]=f.fixture.id;
      byKey[key]={id:f.fixture.id,gh:f.goals.home,ga:f.goals.away,st:f.fixture.status.short};
    });
  }
  fs.writeFileSync(IDCACHE,JSON.stringify(idc));

  // ① scores.json：写入已开赛(含进行中/完赛)的比分
  let sc=0;
  Object.keys(byKey).forEach(k=>{const v=byKey[k]; if(v.st!=="NS"&&v.st!=="TBD"&&v.gh!=null){scores[k]={s:[v.gh,v.ga],st:v.st};sc++;}});
  scores._updated=bj;
  fs.writeFileSync(SCORES_JSON,JSON.stringify(scores,null,1));
  console.log(`  比分写入 ${sc} 场 → scores.json`);

  // ② odds.json机械层：仅开赛前3h且未完赛
  const oddsM=need.filter(m=> m.ko-now>0 && m.ko-now<=WINDOW_H*3600e3 && !(byKey[m.key]&&byKey[m.key].st==="FT"));
  if(oddsM.length){
    const odds=readJSON(ODDS_JSON,{}); const snap=readJSON(SNAP,{}); let up=0;
    for(const m of oddsM){
      const fid=idc[m.key]; if(!fid){console.log("  无id:",m.key);continue;}
      let r; try{r=await get(`/odds?fixture=${fid}`);}catch(e){console.log("  odds错误",m.key,e.message);continue;} await sleep(1200);
      const resp=(r.response||[])[0]; if(!resp||!resp.bookmakers||!resp.bookmakers.length){console.log("  无赔率:",m.key);continue;}
      const bms=resp.bookmakers, rb=refBook(bms);
      const mw=pick([rb],"Match Winner")||pick(bms,"Match Winner"); if(!mw){continue;}
      const oH=+mw.values.find(v=>v.value==="Home").odd,oD=+mw.values.find(v=>v.value==="Draw").odd,oA=+mw.values.find(v=>v.value==="Away").odd;
      const prob=devig([oH,oD,oA]); const wi=prob.indexOf(Math.max(...prob)); const winner=wi===0?m.a:wi===2?m.b:"draw";
      const mx=Math.max(...prob); const conf=mx>=70?"高":mx>=50?"中":"低";
      const ou=pick(bms,"Goals Over/Under"); let oou="under";
      if(ou){const ov=ou.values.find(v=>v.value==="Over 2.5"),un=ou.values.find(v=>v.value==="Under 2.5");if(ov&&un)oou=(+ov.odd<+un.odd)?"over":"under";}
      let os=null; const ex=pick(bms,"Exact Score");
      if(ex){let best=null;ex.values.forEach(v=>{const od=+v.odd;if(best===null||od<best.od)best={od,val:v.value};});if(best){const mm=best.val.match(/(\d+)\D+(\d+)/);if(mm)os=[+mm[1],+mm[2]];}}
      let oht=null; const ht=pick(bms,"Halftime Result")||pick(bms,"1st Half Winner")||pick(bms,"First Half Winner");
      if(ht){const h=ht.values.find(v=>/home/i.test(v.value)),dd=ht.values.find(v=>/draw/i.test(v.value)),aa=ht.values.find(v=>/away/i.test(v.value));if(h&&dd&&aa){const hp=devig([+h.odd,+dd.odd,+aa.odd]);const hi=hp.indexOf(Math.max(...hp));oht=hi===0?m.a:hi===2?m.b:"";}}
      const prev=snap[m.key]; let move;
      if(prev){const lab=["主"+ZH[m.a],"平",ZH[m.b]];const cur=[oH,oD,oA];let bi=0,bd=0;for(let i=0;i<3;i++){const dl=(prev[i]-cur[i])/prev[i];if(dl>bd){bd=dl;bi=i;}}move=bd>0.02?`${lab[bi]}收窄 ${prev[bi]}→${cur[bi]}(资金流入)`:"盘口基本持平";}
      else move=`建立基线(${rb.name} 1X2 ${oH}/${oD}/${oA})`;
      snap[m.key]=[oH,oD,oA];
      const e=odds[m.key]||{}; e.winner=winner;e.prob=prob;e.conf=conf;e.move=move;e.oou=oou;if(os)e.os=os;if(oht!==null)e.oht=oht;if(!e.sharp)e.sharp="机械层数据(待LLM深度博弈判断)";e._book=rb.name;
      odds[m.key]=e; up++;
      console.log(`  ✓赔率 ${m.key} ${rb.name} 去水${prob} ${winner} 大小${oou} 比分${os?os.join("-"):"-"} | ${move}`);
    }
    odds._updated=bj+" (机械层)"; fs.writeFileSync(ODDS_JSON,JSON.stringify(odds,null,1)); fs.writeFileSync(SNAP,JSON.stringify(snap));
    console.log(`  赔率更新 ${up} 场`);
  }
  console.log(`[${bj}] 完成`);
})().catch(e=>{console.error("FATAL",e);process.exit(1);});
