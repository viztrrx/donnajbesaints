// Additive mobile state. Strong consistency is required: KV cannot consume a
// pairing code or reserve an operation exactly once across Cloudflare edges.
export const CATEGORIES = ['backend', 'ai', 'usage', 'security', 'moderation', 'sessions', 'audit', 'jobs'];
export const SESSION_LIFETIME = 7 * 86400000;
const enc = new TextEncoder();
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function randomToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join(''); }
export const result = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json', 'Cache-Control':'no-store'}});
export async function stateCall(env, action, body = {}) {
  if (!env.ADMIN_MOBILE) throw new Error('Mobile state binding not configured');
  const res = await env.ADMIN_MOBILE.get(env.ADMIN_MOBILE.idFromName('admin-mobile-v1')).fetch('https://state/' + action, {method:'POST', body:JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) { const error = new Error(data.error || 'Mobile state unavailable'); error.status = res.status; throw error; }
  return data;
}
export function safeDevice(s) { return {id:s.id, name:s.name, actor:s.actor, role:s.role, perms:s.perms, createdAt:s.createdAt, expiresAt:s.expiresAt, revoked:!!s.revoked, notifications:!!s.push, preferences:s.preferences}; }
export function preferences(body) {
  if(!body || typeof body!=='object') throw Object.assign(new Error('Invalid notification preferences'),{status:400});
  const categories = body.categories;
  if (!Array.isArray(categories) || categories.some(x => !CATEGORIES.includes(x)) || ![1,2,3].includes(body.minimumSeverity)) throw Object.assign(new Error('Invalid notification preferences'), {status:400});
  const q = body.quietHours;
  if (q != null && (!Number.isInteger(q.start) || !Number.isInteger(q.end) || q.start<0 || q.start>23 || q.end<0 || q.end>23 || !Number.isInteger(q.offsetMinutes) || Math.abs(q.offsetMinutes)>840)) throw Object.assign(new Error('Invalid quiet hours'), {status:400});
  return {categories:[...new Set(categories)], minimumSeverity:body.minimumSeverity, quietHours:q || null};
}
export async function validSource(env, s) {
  if (!s || s.revoked || s.expiresAt <= Date.now() || await digest(String(env.ADMIN_TOKEN || '')) !== s.generation) return false;
  const cfg = await env.TELEMETRY.get('config','json') || {};
  if ((cfg.sessionEpoch || 0) !== s.globalEpoch) return false;
  if (s.sourceUser) {
    const a = await env.TELEMETRY.get('acct:' + s.sourceUser.toLowerCase(),'json');
    if (!a || a.disabled || (a.epoch || 0) !== s.accountEpoch) return false;
    const role = a.ownerVerified && a.user.toLowerCase() === String(env.OWNER || 'viztrrx').toLowerCase() ? 'owner' : a.role;
    if (role !== s.sourceRole) return false;
  }
  return true;
}
export async function relayCall(env, path, payload) {
  if (!env.APNS_RELAY_URL || !env.APNS_RELAY_SECRET) return {ok:false, error:'APNs relay not configured', status:503};
  const url = new URL(env.APNS_RELAY_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return {ok:false, error:'Invalid relay configuration', status:503};
  url.pathname = path;
  const body = JSON.stringify(payload), ts = String(Date.now()), nonce = randomToken();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.APNS_RELAY_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(ts+'\n'+nonce+'\n'+path+'\n'+body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  try {
    const res = await fetch(url, {method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Relay-Time':ts,'X-Relay-Nonce':nonce,'X-Relay-Signature':sig},body, signal:AbortSignal.timeout(8000)});
    const data = await res.json(); return {...data,status:res.status,ok:res.ok && data.ok === true};
  } catch { return {ok:false,status:502,error:'APNs relay unreachable; acceptance unknown'}; }
}

export class AdminMobileState {
  constructor(ctx, env) { this.ctx=ctx; this.storage=ctx.storage; this.env=env; }
  async fetch(req) {
    try { return await this.ctx.blockConcurrencyWhile(async () => {
      const b = await req.json(), action = new URL(req.url).pathname.slice(1), now=Date.now();
      const get = key => this.storage.get(key), put=(key,val)=>this.storage.put(key,val);
      if (action==='pair-create') {
        const active=await this.storage.list({prefix:'pair:'});
        for(const [k,v] of active) if(v.expiresAt<now) await this.storage.delete(k);
        if((await this.storage.list({prefix:'pair:'})).size>=10) return result({error:'Too many outstanding pairings'},429);
        await put('pair:'+b.hash,b.record); await this.storage.setAlarm(now+60000); return result({ok:true});
      }
      if (action==='pair-redeem') {
        const ipkey='attempt:'+b.ip, rate=await get(ipkey) || {n:0,until:now+900000};
        if(rate.until<now) {rate.n=0;rate.until=now+900000;}
        if(rate.n>=10) return result({error:'Too many pairing attempts'},429);
        const pair=await get('pair:'+b.hash);
        if(!pair || pair.expiresAt<=now || !(await validSource(this.env,{...pair,expiresAt:pair.expiresAt}))) {rate.n++;await put(ipkey,rate);return result({error:'Pairing code invalid or expired'},401);}
        const sessions=await this.storage.list({prefix:'session:'});
        if([...sessions.values()].filter(s=>!s.revoked && s.expiresAt>now).length>=20) return result({error:'Revoke an existing device first'},409);
        await this.storage.delete('pair:'+b.hash);
        const s={...pair,id:b.id,tokenHash:b.tokenHash,name:b.name,createdAt:now,expiresAt:now+SESSION_LIFETIME,preferences:{categories:CATEGORIES,minimumSeverity:2,quietHours:null}};
        await put('session:'+s.id,s);await put('token:'+s.tokenHash,s.id);return result({ok:true,device:safeDevice(s)});
      }
      if(action==='resolve') { const id=await get('token:'+b.hash), s=id && await get('session:'+id); return result({session:s && await validSource(this.env,s) ? s : null}); }
      if(action==='devices') { const s=await this.storage.list({prefix:'session:'});return result({ok:true,devices:await Promise.all([...s.values()].filter(x=>b.owner || x.id===b.id).map(async x=>({...safeDevice(x),valid:await validSource(this.env,x)})))}); }
      if(action==='revoke') {const s=await get('session:'+b.target);if(!s || (!b.owner && s.id!==b.id)) return result({error:'Device not found'},404);s.revoked=true;delete s.push;await put('session:'+s.id,s);await this.storage.setAlarm(now+1000);await this.storage.delete('token:'+s.tokenHash);return result({ok:true});}
      if(action==='push-register' || action==='preferences') {
        const s=await get('session:'+b.id);if(!s || !(await validSource(this.env,s))) return result({error:'Session expired or revoked'},401);
        if(action==='push-register') {
          for(const other of (await this.storage.list({prefix:'session:'})).values()) if(b.push && other.id!==s.id && other.push?.token===b.push.token && !other.revoked && other.expiresAt>now) return result({error:'Token already belongs to another device; revoke it first'},409);
          if(b.push) s.push=b.push;else delete s.push;
        } else s.preferences=preferences(b.preferences);
        await put('session:'+s.id,s);await this.storage.setAlarm(now+1000);return result({ok:true,device:safeDevice(s)});
      }
      if(action==='operation-begin' || action==='operation-get' || action==='operation-finish') {
        const key='op:'+b.sid+':'+b.id, prior=await get(key);
        if(action==='operation-get') return prior ? result({ok:true,operation:prior}) : result({error:'Operation not found'},404);
        if(action==='operation-finish') {if(prior?.fingerprint===b.fingerprint) await put(key,{...prior,state:'completed',status:b.status,body:b.body});return result({ok:true});}
        if(prior) {if(prior.fingerprint!==b.fingerprint) return result({error:'Operation ID already used for a different request'},409);return result({ok:true,created:false,operation:prior});}
        if((await this.storage.list({prefix:'op:'+b.sid+':'})).size>=500) return result({error:'Operation limit reached'},429);
        const op={state:'running',fingerprint:b.fingerprint,createdAt:now};await put(key,op);return result({ok:true,created:true,operation:op});
      }
      if(action==='event') {
        if(!CATEGORIES.includes(b.category) || ![1,2,3].includes(b.severity)) return result({error:'Invalid event'},400);
        const key='cooldown:'+b.category+':'+(b.dedupe || 'general'), last=await get(key);
        if(last && now-last<600000) return result({ok:true,suppressed:true});
        await put(key,now); const id=crypto.randomUUID();
        // Text never comes from a user, audit metadata, key, or memory record.
        const event={id,category:b.category,severity:b.severity,ts:now,title:'Saints Command',message:'An administrative event needs attention.',attempts:[],pending:true,tries:0};
        await put('event:'+String(now)+':'+id,event); await this.storage.setAlarm(now+1000);return result({ok:true,id});
      }
      if(action==='inbox') {
        const events=await this.storage.list({prefix:'event:',reverse:true,limit:100});
        return result({ok:true,events:[...events.values()].filter(e=>categoryAllowed(b.perms,e.category)).map(e=>({...e,attempts:e.attempts.filter(a=>b.owner || a.device===b.id)}))});
      }
      if(action==='push-test') {
        const s=await get('session:'+b.id);if(!s?.push || !(await validSource(this.env,s))) return result({error:'Register notifications on this device first'},400);
        const last=await get('test:'+b.id);if(last && now-last<30000) return result({error:'Wait 30 seconds between tests'},429);
        await put('test:'+b.id,now);return result({ok:true,push:s.push});
      }
      if(action==='test-log') {const id=crypto.randomUUID();await put('event:'+now+':'+id,{id,category:'sessions',severity:1,ts:now,title:'Test notification',message:'APNs test request',pending:false,attempts:[{device:b.id,...b.attempt}]});return result({ok:true});}
      return result({error:'Unknown state operation'},404);
    }); } catch(e) {return result({error:e.status===400 ? e.message : 'Mobile state error'}, e.status || 500);}
  }
  async alarm() {
    const now=Date.now();
    for(const prefix of ['pair:','attempt:','op:','cooldown:','test:']) for(const [k,v] of await this.storage.list({prefix})) {
      const expired=prefix==='pair:' ? v.expiresAt<now : prefix==='attempt:' ? v.until<now : prefix==='op:' ? v.createdAt<now-SESSION_LIFETIME : Number(v)<now-SESSION_LIFETIME;
      if(expired) await this.storage.delete(k);
    }
    const devices=await this.storage.list({prefix:'session:'});
    for(const [k,s] of devices) if(s.expiresAt<now-86400000) {await this.storage.delete('token:'+s.tokenHash);await this.storage.delete(k);}
    const events=await this.storage.list({prefix:'event:'});let pending=false;
    for(const [k,e] of events) {
      if(e.ts<now-30*86400000) {await this.storage.delete(k);continue;}
      if(!e.pending) continue;
      e.tries=(e.tries || 0)+1;e.pending=false;await this.storage.put(k,e);
      for(const s of devices.values()) {
        if(!s.push || !(await validSource(this.env,s)) || !categoryAllowed(s.perms,e.category) || !s.preferences.categories.includes(e.category) || s.preferences.minimumSeverity>e.severity || e.attempts.some(a=>a.device===s.id && a.ok)) continue;
        const q=s.preferences.quietHours,h=new Date(now+(q?.offsetMinutes || 0)*60000).getUTCHours();
        if(q && (q.start<q.end ? h>=q.start && h<q.end : q.start>q.end && (h>=q.start || h<q.end))) continue;
        const a=await relayCall(this.env,'/push',{...s.push,eventId:e.id});
        e.attempts.push({device:s.id,ts:Date.now(),ok:a.ok,status:a.status,reason:a.reason || a.error || null});
        if(a.status===410 || a.reason==='BadDeviceToken' || a.reason==='DeviceTokenNotForTopic') {delete s.push;await this.storage.put('session:'+s.id,s);}
        if((a.status===429 || a.status>=500) && e.tries<3) e.pending=true;
      }
      await this.storage.put(k,e);pending ||= e.pending;
    }
    const live=[];
    for(const s of devices.values()) if(s.push && s.role==='owner' && await validSource(this.env,s) && s.preferences.categories.includes('backend')) live.push({...s.push,id:s.id,expiresAt:s.expiresAt,syncedAt:now,minimumSeverity:s.preferences.minimumSeverity,quietHours:s.preferences.quietHours});
    await relayCall(this.env,'/devices',{devices:live});
    const monitor=await relayCall(this.env,'/events',{});
    if(monitor.ok && Array.isArray(monitor.events)) for(const e of monitor.events.slice(-100)) {
      if(!/^[a-f0-9-]{36}$/i.test(e.id || '') || !Number.isFinite(e.ts) || e.ts<now-30*86400000) continue;
      const key='event:'+e.ts+':relay-'+e.id;
      if(!(await this.storage.get(key))) await this.storage.put(key,{id:e.id,category:'backend',severity:3,ts:e.ts,title:'Saints Command',message:'The independent monitor reported a Worker outage.',pending:false,attempts:Array.isArray(e.attempts)?e.attempts.slice(0,20).map(a=>({device:a.device,ts:a.ts,ok:!!a.ok,status:a.status})):[]});
    }
    // Runs even with no incoming traffic; also refreshes the monitor snapshot.
    await this.storage.setAlarm(Date.now()+(pending ? 60000 : 3600000));
  }
}
function categoryAllowed(perms, category) {
  const need={backend:'system.view',ai:'ai.view',usage:'ai.view',security:'security.view',moderation:'moderation.view',sessions:'system.view',audit:'audit.view',jobs:'automation.run'}[category];
  return perms.includes('*') || perms.includes(need);
}
export function queueEvent(env,ctx,category,severity=2,dedupe='general') {
  if(!env?.ADMIN_MOBILE) return;
  const p=stateCall(env,'event',{category,severity,dedupe}).catch(()=>{});
  if(ctx?.waitUntil) ctx.waitUntil(p);
}
