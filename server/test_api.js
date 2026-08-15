'use strict';
const BASE = 'http://localhost:8787';
async function call(method, path, body, token){
  const opt = {method, headers:{}};
  if(token) opt.headers['Authorization'] = 'Bearer ' + token;
  if(body !== undefined && body !== null){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(body); }
  const r = await fetch(BASE+path, opt);
  const data = await r.json().catch(()=>({}));
  return {status:r.status, data};
}
(async()=>{
  let pass=0, fail=0;
  const ok=(c,m)=>{ (c?pass++:fail++); console.log((c?'PASS':'FAIL')+' '+m); };

  // 1) 公开线索
  let r = await call('GET','/api/leads?market=国内&ind=石化');
  ok(r.status===200, 'GET /api/leads 国内+石化 status=200');
  ok(r.data.mergedCount>=36, '合并企业数>=36 (实际 '+r.data.mergedCount+')');
  ok(r.data.dupRemoved>0, '去重消除重复='+r.data.dupRemoved+' 条');
  ok(r.data.leads.length>0 && r.data.leads[0].m==='国内', '命中首条为国内企业: '+(r.data.leads[0]&&r.data.leads[0].n));
  ok(r.data.leads.every(d=>d.ind==='石化'), '硬过滤生效：全部 ind=石化');
  const key = r.data.leads[0].key;
  console.log('   取样 key =', key, '| 首条分', r.data.leads[0].score);

  // 2) 注册租户 A
  r = await call('POST','/api/register',{email:'teamA@test.com',password:'aaa111'});
  ok(r.status===200 && r.data.token, '注册 teamA 拿到 token');
  const tA = r.data.token;

  // 3) 注册租户 B
  r = await call('POST','/api/register',{email:'teamB@test.com',password:'bbb222'});
  ok(r.status===200 && r.data.token, '注册 teamB 拿到 token');
  const tB = r.data.token;

  // 4) A 收藏
  r = await call('POST','/api/favorites',{key}, tA);
  ok(r.status===200 && r.data.favs.includes(key), 'A 收藏成功');
  // 5) A 读收藏
  r = await call('GET','/api/favorites',null,tA);
  ok(r.data.favs.includes(key), 'A 读取收藏含该 key');
  // 6) B 读收藏 → 必须为空（行级隔离）
  r = await call('GET','/api/favorites',null,tB);
  ok(r.data.favs.length===0, 'B 收藏为空（隔离验证）');
  // 7) A 取消收藏
  r = await call('DELETE','/api/favorites/'+encodeURIComponent(key),null,tA);
  ok(r.status===200 && !r.data.favs.includes(key), 'A 取消收藏成功');

  // 8) A 存常用 ICP
  r = await call('POST','/api/icps',{name:'石化华东',market:'国内',ind:['石化'],rg:['华东'],role:[],cert:[],sig:['招标']}, tA);
  ok(r.status===200 && r.data.icps.length===1, 'A 存常用 ICP 成功');
  // 9) B 读 ICP → 空
  r = await call('GET','/api/icps',null,tB);
  ok(r.data.icps.length===0, 'B 的 ICP 为空（隔离验证）');

  // 10) A 标记联系
  r = await call('POST','/api/contacts/'+encodeURIComponent(key),null,tA);
  ok(r.status===200 && r.data.contacts[key], 'A 标记已联系');
  // 11) B 联系记录 → 空
  r = await call('GET','/api/contacts',null,tB);
  ok(Object.keys(r.data.contacts).length===0, 'B 联系记录为空（隔离验证）');

  // 12) 演示账号登录
  r = await call('POST','/api/login',{email:'demo@valve-cn.com',password:'123456'});
  ok(r.status===200 && r.data.token, '演示账号 demo@valve-cn.com 登录成功');
  // 13) /api/me
  r = await call('GET','/api/me',null,r.data.token);
  ok(r.status===200 && r.data.tenant.email==='demo@valve-cn.com', '/api/me 返回正确租户');

  // 14) 错误密码
  r = await call('POST','/api/login',{email:'demo@valve-cn.com',password:'wrong'});
  ok(r.status===401, '错误密码被拒(401)');
  // 15) 未授权访问 favorites
  r = await call('GET','/api/favorites',null,null);
  ok(r.status===401, '无 token 访问受保护接口被拒(401)');

  console.log('\n结果: PASS='+pass+'  FAIL='+fail);
  process.exit(fail?1:0);
})();
