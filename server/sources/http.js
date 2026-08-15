'use strict';
/* 极简 HTTPS GET/POST（零依赖），带超时与错误透传 */
const https = require('https');
const http = require('http');

function request(method, urlStr, {headers={}, body=null, timeout=12000}={}){
  return new Promise((resolve, reject)=>{
    let url;
    try{ url = new URL(urlStr); }catch(e){ return reject(new Error('bad url: '+urlStr)); }
    const lib = url.protocol === 'http:' ? http : https;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: Object.assign({'User-Agent':'Baxin-Leads/1.0'}, headers)
    };
    const req = lib.request(opts, (res)=>{
      let data='';
      res.on('data', c=> data+=c);
      res.on('end', ()=>{
        const ctype = res.headers['content-type'] || '';
        if(ctype.includes('application/json') || data.trim().startsWith('{') || data.trim().startsWith('[')){
          try{ resolve({status:res.statusCode, json: JSON.parse(data)}); }
          catch(e){ resolve({status:res.statusCode, text:data}); }
        } else {
          resolve({status:res.statusCode, text:data});
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, ()=> req.destroy(new Error('timeout after '+timeout+'ms')));
    if(body) req.write(body);
    req.end();
  });
}
function getJSON(url, headers, timeout){ return request('GET', url, {headers, timeout}); }
function postJSON(url, obj, headers, timeout){
  return request('POST', url, {headers: Object.assign({'Content-Type':'application/json'}, headers||{}),
    body: JSON.stringify(obj), timeout});
}
module.exports = {request, getJSON, postJSON};
