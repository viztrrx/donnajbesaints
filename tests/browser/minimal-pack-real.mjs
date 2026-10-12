// Real u35 pack load + before/after sample. Isolated browser storage and a
// fixed-seed world; no user's saves are touched. Needs EAGLER_CLIENT_DIR.
// Optional BASELINE_BUNDLE points to the previous generated chromebox-lite.js.
// The samples are Mac/browser comparisons, not Lenovo hardware benchmarks.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';
const dir = process.env.EAGLER_CLIENT_DIR;
if (!dir || !fs.existsSync(path.join(dir, 'assets.epk'))) throw new Error('Set EAGLER_CLIENT_DIR to the real u35 build');
const out = process.argv[2] || '/tmp/minimal-pack-real';fs.mkdirSync(out,{recursive:true});
const current = JSON.parse(fs.readFileSync(path.join(ROOT,'eaglercraft/loader/chromebox-lite.json')));
let baseline = null;
if(process.env.BASELINE_BUNDLE) { const s=fs.readFileSync(process.env.BASELINE_BUNDLE,'utf8'); baseline=JSON.parse(s.slice(s.indexOf('=')+1).trim().replace(/;$/,'')); }
const env=await startEnv({relay:false,clientDir:path.resolve(dir)});
const browser=await chromium.launch({headless:true,channel:'chromium',args:['--use-angle=metal','--enable-gpu','--autoplay-policy=no-user-gesture-required']});
const report={note:'Actual u35 client on Apple hardware; 4x CPU slowdown is uncalibrated and does not emulate Intel GPU/ChromeOS.',samples:[]};

try {
 for(const [name,bundle] of baseline?[['before',baseline],['after',current]]:[['after',current]]) {
  const ctx=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await ctx.addInitScript(()=>{
   window.__frameTimes=[];window.__collect=false;const p=WebGL2RenderingContext.prototype;const bind=p.bindFramebuffer,blit=p.blitFramebuffer;const draws=new WeakMap();
   p.bindFramebuffer=function(t,f){if(t===this.FRAMEBUFFER||t===this.DRAW_FRAMEBUFFER)draws.set(this,f);return bind.call(this,t,f)};
   p.blitFramebuffer=function(...a){if(window.__collect&&draws.get(this)===null)window.__frameTimes.push(performance.now());return blit.apply(this,a)};
  });
  if(name==='before') {
   await ctx.route('**/eagler/loader/pack-config.js',r=>r.fulfill({contentType:'text/javascript',body:'window.__eaglerPackConfig='+JSON.stringify({format:1,folder:bundle.folder,name:bundle.name,version:'1.0.0',revision:bundle.revision,url:'loader/chromebox-lite.json?v='+bundle.revision,autoSelect:true})+';'}));
   await ctx.route('**/eagler/loader/chromebox-lite.json*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(bundle)}));
  }
  await ctx.route('**/favicon.ico',r=>r.fulfill({status:204}));
  const page=await ctx.newPage();const logs=[];const errors=[];const requests=[];const badResponses=[];
  page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()})});
  page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push(r.url()));
  await page.goto(env.workerUrl+'/eagler/?autoPack=1');
  await page.waitForFunction(()=>typeof window.main==='function');
  await page.waitForTimeout(3000);await page.mouse.click(600,350,{delay:120});await page.keyboard.press('Space',{delay:120});await page.waitForTimeout(15000);
  const click=async(x,y,ms=600)=>{await page.mouse.click(x,y,{delay:120});await page.waitForTimeout(ms)};
  const shot=async tag=>page.screenshot({path:path.join(out,name+'-'+tag+'.png')});
  {
   await click(640,650); // first-run profile Done
   await click(640,350,6000); // Wait for the integrated-server world list
   await click(850,592); // Create New World / import choice
   await click(640,330);
   await click(640,375);await click(640,375); // Creative
   await click(640,590);await click(600,210);
   await page.keyboard.type('349874861416572032',{delay:60});await page.waitForTimeout(300);
   await click(400,665,20000);
   // Both isolated contexts create the same seed; keep gameplay active rather
   // than relying on a timed world-list selection after saving/quitting.
  }
  const command=async s=>{await page.keyboard.press('KeyT',{delay:120});await page.waitForTimeout(250);await page.keyboard.type(s,{delay:45});await page.waitForTimeout(200);await page.keyboard.press('Enter',{delay:120});await page.waitForTimeout(500)};
  await command('/gamemode 3');await command('/time set 6000');await command('/gamerule doDaylightCycle false');await command('/weather clear');await command('/tp @p 181 78 219 0 15');await command('/gamerule sendCommandFeedback false');await page.waitForTimeout(10000);
  await shot('world');
  fs.writeFileSync(path.join(out,name+'-console.txt'),logs.join('\n'));
  assert.ok(logs.some(l => /Preparing spawn|Preparing start region|logged in|Loading world|Starting integrated eaglercraft server|Preparing level|Starting integrated Minecraft server/i.test(l)), 'World did not start; do not treat menu frame timing as gameplay');
  const glInfo=await page.evaluate(()=>{const g=document.querySelector('canvas').getContext('webgl2');const e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL),width:g.drawingBufferWidth,height:g.drawingBufferHeight}});
  assert.ok(!/SwiftShader/.test(glInfo.renderer),'A software renderer is not a valid hardware comparison');
  const cdp=await ctx.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  for(const workload of ['stationary','movement']) {
   await command('/tp @p 181 78 219 0 15');await page.waitForTimeout(5000);
   const heapBefore=(await cdp.send('Runtime.getHeapUsage')).usedSize;
   await page.evaluate(()=>{window.__frameTimes=[];window.__collect=true});
   if(workload==='movement')await page.keyboard.down('KeyW');
   await page.waitForTimeout(6000);
   if(workload==='movement'){await page.keyboard.up('KeyW');await page.keyboard.down('KeyS')}
   await page.waitForTimeout(6000);
   if(workload==='movement')await page.keyboard.up('KeyS');
   const times=await page.evaluate(()=>{window.__collect=false;return window.__frameTimes});
   assert.ok(times.length>100,'Not enough game frames; inspect screenshots for a menu/load failure');
   const durations=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
   const sample={pack:name,workload,frames:times.length,averageFps:1000*(times.length-1)/(times.at(-1)-times[0]),p95Ms:durations[Math.floor(durations.length*.95)],p99Ms:durations[Math.floor(durations.length*.99)],over25msPercent:100*durations.filter(d=>d>25).length/durations.length,over50msPercent:100*durations.filter(d=>d>50).length/durations.length,jsHeapBefore:heapBefore,jsHeapAfter:(await cdp.send('Runtime.getHeapUsage')).usedSize,...glInfo};
   report.samples.push(sample);console.log(JSON.stringify(sample));
  }
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  const gameSettings=await page.evaluate(async()=>{const b=Uint8Array.from(atob(localStorage.getItem('_eaglercraftX.g')),c=>c.charCodeAt(0));return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text()});
  assert.ok(gameSettings.includes('resourcePacks:["agent-console-chromebox-lite-8x"]'));
  fs.writeFileSync(path.join(out,name+'-console.txt'),logs.join('\n'));
  fs.writeFileSync(path.join(out,name+'-failed-requests.json'),JSON.stringify(badResponses,null,2));
  assert.deepEqual(badResponses,[]);assert.deepEqual(errors,[]);assert.ok(!logs.some(l=>/Unable to load|Failed to load|Using missing texture|stitching.*error|Could not load resource pack|Game Crashed/i.test(l)),logs.filter(l=>/Unable to load|Failed to load|Using missing texture|stitching.*error|Could not load resource pack|Game Crashed/i.test(l)).join('\n'));
  fs.writeFileSync(path.join(out,name+'-console.txt'),logs.join('\n'));fs.writeFileSync(path.join(out,name+'-requests.json'),JSON.stringify(requests,null,2));
  await ctx.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log('PASS actual u35 automatic activation, PNG/atlas load, fixed-world samples, no page/texture errors');
} finally { await browser.close();await env.close(); }
