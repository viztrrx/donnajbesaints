// Decode every generated PNG with Chromium's real image codec, matching u35's
// PlatformAssets browser decoder. No game assets or external requests needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch } from './harness.mjs';
const pack=JSON.parse(fs.readFileSync(new URL('../../eaglercraft/loader/chromebox-lite.json',import.meta.url)));
const browser=await launch();
try {
 const page=await browser.newPage();
 const counts=await page.evaluate(async files=>{
  const counts={};
  for(const [name,base64] of Object.entries(files)){
   if(!name.endsWith('.png'))continue;
   const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
   const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
   if(!image.width||image.width!==image.height)throw new Error('Unexpected image dimensions: '+name);
   const size=image.width+'x'+image.height;counts[size]=(counts[size]||0)+1;image.close();
  }
  return counts;
 },pack.files);
 assert.deepEqual(counts,{'8x8':272,'16x16':102,'64x64':1,'32x32':2});
 console.log('PASS Chromium decoded all 377 indexed PNGs with expected dimensions');
} finally {await browser.close()}
