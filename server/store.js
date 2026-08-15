'use strict';
/* =========================================================================
 * 存储层：JSON 文件 + tenant_id 行级隔离
 * 生产环境把本文件替换为 SQLite/Postgres 即可，接口签名不变；
 * 所有读写在 JS 层强制按 tenantId 过滤，模拟数据库行级安全。
 * 数据文件：server/data.json（已在 .gitignore 排除）
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data.json');

const DEFAULTS = () => ({
  tenants: {},     // email -> {id,email,pwdHash,salt,name,market,created}
  favorites: {},   // tenantId -> [leadKey]
  icps: {},        // tenantId -> [{name,market,ind,rg,role,cert,sig}]
  contacts: {}     // tenantId -> { leadKey: date }
});

let DB = DEFAULTS();

function load(){
  try{
    if(fs.existsSync(DATA_FILE)){
      DB = Object.assign(DEFAULTS(), JSON.parse(fs.readFileSync(DATA_FILE,'utf8')));
    } else {
      persist();
    }
  }catch(e){ DB = DEFAULTS(); }
}
function persist(){
  fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2));
}

/* ---------- 密码哈希（Node 内置 scrypt，无外部依赖） ---------- */
function hashPwd(pwd, salt){
  salt = salt || crypto.randomBytes(8).toString('hex');
  const h = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return {salt, pwdHash:h};
}
function verifyPwd(pwd, salt, pwdHash){
  return crypto.scryptSync(String(pwd), salt, 32).toString('hex') === pwdHash;
}

/* ---------- 租户 / 用户 ---------- */
function getTenant(email){ return DB.tenants[String(email).toLowerCase()] || null; }
function getTenantById(id){
  for(const e in DB.tenants){ if(DB.tenants[e].id === id) return DB.tenants[e]; }
  return null;
}

function createTenant(email, pwd, name, market){
  email = String(email).toLowerCase();
  const id = 't' + (Object.keys(DB.tenants).length + 1) + '_' + email.split('@')[0].replace(/\W/g,'');
  const {salt, pwdHash} = hashPwd(pwd);
  const t = {id, email, salt, pwdHash,
             name: name || (email.split('@')[0] + ' · 新租户'),
             market: market || '全部',
             created: new Date().toISOString().slice(0,10)};
  DB.tenants[email] = t;
  DB.favorites[t.id] = DB.favorites[t.id] || [];
  DB.icps[t.id] = DB.icps[t.id] || [];
  DB.contacts[t.id] = DB.contacts[t.id] || {};
  persist();
  return t;
}

function seedDemoTenants(){
  const preset = {
    'demo@valve-cn.com': {name:'浙江精工阀门 · 国内销售团队', market:'国内'},
    'demo@valve-ex.com': {name:'宁波阀门出口部 · 外贸团队',   market:'国外'}
  };
  Object.entries(preset).forEach(([email, info])=>{
    if(!getTenant(email)) createTenant(email, '123456', info.name, info.market);
  });
}

function publicTenant(t){ return {id:t.id, email:t.email, name:t.name, market:t.market, created:t.created}; }

/* ---------- 收藏（行级隔离：只按 tenantId 读写） ---------- */
function getFavorites(tenantId){ return DB.favorites[tenantId] || []; }
function addFavorite(tenantId, key){
  if(!DB.favorites[tenantId]) DB.favorites[tenantId] = [];
  if(!DB.favorites[tenantId].includes(key)) DB.favorites[tenantId].push(key);
  persist();
}
function removeFavorite(tenantId, key){
  if(!DB.favorites[tenantId]) return;
  DB.favorites[tenantId] = DB.favorites[tenantId].filter(k => k !== key);
  persist();
}

/* ---------- 常用 ICP ---------- */
function getIcps(tenantId){ return DB.icps[tenantId] || []; }
function addIcp(tenantId, icp){
  if(!DB.icps[tenantId]) DB.icps[tenantId] = [];
  DB.icps[tenantId].push(icp); persist();
  return DB.icps[tenantId].length - 1;
}
function delIcp(tenantId, idx){
  if(!DB.icps[tenantId] || !DB.icps[tenantId][idx]) return false;
  DB.icps[tenantId].splice(idx, 1); persist(); return true;
}

/* ---------- 联系记录 ---------- */
function getContacts(tenantId){ return DB.contacts[tenantId] || {}; }
function markContact(tenantId, key){
  if(!DB.contacts[tenantId]) DB.contacts[tenantId] = {};
  DB.contacts[tenantId][key] = new Date().toISOString().slice(0,10);
  persist();
}

module.exports = {
  load, seedDemoTenants, getTenant, getTenantById, createTenant, publicTenant,
  getFavorites, addFavorite, removeFavorite,
  getIcps, addIcp, delIcp,
  getContacts, markContact
};
