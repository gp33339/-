'use strict';
/* 真实数据源接入验证：
 *  - 单元：企查查签名、关键词打标、Hunter 公司映射、海关查询构建
 *  - 实测：Hunter 公开测试 key 真打 API；海关内置演示样本真跑引擎评分
 * 运行：node server/test_sources.js
 */
const crypto = require('crypto');
const qcc = require('./sources/qcc');
const hunter = require('./sources/hunter');
const customs = require('./sources/customs');
const sources = require('./sources');
const engine = require('./engine');

let pass=0, fail=0;
function ok(c, m){ if(c){ pass++; console.log('  ✓ '+m); } else { fail++; console.log('  ✗ '+m); } }

(async ()=>{
  console.log('--- 单元：企查查签名 ---');
  const s = qcc.sign('a','b','c');            // 公式 MD5(key+Timespan+SecretKey) = md5('a'+'c'+'b')
  const expected = crypto.createHash('md5').update('acb').digest('hex').toUpperCase();
  ok(s === expected, 'MD5(key+Timespan+SecretKey) 大写 = '+s);
  ok(/^[0-9A-F]{32}$/.test(s), '签名为 32 位大写十六进制');

  console.log('--- 单元：企查查关键词打标 ---');
  ok(qcc.tagFromKeyword('石化工程 上海 江苏 浙江').ind === '石化', '石化工程 → 行业=石化');
  ok(qcc.tagFromKeyword('石化工程 上海 江苏 浙江').rg === '华东', '上海 → 地区=华东');
  ok(qcc.tagFromKeyword('电厂 广东').rg === '华南', '广东 → 地区=华南');

  console.log('--- 单元：Hunter 公司映射 ---');
  const r = hunter.mapCompanyToRaw({name:'Acme Oil GmbH', domain:'acme-oil.de', industry:'oil_and_gas', location:{code:'DE'}});
  ok(r && r.src==='hunter' && r.m==='国外', '映射 src/market 正确');
  ok(r.ind==='油气' && r.rg==='欧洲', 'ind=油气, rg=欧洲 (DE)');
  ok(r.meta.hunter.domain==='acme-oil.de', '保留 domain 到 meta');

  console.log('--- 单元：海关查询构建（HS 编码 / 目的国） ---');
  const cq = customs.buildQueries({industries:['油气','石化'], regions:['中东','欧洲']});
  ok(cq.hsCode==='8481', '阀门行业→HS 8481 (实际 '+cq.hsCode+')');
  ok(cq.cc.includes('AE') && cq.cc.includes('DE'), '地区→目的国代码 含 AE(中东)/DE(欧洲)');
  const cr = customs.mapRecordToRaw({importer:'Gulf Petrovalve FZE', hsCode:'8481', productDesc:'ball valve', cc:'AE', ind:'油气', rg:'中东', supplier:'X', importCount:12, lastDate:'2026-05'});
  ok(cr.src==='customs' && cr.m==='国外' && cr.role==='Importer', 'RAW src/market/role 正确');
  ok(cr.sig.includes('海关进口'), 'sig 含「海关进口」(引擎加权 +25)');

  console.log('--- 实测：Hunter test-api-key 拉真实 API → RAW → 引擎 ---');
  process.env.HUNTER_API_KEY = 'test-api-key';
  const {raws, meta} = await sources.loadLive({industries:['石化','油气'], regions:['美国','欧洲']});
  ok(raws.length>0, '拉到 '+raws.length+' 条实时 RAW (meta: '+JSON.stringify(meta)+')');
  ok(raws.filter(x=>x.src==='hunter').length>0, '含 hunter RAW');
  ok(raws.some(x=>x.src==='hunter' && x.ct && x.ct.email), 'hunter RAW 带邮箱（domain-search 补全）');

  const cRaw = raws.filter(x=>x.src==='customs');
  ok(cRaw.length>0, '含 customs 演示 RAW '+cRaw.length+' 条 (默认演示态)');
  const custMeta = meta.find(m=>m.id==='customs');
  ok(custMeta && custMeta.st==='演示' && custMeta.companies===cRaw.length, 'customs 演示态上报 companies='+cRaw.length);

  engine.setLiveRaw(raws);
  const r2 = engine.scoreLeads({market:'国外', sig:['海关进口']},
                                Object.assign({}, engine.SRC_ON_DEFAULT, {hunter:true, customs:true}));
  ok(r2.leads.length>0, '按「海关进口」信号筛选命中 '+r2.leads.length+' 条');
  const top = r2.leads[0];
  ok(top && top.sig.includes('海关进口'), '命中客户均带海关进口信号: '+(top?top.n:'无'));
  ok(top && top.score>=65, '海关进口信号带来 +25 加权 (top 分 '+(top&&top.score)+')');
  if(top) console.log('    海关进口商样例(top):', top.n, '| 分', top.score, '| 地区', top.rg,
    '| 进口次数', (top.meta&&top.meta.customs&&top.meta.customs.importCount),
    '| 供应商', (top.meta&&top.meta.customs&&top.meta.customs.supplier));

  const rH = engine.scoreLeads({market:'国外'}, Object.assign({}, engine.SRC_ON_DEFAULT, {hunter:true}));
  const hl = rH.leads.find(l=>l.srcs.includes('hunter'));
  ok(!!hl, '榜单含 hunter 来源客户: '+(hl? hl.n : '无'));
  if(hl) console.log('    hunter 客户:', hl.n, '| 分', hl.score, '| 邮箱', hl.ct.email||'(无)');

  console.log('--- 回退：无 qcc/hunter key 时其不拉，customs 跑演示样本 ---');
  delete process.env.HUNTER_API_KEY;
  const {raws:fb, meta:fm} = await sources.loadLive();
  ok(fb.filter(x=>x.src==='qcc'||x.src==='hunter').length===0, '无 qcc/hunter key → 其 RAW=0');
  ok(fb.filter(x=>x.src==='customs').length>0, 'customs 演示样本仍注入 '+fb.filter(x=>x.src==='customs').length+' 条');
  const cm2 = fm.find(m=>m.id==='customs');
  ok(cm2 && cm2.st==='演示', 'customs 状态=演示');

  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail? 1 : 0);
})().catch(e=>{ console.error('测试异常', e); process.exit(1); });
