'use strict';
/* =========================================================================
 * 招投标适配器（国内免费、公开、且直接带采购人联系电话 —— 阀门最强采购信号）
 * -------------------------------------------------------------------------
 * - 真实形态: 聚合中国政府采购网(ccgp.gov.cn)、全国公共资源交易平台(ggzy)、
 *   各省市公共资源交易中心的招标/采购公告。公告正文公开，通常含
 *   【采购人名称 + 联系人 + 固定电话/手机 + 邮箱 + 采购内容 + 预算】。
 * - 演示形态(默认): 返回一组内置阀门招标样本 RAW（真实格式联系方式），
 *   零成本验证「招标采购信号 → 引擎 +25 → 带电话清单置顶」整条逻辑。
 *
 * 合规护栏（务必遵守）:
 *   1. 仅聚合公开公告中的【企业/机构采购联系信息】，不抓取自然人隐私；
 *   2. 遵守目标站点 robots.txt，低频访问，必要时加 UA 与间隔；
 *   3. 聚合结果用于用户自主商业研判，触达动作由用户负责（不得骚扰）；
 *   4. 不得转售原始公告文本或形成对原站的实质性替代。
 * ========================================================================= */
const {getJSON} = require('./http');

/* 演示样本：真实风格的阀门招标（采购人/代理/联系方式均为示例，格式真实）。
 * 阀门下游招标高频行业：石化、油气、水处理、电力、化工、市政、冶金、造船。 */
const DEMO_TENDERS = [
  {project:'某石化炼化一体化项目工艺阀门采购', buyer:'华东某石化工程有限公司', ind:'石化', rg:'华东',
   contact:'张工', title:'采购经理', phone:'0571-87654321', email:'zhang@hd-shihua.example',
   budget:'¥2,800万', publish:'2026-07', url:'https://www.ccgp.gov.cn/example/1'},
  {project:'城市供水管网改造蝶阀/闸阀招标', buyer:'华南某水务集团有限公司', ind:'水处理', rg:'华南',
   contact:'李工', title:'采购主管', phone:'020-38391234', email:'li@hnshuiwu.example',
   budget:'¥1,150万', publish:'2026-06', url:'https://www.ccgp.gov.cn/example/2'},
  {project:'电厂烟气脱硫系统调节阀采购', buyer:'华北某电力建设有限公司', ind:'电力', rg:'华北',
   contact:'赵工', title:'技术总监', phone:'010-65238899', email:'zhao@hbdianli.example',
   budget:'¥920万', publish:'2026-07', url:'https://www.ccgp.gov.cn/example/3'},
  {project:'海上平台球阀年度框架采购', buyer:'华东某造船有限公司', ind:'造船', rg:'华东',
   contact:'周工', title:'采购经理', phone:'021-58887766', email:'zhou@hdzaochuan.example',
   budget:'¥1,650万', publish:'2026-05', url:'https://www.ccgp.gov.cn/example/4'},
  {project:'油气长输管道截断阀招标', buyer:'华南某油气储运有限公司', ind:'油气', rg:'华南',
   contact:'吴工', title:'采购经理', phone:'0755-26178899', email:'wu@hnyouqi.example',
   budget:'¥3,200万', publish:'2026-07', url:'https://www.ccgp.gov.cn/example/5'},
  {project:'化工园区不锈钢球阀采购', buyer:'华中某化工集团股份有限公司', ind:'石化', rg:'华中',
   contact:'钱工', title:'设备工程师', phone:'027-87112233', email:'qian@hzhuagong.example',
   budget:'¥760万', publish:'2026-06', url:'https://www.ccgp.gov.cn/example/6'},
  {project:'市政供热管网平衡阀采购', buyer:'华北某城市热力有限公司', ind:'电力', rg:'华北',
   contact:'孙工', title:'采购', phone:'022-23338877', email:'sun@hbrelie.example',
   budget:'¥540万', publish:'2026-04', url:'https://www.ccgp.gov.cn/example/7'},
  {project:'冶金高炉冷却系统截止阀招标', buyer:'华北某冶金集团有限公司', ind:'冶金', rg:'华北',
   contact:'刘工', title:'技术部', phone:'0310-55226688', email:'liu@hbyejin.example',
   budget:'¥1,080万', publish:'2026-05', url:'https://www.ccgp.gov.cn/example/8'},
  {project:'海外 EPC 海水淡化项目阀门包', buyer:'东南亚某水务 EPC 公司', ind:'水处理', rg:'东南亚',
   contact:'Tan Wei', title:'Project Mgr', phone:'+65-6123 4567', email:'tan@sea-epc.example',
   budget:'$1.8M', publish:'2026-06', url:'https://www.ccgp.gov.cn/example/9'},
  {project:'中东油气处理厂紧急切断阀', buyer:'中东某油气工程公司', ind:'油气', rg:'中东',
   contact:'Omar Said', title:'Procurement', phone:'+971-4 331 7788', email:'omar@mepc.example',
   budget:'$2.4M', publish:'2026-07', url:'https://www.ccgp.gov.cn/example/10'}
];

/* 一条招标记录 → 引擎 RAW 形态
 * t: { project, buyer, ind, rg, contact, title, phone, email, budget, publish, url } */
function mapTenderToRaw(t){
  const sz = inferSize(t.budget);
  // 国内地区 → 国内；海外地区 → 国外（招投标既有国内政采，也有海外 EPC 招标）
  const DOMESTIC_RG = new Set(['华东','华南','华北','华中','本地周边']);
  const m = DOMESTIC_RG.has(t.rg) ? '国内' : '国外';
  return {
    src:'bid',
    rawName: t.buyer,
    m,
    ind: t.ind, rg: t.rg, sz,
    role:'采购人/招标方',
    cert:[],
    sig:['招标采购'],
    ct:{ name:t.contact, title:t.title, phone:t.phone, email:t.email },
    act:'招标采购阀门 → 按公告要求报名/购标书，或直连采购人/代理推进入合格供方',
    meta:{ tender:{ project:t.project, buyer:t.buyer, budget:t.budget, publish:t.publish,
                    url:t.url, contact:t.contact, phone:t.phone, email:t.email } }
  };
}

/* 预算 → 规模（用于评分与展示） */
function inferSize(budget){
  if(!budget) return null;
  const m = String(budget).match(/([\d,.]+)\s*(万|亿|M|k|万)/i);
  if(!m) return null;
  let v = parseFloat(m[1].replace(/,/g,''));
  const unit = m[2].toLowerCase();
  if(unit === '亿') v *= 10000;
  else if(unit === 'm') v *= 100; // $1.8M ≈ 180万
  if(v >= 2000) return '大型';
  if(v >= 500)  return '中型';
  return '小型';
}

/* 主入口：拉取招投标 RAW
 * opts: { demo(bool), industries:[], regions:[], live(bool) } */
async function fetchRaw({demo=false, industries=[], regions=[], live=false}={}){
  if(!live || demo){
    const indSet = new Set(industries), rgSet = new Set(regions);
    const out = DEMO_TENDERS
      .filter(t => !indSet.size || !t.ind || indSet.has(t.ind))
      .filter(t => !rgSet.size || !t.rg || rgSet.has(t.rg))
      .map(mapTenderToRaw);
    console.warn('[tender] 演示样本 ' + out.length + ' 条（招投标公告为公开免费数据；' +
                 '设 TENDER_LIVE=1 启用真实聚合，须遵守 robots.txt 与低频访问）');
    return out;
  }

  // 真实：聚合公开招标公告（脚手架 —— 需按目标站结构调优解析规则）
  const queries = buildQueries({industries, regions});
  let out = [];
  try{
    for(const q of queries){
      const html = await fetchNoticeHTML(q);
      const recs = parseNotices(html);
      out.push(...recs.map(mapTenderToRaw));
    }
  }catch(e){
    console.warn('[tender] 实时聚合失败（回退演示样本）:', e.message);
    out = DEMO_TENDERS.map(mapTenderToRaw);
  }
  return out;
}

/* 真实抓取脚手架（占位实现，需调优） */
async function fetchNoticeHTML(q){
  // 例：抓 ccgp 搜索页；真实部署应加 UA、限速、遵守 robots、抓详情页提取电话
  const url = 'https://search.ccgp.gov.cn/bxsearch?searchtype=1&dbselect=bidx&kw=' +
             encodeURIComponent(q.kw);
  const resp = await getJSON(url, {'User-Agent':'Baxin-Leads/1.0 (compliance; contact admin)'});
  return resp.text || '';
}
function parseNotices(html){
  // 占位：真实需按站点 DOM 解析"采购人/联系人/电话"字段。
  // 公开公告中电话通常出现在正文的"联系方式"段，可用正则按 【联系人/电话/邮箱】 抽取。
  return [];
}

function buildQueries({industries=[], regions=[]}={}){
  const kw = [];
  (industries.length ? industries : ['石化','油气','水处理','电力','化工','冶金','造船'])
    .forEach(i => kw.push({kw: i + ' 阀门 招标'}));
  return kw;
}

module.exports = {fetchRaw, mapTenderToRaw, inferSize, buildQueries, DEMO_TENDERS};
