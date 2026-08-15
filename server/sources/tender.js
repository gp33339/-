'use strict';
/* =========================================================================
 * 招投标适配器（国内·公开免费·直接带采购人电话 —— 阀门最强采购信号）
 * -------------------------------------------------------------------------
 * 真实形态: 实时聚合中国政府采购网(ccgp.gov.cn)公开招标/采购/中标/成交公告。
 *   栏目页为服务端渲染(稳定 200)，公告正文公开，通常含
 *   【采购人(采购单位) + 项目联系人 + 座机/手机 + 邮箱 + 预算】。
 *   仅抓 www 子域(详情页)，避开 search 子域的"频繁访问"限流。
 *
 * 演示形态(默认, TENDER_LIVE 未设): 返回内置阀门招标样本 RAW（真实格式联系方式），
 *   零成本验证「招标采购信号 → 引擎 +25 → 带电话清单置顶」整条逻辑。
 *
 * 合规护栏（务必遵守）:
 *   1. 仅聚合公开公告中的【采购人/代理机构联系信息】，不抓取自然人隐私；
 *   2. 守 robots.txt、低频访问(内置 600ms 间隔+数量上限)、带 UA；
 *   3. 聚合结果用于用户自主商业研判，触达动作由用户负责（不得骚扰）；
 *   4. 不得转售原始公告文本或形成对原站的实质性替代。
 * ========================================================================= */
const {request} = require('./http');

const CCGP = 'http://www.ccgp.gov.cn';
const UA = {'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BaxinLeads/1.0 (compliance; +mailto:admin@example.com)'};

/* 阀门相关关键词：公告标题命中即视为目标线索 */
const VALVE_KW = ['阀门','阀组','蝶阀','球阀','闸阀','截止阀','调节阀','止回阀','安全阀','疏水阀',
  '减压阀','电磁阀','隔膜阀','旋塞阀','柱塞阀','节流阀','排污阀','排气阀','控制阀','管阀','法兰','阀'];

/* 需抓取的栏目（中央公告为主，取各栏目最新一页） */
const LIST_PAGES = [
  '/cggg/zygg/', '/cggg/zygg/zbgg/', '/cggg/zygg/cjgg/',
  '/cggg/zygg/jzxtpgg/', '/cggg/zygg/jzxcs/', '/cggg/zygg/gzgg/'
];

const RG_MAP = [
  [/北京|天津|河北|山东|山西|内蒙古/, '华北'],
  [/上海|江苏|浙江|安徽/, '华东'],
  [/广东|深圳|福建|广西|海南/, '华南'],
  [/湖北|湖南|河南|江西/, '华中'],
  [/四川|重庆|云南|贵州|西藏/, '西南'],
  [/陕西|甘肃|青海|宁夏|新疆/, '西北'],
  [/辽宁|吉林|黑龙江/, '东北']
];
const IND_MAP = [
  [/石化|化工|炼化|炼油|化纤/, '石化'],
  [/油气|石油|管道|储运|燃气/, '油气'],
  [/水务|供水|水处理|环保|污水|净水/, '水处理'],
  [/电力|电厂|热电|能源/, '电力'],
  [/冶金|钢铁|金属|有色/, '冶金'],
  [/造船|船舶|船厂|海工|海洋/, '造船']
];
function inferRegion(s){ for(const [re,v] of RG_MAP) if(re.test(s)) return v; return '国内'; }
function inferInd(title){ for(const [re,v] of IND_MAP) if(re.test(title)) return v; return '其他'; }
function isValve(title){ return VALVE_KW.some(k => title.includes(k)); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/* 相对 href 解析为绝对 URL（基于栏目页路径） */
function resolve(href, basePath){
  if(href.startsWith('http')) return href;
  if(href.startsWith('//')) return 'http:' + href;
  let base = basePath.endsWith('/') ? basePath : basePath.slice(0, basePath.lastIndexOf('/') + 1);
  let p = href;
  while(p.startsWith('../')){ p = p.slice(3); base = base.replace(/[^/]+\/$/, ''); }
  if(p.startsWith('./')) p = p.slice(2);
  return CCGP + base + p;
}

/* 解析栏目页：抽取标题含阀门的链接 */
function parseListing(html, basePath){
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*title="([^"]+)"[^>]*>/g;
  let m;
  while((m = re.exec(html))){
    const href = m[1], title = (m[2] || '').trim();
    if(href.endsWith('.htm') && title.length > 4 && isValve(title)){
      out.push({title, url: resolve(href, basePath)});
    }
  }
  return out;
}

/* 从详情页 HTML 抽取采购人/联系人/电话/邮箱/预算 */
function extractContacts(html){
  const t = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
  const get = (re) => { const m = t.match(re); return m ? (m[1] || m[0]).trim() : null; };
  const NAME = '[\\u4e00-\\u9fa5A-Za-z0-9（）()·]';
  const buyer = get(new RegExp('(?:采购人|采购单位|招标人)\\s*[名称:：]*\\s*(' + NAME + '{2,30}?)\\s*(?:采购单位地址|地址|联系方式|采购代理|项目|，)'))
    || get(/采购人[：:]\s*([\u4e00-\u9fa5A-Za-z0-9（）()·]{2,30})/);
  const contact = get(/项目联系人\s*([^\s]{2,30}?)\s*项目联系电话/)
    || get(/联系人[：: ]*\s*([^\s,，。；;]{2,20}?)\s*(?:电话|联系电|。|；|，)/);
  const phone = get(/项目联系电话\s*([（(]?\d{2,4}[）)]?[-\s]?\d{7,8})/)
    || get(/联系电话\s*([（(]?\d{2,4}[）)]?[-\s]?\d{7,8})/)
    || (t.match(/(?<!\d)[（(]?\d{2,4}[）)]?[-\s]?\d{7,8}(?!\d)/g) || [])[0]
    || null;
  const mobile = get(/手机[号码]*[：: ]*(1[3-9]\d{9})/) || null;
  const email = (t.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])[0] || null;
  const budget = get(/预算金额[：: ]*([¥\d.,]+\s*(?:万元|元|万))/)
    || get(/中标金额[：: ]*([¥\d.,]+\s*万)/)
    || get(/成交金额[：: ]*([¥\d.,]+\s*万)/)
    || get(/金额[：: ]*([¥\d.,]+\s*万)/);
  return {buyer, contact, phone, mobile, email, budget};
}

function inferSize(budget){
  if(!budget) return null;
  const m = String(budget).match(/([\d.,]+)\s*(万|亿|元)/i);
  if(!m) return null;
  let v = parseFloat(m[1].replace(/,/g, ''));
  const unit = m[2].toLowerCase();
  if(unit === '亿') v *= 10000;
  else if(unit === '元') v /= 10000;
  if(v >= 2000) return '大型';
  if(v >= 500)  return '中型';
  return '小型';
}

/* 一条招标记录 → 引擎 RAW 形态 */
function mapTenderToRaw(item, ext){
  if(!ext.buyer) return null;
  const m = '国内';
  const rg = inferRegion(ext.buyer + ' ' + item.title);
  const ind = inferInd(item.title);
  const sz = inferSize(ext.budget);
  return {
    src: 'bid',
    rawName: ext.buyer,
    m, ind, rg, sz,
    role: '采购人/招标方',
    cert: [],
    sig: ['招标采购'],
    ct: { name: ext.contact || undefined,
          phone: ext.phone || undefined,
          mobile: ext.mobile || undefined,
          email: ext.email || undefined },
    act: '招标采购阀门 → 按公告要求报名/购标书，或直连采购人/代理推进入合格供方',
    meta: { tender: { project: item.title, buyer: ext.buyer, budget: ext.budget || null,
                      url: item.url, contact: ext.contact, phone: ext.phone, email: ext.email } }
  };
}

/* 演示样本：真实风格的阀门招标（联系方式为示例，格式真实）。 */
const DEMO_TENDERS = [
  {project:'某石化炼化一体化项目工艺阀门采购', buyer:'华东某石化工程有限公司', ind:'石化', rg:'华东', contact:'张工', title:'采购经理', phone:'0571-87654321', email:'zhang@hd-shihua.example', budget:'¥2,800万', url:'https://www.ccgp.gov.cn/example/1'},
  {project:'城市供水管网改造蝶阀/闸阀招标', buyer:'华南某水务集团有限公司', ind:'水处理', rg:'华南', contact:'李工', title:'采购主管', phone:'020-38391234', email:'li@hnshuiwu.example', budget:'¥1,150万', url:'https://www.ccgp.gov.cn/example/2'},
  {project:'电厂烟气脱硫系统调节阀采购', buyer:'华北某电力建设有限公司', ind:'电力', rg:'华北', contact:'赵工', title:'技术总监', phone:'010-65238899', email:'zhao@hbdianli.example', budget:'¥920万', url:'https://www.ccgp.gov.cn/example/3'},
  {project:'海上平台球阀年度框架采购', buyer:'华东某造船有限公司', ind:'造船', rg:'华东', contact:'周工', title:'采购经理', phone:'021-58887766', email:'zhou@hdzaochuan.example', budget:'¥1,650万', url:'https://www.ccgp.gov.cn/example/4'},
  {project:'油气长输管道截断阀招标', buyer:'华南某油气储运有限公司', ind:'油气', rg:'华南', contact:'吴工', title:'采购经理', phone:'0755-26178899', email:'wu@hnyouqi.example', budget:'¥3,200万', url:'https://www.ccgp.gov.cn/example/5'},
  {project:'化工园区不锈钢球阀采购', buyer:'华中某化工集团股份有限公司', ind:'石化', rg:'华中', contact:'钱工', title:'设备工程师', phone:'027-87112233', email:'qian@hzhuagong.example', budget:'¥760万', url:'https://www.ccgp.gov.cn/example/6'},
  {project:'市政供热管网平衡阀采购', buyer:'华北某城市热力有限公司', ind:'电力', rg:'华北', contact:'孙工', title:'采购', phone:'022-23338877', email:'sun@hbrelie.example', budget:'¥540万', url:'https://www.ccgp.gov.cn/example/7'},
  {project:'冶金高炉冷却系统截止阀招标', buyer:'华北某冶金集团有限公司', ind:'冶金', rg:'华北', contact:'刘工', title:'技术部', phone:'0310-55226688', email:'liu@hbyejin.example', budget:'¥1,080万', url:'https://www.ccgp.gov.cn/example/8'},
  {project:'海外 EPC 海水淡化项目阀门包', buyer:'东南亚某水务 EPC 公司', ind:'水处理', rg:'东南亚', contact:'Tan Wei', title:'Project Mgr', phone:'+65-6123 4567', email:'tan@sea-epc.example', budget:'$1.8M', url:'https://www.ccgp.gov.cn/example/9'},
  {project:'中东油气处理厂紧急切断阀', buyer:'中东某油气工程公司', ind:'油气', rg:'中东', contact:'Omar Said', title:'Procurement', phone:'+971-4 331 7788', email:'omar@mepc.example', budget:'$2.4M', url:'https://www.ccgp.gov.cn/example/10'}
];

function demoRaws({industries=[], regions=[]}={}){
  const indSet = new Set(industries), rgSet = new Set(regions);
  return DEMO_TENDERS
    .filter(t => !indSet.size || !t.ind || indSet.has(t.ind))
    .filter(t => !rgSet.size || !t.rg || rgSet.has(t.rg))
    .map(t => mapTenderToRaw(t, {buyer:t.buyer, contact:t.contact, phone:t.phone, email:t.email, budget:t.budget}));
}

/* 主入口：拉取招投标 RAW
 * opts: { demo(bool), industries:[], regions:[], live(bool) } */
async function fetchRaw({demo=false, industries=[], regions=[], live=false}={}){
  if(!live || demo){
    const out = demoRaws({industries, regions});
    console.warn('[tender] 演示样本 ' + out.length + ' 条（招投标为公开免费数据；' +
      '设 TENDER_LIVE=1 启用真实聚合，须遵守 robots.txt 与低频访问）');
    return out;
  }

  const MAX = parseInt(process.env.TENDER_MAX || '20', 10);
  const raws = [];
  const seen = new Set();
  let fetched = 0;
  try{
    for(const page of LIST_PAGES){
      if(fetched >= MAX) break;
      let html;
      try{ html = (await request('GET', CCGP + page, {headers: UA, timeout: 20000})).text; }
      catch(e){ console.warn('[tender] 栏目失败', page, e.message); continue; }
      const items = parseListing(html, page);
      for(const it of items){
        if(fetched >= MAX) break;
        if(seen.has(it.url)) continue;
        seen.add(it.url);
        try{
          const d = (await request('GET', it.url, {headers: UA, timeout: 20000})).text;
          const ext = extractContacts(d);
          const r = mapTenderToRaw(it, ext);
          if(r) raws.push(r);
          fetched++;
          await sleep(600); // 限速，守 robots
        }catch(e){ /* 单条失败不影响其他 */ }
      }
    }
  }catch(e){
    console.warn('[tender] 实时聚合异常:', e.message);
  }
  if(!raws.length){
    console.warn('[tender] 实时未取到阀门招标（可能当日栏目无命中），回退演示样本');
    return demoRaws({industries, regions});
  }
  console.warn('[tender] 实时聚合 ' + raws.length + ' 条真实招标（采购人+联系方式）');
  return raws;
}

module.exports = {fetchRaw, parseListing, extractContacts, mapTenderToRaw, inferRegion, inferInd,
  demoRaws, DEMO_TENDERS, VALVE_KW, LIST_PAGES};
