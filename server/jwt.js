'use strict';
/* 极简 JWT（HS256），仅用 Node 内置 crypto，无外部依赖 */
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'bx3-dev-secret-change-me';
const B64 = s => Buffer.from(s).toString('base64url');
const B64D = s => Buffer.from(s, 'base64url').toString('utf8');

function sign(payload, expSec){
  const header = {alg:'HS256', typ:'JWT'};
  const body = Object.assign({}, payload, {exp: Math.floor(Date.now()/1000) + (expSec||60*60*24*7)});
  const data = B64(JSON.stringify(header)) + '.' + B64(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}
function verify(token){
  if(!token || token.split('.').length !== 3) return null;
  const [h, b, s] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(h + '.' + b).digest('base64url');
  if(expect !== s) return null;
  const body = JSON.parse(B64D(b));
  if(body.exp && body.exp < Math.floor(Date.now()/1000)) return null;
  return body;
}

module.exports = {sign, verify};
