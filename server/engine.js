'use strict';
/* =========================================================================
 * 靶心 · 精准引擎（服务端版，纯函数，无 DOM）
 *
 * 设计要点（v4 接入真实数据源）：
 *   - SEED(演示真值) 仅用于"在无真实数据时"生成可演示的多源投影 RAW。
 *   - 真实数据源（企查查/Hunter…）由 server/sources/* 适配器产出 RAW，
 *     通过 engine.setLiveRaw() 注入；aggregate 把 seed RAW 与 live RAW 合并。
 *   - aggregate 不依赖 _truthKey：真实记录自带 m(市场)/act，缺失时按源推断，
 *     因此同一套"归一化去重 + 字段互补 + 多源交叉验证 + 评分"逻辑对真假数据通用。
 *
 * RAW 记录形态（项目/适配器都遵守）：
 *   { src, rawName, m?, ind?, rg?, sz?, role?, cert?:[], sig?:[], ct?:{}, act?, meta? }
 *   - m: '国内' | '国外'（可选，缺失则按源推断）
 *   - ct: { phone, email, im, imType, name, title }（字段可选，跨源互补）
 * ========================================================================= */

const SOURCES = [
  {id:'qcc',      nm:'企查查（国内工商）',     mkt:'国内', st:'模拟',   on:true},
  {id:'bid',      nm:'招投标/Tender 库',       mkt:'双',   st:'模拟',   on:true},
  {id:'map',      nm:'地图 LBS（本地周边）',   mkt:'国内', st:'模拟',   on:true},
  {id:'web',      nm:'官网/GEO 内容线索',      mkt:'双',   st:'模拟',   on:true},
  {id:'news',     nm:'资讯监测（扩产/投产）',   mkt:'双',   st:'模拟',   on:true},
  {id:'gdb',      nm:'全球企业库（国外工商）', mkt:'国外', st:'模拟',   on:true},
  {id:'customs',  nm:'海关进口数据',           mkt:'国外', st:'模拟',   on:true},
  {id:'linkedin', nm:'LinkedIn 决策人',        mkt:'国外', st:'模拟',   on:true},
  {id:'alibaba',  nm:'国际站/MIC（RFQ）',      mkt:'国外', st:'模拟',   on:true},
  {id:'hunter',   nm:'Hunter（海外公司+邮箱）',mkt:'国外', st:'待配置', on:false},
  {id:'enrich',   nm:'联系方式补全服务',       mkt:'双',   st:'增值',   on:false}
];
const SRC_ON_DEFAULT = {};
SOURCES.forEach(s => SRC_ON_DEFAULT[s.id] = s.on);

/* 国内源集合：记录未带 m 时按源推断市场 */
const DOMESTIC_SRCS = new Set(['qcc','bid','map','web','news']);

/* SEED：演示真值库（仅用于生成可演示的多源投影） */
const SEED = [
 {m:"国内",n:"中石化某工程公司",ind:"石化",rg:"华东",sz:"大型",role:"采购部",cert:["API 6D","TS","ISO 9001"],sig:["招标","扩产"],ct:{name:"张工",title:"采购经理",phone:"138****1201",im:"微信:zhang_valve",imType:"wechat"},act:"投招标跟进 + 发选型手册"},
 {m:"国内",n:"浙江某阀门经销商",ind:"石化",rg:"华东",sz:"中型",role:"经销商",cert:["TS","ISO 9001"],sig:["RFQ"],ct:{name:"王总",title:"总经理",phone:"138****2202",im:"微信:wang_valve",imType:"wechat"},act:"经销商政策 + 样品寄送"},
 {m:"国内",n:"广东水处理设备厂",ind:"水处理",rg:"华南",sz:"中型",role:"采购部",cert:["ISO 9001","CE"],sig:["招标"],ct:{name:"李工",title:"采购主管",phone:"137****3303",im:"微信:li_water",imType:"wechat"},act:"招标响应 + 技术对接"},
 {m:"国内",n:"山东电力建设公司",ind:"电力",rg:"华北",sz:"大型",role:"技术部",cert:["API 600","TS"],sig:["招标","职位变动"],ct:{name:"赵工",title:"技术总监",phone:"139****4404",im:"微信:zhao_power",imType:"wechat"},act:"技术参数确认 + 入合格供方"},
 {m:"国内",n:"江苏某泵业OEM",ind:"石化",rg:"华东",sz:"中型",role:"采购部",cert:["API 6D","ISO 9001"],sig:["RFQ","官网需求"],ct:{name:"陈工",title:"采购",phone:"138****5505",im:"微信:chen_pump",imType:"wechat"},act:"配套报价 + 寄样"},
 {m:"国内",n:"上海某船厂",ind:"造船",rg:"华东",sz:"大型",role:"采购部",cert:["API 6D","CE","防火"],sig:["招标"],ct:{name:"周工",title:"采购经理",phone:"137****6606",im:"微信:zhou_ship",imType:"wechat"},act:"船级社认证对接"},
 {m:"国内",n:"本地周边某水厂",ind:"水处理",rg:"本地周边",sz:"小型",role:"老板/工厂主",cert:["ISO 9001"],sig:["官网需求"],ct:{name:"孙厂长",title:"厂长",phone:"136****7707",im:"微信:sun_plant",imType:"wechat"},act:"老板直连 + 现场拜访"},
 {m:"国内",n:"河北冶金集团",ind:"冶金",rg:"华北",sz:"大型",role:"技术部",cert:["TS","ISO 9001"],sig:["扩产"],ct:{name:"刘工",title:"技术部",phone:"139****8808",im:"微信:liu_metal",imType:"wechat"},act:"扩产配套提前介入"},
 {m:"国内",n:"华南油气工程",ind:"油气",rg:"华南",sz:"大型",role:"采购部",cert:["API 6D","API 600","TS"],sig:["招标"],ct:{name:"吴工",title:"采购经理",phone:"138****9909",im:"微信:wu_oil",imType:"wechat"},act:"招标 + 入供应商库"},
 {m:"国内",n:"华中某阀门贸易",ind:"石化",rg:"华中",sz:"小型",role:"经销商",cert:["TS"],sig:["RFQ"],ct:{name:"郑总",title:"贸易经理",phone:"137****1010",im:"微信:zheng_trade",imType:"wechat"},act:"批发价 + 区域代理"},
 {m:"国内",n:"北京某环保工程EPC",ind:"水处理",rg:"华北",sz:"中型",role:"采购部",cert:["ISO 9001","CE"],sig:["招标","RFQ"],ct:{name:"冯工",title:"采购",phone:"138****1111",im:"微信:feng_epc",imType:"wechat"},act:"EPC 总包配套"},
 {m:"国内",n:"浙江某石化民企",ind:"石化",rg:"华东",sz:"大型",role:"老板/工厂主",cert:["API 6D","TS"],sig:["扩产","职位变动"],ct:{name:"许总",title:"老板",phone:"139****1212",im:"微信:xu_boss",imType:"wechat"},act:"老板层建联 + 战略供货"},
 {m:"国内",n:"天津某电厂",ind:"电力",rg:"华北",sz:"大型",role:"技术部",cert:["API 600","TS"],sig:["招标"],ct:{name:"韩工",title:"技术",phone:"138****1313",im:"微信:han_power",imType:"wechat"},act:"技术选型 + 招标"},
 {m:"国内",n:"广东某水处理科技",ind:"水处理",rg:"华南",sz:"中型",role:"采购部",cert:["CE","ISO 9001"],sig:["官网需求"],ct:{name:"曹工",title:"采购",phone:"137****1414",im:"微信:cao_water",imType:"wechat"},act:"官网需求响应"},
 {m:"国内",n:"山东某造船厂",ind:"造船",rg:"华东",sz:"大型",role:"采购部",cert:["API 6D","CE"],sig:["扩产"],ct:{name:"唐工",title:"采购",phone:"138****1515",im:"微信:tang_ship",imType:"wechat"},act:"扩产产能锁定"},
 {m:"国内",n:"华中某冶金设备",ind:"冶金",rg:"华中",sz:"中型",role:"技术部",cert:["TS","ISO 9001"],sig:["RFQ"],ct:{name:"邓工",title:"技术",phone:"139****1616",im:"微信:deng_metal",imType:"wechat"},act:"询盘报价"},
 {m:"国内",n:"本地周边某机电经销商",ind:"石化",rg:"本地周边",sz:"小型",role:"经销商",cert:["ISO 9001"],sig:["官网需求"],ct:{name:"萧总",title:"经销商",phone:"136****1717",im:"微信:xiao_motor",imType:"wechat"},act:"本地经销合作"},
 {m:"国内",n:"华东油气储运",ind:"油气",rg:"华东",sz:"大型",role:"采购部",cert:["API 6D","防火"],sig:["招标","职位变动"],ct:{name:"程工",title:"采购",phone:"138****1818",im:"微信:cheng_oil",imType:"wechat"},act:"储运安全认证 + 招标"},
 {m:"国外",n:"US Valve Importer A",ind:"石化",rg:"美国",sz:"中型",role:"Importer",cert:["API 6D","API 600"],sig:["海关进口","RFQ"],ct:{name:"John Smith",title:"Procurement",email:"john@importer-a.com",im:"linkedin.com/in/johnsmith",imType:"linkedin"},act:"海关数据命中 + 发目录/样品"},
 {m:"国外",n:"German Distributor B",ind:"电力",rg:"欧洲",sz:"中型",role:"Distributor",cert:["CE","PED","ISO 9001"],sig:["海关进口"],ct:{name:"Hans Muller",title:"Buyer",email:"hans@distributor-b.de",im:"linkedin.com/in/hansmueller",imType:"linkedin"},act:"CE/PED 合规 + 分销协议"},
 {m:"国外",n:"SEA EPC C",ind:"水处理",rg:"东南亚",sz:"大型",role:"EPC",cert:["API 6D","ISO 9001"],sig:["招标","扩产"],ct:{name:"Tan Wei",title:"Project Mgr",email:"tan@epc-c.sg",im:"linkedin.com/in/tanwei",imType:"linkedin"},act:"EPC 总包 + 本地代理"},
 {m:"国外",n:"MENA Oil EPC",ind:"油气",rg:"中东",sz:"大型",role:"EPC",cert:["API 6D","API 600","防火"],sig:["海关进口","RFQ"],ct:{name:"Omar Said",title:"Procurement",email:"omar@epc-d.ae",im:"linkedin.com/in/omarsaid",imType:"linkedin"},act:"油气认证 + InMail 开发"},
 {m:"国外",n:"US Pump OEM",ind:"石化",rg:"美国",sz:"中型",role:"OEM",cert:["API 600","ISO 9001"],sig:["官网需求"],ct:{name:"Mike Lee",title:"Sourcing",email:"mike@pump-oem.com",im:"linkedin.com/in/mikelee",imType:"linkedin"},act:"OEM 配套报价"},
 {m:"国外",n:"EU Water Utility",ind:"水处理",rg:"欧洲",sz:"大型",role:"采购部",cert:["CE","PED"],sig:["招标"],ct:{name:"Sophie Ren",title:"Procurement",email:"sophie@water-util.fr",im:"linkedin.com/in/sophieren",imType:"linkedin"},act:"公用事业招标 + PED"},
 {m:"国外",n:"SEA Distributor",ind:"造船",rg:"东南亚",sz:"中型",role:"Distributor",cert:["CE","API 6D"],sig:["海关进口","职位变动"],ct:{name:"Wei Lin",title:"MD",email:"wei@distributor-g.sg",im:"linkedin.com/in/weilin",imType:"linkedin"},act:"海关命中 + 职位变动暖推荐"},
 {m:"国外",n:"Brazil Importer",ind:"冶金",rg:"南美",sz:"中型",role:"Importer",cert:["API 6D","ISO 9001"],sig:["海关进口","RFQ"],ct:{name:"Carlos Silva",title:"Import Mgr",email:"carlos@import-h.br",im:"linkedin.com/in/carlossilva",imType:"linkedin"},act:"海关进口商开发"},
 {m:"国外",n:"US EPC Energy",ind:"电力",rg:"美国",sz:"大型",role:"EPC",cert:["API 600","防火"],sig:["招标","扩产"],ct:{name:"Sarah King",title:"Procurement",email:"sarah@epc-energy.us",im:"linkedin.com/in/sarahking",imType:"linkedin"},act:"电力 EPC + 扩产"},
 {m:"国外",n:"EU Valve Wholesaler",ind:"石化",rg:"欧洲",sz:"中型",role:"Distributor",cert:["CE","PED","API 6D"],sig:["海关进口"],ct:{name:"Lukas Wolf",title:"Buyer",email:"lukas@wholesaler-j.de",im:"linkedin.com/in/lukaswolf",imType:"linkedin"},act:"批发分销 + 认证"},
 {m:"国外",n:"MENA OEM",ind:"油气",rg:"中东",sz:"中型",role:"OEM",cert:["API 6D","ISO 9001"],sig:["官网需求","RFQ"],ct:{name:"Ali Hassan",title:"Sourcing",email:"ali@oem-k.ae",im:"linkedin.com/in/alihassan",imType:"linkedin"},act:"OEM 配套 + RFQ"},
 {m:"国外",n:"SEA Power Plant",ind:"电力",rg:"东南亚",sz:"大型",role:"采购部",cert:["CE","PED"],sig:["招标"],ct:{name:"Budi Sant",title:"Procurement",email:"budi@powerplant-l.id",im:"linkedin.com/in/budisant",imType:"linkedin"},act:"电厂招标 + PED"},
 {m:"国外",n:"US Water Distributor",ind:"水处理",rg:"美国",sz:"中型",role:"Distributor",cert:["API 600","ISO 9001"],sig:["海关进口","职位变动"],ct:{name:"Emma Reed",title:"Buyer",email:"emma@waterdist-us.com",im:"linkedin.com/in/emmareed",imType:"linkedin"},act:"海关 + LinkedIn 暖推荐"},
 {m:"国外",n:"EU Shipbuilder",ind:"造船",rg:"欧洲",sz:"大型",role:"采购部",cert:["CE","API 6D"],sig:["扩产"],ct:{name:"Klaus Berg",title:"Procurement",email:"klaus@shipbuilder-n.de",im:"linkedin.com/in/klausberg",imType:"linkedin"},act:"船厂扩产 + CE"},
 {m:"国外",n:"SA EPC",ind:"油气",rg:"南美",sz:"大型",role:"EPC",cert:["API 6D","API 600"],sig:["招标","海关进口"],ct:{name:"Diego Lopez",title:"Procurement",email:"diego@epc-o.ar",im:"linkedin.com/in/diegolopez",imType:"linkedin"},act:"南美 EPC + 海关"},
 {m:"国外",n:"SEA Importer",ind:"石化",rg:"东南亚",sz:"中型",role:"Importer",cert:["API 6D","ISO 9001"],sig:["海关进口","RFQ"],ct:{name:"Nina Tan",title:"Import Mgr",email:"nina@importer-p.sg",im:"linkedin.com/in/ninatan",imType:"linkedin"},act:"进口商开发"},
 {m:"国外",n:"MENA Water EPC",ind:"水处理",rg:"中东",sz:"大型",role:"EPC",cert:["CE","PED"],sig:["招标","扩产"],ct:{name:"Layla Ali",title:"Procurement",email:"layla@water-epc.ae",im:"linkedin.com/in/laylaali",imType:"linkedin"},act:"水务 EPC + 扩产"},
 {m:"国外",n:"US Metal OEM",ind:"冶金",rg:"美国",sz:"中型",role:"OEM",cert:["API 600","ISO 9001"],sig:["官网需求"],ct:{name:"Tom Ray",title:"Sourcing",email:"tom@metal-oem.us",im:"linkedin.com/in/tomray",imType:"linkedin"},act:"冶金 OEM 配套"}
];

const SIG_SRC = {"招标":"bid","海关进口":"customs","扩产":"news","职位变动":"linkedin","RFQ":"alibaba","官网需求":"web"};
const SIG_W   = {"招标":25,"海关进口":25,"扩产":15,"职位变动":15,"RFQ":12,"官网需求":12};

function variant(name, src){
  switch(src){
    case 'qcc':      return name + '有限公司';
    case 'map':      return name + '（本部）';
    case 'gdb':      return name + ' Co., Ltd.';
    case 'customs':  return name.toUpperCase();
    case 'alibaba':  return name + ' Ltd.';
    case 'bid':      return name + ' ';
    default:         return name;
  }
}
function project(seed, src){
  const r = {src, rawName:variant(seed.n, src), _truthKey:seed.n, m:seed.m};
  const c = seed.ct;
  switch(src){
    case 'qcc':      Object.assign(r,{ind:seed.ind,rg:seed.rg,sz:seed.sz,cert:seed.cert.slice(0,1),
                                      ct:{phone:c.phone,im:c.im,imType:c.imType}}); break;
    case 'bid':      Object.assign(r,{ind:seed.ind,rg:seed.rg,role:'采购部',sig:['招标'],
                                      ct:{name:c.name,title:c.title}}); break;
    case 'map':      Object.assign(r,{rg:seed.rg,sz:seed.sz,ct:{phone:c.phone}}); break;
    case 'web':      Object.assign(r,{ind:seed.ind,sig:['官网需求'],cert:seed.cert,
                                      ct:{email:c.email}}); break;
    case 'news':     Object.assign(r,{ind:seed.ind,sig:['扩产']}); break;
    case 'gdb':      Object.assign(r,{ind:seed.ind,rg:seed.rg,sz:seed.sz,cert:seed.cert.slice(0,2)}); break;
    case 'customs':  Object.assign(r,{rg:seed.rg,sig:['海关进口'],role:seed.role,
                                      ct:{email:c.email}}); break;
    case 'linkedin': Object.assign(r,{role:seed.role,sig:seed.sig.includes('职位变动')?['职位变动']:[],
                                      ct:{name:c.name,title:c.title,im:c.im,imType:c.imType}}); break;
    case 'alibaba':  Object.assign(r,{sig:['RFQ'],cert:seed.cert,ct:{email:c.email}}); break;
  }
  return r;
}
function sourcesOf(seed){
  const s = new Set();
  s.add(seed.m === '国内' ? 'qcc' : 'gdb');
  if(seed.m === '国外') s.add('linkedin');
  if(seed.m === '国内' && seed.rg === '本地周边') s.add('map');
  seed.sig.forEach(g => { if(SIG_SRC[g]) s.add(SIG_SRC[g]); });
  return [...s];
}
const SEED_RAW = [];
SEED.forEach(seed => sourcesOf(seed).forEach(src => SEED_RAW.push(project(seed, src))));

/* live RAW（真实数据源注入，默认空） */
let LIVE_RAW = [];
function setLiveRaw(arr){ LIVE_RAW = Array.isArray(arr) ? arr : []; }
function allRaw(){ return SEED_RAW.concat(LIVE_RAW); }

function normKey(name){
  return String(name).toLowerCase()
    .replace(/（本部）|\(本部\)/g,'')
    .replace(/股份有限公司|有限责任公司|有限公司|集团|公司/g,'')
    .replace(/co\.?,?\s?ltd\.?|co\s?ltd|,?\s?ltd\.?|inc\.?|gmbh|llc|s\.a\./g,'')
    .replace(/[\s\.,·、\-_()（）]/g,'')
    .trim();
}
function uniq(a){ return [...new Set(a)]; }

function aggregate(srcOn){
  const enabled = allRaw().filter(r => srcOn[r.src]);
  const map = new Map();
  enabled.forEach(r => {
    const k = normKey(r.rawName);
    if(!map.has(k)) map.set(k,{key:k,names:[],srcs:[],ind:null,rg:null,sz:null,role:null,
                              cert:[],sig:[],ct:{},raws:0});
    const t = map.get(k);
    t.raws++;
    t.names.push(r.rawName.trim());
    t.srcs.push(r.src);
    ['ind','rg','sz','role'].forEach(f => { if(!t[f] && r[f]) t[f] = r[f]; });
    if(r.cert) t.cert = uniq(t.cert.concat(r.cert));
    if(r.sig)  t.sig  = uniq(t.sig.concat(r.sig));
    if(r.ct) Object.keys(r.ct).forEach(f => { if(!t.ct[f] && r.ct[f]) t.ct[f] = r.ct[f]; });
    if(r.m) t.m = r.m;                                   // 记录自带市场优先
    if(r.act && !t.act) t.act = r.act;
    if(r.meta) (t.meta = t.meta || {}).src = r.src;
  });

  const list = [...map.values()].map(t => {
    t.srcs = uniq(t.srcs);
    t.n = t.names.slice().sort((a,b)=>a.length-b.length)[0];

    // 市场：记录自带 → 种子真值 → 按源推断
    if(!t.m){
      const seed = SEED.find(s => s.n === t.key || t.names.includes(s.n));
      if(seed) t.m = seed.m;
      else t.m = t.srcs.some(s => DOMESTIC_SRCS.has(s)) ? '国内' : '国外';
    }
    if(!t.act){
      const seed = SEED.find(s => s.n === t.key || t.names.includes(s.n));
      t.act = seed ? seed.act : '实时数据源，建议人工核验后触达';
    }

    t.enriched = [];
    if(srcOn.enrich){
      const seed = SEED.find(s => s.n === t.key || t.names.includes(s.n));
      if(seed){
        ['phone','email','im','name','title'].forEach(f=>{
          if(!t.ct[f] && seed.ct[f]){ t.ct[f] = seed.ct[f]; t.enriched.push(f); }
        });
        if(t.enriched.includes('im') && !t.ct.imType) t.ct.imType = seed.ct.imType;
        if(!t.role) t.role = seed.role;
      }
    }
    const k = t.srcs.length;
    t.conf = k>=4 ? 96 : k===3 ? 90 : k===2 ? 78 : 62;
    t.crossBonus = Math.min((k-1)*8, 24);
    const need = ['phone','email','im','name','title'];
    t.fill = Math.round(need.filter(f=>t.ct[f]).length / need.length * 100);
    return t;
  });
  return {rawCount: enabled.length, merged: list};
}

/* ICP 硬过滤 + 加权评分，返回按分降序的线索清单 */
function scoreLeads(icp, srcOn){
  const so = srcOn || SRC_ON_DEFAULT;
  const {rawCount, merged} = aggregate(so);
  const p = icp || {};
  let out = [];
  merged.forEach(d => {
    if(p.market && p.market !== '全部' && d.m !== p.market) return;
    if(p.ind && p.ind.length && !p.ind.includes(d.ind)) return;
    if(p.rg && p.rg.length && !p.rg.includes(d.rg)) return;
    let score = 40, why = ['行业:'+(d.ind||'未知'), '地区:'+(d.rg||'未知')];
    if(p.role && p.role.length && d.role && p.role.includes(d.role)){ score += 15; why.push('角色✓'+d.role); }
    let cm = 0;
    (p.cert || []).forEach(x => { if(d.cert.includes(x)){ cm++; why.push('认证✓'+x); } });
    score += cm * 10;
    (p.sig || []).forEach(x => { if(d.sig.includes(x)){ score += (SIG_W[x]||0); why.push('信号✓'+x); } });
    score += d.crossBonus;
    if(d.crossBonus) why.push(d.srcs.length + '源交叉+' + d.crossBonus);
    out.push(Object.assign({}, d, {score, why}));
  });
  out.sort((a,b) => b.score - a.score);
  return {rawCount, mergedCount: merged.length, dupRemoved: rawCount - merged.length, leads: out};
}

module.exports = {SOURCES, SRC_ON_DEFAULT, SEED, scoreLeads, normKey, aggregate,
                  setLiveRaw, allRaw, SEED_RAW};
