'use strict';
/* 真实数据源接入验证：
 *  - 单元：企查查签名、关键词打标、Hunter 公司映射
 *  - 实测：Hunter 公开测试 key 真打 API，跑通 真实API → RAW → 引擎 → 评分清单
 * 运行：node server/test_sources.js   （需先起服务或独立运行均可）
 */
const crypto = require('crypto');
const qcc = require('./sources/qcc');
const hunter = require('./sources/hunter');
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

  console.log('--- 实测：Hunter test-api-key 拉真实 API → RAW → 引擎 ---');
  process.env.HUNTER_API_KEY = 'test-api-key';
  const {raws, meta} = await sources.loadLive({industries:['石化','油气'], regions:['美国','欧洲']});
  ok(raws.length>0, '拉到 '+raws.length+' 条 hunter RAW (meta: '+JSON.stringify(meta)+')');
  ok(raws.every(x=>x.src==='hunter' && x.m==='国外'), 'RAW 形态合规 (src=hunter, market=国外)');
  ok(raws.some(x=>x.ct && x.ct.email), '至少部分 RAW 带邮箱（domain-search 补全）');

  engine.setLiveRaw(raws);
  const r2 = engine.scoreLeads({market:'国外'}, Object.assign({}, engine.SRC_ON_DEFAULT, {hunter:true}));
  ok(r2.leads.length>0, '评分清单含 '+r2.leads.length+' 条国外线索');
  const hunterLead = r2.leads.find(l=>l.srcs.includes('hunter'));
  ok(!!hunterLead, '榜单含 hunter 来源客户: '+(hunterLead? hunterLead.n : '无'));
  if(hunterLead){
    console.log('    样例客户:', hunterLead.n, '| 分', hunterLead.score, '| 源', hunterLead.srcs.join(','),
                '| 邮箱', hunterLead.ct.email||'(无)', '| 理由', hunterLead.why.join(';'));
  }

  console.log('--- 回退：无 key 时引擎仍用演示数据 ---');
  delete process.env.HUNTER_API_KEY;
  const {raws:empty} = await sources.loadLive();
  ok(empty.length === 0, '无 key → 实时 RAW = 0，回退演示');
  engine.setLiveRaw(empty);
  const r3 = engine.scoreLeads({market:'全部'}, engine.SRC_ON_DEFAULT);
  ok(r3.mergedCount === 36, '演示全量仍为 36 家 (实际 '+r3.mergedCount+')');

  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail? 1 : 0);
})().catch(e=>{ console.error('测试异常', e); process.exit(1); });
