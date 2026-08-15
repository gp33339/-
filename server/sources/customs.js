'use strict';
/* =========================================================================
 * 海关进口数据适配器（阀门外贸最强采购信号源）
 * -------------------------------------------------------------------------
 * - 真实形态: 腾道(tendata.cn)海关数据 API，Bearer(OAuth2) 鉴权，
 *   按 HS 编码(阀门约 8481 系列) + 目的国 + 产品描述查进口商提单记录。
 * - 演示形态(无 key 或 CUSTOMS_DEMO=1): 返回一组内置阀门进口商样本 RAW，
 *   零成本验证「海关进口信号 → 引擎评分 +25 → 清单置顶」整条逻辑。
 * 合规: 海关提单数据属授权商业数据，不得二次转售；触达由用户负责(GDPR)。
 * ========================================================================= */
const {postJSON} = require('./http');
const {CC_TO_RG} = require('./hunter');   // 复用地区回查（US→美国/DE→欧洲/…）

const DEFAULT_API_BASE = 'https://api.tendata.cn/openapi/customs/v1/records';

/* 阀门 HS 编码族（海关税则：84.81 龙头/阀门/旋塞；848180 其他阀门） */
const HS_VALVE = '8481';
const IND_TO_HS = {
  '石化':   {hs:'8481',   desc:'valve'},
  '油气':   {hs:'8481',   desc:'ball valve'},
  '水处理': {hs:'8481',   desc:'water valve'},
  '电力':   {hs:'8481',   desc:'gate valve'},
  '造船':   {hs:'848180', desc:'marine valve'},
  '冶金':   {hs:'8481',   desc:'industrial valve'}
};
/* 地区 → 腾道目的国代码枚举（简化 2 位） */
const RG_TO_CC = {
  '美国':['US'], '欧洲':['DE','GB'], '东南亚':['SG'], '中东':['AE'], '南美':['BR']
};

/* 内置演示样本：真实形态的阀门进口商（假名），覆盖主要目的国/行业。
 * 每条 = 一个进口商，海关提单命中 = 强采购意图。 */
const DEMO_RECORDS = [
  {importer:'Gulf Petrovalve FZE',            hsCode:'8481',   productDesc:'ball valve',   cc:'AE', ind:'油气',   rg:'中东',   supplier:'Zhejiang Jinggong Valve Co., Ltd.', importCount:12, lastDate:'2026-05'},
  {importer:'Euro Valve Distributors GmbH',  hsCode:'8481',   productDesc:'valve',        cc:'DE', ind:'石化',   rg:'欧洲',   supplier:'Wenzhou Xinhua Valve',            importCount:9,  lastDate:'2026-06'},
  {importer:'SEA Marine Valve Pte Ltd',      hsCode:'848180', productDesc:'marine valve', cc:'SG', ind:'造船',   rg:'东南亚', supplier:'Jiangsu Marine Valve Mfg',         importCount:6,  lastDate:'2026-04'},
  {importer:'Andean Industrial Imports S.A.',hsCode:'8481',   productDesc:'industrial valve', cc:'BR', ind:'冶金', rg:'南美', supplier:'Hebei Steel Valve',              importCount:4,  lastDate:'2026-03'},
  {importer:'North American Flow Controls Inc',hsCode:'8481', productDesc:'gate valve',   cc:'US', ind:'电力',   rg:'美国',   supplier:'Shenzhen Power Valve',            importCount:15, lastDate:'2026-07'},
  {importer:'MENA Water Systems LLC',         hsCode:'8481',   productDesc:'water valve',  cc:'AE', ind:'水处理', rg:'中东',   supplier:'Shanghai Water Valve',            importCount:7,  lastDate:'2026-05'},
  {importer:'Rhine Pump & Valve AG',          hsCode:'848120', productDesc:'hydraulic valve', cc:'DE', ind:'石化', rg:'欧洲', supplier:'Ningbo Hydraulic Components',       importCount:11, lastDate:'2026-06'},
  {importer:'Pacific Valve Traders Pte Ltd',  hsCode:'848130', productDesc:'check valve',  cc:'SG', ind:'油气',   rg:'东南亚', supplier:'Guangdong Valve Mfg',             importCount:5,  lastDate:'2026-02'}
];

/* 一条海关记录 → 引擎 RAW 形态
 * rec: { importer, hsCode, productDesc, cc, ind?, rg?, supplier, importCount, lastDate, email? } */
function mapRecordToRaw(rec){
  const rg = rec.rg || CC_TO_RG[String(rec.cc || '').toUpperCase()] || null;
  const ind = rec.ind || inferInd(rec.productDesc);
  return {
    src:'customs',
    rawName: rec.importer,
    m:'国外',
    ind, rg,
    sz:null,
    role:'Importer',
    cert:[],
    sig:['海关进口'],
    ct: rec.email ? {email:rec.email} : {},
    act:'海关提单命中进口商 → 发产品目录/样品/海关开发信',
    meta:{
      customs:{
        hsCode: rec.hsCode, productDesc: rec.productDesc, country: rec.cc,
        importer: rec.importer, importCount: rec.importCount,
        lastDate: rec.lastDate, supplier: rec.supplier, allSrc:'customs'
      }
    }
  };
}

/* 产品描述 → 行业（用于真实 API 回查，演示样本已自带 ind 不触发此逻辑） */
function inferInd(desc){
  if(!desc) return '石化';
  const d = String(desc).toLowerCase();
  if(/ball|oil|petro|gas/.test(d)) return '油气';
  if(/water/.test(d)) return '水处理';
  if(/marine|ship/.test(d)) return '造船';
  if(/gate|power/.test(d)) return '电力';
  if(/hydraulic/.test(d)) return '石化';
  return '石化';
}

/* 主入口：拉取海关进口商 RAW
 * opts: { apiKey, apiBase, industries:[], regions:[], demo(bool) } */
async function fetchRaw({apiKey, apiBase, industries=[], regions=[], demo=false}={}){
  if(!apiKey || demo){
    // 演示：内置样本，按 industries/regions 过滤
    const indSet = new Set(industries), rgSet = new Set(regions);
    const out = DEMO_RECORDS
      .filter(r => !indSet.size || !r.ind || indSet.has(r.ind))
      .filter(r => !rgSet.size || !r.rg || rgSet.has(r.rg))
      .map(mapRecordToRaw);
    console.warn('[customs] 演示样本 ' + out.length + ' 条（无 CUSTOMS_API_KEY，填 key 即换真实提单）');
    return out;
  }

  // 真实：调腾道海关数据 API（Bearer/OAuth2）
  const base = apiBase || DEFAULT_API_BASE;
  const q = buildQueries({industries, regions});
  const end = new Date().toISOString().slice(0,10);
  const start = new Date(Date.now()-365*24*3600*1000).toISOString().slice(0,10);
  const payload = {catalog:'import', startDate:start, endDate:end, searchMode:'FUZZY_SINGLE'};
  if(q.hsCode) payload.hsCode = q.hsCode;
  if(q.productDesc) payload.productDesc = q.productDesc;
  if(q.cc.length) payload.countryOfDestinationCode = q.cc.join(',');

  let resp;
  try{
    resp = await postJSON(base, payload, {Authorization:'Bearer ' + apiKey});
  }catch(e){
    console.warn('[customs] API 失败:', e.message);
    return [];
  }
  const list = (resp.json && resp.json.data && (resp.json.data.list || resp.json.data.records)) || [];
  if(!list.length){
    console.warn('[customs] 无结果', JSON.stringify(resp.json).slice(0,200));
    return [];
  }
  // 按进口商聚合（同一进口商可能多票提单）
  const byImp = new Map();
  list.forEach(rec=>{
    const imp = rec.importer || rec.buyerName || rec.companyName;
    if(!imp) return;
    if(!byImp.has(imp)) byImp.set(imp, {importer:imp, hsCode:rec.hsCode, productDesc:rec.productDesc,
      cc:rec.countryOfDestinationCode || rec.countryCode, supplier:rec.exporter || rec.supplier,
      dates:[], email:rec.contactEmail});
    const o = byImp.get(imp); o.dates.push(rec.date || rec.declarationDate);
  });
  const out = [];
  for(const o of byImp.values()){
    o.dates.sort();
    out.push(mapRecordToRaw({
      importer:o.importer, hsCode:o.hsCode, productDesc:o.productDesc, cc:o.cc,
      supplier:o.supplier, importCount:o.dates.length, lastDate:o.dates[o.dates.length-1] || null, email:o.email
    }));
  }
  return out;
}

function buildQueries({industries=[], regions=[]}){
  let hsCode=null, desc=null;
  industries.forEach(i=>{ const h = IND_TO_HS[i]; if(h){ if(!hsCode) hsCode=h.hs; if(!desc) desc=h.desc; } });
  const cc = [];
  regions.forEach(r=>{ (RG_TO_CC[r]||[]).forEach(c=>cc.push(c)); });
  return {hsCode, productDesc:desc, cc};
}

module.exports = {fetchRaw, mapRecordToRaw, buildQueries, inferInd,
                  IND_TO_HS, RG_TO_CC, HS_VALVE, DEFAULT_API_BASE, DEMO_RECORDS};
