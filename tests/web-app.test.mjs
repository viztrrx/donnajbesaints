import {readFile,readdir} from 'node:fs/promises';
import assets from '../web/assets.generated.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webApp} from '../web/handler.js';
import {payload} from '../web/public/model.js';
const base='https://fixture.example',token='a'.repeat(64);
const request=(path,{body,headers={},method}={})=>new Request(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'X-Saints-Request':'1',Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('public shell has standalone manifest and strict CSP; unknown assets and POST refused',async()=>{
 const shell=await webApp(request('/app/'),{},{});assert.equal(shell.status,200);assert.match(shell.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.match(await shell.text(),/apple-mobile-web-app-capable/);
 const m=await webApp(request('/app/manifest.webmanifest'),{},{});assert.equal((await m.json()).display,'standalone');
 assert.equal((await webApp(request('/app/nope'),{},{})).status,404);
 assert.equal((await webApp(request('/app/',{body:{}}),{},{})).status,405);
 assert.equal(await webApp(request('/mobile/health'),{},{}),null);
});
test('gateway refuses cross-origin and simple requests before dispatch',async()=>{
 for(const headers of [{Origin:'https://evil.example'},{'X-Saints-Request':''},{'Sec-Fetch-Site':'cross-site'}]){
 const r=await webApp(request('/app/api/login',{body:{ownerToken:'fixture',name:'phone'},headers}),{},{},()=>{throw Error('must not dispatch');});assert.equal(r.status,403);
 }
});
test('owner bootstrap creates scoped cookie and never returns credentials',async()=>{
 const calls=[];const dispatch=async req=>{calls.push(req);return new URL(req.url).pathname==='/admin/mobile/pair'?response({code:'b'.repeat(64)}):response({ok:true,token,device:{id:'phone',expiresAt:Date.now()+604800000}});};
 const r=await webApp(request('/app/api/login',{body:{ownerToken:'owner-fixture',name:'Phone'}}),{},{},dispatch);
 assert.equal(r.status,200);const set=r.headers.get('Set-Cookie');for(const part of ['HttpOnly','Secure','SameSite=Strict','Path=/app/api/'])assert.ok(set.includes(part));
 const text=await r.text();assert.ok(!text.includes(token));assert.ok(!text.includes('owner-fixture'));
 assert.equal(calls[0].headers.get('Authorization'),'Bearer owner-fixture');assert.equal(calls[1].headers.get('Authorization'),null);
});
test('cookie gateway uses existing admin authorization and strips CORS',async()=>{
 let called;const r=await webApp(request('/app/api/admin/overview',{headers:{Cookie:'__Secure-saints_session='+token}}),{},{},req=>{called=req;return response({ok:true});});assert.equal(r.status,200);assert.equal(called.headers.get('X-GPA-Mobile'),token);assert.equal(called.headers.get('Cookie'),null);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
 assert.equal((await webApp(request('/app/api/admin/overview'),{},{})).status,401);
 assert.equal((await webApp(request('/app/api/v1/test',{headers:{Cookie:'__Secure-saints_session='+token}}),{},{})).status,404);
});
test('expired authorization clears browser cookie; POST preserves operation ID',async()=>{
 const id=crypto.randomUUID();let called;
 const r=await webApp(request('/app/api/admin/moderate',{body:{user:'fixture',action:'warn'},headers:{Cookie:'__Secure-saints_session='+token,'X-Operation-ID':id}}),{},{},req=>{called=req;return new Response('{"error":"expired"}',{status:401});});assert.equal(called.headers.get('X-Operation-ID'),id);assert.equal(r.status,401);assert.match(r.headers.get('Set-Cookie'),/Max-Age=0/);
});
test('logout revokes own device and removes browser credential',async()=>{
 const seen=[];const r=await webApp(request('/app/api/logout',{body:{},headers:{Cookie:'__Secure-saints_session='+token}}),{},{},req=>{seen.push(req);return response(seen.length===1?{device:{id:'own-device'}}:{ok:true});});assert.equal((await r.json()).revoked,true);assert.match(r.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal((await seen[1].json()).id,'own-device');assert.ok(seen[1].headers.get('X-Operation-ID'));
});
test('action payload preserves partial updates, parses types and requires deliberate phrases',()=>{
 const op={fixed:{action:'quota'},fields:[{key:'quotaDaily',kind:'number',label:'Daily'},{key:'features',kind:'json',label:'Features'},{key:'allowedModels',kind:'array',label:'Models'}]};assert.deepEqual(payload(op,{quotaDaily:'0',features:'{"games":false}',allowedModels:'[]'}),{action:'quota',quotaDaily:0,features:{games:false},allowedModels:[]});assert.throws(()=>payload(op,{quotaDaily:'1.5'}));
 const danger={fixed:{action:'purge_memory'},fields:[],confirmation:'DELETE MEMORY',path:'/admin/danger'};assert.throws(()=>payload(danger,{}));assert.equal(payload(danger,{_confirmation:'DELETE MEMORY'}).confirm,'DELETE MEMORY');
 const restore={id:'restore',fixed:{},fields:[{key:'backup',kind:'json',required:true,label:'Backup'}]};assert.deepEqual(payload(restore,{backup:'{"config":{}}'}),{config:{}});
});

test('bundled assets match sources',async()=>{
 const dir=new URL('../web/public/',import.meta.url);for(const file of await readdir(dir)){const a=assets['/app/'+(file==='index.html'?'':file)];assert.equal(a.body,await readFile(new URL(file,dir),a.base64?'base64':'utf8'),file+' must be rebuilt');}
});
