'use strict';
/* =========================================================================
 * Hunter.io 适配器（海外公司发现 + 邮箱补全）
 * - v2/discover : 按行业/国家搜公司（POST，免费额度）—— 真 key 用
 * - v2/domain-search : 按域名找邮箱（GET）—— 支持公开测试 key 'test-api-key'
 * 设计：Hunter 主要补全"海外公司 + 联系人邮箱"，映射到 RAW(src='hunter', m='国外')。
 *   测试 key 下 discover 会 401，因此自动降级为"对示例域名跑 domain-search"，
 *   以零成本验证整条"真实 API → RAW → 引擎"链路。
 * 合规：Hunter 数据须能提供来源与退订机制（GDPR）；本产品仅交付，触达由用户负责。
 * ========================================================================= */
const {getJSON, postJSON} = require('./http');

const DISCOVER = 'https://api.hunter.io/v2/discover';
const DOMAIN_SEARCH = 'https://api.hunter.io/v2/domain-search';

/* 我们的行业 → Hunter discover industry slug */
const IND_TO_HUNTER = {
  '石化':'chemicals', '油气':'oil_and_gas', '电力':'utilities', '水处理':'utilities',
  '冶金':'mining_metals', '造船':'manufacturing'
};
/* 我们的地区 → Hunter location 国家码（discover 用） */
const RG_TO_CC = {
  '美国':['US'], '欧洲':['GB','DE','FR'], '东南亚':['SG','ID','MY'], '中东':['AE','SA'], '南美':['BR','AR']
};
/* Hunter 国家码/名称 → 我们的地区 */
const CC_TO_RG = {
  US:'美国', GB:'欧洲', UK:'欧洲', DE:'欧洲', FR:'欧洲', IE:'欧洲', ES:'欧洲', IT:'欧洲',
  SG:'东南亚', ID:'东南亚', MY:'东南亚', TH:'东南亚', VN:'东南亚', PH:'东南亚',
  AE:'中东', SA:'中东', QA:'中东', KW:'中东', IL:'中东',
  BR:'南美', AR:'南美', CL:'南美', MX:'南美',
  CN:'国内', HK:'国内', TW:'国内'
};
/* Hunter industry slug → 我们的行业 */
const HUNTER_TO_IND = {
  chemicals:'石化', oil_and_gas:'油气', utilities:'电力', energy:'电力', water:'水处理',
  mining_metals:'冶金', metals:'冶金', manufacturing:'造船', oil_gas:'油气'
};

function mapCompanyToRaw(c){
  const name = c.name || c.domain || (c.organization);
  if(!name) return null;
  const cc = (c.location && (c.location.code || c.location.country || c.location)) || c.country;
  const rg = (typeof cc === 'string' && CC_TO_RG[cc.toUpperCase()]) || null;
  const ind = (c.industry && HUNTER_TO_IND[String(c.industry).toLowerCase()]) || null;
  const ct = {imType:'linkedin'};
  if(c.domain) ct.im = c.domain;
  return {
    src:'hunter', rawName: name, m:'国外', ind, rg,
    sz: c.employee_range || null, cert:[], sig:[],
    ct, meta:{ hunter:{ domain:c.domain, industry:c.industry, location:cc } }
  };
}

/* 单域名 domain-search → 一家公司 RAW（带主联系人邮箱） */
async function domainSearch(domain, apiKey){
  const url = DOMAIN_SEARCH + '?domain=' + encodeURIComponent(domain) + '&api_key=' + encodeURIComponent(apiKey);
  let resp;
  try{ resp = await getJSON(url); }catch(e){ console.warn('[hunter] domain-search 失败', domain, e.message); return null; }
  const d = resp.json && resp.json.data;
  if(!d || !d.organization) return null;
  const emails = (d.emails || []).filter(e=>e.value);
  // 取置信度最高的 personal 邮箱作为主联系人
  const best = emails.filter(e=>e.type==='personal').sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0]
            || emails.sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0];
  const ct = {imType:'linkedin', im: d.domain};
  if(best){
    ct.email = best.value;
    if(best.first_name || best.last_name) ct.name = [best.first_name, best.last_name].filter(Boolean).join(' ');
    if(best.position) ct.title = best.position;
  }
  return {
    src:'hunter', rawName: d.organization, m:'国外', ind:null, rg:null,
    sz:null, cert:[], sig:[],
    ct, meta:{ hunter:{ domain:d.domain, emails: emails.map(e=>({value:e.value, type:e.type, conf:e.confidence})) } }
  };
}

/* 主入口：拉取海外 RAW
 * opts: { apiKey, industries:[], regions:[], perPage, enrich(bool) } */
async function discoverRaw({apiKey, industries=[], regions=[], perPage=20, enrich=false}){
  if(apiKey === 'test-api-key'){
    // 测试 key：discover 不可用，改用示例域名跑 domain-search 验证链路
    const sampleDomains = ['stripe.com','intercom.com','shopify.com','hubspot.com'];
    const out = [];
    for(const dom of sampleDomains){
      const r = await domainSearch(dom, apiKey);
      if(r) out.push(r);
    }
    return out;
  }

  // 真 key：discover 搜公司
  const indSet = new Set();
  industries.forEach(i=>{ const h = IND_TO_HUNTER[i]; if(h) indSet.add(h); });
  const ccSet = new Set();
  regions.forEach(r=>{ (RG_TO_CC[r]||[]).forEach(cc=>ccSet.add(cc)); });
  const payload = { per_page: Math.min(perPage||20, 100) };
  if(indSet.size) payload.industry = [...indSet];
  if(ccSet.size) payload.location = [...ccSet];

  let resp;
  try{
    resp = await postJSON(DISCOVER + '?api_key=' + encodeURIComponent(apiKey), payload);
  }catch(e){ console.warn('[hunter] discover 失败', e.message); return []; }
  const arr = (resp.json && (resp.json.data || resp.json.companies || []));
  if(!Array.isArray(arr) || !arr.length){
    console.warn('[hunter] discover 无结果', resp.json && JSON.stringify(resp.json).slice(0,200));
    return [];
  }
  const out = [];
  for(const c of arr.slice(0, 50)){
    const r = mapCompanyToRaw(c);
    if(!r) continue;
    if(enrich && r.meta && r.meta.hunter && r.meta.hunter.domain){
      const e = await domainSearch(r.meta.hunter.domain, apiKey);
      if(e && e.ct.email){ r.ct.email = e.ct.email; r.ct.name = e.ct.name || r.ct.name; r.ct.title = e.ct.title || r.ct.title;
        r.meta.hunter.emails = (e.meta.hunter && e.meta.hunter.emails) || null; }
    }
    out.push(r);
  }
  return out;
}

module.exports = {discoverRaw, domainSearch, mapCompanyToRaw,
                  IND_TO_HUNTER, RG_TO_CC, CC_TO_RG, HUNTER_TO_IND, DISCOVER, DOMAIN_SEARCH};
