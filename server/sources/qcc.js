'use strict';
/* =========================================================================
 * 企查查开放平台适配器（国内工商数据源）
 * 接口：FuzzySearch/GetList  （ApiCode 886，需企业实名+开通）
 * 鉴权：Header Token = MD5(key + Timespan + SecretKey) 32位大写
 *       Header Timespan = 秒级 Unix 时间戳
 *       Query key = AppKey, searchKey = 关键词
 * 说明：企查查基础字段不含电话/邮箱（默认脱敏，需白名单才返明文），
 *       因此本适配器只产出 公司名/法人/信用代码/地区/状态，联系方式留空，
 *       由 enrich 源或人工补全——符合"字段跨源互补"设计。
 * ========================================================================= */
const crypto = require('crypto');
const {getJSON} = require('./http');

const BASE = 'https://api.qichacha.com/FuzzySearch/GetList';

function sign(appkey, secret, timespan){
  return crypto.createHash('md5').update(appkey + timespan + secret).digest('hex').toUpperCase();
}

/* 关键词 → 我们行业/地区税表的推断（企查查按关键词搜，命中即打该标签） */
function tagFromKeyword(kw){
  const indMap = [
    [/石化|化工|炼化|油气|石油/,'石化'], [/电力|电厂|能源/,'电力'], [/水务|水处理|供水|环保/,'水处理'],
    [/冶金|钢铁|金属/,'冶金'], [/造船|船舶|船厂/,'造船'], [/油|气|储运/,'油气']
  ];
  const rgMap = [
    [/上海|江苏|浙江|华东|安徽/,'华东'], [/广东|深圳|华南|福建/,'华南'], [/山东|华北|北京|天津|河北/,'华北'],
    [/华中|湖北|湖南|河南/,'华中']
  ];
  let ind=null, rg=null;
  indMap.forEach(([re,v])=>{ if(re.test(kw) && !ind) ind=v; });
  rgMap.forEach(([re,v])=>{ if(re.test(kw) && !rg) rg=v; });
  return {ind, rg};
}

/* queries: [{kw, ind?, rg?}]  返回 RAW 数组（引擎形态） */
async function searchRaw({appkey, secret, queries}){
  const out = [];
  for(const q of queries){
    const timespan = Math.floor(Date.now()/1000);
    const token = sign(appkey, secret, timespan);
    const url = BASE + '?key=' + encodeURIComponent(appkey) + '&searchKey=' + encodeURIComponent(q.kw);
    let resp;
    try{
      resp = await getJSON(url, {'Token': token, 'Timespan': String(timespan)});
    }catch(e){ console.warn('[qcc] 请求失败', q.kw, e.message); continue; }
    const j = resp.json;
    if(!j || j.Status !== '200' || !Array.isArray(j.Result)){
      console.warn('[qcc] 无数据', q.kw, j && (j.Status + ' ' + j.Message));
      continue;
    }
    const tag = tagFromKeyword(q.kw);
    j.Result.forEach(r=>{
      if(!r.Name) return;
      const ct = {name: r.OperName || undefined, imType:'wechat'};
      out.push({
        src:'qcc', rawName: r.Name, m:'国内',
        ind: q.ind || tag.ind || null,
        rg: q.rg || tag.rg || null,
        cert:[], sig:[],
        ct,
        meta:{ qcc: {creditCode: r.CreditCode, status: r.Status, address: r.Address, keyNo: r.KeyNo} }
      });
    });
  }
  return out;
}

/* 由默认 ICP（行业+地区）生成企查查查询词 */
function buildQueries({industries=[], regions=[]}={}){
  const inds = industries.length ? industries : ['石化','电力','水处理','冶金','造船','油气'];
  const rgs  = regions.length  ? regions  : ['华东','华南','华北'];
  const kwByInd = {
    '石化':'石化工程 化工', '电力':'电厂 电力', '水处理':'自来水 水务 水处理',
    '冶金':'冶金 钢铁', '造船':'造船 船舶', '油气':'油气 储运'
  };
  const kwByRg = {'华东':'上海 江苏 浙江','华南':'广东 深圳','华北':'山东 北京 天津','华中':'湖北 湖南'};
  const qs = [];
  inds.forEach(i=>{
    const base = kwByInd[i] || i;
    (rgs.length ? rgs : [null]).forEach(rg=>{
      const kw = rg ? (base + ' ' + (kwByRg[rg]||rg)) : base;
      qs.push({kw, ind:i, rg: rg || null});
    });
  });
  return qs.slice(0, 12); // 控制调用次数
}

module.exports = {sign, searchRaw, buildQueries, tagFromKeyword, BASE};
