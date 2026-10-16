// Memory limits: requests on one Worker instance share 128 MB, and running
// out fails everything on that instance at once (a "Worker exceeded memory
// limit" alert from GET /chat/poll was the symptom). These are the routes
// that could take in something huge. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

function makeKV() {
  const store = new Map();
  return {
    async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
  };
}
const forwarded = [];
let pulled = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url && url.url || url);
  if (u.startsWith('https://api.openai.com')) {
    forwarded.push(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://huge.example.com')) {
    // An endless text page, 1 MB at a time; counts how much was pulled.
    pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(1024 * 1024));
    return new Response(new ReadableStream({ pull(c) { pulled++; c.enqueue(chunk); } }), { headers: { 'Content-Type': 'text/plain' } });
  }
  return realFetch(url, init);
};
const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: 'admin-token-very-secret-1234', OWNER: 'boss' };
const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body }), env, { waitUntil: () => {} });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data, text };
};
const ask = (images, extra = {}) => JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this?' },
  ...images.map((mb) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'A'.repeat(mb * 1024 * 1024) } }))] }], ...extra });

test('AI requests: a normal one with photos goes through unchanged', async () => {
  forwarded.length = 0;
  const body = ask([0.4, 0.4]);
  const r = await call('/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer sk-test-123456789', 'Content-Type': 'application/json' }, body });
  assert.equal(r.status, 200);
  assert.equal(forwarded[0], body, 'nothing to strip: forwarded exactly as sent (no extra copy made)');
});

test('AI requests: the key field is still stripped before OpenAI', async () => {
  forwarded.length = 0;
  const r = await call('/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ask([], { _gpa_key: 'sk-from-body-123456' }) });
  assert.equal(r.status, 200);
  assert.ok(!forwarded[0].includes('_gpa_key') && !forwarded[0].includes('sk-from-body'));
});

test('AI requests: over 24 MB is refused with a plain reason, before reading it into memory', async () => {
  forwarded.length = 0;
  const body = ask([6, 6, 6, 6, 6]);   // five full-size phone photos, ~30 MB
  let r = await call('/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer sk-test-123456789', 'Content-Type': 'application/json', 'Content-Length': String(body.length) }, body });
  assert.equal(r.status, 413);
  assert.equal(r.data.error.type, 'request_too_large');
  assert.match(r.data.error.message, /fewer or smaller images/);
  // Without a Content-Length it is checked after reading.
  r = await call('/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer sk-test-123456789', 'Content-Type': 'application/json' }, body });
  assert.equal(r.status, 413);
  assert.equal(forwarded.length, 0, 'never sent on');
});

test('Page reading stops at 3 MB instead of downloading a huge page whole', async () => {
  const r = await call('/read?url=' + encodeURIComponent('https://huge.example.com/endless.txt'));
  assert.equal(r.status, 200);
  assert.equal(r.text.length, 3000000);
  assert.ok(pulled <= 4, `pulled ${pulled} MB of an endless page`);
});

test('Chat photo uploads must say how big they are', async () => {
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(10)], { type: 'image/png' }), 'a.png');
  const req = new Request('https://w.test/chat/media/upload', { method: 'POST', body: form });
  const stream = new Request('https://w.test/chat/media/upload', { method: 'POST', body: req.body, duplex: 'half', headers: { 'Content-Type': req.headers.get('Content-Type') } });
  const envR2 = { ...env, donnajbe_eaglercraft_client: { async put() {}, async head() { return null; }, async get() { return null; } } };
  const res = await worker.fetch(stream, envR2, { waitUntil: () => {} });
  assert.equal(res.status, 411);
});
