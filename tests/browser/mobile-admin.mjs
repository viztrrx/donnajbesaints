// Requires a LOCAL Worker with the mobile DO binding and fixture admin token.
import assert from 'node:assert/strict';
import {launch,serve,openConsole,HOST_PAGE,refuseExternal} from './harness.mjs';
const url=process.env.MOBILE_TEST_URL || 'http://127.0.0.1:8791',token=process.env.MOBILE_TEST_ADMIN;
assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Never run this mutation test against production');assert.ok(token,'Set a local fixture MOBILE_TEST_ADMIN');
const host=await serve((req,res)=>{res.setHeader('Content-Type','text/html');res.end(HOST_PAGE);});
const browser=await launch(),context=await browser.newContext();await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:url});await refuseExternal(context);
try {
  const page=await openConsole(context,'http://127.0.0.1:'+host.port+'/',{user:'mobile-web-'+Date.now(),patch:code=>code.replaceAll('https://donnajbe.viztrrx.workers.dev',url)});
  page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'1029':undefined));
  await page.evaluate(()=>{const r=document.getElementById('gpa-root-host').shadowRoot;for(let i=0;i<5;i++)r.querySelector('#gpa-account-heading').click();});
  await page.evaluate(({token,url})=>{const r=document.getElementById('gpa-root-host').shadowRoot;r.querySelector('#gpa-tele-token').value=token;r.querySelector('#gpa-tele-endpoint').value=url;r.querySelector('#gac-connect').click();},{token,url});
  await page.waitForFunction(()=>!document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-layout').hidden);
  await page.evaluate(()=>document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-nav [data-asec="system"]').click());
  await page.locator('#gac-mobile-pair').waitFor();await page.locator('#gac-mobile-role').selectOption('moderator');await page.locator('#gac-mobile-pair').click();
  await page.waitForFunction(()=>/^[a-f0-9]{64}\n/.test(document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-mobile-code').textContent));
  const code=(await page.locator('#gac-mobile-code').textContent()).split('\n')[0];
  assert.ok(await page.locator('#gac-mobile-copy').isEnabled());
  const phone=await context.newPage();await phone.goto(url+'/app/');await phone.locator('#pair-form').getByLabel('Device name',{exact:true}).fill('Web pairing test phone');await phone.getByLabel('Pairing code',{exact:true}).fill(code);await phone.getByRole('button',{name:'Pair device',exact:true}).click();await phone.getByRole('heading',{name:'Overview',exact:true}).waitFor();
  const cookie=(await context.cookies()).find(c=>c.name==='__Secure-saints_session');assert.ok(cookie?.httpOnly);const paired={token:cookie.value};
  const replay=await context.request.post(url+'/mobile/pair',{data:{code,name:'Replay fixture'}});assert.equal(replay.status(),401);
  await page.locator('#gac-mobile-refresh').click();await page.waitForFunction(()=>document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-mobile-devices').textContent.includes('Web pairing test phone'));
  await page.locator('#gac-mobile-devices .gps-row').filter({hasText:'Web pairing test phone'}).getByText('Revoke',{exact:true}).click();
  await page.waitForFunction(()=>[...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('#gac-mobile-devices .gps-row')].some(r=>r.textContent.includes('Web pairing test phone') && r.textContent.includes('revoked')));
  const revoked=await context.request.get(url+'/admin/whoami',{headers:{'X-GPA-Mobile':paired.token}});assert.equal(revoked.status(),401);await phone.reload();await phone.getByRole('heading',{name:'Control, wherever you are.'}).waitFor();
  assert.deepEqual(page._errors || [],[]);
  console.log('PASS original Admin System creates role-scoped code, Home Screen app pairs, reuse denied, device list and revoke invalidate both API and browser');
}finally{await browser.close();await host.close();}
