import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../worker.js';
import {AdminMobileState,stateCall,digest,relayCall} from '../mobile/backend/state.js';
import {createRelay,signature} from '../mobile/apns-relay/server.mjs';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import http from 'node:http';

function fixture() {
  const kv=new Map(),data=new Map();let tail=Promise.resolve();
  const storage={async get(k){return structuredClone(data.get(k));},async put(k,v){data.set(k,structuredClone(v));},async delete(k){data.delete(k);},async setAlarm(t){storage.alarm=t;},async list({prefix='',reverse=false,limit=1000}={}){let entries=[...data].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b));if(reverse)entries.reverse();return new Map(structuredClone(entries.slice(0,limit)));}};
  const env={ADMIN_TOKEN:'a-very-long-owner-token-for-tests',OWNER:'boss',TELEMETRY:{async get(k,type){const v=kv.get(k);return v==null?null:type==='json'?JSON.parse(v):v;},async put(k,v){kv.set(k,String(v));},async delete(k){kv.delete(k);},async list({prefix='',limit=1000,cursor}={}){const keys=[...kv.keys()].filter(k=>k.startsWith(prefix)).sort(),offset=Number(cursor || 0),page=keys.slice(offset,offset+limit);return {keys:page.map(name=>({name})),list_complete:offset+limit>=keys.length,cursor:offset+limit>=keys.length?undefined:String(offset+limit)};}}};
  const state=new AdminMobileState({storage,blockConcurrencyWhile(fn){const p=tail.then(fn);tail=p.catch(()=>{});return p;}},env);
  env.ADMIN_MOBILE={idFromName:name=>name,get:()=>({fetch:(url,init)=>state.fetch(new Request(url,init))})};
  const pending=[],ctx={waitUntil:p=>pending.push(p)};
  async function call(path,{body,owner=false,token,id,headers={}}={}) {
    const res=await worker.fetch(new Request('https://test'+path,{method:body===undefined?'GET':'POST',headers:{'CF-Connecting-IP':'mobile-tests',...(owner?{Authorization:'Bearer '+env.ADMIN_TOKEN}:{}),...(token?{'X-GPA-Mobile':token}:{}),...(id?{'X-Operation-ID':id}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
    return {status:res.status,data:await res.json()};
  }
  async function pair(role='owner') {const c=await call('/admin/mobile/pair',{owner:true,body:{role}});assert.equal(c.status,200);const r=await call('/mobile/pair',{body:{code:c.data.code,name:'Test iPhone'}});assert.equal(r.status,200);return {...r.data,code:c.data.code};}
  async function settle(){while(pending.length)await pending.shift();}
  return {env,kv,data,state,call,pair,settle};
}

test('mobile: single-use pairing is atomic under concurrent redemption, scoped and expiring',async()=>{
  const f=fixture();assert.equal((await f.call('/admin/mobile/pair',{body:{}})).status,401);
  const c=await f.call('/admin/mobile/pair',{owner:true,body:{role:'moderator'}});
  const results=await Promise.all([1,2].map(()=>f.call('/mobile/pair',{body:{code:c.data.code,name:'iPhone'}})));
  assert.deepEqual(results.map(x=>x.status).sort(),[200,401]);
  const token=results.find(x=>x.status===200).data.token;
  assert.equal((await f.call('/admin/whoami',{token})).data.role,'moderator');
  assert.equal((await f.call('/admin/assignkey',{token,id:randomUUID(),body:{user:'alice',key:'sk-test'}})).status,403);
  assert.equal((await f.call('/admin/mobile/pair',{token,id:randomUUID(),body:{}})).status,403);
  const owner=await f.pair();
  assert.equal((await f.call('/admin/mobile/pair',{token:owner.token,id:randomUUID(),body:{}})).status,403);
});

test('mobile: expiry, individual revocation, master rotation and global epoch revoke sessions',async()=>{
  for(const mode of ['expired','device','master','epoch']) {
    const f=fixture(),p=await f.pair(),record=f.data.get('session:'+p.device.id);
    if(mode==='expired'){record.expiresAt=Date.now()-1;f.data.set('session:'+record.id,record);}
    if(mode==='device')assert.equal((await f.call('/admin/mobile/revoke',{owner:true,body:{id:p.device.id}})).status,200);
    if(mode==='master')f.env.ADMIN_TOKEN='rotated-owner-token';
    if(mode==='epoch')f.kv.set('config',JSON.stringify({sessionEpoch:1}));
    assert.equal((await f.call('/admin/whoami',{token:p.token})).status,401);
  }
});
test('mobile: every admin route denies unauthenticated requests; unknown routes deny by default',async()=>{
  const source=await readFile(new URL('../worker.js',import.meta.url),'utf8');
  const map=source.slice(source.indexOf('const ADMIN_ROUTES ='),source.indexOf("if (url.pathname === '/mobile/health'"));
  const routes=[...map.matchAll(/'(\/admin\/[^']+)'\s*:\s*\{\s*method:\s*'(GET|POST)'/g)];assert.ok(routes.length>=35);
  for(const [,path,method] of routes) {const f=fixture();assert.equal((await f.call(path,{body:method==='POST'?{}:undefined})).status,401,path);}
  assert.equal((await fixture().call('/admin/mobile/unknown',{owner:true})).status,404);
});
test('mobile: mutations require IDs and duplicates execute once; body collisions fail',async()=>{
  const f=fixture(),p=await f.pair(),id=randomUUID(),body={user:'alice',action:'warn'};
  assert.equal((await f.call('/admin/moderate',{token:p.token,body})).status,400);
  const results=await Promise.all([1,2].map(()=>f.call('/admin/moderate',{token:p.token,id,body})));
  assert.ok(results.every(r=>[200,409].includes(r.status)));
  assert.equal(JSON.parse(f.kv.get('mod:alice')).strikes,1);
  assert.equal((await f.call('/admin/moderate',{token:p.token,id,body})).status,200);
  assert.equal(JSON.parse(f.kv.get('mod:alice')).strikes,1);
  assert.equal((await f.call('/admin/moderate',{token:p.token,id,body:{...body,action:'block'}})).status,409);
  const state=await f.call('/admin/mobile/operation?id='+id,{token:p.token});assert.equal(state.data.operation.state,'completed');
  assert.equal((await f.call('/admin/config',{token:p.token,id:randomUUID(),body:{dailyQuota:8}})).status,200);
  assert.equal(JSON.parse(f.kv.get('config')).dailyQuota,8);
  const key='sk-test-new-private-user-key';
  const assigned=await f.call('/admin/assignkey',{token:p.token,id:randomUUID(),body:{user:'alice',key}});assert.equal(assigned.status,200);assert.ok(!JSON.stringify(assigned.data).includes(key));
  assert.ok(!JSON.stringify((await f.call('/admin/keys',{token:p.token})).data).includes(key));
  assert.ok([...f.kv.entries()].some(([k,v])=>k.startsWith('audit:') && JSON.parse(v).action==='assign'));
});
test('mobile: another administrator cannot revoke or hijack device registration',async()=>{
  const f=fixture(),a=await f.pair('moderator'),b=await f.pair('admin'),token='f'.repeat(64);
  assert.equal((await f.call('/admin/mobile/register',{token:a.token,id:randomUUID(),body:{token,environment:'sandbox'}})).status,200);
  assert.equal((await f.call('/admin/mobile/register',{token:b.token,id:randomUUID(),body:{token,environment:'sandbox'}})).status,409);
  assert.equal((await f.call('/admin/mobile/revoke',{token:b.token,id:randomUUID(),body:{id:a.device.id}})).status,404);
  assert.equal((await f.call('/admin/mobile/devices',{token:b.token})).data.devices.length,1);
  assert.equal((await f.call('/admin/mobile/register',{token:a.token,id:randomUUID(),body:{token:'bad',environment:'sandbox'}})).status,400);
  assert.equal((await f.call('/admin/mobile/preferences',{token:a.token,id:randomUUID(),body:{categories:['arbitrary'],minimumSeverity:2}})).status,400);
  assert.equal((await f.call('/admin/mobile/preferences',{token:a.token,id:randomUUID(),body:{categories:['moderation'],minimumSeverity:2,quietHours:{start:22,end:7,offsetMinutes:-240}}})).status,200);
  const test=await f.call('/admin/mobile/test',{token:a.token,id:randomUUID(),body:{}});assert.equal(test.status,502);assert.equal(test.data.accepted,false);assert.equal(test.data.deliveryConfirmed,false);
  assert.equal((await f.call('/admin/mobile/register',{token:a.token,id:randomUUID(),body:{remove:true}})).status,200);
});
test('mobile: alert cooldown, role privacy, delivery failure and invalid tokens',async()=>{
  const f=fixture(),p=await f.pair(),m=await f.pair('moderator');
  await f.call('/admin/mobile/register',{token:p.token,id:randomUUID(),body:{token:'f'.repeat(64),environment:'sandbox'}});
  const a=await stateCall(f.env,'event',{category:'security',severity:3,dedupe:'test'});
  const b=await stateCall(f.env,'event',{category:'security',severity:3,dedupe:'test'});assert.ok(a.id);assert.equal(b.suppressed,true);
  assert.equal((await f.call('/admin/mobile/inbox',{token:m.token})).data.events.filter(e=>e.category==='security').length,0);
  const real=globalThis.fetch;f.env.APNS_RELAY_URL='https://relay.test';f.env.APNS_RELAY_SECRET='shared-secure-test-secret'.repeat(3);
  globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).endsWith('/push')?{ok:false,status:410,reason:'Unregistered'}:{ok:true}),{status:String(url).endsWith('/push')?410:200,headers:{'Content-Type':'application/json'}});
  try{await f.settle();await f.state.alarm();assert.equal(f.data.get('session:'+p.device.id).push,undefined);const events=await f.call('/admin/mobile/inbox',{token:p.token});assert.ok(events.data.events.some(e=>e.attempts.some(a=>a.status===410)));}finally{globalThis.fetch=real;}
});
test('mobile: missing binding fails safely while the web admin API remains usable',async()=>{
  const f=fixture();delete f.env.ADMIN_MOBILE;
  assert.equal((await f.call('/admin/mobile/pair',{owner:true,body:{}})).status,503);
  assert.equal((await f.call('/admin/whoami',{owner:true})).status,200);
  assert.equal((await f.call('/mobile/health')).status,200);
});
test('APNs relay: missing credentials fail; authenticated transport distinguishes acceptance',async()=>{
  const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const base={APNS_RELAY_SECRET:'secret'.repeat(12),APNS_TEAM_ID:'ABCDEFGHIJ',APNS_KEY_ID:'1234567890',APNS_TOPIC:'com.viztrrx.SaintsCommand',APNS_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}),SNAPSHOT_PATH:'/tmp/saints-relay-test-'+randomUUID()+'.json'};
  let sent;
  const relay=createRelay(base,async r=>{sent=r;return {ok:true,status:200,deliveryConfirmed:false};});
  const payload={token:'f'.repeat(64),environment:'sandbox',eventId:randomUUID()};
  assert.equal((await relay.push(payload)).ok,true);assert.equal(sent.jwt.split('.').length,3);assert.equal(sent.topic,base.APNS_TOPIC);
  assert.equal((await createRelay({...base,APNS_PRIVATE_KEY:''}).push(payload)).ok,false);
  const server=http.createServer((req,res)=>relay.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const url='http://127.0.0.1:'+server.address().port+'/push',body=JSON.stringify(payload),time=String(Date.now()),nonce='a'.repeat(64),sig=signature(base.APNS_RELAY_SECRET,time,nonce,'/push',body);
    assert.equal((await fetch(url,{method:'POST',body})).status,401);
    const headers={'X-Relay-Time':time,'X-Relay-Nonce':nonce,'X-Relay-Signature':sig};
    assert.equal((await fetch(url,{method:'POST',headers,body})).status,200);
    assert.equal((await fetch(url,{method:'POST',headers,body})).status,401);
  }finally{server.close();}
});

test('mobile: account-backed owner pairing invalidates on account disable or epoch change',async()=>{
  const f=fixture();f.env.OWNER_CODE='owner-proof-fixture';
  const registered=await f.call('/auth/register',{headers:{'X-GPA-Owner':'owner-proof-fixture'},body:{user:'boss',verifier:'1'.repeat(64)}});assert.equal(registered.status,200);
  const c=await f.call('/admin/mobile/pair',{headers:{'X-GPA-Session':registered.data.token},body:{role:'admin'}});assert.equal(c.status,200);
  const p=await f.call('/mobile/pair',{body:{code:c.data.code,name:'account phone'}});assert.equal(p.status,200);
  assert.equal((await f.call('/admin/whoami',{token:p.data.token})).data.role,'admin');
  assert.equal((await f.call('/admin/config',{token:p.data.token,id:randomUUID(),body:{dailyQuota:1}})).status,403);
  const acct=JSON.parse(f.kv.get('acct:boss'));acct.epoch++;f.kv.set('acct:boss',JSON.stringify(acct));
  assert.equal((await f.call('/admin/whoami',{token:p.data.token})).status,401);
});
test('mobile: pairing codes expire and unknown operation outcomes stay reserved',async()=>{
  const f=fixture(),c=await f.call('/admin/mobile/pair',{owner:true,body:{}});
  const key='pair:'+await digest(c.data.code),record=f.data.get(key);record.expiresAt=Date.now()-1;f.data.set(key,record);
  assert.equal((await f.call('/mobile/pair',{body:{code:c.data.code,name:'expired'}})).status,401);
  const p=await f.pair(),id=randomUUID(),body={user:'alice',action:'warn'},fingerprint=await digest('/admin/moderate\n'+JSON.stringify(body));
  await stateCall(f.env,'operation-begin',{sid:p.device.id,id,fingerprint});
  assert.equal((await f.call('/admin/moderate',{token:p.token,id,body})).status,409);assert.equal(f.kv.has('mod:alice'),false);
  assert.equal((await f.call('/admin/mobile/operation?id='+id,{token:p.token})).data.operation.state,'running');
});

test('mobile: request types and memory privacy reason are validated server-side',async()=>{
  const f=fixture(),p=await f.pair();
  assert.equal((await f.call('/mobile/pair',{body:null})).status,400);
  for(const body of [null,[],{features:{quiz:'no'}},{dailyQuota:-2},{allowedModels:'gpt-5'},{requireSessions:'false'}])assert.equal((await f.call('/admin/config',{token:p.token,id:randomUUID(),body})).status,400);
  assert.equal((await f.call('/admin/memory/user',{token:p.token,id:randomUUID(),body:{u:'alice',reason:''}})).status,400);
  assert.equal((await f.call('/admin/memory/user',{token:p.token,id:randomUUID(),body:{u:'alice',reason:'Investigating a user support request'}})).status,200);
});
test('APNs relay: independent monitoring persists generic history and honors a cooldown',async()=>{
  const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const env={APNS_RELAY_SECRET:'secret'.repeat(12),APNS_TEAM_ID:'ABCDEFGHIJ',APNS_KEY_ID:'1234567890',APNS_TOPIC:'com.viztrrx.SaintsCommand',APNS_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}),SNAPSHOT_PATH:'/tmp/saints-monitor-'+randomUUID()+'.json',MONITOR_URL:'https://worker.test/mobile/health'};
  let pushes=0;const relay=createRelay(env,async()=>{pushes++;return {ok:true,status:200};});
  const server=http.createServer((req,res)=>relay.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  async function call(path,payload){const body=JSON.stringify(payload),time=String(Date.now()),nonce=await digest(randomUUID());const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'X-Relay-Time':time,'X-Relay-Nonce':nonce,'X-Relay-Signature':signature(env.APNS_RELAY_SECRET,time,nonce,path,body)},body});return {status:r.status,data:await r.json()};}
  try {
    assert.equal((await call('/devices',{devices:[{id:randomUUID(),token:'f'.repeat(64),environment:'sandbox',expiresAt:Date.now()+3600000,syncedAt:Date.now()}]})).status,200);
    const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{"ok":false}',{status:503});
    try{for(let i=0;i<8;i++)await relay.monitor();}finally{globalThis.fetch=original;}
    assert.equal(pushes,1);const events=(await call('/events',{})).data.events;assert.equal(events.length,1);assert.equal(events[0].attempts[0].ok,true);assert.ok(!JSON.stringify(events).includes('f'.repeat(64)));
    const restarted=createRelay(env,async()=>{pushes++;return {ok:true,status:200};});globalThis.fetch=async()=>new Response('{"ok":false}',{status:503});
    try{for(let i=0;i<3;i++)await restarted.monitor();}finally{globalThis.fetch=original;}
    assert.equal(pushes,1);
  }finally{server.close();const {rm}=await import('node:fs/promises');await rm(env.SNAPSHOT_PATH,{force:true});}
});
