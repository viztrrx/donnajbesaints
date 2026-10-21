// Zero dependencies. A durable volume holds the private monitor snapshot/history.
// HTTP is intended behind an HTTPS reverse proxy. Never expose without TLS.
import http from 'node:http';
import http2 from 'node:http2';
import {createHmac, timingSafeEqual, createPrivateKey, sign} from 'node:crypto';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export function signature(secret,time,nonce,path,body) {return createHmac('sha256',secret).update(time+'\n'+nonce+'\n'+path+'\n'+body).digest('hex');}
export function createRelay(env, transport = sendAPNs) {
  if(!env.APNS_RELAY_SECRET || env.APNS_RELAY_SECRET.length<32) throw new Error('Configure a relay secret of at least 32 characters');
  if(env.MONITOR_URL) {const u=new URL(env.MONITOR_URL);if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash) throw new Error('Use a credential-free HTTPS monitor URL');}
  const seen=new Map();let jwtCache;
  function providerToken() {
    if(jwtCache && Date.now()-jwtCache.ts<3000000) return jwtCache.value;
    if(!/^[A-Z0-9]{10}$/.test(env.APNS_TEAM_ID || '') || !/^[A-Z0-9]{10}$/.test(env.APNS_KEY_ID || '') || !/^[A-Za-z0-9.-]{3,200}$/.test(env.APNS_TOPIC || '') || !env.APNS_PRIVATE_KEY) throw new Error('APNs configuration incomplete');
    const header=Buffer.from(JSON.stringify({alg:'ES256',kid:env.APNS_KEY_ID})).toString('base64url');
    const claims=Buffer.from(JSON.stringify({iss:env.APNS_TEAM_ID,iat:Math.floor(Date.now()/1000)})).toString('base64url');
    const key=createPrivateKey(env.APNS_PRIVATE_KEY.replace(/\\n/g,'\n'));
    if(key.asymmetricKeyType!=='ec' || key.asymmetricKeyDetails?.namedCurve!=='prime256v1') throw new Error('APNs requires an ES256 private key');
    const sig=sign('sha256',Buffer.from(header+'.'+claims),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
    jwtCache={ts:Date.now(),value:header+'.'+claims+'.'+sig};return jwtCache.value;
  }
  async function push(b) {
    if(!b || !/^[a-f0-9]{64,200}$/.test(b.token || '') || !['sandbox','production'].includes(b.environment) || !/^[a-f0-9-]{36}$/i.test(b.eventId || '')) return {ok:false,status:400,reason:'InvalidPayload'};
    try {return await transport({token:b.token,environment:b.environment,jwt:providerToken(),topic:env.APNS_TOPIC,eventId:b.eventId});}
    catch {return {ok:false,status:503,reason:'APNsUnavailableOrMisconfigured'};}
  }
  const snapshotPath=env.SNAPSHOT_PATH || './data/devices.json';let devices=[],history=[],writeTail=Promise.resolve();
  const ready=readFile(snapshotPath,'utf8').then(raw=>{const stored=JSON.parse(raw);devices=Array.isArray(stored)?stored:stored.devices || [];history=stored.history || [];}).catch(()=>{});
  function saveSnapshot() {writeTail=writeTail.catch(()=>{}).then(async()=>{await mkdir(dirname(snapshotPath),{recursive:true});await writeFile(snapshotPath+'.tmp',JSON.stringify({devices,history}),{mode:0o600});await rename(snapshotPath+'.tmp',snapshotPath);});return writeTail;}
  async function handler(req,res) {
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    if(req.method!=='POST' || !['/push','/devices','/events'].includes(req.url)) return reply(404,{ok:false});
    let raw='';for await (const c of req) {raw+=c;if(raw.length>16384) return reply(413,{ok:false});}
    const time=req.headers['x-relay-time'],nonce=req.headers['x-relay-nonce'],sig=req.headers['x-relay-signature'];
    for(const [n,t] of seen) if(Date.now()-t>120000) seen.delete(n);
    if(!/^\d{13}$/.test(time || '') || Math.abs(Date.now()-Number(time))>60000 || !/^[a-f0-9]{64}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(sig || '') || seen.has(nonce)) return reply(401,{ok:false});
    const expected=signature(env.APNS_RELAY_SECRET,time,nonce,req.url,raw);
    if(!timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return reply(401,{ok:false});
    seen.set(nonce,Date.now());if(seen.size>10000) return reply(429,{ok:false});
    let b;try{b=JSON.parse(raw);}catch{return reply(400,{ok:false});}
    if(!b || Array.isArray(b) || typeof b!=='object') return reply(400,{ok:false});
    if(req.url==='/events') {await ready;return reply(200,{ok:true,events:history});}
    if(req.url==='/push') {const r=await push(b);return reply(r.ok?200:r.status,r);}
    if(!Array.isArray(b.devices) || b.devices.length>20 || b.devices.some(d=>!d || ! /^[a-f0-9]{64,200}$/.test(d.token || '') || !['sandbox','production'].includes(d.environment) || !Number.isFinite(d.expiresAt))) return reply(400,{ok:false});
    await ready;devices=b.devices;
    try{await saveSnapshot();return reply(200,{ok:true});}catch{return reply(503,{ok:false});}
  }
  let failures=0,lastAlert=0,lastFailure=false;
  async function monitor() {
    if(!env.MONITOR_URL) return;
    const url=new URL(env.MONITOR_URL);if(url.protocol!=='https:') throw new Error('Monitor URL must use HTTPS');
    let healthy=false;try{const r=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'});healthy=r.ok && (await r.json()).ok===true;}catch{}
    failures=healthy?0:failures+1;
    if(failures>=3 && Date.now()-lastAlert>600000) {
      await ready;if(history.length && Date.now()-history[history.length-1].ts<600000)return;lastAlert=Date.now();lastFailure=true;
      const event={id:crypto.randomUUID(),category:'backend',severity:3,ts:Date.now(),title:'Saints Command',message:'The independent monitor could not reach the Worker.',attempts:[],pending:false};
      for(const d of devices) {
        // Snapshot becomes unusable after session expiry or 2 hours without
        // synchronization. Monitor cannot authorize a permanently cached phone.
        if(d.expiresAt<=Date.now() || !d.syncedAt || Date.now()-d.syncedAt>7200000) continue;
        const q=d.quietHours,h=new Date(Date.now()+(q?.offsetMinutes || 0)*60000).getUTCHours();
        if(q && (q.start<q.end ? h>=q.start && h<q.end : q.start>q.end && (h>=q.start || h<q.end))) continue;
        const attempt=await push({...d,eventId:event.id});event.attempts.push({device:d.id,ts:Date.now(),ok:attempt.ok,status:attempt.status,reason:attempt.reason || null});
      }
      history.push(event);history=history.filter(e=>e.ts>Date.now()-30*86400000).slice(-100);await saveSnapshot();
    }
    if(healthy && lastFailure) {lastFailure=false; /* Recovery is visible in the next health refresh. */}
  }
  return {handler,push,monitor};
}
export function sendAPNs({token,environment,jwt,topic,eventId}) {
  return new Promise((resolve,reject)=>{
    const client=http2.connect(environment==='sandbox'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com');
    let done=false;const finish=(r,e)=>{if(done)return;done=true;clearTimeout(timer);client.destroy();e?reject(e):resolve(r);};
    const timer=setTimeout(()=>finish(null,new Error('APNs timeout')),8000);
    client.on('error',e=>finish(null,e));
    const req=client.request({':method':'POST',':path':'/3/device/'+token,'content-type':'application/json',authorization:'bearer '+jwt,'apns-topic':topic,'apns-push-type':'alert','apns-priority':'10','apns-expiration':String(Math.floor(Date.now()/1000)+3600),'apns-collapse-id':eventId,'apns-id':eventId});
    let status,body='';req.on('response',h=>status=Number(h[':status']));req.on('data',c=>body+=c);req.on('error',e=>finish(null,e));
    req.on('end',()=>{let reason;try{reason=JSON.parse(body).reason;}catch{}finish({ok:status===200,status:status || 502,reason:reason || null,deliveryConfirmed:false});});
    req.end(JSON.stringify({aps:{alert:{title:'Saints Command',body:'An administrative event needs attention. Open the app to review.'},sound:'default'},eventId}));
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const relay=createRelay(process.env),server=http.createServer((req,res)=>relay.handler(req,res).catch(()=>{res.writeHead(500);res.end('{"ok":false}');}));
  server.listen(Number(process.env.PORT || 8789),process.env.BIND_ADDRESS || '127.0.0.1');
  let checking=false;setInterval(async()=>{if(checking)return;checking=true;try{await relay.monitor();}finally{checking=false;}},60000).unref();
  console.log('APNs relay listening; payloads and credentials are never logged.');
}
