'use strict';
/* =========================================================================
 * 靶心 · 后端 SaaS 骨架（零依赖 Node http 服务）
 * - 登录鉴权：/api/register, /api/login → JWT
 * - 多租户行级隔离：收藏/常用ICP/联系记录按 tenant_id 隔离
 * - 精准引擎：/api/leads（ICP 参数 → 评分清单，公开只读）
 * - 静态托管：../mvp/index.html（改造后的 API 驱动前端）
 * 运行：node server/index.js   （默认端口 8787，可用 PORT 覆盖）
 * ========================================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const store = require('./store');
const jwt = require('./jwt');
const engine = require('./engine');

const PORT = process.env.PORT || 8787;
const MVP_DIR = path.join(__dirname, '..', 'mvp');
const PUBLIC = path.join(__dirname, '..');

store.load();
store.seedDemoTenants();

/* ---------- 工具 ---------- */
function send(res, code, obj){
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}
function readBody(req){
  return new Promise((resolve)=>{
    let d=''; req.on('data', c=>d+=c); req.on('end', ()=>{
      try{ resolve(d?JSON.parse(d):{}); }catch(e){ resolve({}); }
    });
  });
}
function auth(req){
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if(!m) return null;
  const body = jwt.verify(m[1]);
  return body ? body.tid : null;   // tenant id
}
function qlist(q, key){
  const v = q[key];
  if(!v) return [];
  return Array.isArray(v) ? v : v.split(',').filter(Boolean);
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res)=>{
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method.toUpperCase();

  try{
    /* ===== 静态文件（前端） ===== */
    if(method === 'GET' && (pathname === '/' || pathname.startsWith('/mvp/'))){
      let fp = pathname === '/' ? path.join(MVP_DIR,'index.html') : path.join(PUBLIC, pathname);
      fp = path.normalize(fp);
      if(!fp.startsWith(PUBLIC)){ send(res, 403, {error:'forbidden'}); return; }
      if(fs.existsSync(fp) && fs.statSync(fp).isFile()){
        const ext = path.extname(fp);
        const ct = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.csv':'text/csv'}[ext] || 'application/octet-stream';
        res.writeHead(200, {'Content-Type':ct+'; charset=utf-8'});
        fs.createReadStream(fp).pipe(res);
        return;
      }
      send(res, 404, {error:'not found'});
      return;
    }

    /* ===== 鉴权：注册 / 登录 ===== */
    if(pathname === '/api/register' && method === 'POST'){
      const b = await readBody(req);
      const email = (b.email||'').trim().toLowerCase();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, {error:'邮箱格式不正确'});
      if(!b.password) return send(res, 400, {error:'请设置密码'});
      if(store.getTenant(email)) return send(res, 409, {error:'该账号已存在，请直接登录'});
      const t = store.createTenant(email, b.password, b.name, b.market);
      const token = jwt.sign({tid:t.id, email:t.email});
      return send(res, 200, {token, tenant: store.publicTenant(t)});
    }

    if(pathname === '/api/login' && method === 'POST'){
      const b = await readBody(req);
      const email = (b.email||'').trim().toLowerCase();
      const t = store.getTenant(email);
      if(!t) return send(res, 401, {error:'账号不存在，请先注册或用演示账号'});
      if(!verifyLocal(email, b.password)) return send(res, 401, {error:'密码不正确'});
      const token = jwt.sign({tid:t.id, email:t.email});
      return send(res, 200, {token, tenant: store.publicTenant(t)});
    }

    /* ===== 需登录的接口 ===== */
    const tid = auth(req);
    if(!tid && pathname.startsWith('/api/') && pathname !== '/api/leads'){
      return send(res, 401, {error:'未登录'});
    }

    if(pathname === '/api/me' && method === 'GET'){
      const tenant = store.getTenantById(tid);
      if(!tenant) return send(res, 401, {error:'无效会话'});
      return send(res, 200, {tenant: store.publicTenant(tenant)});
    }

    /* ===== 线索（公开只读，任何人可查） ===== */
    if(pathname === '/api/leads' && method === 'GET'){
      const q = parsed.query;
      const icp = {
        market: q.market || '全部',
        ind: qlist(q,'ind'),
        rg: qlist(q,'rg'),
        role: qlist(q,'role'),
        cert: qlist(q,'cert'),
        sig: qlist(q,'sig')
      };
      const srcOn = Object.assign({}, engine.SRC_ON_DEFAULT);
      Object.keys(srcOn).forEach(k=>{ if(q['src_'+k]==='0') srcOn[k]=false; if(q['src_'+k]==='1') srcOn[k]=true; });
      const r = engine.scoreLeads(icp, srcOn);
      return send(res, 200, {
        sources: engine.SOURCES.map(s=>({id:s.id, nm:s.nm, mkt:s.mkt, st:s.st, on:!!srcOn[s.id]})),
        rawCount: r.rawCount, mergedCount: r.mergedCount, dupRemoved: r.dupRemoved,
        leads: r.leads
      });
    }

    /* ===== 收藏 ===== */
    if(pathname === '/api/favorites' && method === 'GET'){
      return send(res, 200, {favs: store.getFavorites(tid)});
    }
    if(pathname === '/api/favorites' && method === 'POST'){
      const b = await readBody(req);
      if(!b.key) return send(res, 400, {error:'缺 key'});
      store.addFavorite(tid, b.key);
      return send(res, 200, {favs: store.getFavorites(tid)});
    }
    const fm = pathname.match(/^\/api\/favorites\/(.+)$/);
    if(fm && method === 'DELETE'){
      store.removeFavorite(tid, decodeURIComponent(fm[1]));
      return send(res, 200, {favs: store.getFavorites(tid)});
    }

    /* ===== 常用 ICP ===== */
    if(pathname === '/api/icps' && method === 'GET'){
      return send(res, 200, {icps: store.getIcps(tid)});
    }
    if(pathname === '/api/icps' && method === 'POST'){
      const b = await readBody(req);
      if(!b.name) return send(res, 400, {error:'缺 name'});
      const idx = store.addIcp(tid, b);
      return send(res, 200, {icps: store.getIcps(tid), idx});
    }
    const im = pathname.match(/^\/api\/icps\/(\d+)$/);
    if(im && method === 'DELETE'){
      store.delIcp(tid, +im[1]);
      return send(res, 200, {icps: store.getIcps(tid)});
    }

    /* ===== 联系记录 ===== */
    if(pathname === '/api/contacts' && method === 'GET'){
      return send(res, 200, {contacts: store.getContacts(tid)});
    }
    const cm = pathname.match(/^\/api\/contacts\/(.+)$/);
    if(cm && method === 'POST'){
      store.markContact(tid, decodeURIComponent(cm[1]));
      return send(res, 200, {contacts: store.getContacts(tid)});
    }

    send(res, 404, {error:'unknown route'});
  }catch(e){
    console.error(e);
    send(res, 500, {error:'server error', detail: String(e && e.message || e)});
  }
});

/* 本地密码校验（演示账号 + 注册用户） */
function verifyLocal(email, pwd){
  const t = store.getTenant(email);
  if(!t) return false;
  if(email.startsWith('demo@') && pwd === '123456') return true;
  const crypto = require('crypto');
  const h = crypto.scryptSync(String(pwd), t.salt, 32).toString('hex');
  return h === t.pwdHash;
}

server.listen(PORT, ()=>{
  console.log('靶心 SaaS 后端已启动: http://localhost:' + PORT);
  console.log('演示账号: demo@valve-cn.com / demo@valve-ex.com  密码 123456');
});
