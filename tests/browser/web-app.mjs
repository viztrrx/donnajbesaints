import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const url=process.env.MOBILE_TEST_URL,secret=process.env.MOBILE_TEST_ADMIN;
assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Local fixtures only');
assert.ok(secret);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[],page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));
try{
 await page.goto(url+'/app/');await page.getByRole('heading',{name:'Control, wherever you are.'}).waitFor();
 await page.getByText('Owner setup',{exact:true}).click();await page.getByLabel('Worker owner credential').fill(secret);await page.getByRole('button',{name:'Connect as owner'}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();await page.screenshot({path:'/tmp/saints-pwa-overview.png',fullPage:true});
 const cookies=await context.cookies();const cookie=cookies.find(c=>c.name==='__Secure-saints_session');assert.ok(cookie);assert.ok(cookie.httpOnly&&cookie.secure);assert.equal(cookie.sameSite,'Strict');
 assert.equal(await page.evaluate(()=>document.cookie.includes('saints_session')),false);
 assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('owner-fixture'))),false);
 await page.getByRole('link',{name:'Command',exact:true}).click();await page.getByLabel('Find a section or action').fill('warn');await page.getByRole('link',{name:'Warn',exact:true}).click();await page.getByLabel('Username',{exact:true}).fill('pwa-fixture');await page.getByLabel('Reason',{exact:false}).fill('local browser verification');await page.getByRole('button',{name:'Review action'}).click();assert.ok(await page.locator('dialog').isVisible());await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#result').isVisible(),false);
 await page.getByRole('button',{name:'Review action'}).click();await page.getByRole('button',{name:'Execute',exact:true}).click();await page.getByText('Action completed. Refresh the affected screen to view changes.',{exact:true}).waitFor();assert.ok(await page.locator('#result').isVisible());
 await page.getByRole('link',{name:'Command',exact:true}).click();await page.getByLabel('Find a section or action').fill('users');await page.getByRole('link',{name:'Users',exact:true}).click();await page.getByLabel('Search users').waitFor();
 for(const size of [{width:320,height:640},{width:390,height:844},{width:844,height:390},{width:768,height:1024}]){await page.setViewportSize(size);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow '+size.width);}
 await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Appearance').selectOption('dark');await page.getByRole('button',{name:'Save preferences'}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.getByLabel('Appearance').selectOption('light');await page.getByRole('button',{name:'Save preferences'}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 const cacheKeys=await page.evaluate(async()=>{const c=await caches.open('saints-shell-v1');return(await c.keys()).map(r=>new URL(r.url).pathname);});assert.ok(cacheKeys.includes('/app/'));assert.ok(cacheKeys.every(p=>!p.includes('/api/')));
 await context.setOffline(true);await page.reload();await page.locator('#connection').filter({hasText:'Offline'}).waitFor();await page.getByText('You are offline. Reconnect and try again.',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Overview',exact:true}).count(),0);
 await context.setOffline(false);await page.reload();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();await page.getByRole('button',{name:'Revoke this session & sign out'}).click();await page.getByRole('button',{name:'Execute',exact:true}).click();await page.getByRole('heading',{name:'Control, wherever you are.'}).waitFor();assert.equal((await context.cookies()).some(c=>c.name==='__Secure-saints_session'),false);
 assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/saints-pwa-login.png',fullPage:true});
 console.log('PASS PWA browser: owner pairing, HttpOnly cookie, confirmations, admin action, mobile layouts, themes, shell-only cache, offline state, session revocation');
}finally{await browser.close();}
