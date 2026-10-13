// Real Cloudflare workerd + SQLite Durable Object. No production resources.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(new URL('..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'saints-mobile-')),port=18900+Math.floor(Math.random()*900),base='http://127.0.0.1:'+port;
const secret='local-mobile-fixture-'+randomUUID();
await writeFile(join(dir,'wrangler.json'),JSON.stringify({name:'saints-mobile-test',main:join(root,'worker.js'),compatibility_date:'2026-09-01',durable_objects:{bindings:[{name:'ADMIN_MOBILE',class_name:'AdminMobileState'}]},migrations:[{tag:'admin-mobile-v1',new_sqlite_classes:['AdminMobileState']}],kv_namespaces:[{binding:'TELEMETRY',id:'local-tests-only'}],vars:{ADMIN_TOKEN:secret,OWNER:'boss'}}));
const child=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--config',join(dir,'wrangler.json'),'--port',String(port),'--persist-to',join(dir,'state')],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:join(dir,'config')},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
async function call(path,{owner=false,token,body,id}={}) {const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(owner?{Authorization:'Bearer '+secret}:{}),...(token?{'X-GPA-Mobile':token}:{}),...(id?{'X-Operation-ID':id}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
try {
  let ready=false;for(let i=0;i<100;i++){try{if((await call('/mobile/health')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,'Local runtime failed to start: '+log.replaceAll(secret,'[fixture]'));
  const c=await call('/admin/mobile/pair',{owner:true,body:{role:'owner'}});assert.equal(c.status,200);
  const p=await call('/mobile/pair',{body:{code:c.data.code,name:'workerd test'}});assert.equal(p.status,200);
  assert.equal((await call('/mobile/pair',{body:{code:c.data.code,name:'replay'}})).status,401);
  assert.equal((await call('/admin/whoami',{token:p.data.token})).data.kind,'mobile');
  const id=randomUUID(),body={user:'runtime-user',action:'warn'};
  assert.equal((await call('/admin/moderate',{token:p.data.token,id,body})).status,200);
  assert.equal((await call('/admin/moderate',{token:p.data.token,id,body})).data.mod.strikes,1);
  assert.equal((await call('/admin/mobile/operation?id='+id,{token:p.data.token})).data.operation.state,'completed');
  assert.equal((await call('/admin/overview',{token:p.data.token})).status,200);
  assert.equal((await call('/admin/mobile/register',{token:p.data.token,id:randomUUID(),body:{token:'f'.repeat(64),environment:'sandbox'}})).status,200);
  assert.equal((await call('/admin/mobile/test',{token:p.data.token,id:randomUUID(),body:{}})).status,502);
  assert.equal((await call('/admin/mobile/revoke',{owner:true,body:{id:p.data.device.id}})).status,200);
  assert.equal((await call('/admin/whoami',{token:p.data.token})).status,401);
  if(process.env.SAINTS_BROWSER_TEST==='1') {
    const ui=spawn(process.execPath,[join(root,'tests/browser/mobile-admin.mjs')],{cwd:root,env:{...process.env,MOBILE_TEST_URL:base,MOBILE_TEST_ADMIN:secret},stdio:'inherit'});
    const code=await new Promise(r=>ui.on('exit',r));assert.equal(code,0,'Web pairing test failed');
  }
  if(process.env.SAINTS_PWA_TEST==='1') {
    const ui=spawn(process.execPath,[join(root,'tests/browser/web-app.mjs')],{cwd:root,env:{...process.env,MOBILE_TEST_URL:base,MOBILE_TEST_ADMIN:secret},stdio:'inherit'});
    const code=await new Promise(r=>ui.on('exit',r));assert.equal(code,0,'PWA browser test failed');
  }
  console.log('PASS actual workerd + SQLite DO: pairing, single use, identity, idempotency, overview, APNs registration/failure, revocation');
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
