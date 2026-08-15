'use strict';
/* =========================================================================
 * 数据源编排器（真实数据源的总开关）
 * - 读环境变量判断哪些源已配置（有 key 即"真实"态）
 * - loadLive() 拉取所有已配置源的 RAW，注入引擎；任一源失败不影响其他源
 * - 未配置任何 key 时返回空数组，引擎自动回退到演示 SEED 投影
 *
 * 环境变量：
 *   QCC_APPKEY / QCC_SECRET   企查查开放平台
 *   HUNTER_API_KEY            Hunter.io（填 'test-api-key' 可零成本验证链路）
 *   ENRICH_EMAILS=1           真 key 下对 discover 命中的公司再补全邮箱（耗额度）
 *   CUSTOMS_API_KEY          海关数据 API（腾道等）；留空则使用内置阀门进口商演示样本
 *   CUSTOMS_API_BASE         海关 API 基址（签合同后填真实 endpoint）
 *   TENDER_LIVE=1            启用招投标真实聚合（默认演示样本；公开数据须守 robots/低频）
 * ========================================================================= */
const qcc = require('./qcc');
const hunter = require('./hunter');
const customs = require('./customs');
const tender = require('./tender');

function configured(){
  const list = [];
  if(process.env.QCC_APPKEY && process.env.QCC_SECRET) list.push({id:'qcc', st:'真实'});
  if(process.env.HUNTER_API_KEY) list.push({id:'hunter', st: process.env.HUNTER_API_KEY==='test-api-key' ? '测试key' : '真实'});
  // 海关：有 key 为真实；无 key 默认跑内置演示样本（默认演示，让用户立即看到最强信号）
  list.push({id:'customs', st: process.env.CUSTOMS_API_KEY ? '真实' : '演示'});
  // 招投标：公开免费数据，默认演示样本（带采购人电话）；TENDER_LIVE=1 启用真实聚合
  // 注意：引擎 SOURCES 中招投标源 id 为 'bid'，此处须保持一致以便前端透出状态
  list.push({id:'bid', st: process.env.TENDER_LIVE ? '真实' : '演示'});
  return list;
}

async function loadLive({industries=[], regions=[]}={}){
  const raws = [];
  const meta = [];
  const cfg = configured();

  const qccCfg = cfg.find(c=>c.id==='qcc');
  if(qccCfg){
    try{
      const queries = qcc.buildQueries({industries, regions});
      const r = await qcc.searchRaw({appkey:process.env.QCC_APPKEY, secret:process.env.QCC_SECRET, queries});
      raws.push(...r);
      meta.push({id:'qcc', st:'真实', pulled:queries.length, companies:r.length});
    }catch(e){ meta.push({id:'qcc', st:'错误', error:String(e.message)}); }
  }

  const hunterCfg = cfg.find(c=>c.id==='hunter');
  if(hunterCfg){
    try{
      const r = await hunter.discoverRaw({
        apiKey: process.env.HUNTER_API_KEY,
        industries, regions,
        enrich: process.env.ENRICH_EMAILS === '1'
      });
      raws.push(...r);
      meta.push({id:'hunter', st:hunterCfg.st, companies:r.length});
    }catch(e){ meta.push({id:'hunter', st:'错误', error:String(e.message)}); }
  }

  const customsCfg = cfg.find(c=>c.id==='customs');
  if(customsCfg){
    try{
      const r = await customs.fetchRaw({
        apiKey: process.env.CUSTOMS_API_KEY,
        apiBase: process.env.CUSTOMS_API_BASE,
        industries, regions,
        demo: !process.env.CUSTOMS_API_KEY
      });
      raws.push(...r);
      meta.push({id:'customs', st:customsCfg.st, companies:r.length});
    }catch(e){ meta.push({id:'customs', st:'错误', error:String(e.message)}); }
  }

  const tenderCfg = cfg.find(c=>c.id==='bid');
  if(tenderCfg){
    try{
      const r = await tender.fetchRaw({ industries, regions, live: !!process.env.TENDER_LIVE });
      raws.push(...r);
      meta.push({id:'bid', st:tenderCfg.st, companies:r.length});
    }catch(e){ meta.push({id:'bid', st:'错误', error:String(e.message)}); }
  }

  return {raws, meta, configured: cfg};
}

module.exports = {configured, loadLive};
