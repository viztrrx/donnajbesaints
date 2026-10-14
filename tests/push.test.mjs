// Owner push notifications: real RFC 8291 encryption and RFC 8292 VAPID
// signatures, checked by decrypting each push exactly as a phone would, plus
// the owner-only routes and the events that trigger alerts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { b64u, encryptPayload, validSubscription } from '../web/console/push.js';

const enc = new TextEncoder();
const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

// A fake phone: its own ECDH key pair and auth secret, like PushManager makes.
async function makeDevice(endpoint = 'https://web.push.apple.com/QGuQyavXutnMH' + Math.random().toString(36).slice(2)) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, pub, auth, subscription: { endpoint, keys: { p256dh: b64u.enc(pub), auth: b64u.enc(auth) } } };
}
// RFC 8291 decryption, independent of the sender's code path.
async function decrypt(device, body) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096, 'record size');
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, device.pair.privateKey, 256));
  const prkKey = await hmac(device.auth, ecdh);
  const ikm = (await hmac(prkKey, concat(enc.encode('WebPush: info\0'), device.pub, asPublic, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  assert.equal(plain[plain.length - 1], 2, 'final-record delimiter');
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}
async function verifyVapid(header, endpoint, expectKey) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, 'vapid header shape');
  const [h, c, sig] = m[1].split('.');
  assert.equal(m[2], expectKey);
  const claims = JSON.parse(new TextDecoder().decode(b64u.dec(c)));
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, 'exp within 24h');
  assert.match(claims.sub, /^(https:|mailto:)/);
  const pub = await crypto.subtle.importKey('raw', b64u.dec(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64u.dec(sig), enc.encode(h + '.' + c)), 'ES256 signature verifies');
}

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(k, type) { const e = store.get(k); if (!e) return null; return type === 'json' ? JSON.parse(e) : e; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
  };
}
const ADMIN = 'admin-token-very-secret-1234';
function setup() {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', OWNER_CODE: 'owner-code-1' };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const pushes = [];   // what reached the "push service"
  let openaiStatus = 200;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input && input.url || input);
    if (/push\.apple\.com|fcm\.googleapis\.com/.test(u)) {
      pushes.push({ endpoint: u, headers: init.headers, body: new Uint8Array(init.body) });
      return new Response('', { status: u.includes('gone') ? 410 : 201 });
    }
    if (u.startsWith('https://api.openai.com')) {
      return openaiStatus === 200
        ? new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ error: { type: 'insufficient_quota', message: 'You exceeded your quota sk-abcdefghijklmnop' } }), { status: openaiStatus, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  };
  const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const res = await worker.fetch(new Request('https://worker.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env, ctx);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  };
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { env, call, settle, pushes, setOpenAI: (s) => { openaiStatus = s; }, restore: () => { globalThis.fetch = realFetch; } };
}
const owner = { Authorization: 'Bearer ' + ADMIN };

test('push: payload encryption round-trips (RFC 8291)', async () => {
  const d = await makeDevice();
  const body = await encryptPayload({ p256dh: d.subscription.keys.p256dh, auth: d.subscription.keys.auth }, JSON.stringify({ title: 'hi', body: 'é ✓ 💬' }));
  assert.deepEqual(await decrypt(d, body), { title: 'hi', body: 'é ✓ 💬' });
});

test('push: only real push services are accepted as endpoints', async () => {
  const d = await makeDevice();
  assert.ok(validSubscription(d.subscription));
  for (const endpoint of ['http://web.push.apple.com/x', 'https://evil.example/x', 'https://web.push.apple.com.evil.example/x', 'https://user:pw@web.push.apple.com/x', 'https://127.0.0.1/x']) {
    assert.equal(validSubscription({ ...d.subscription, endpoint }), false, endpoint);
  }
  assert.equal(validSubscription({ endpoint: d.subscription.endpoint, keys: { p256dh: 'abc', auth: 'def' } }), false);
});

test('push: only the owner can subscribe; devices manage only themselves', async () => {
  const t = setup();
  try {
    const key = await t.call('/push/key');
    assert.equal(key.status, 200);
    assert.equal(b64u.dec(key.data.publicKey).length, 65);
    assert.ok(key.data.categories.chat && key.data.categories.aierror);
    assert.equal((await t.call('/push/key')).data.publicKey, key.data.publicKey, 'key pair is stable');
    const d = await makeDevice();
    assert.equal((await t.call('/push/subscribe', { method: 'POST', body: { subscription: d.subscription } })).status, 403, 'anonymous refused');
    assert.equal((await t.call('/push/subscribe', { method: 'POST', headers: { 'X-GPA-Owner': 'wrong' }, body: { subscription: d.subscription } })).status, 403);
    const bad = await t.call('/push/subscribe', { method: 'POST', headers: owner, body: { subscription: { ...d.subscription, endpoint: 'https://evil.example/x' } } });
    assert.equal(bad.status, 400);
    const ok = await t.call('/push/subscribe', { method: 'POST', headers: { 'X-GPA-Owner': 'owner-code-1' }, body: { subscription: d.subscription, name: 'iPhone' } });
    assert.equal(ok.status, 200);
    const sub = ok.data.subscription;
    assert.ok(sub.id && sub.manageKey);
    assert.ok(Object.values(sub.categories).every(Boolean), 'everything on by default');
    assert.ok(!JSON.stringify(t.env.TELEMETRY.store.get('push:subs')).includes(sub.manageKey), 'manage key stored only as a hash');
    assert.equal((await t.call('/push/update', { method: 'POST', body: { id: sub.id, key: 'nope', categories: {} } })).status, 404);
    const up = await t.call('/push/update', { method: 'POST', body: { id: sub.id, key: sub.manageKey, categories: { signin: false } } });
    assert.equal(up.data.subscription.categories.signin, false);
    assert.equal(up.data.subscription.categories.chat, true);
    const test1 = await t.call('/push/test', { method: 'POST', body: { id: sub.id, key: sub.manageKey } });
    assert.equal(test1.status, 200);
    const pushed = t.pushes.at(-1);
    await verifyVapid(pushed.headers.Authorization, pushed.endpoint, key.data.publicKey);
    assert.equal(pushed.headers['Content-Encoding'], 'aes128gcm');
    assert.match((await decrypt(d, pushed.body)).body, /Notifications are working/);
    assert.equal((await t.call('/push/unsubscribe', { method: 'POST', body: { id: sub.id, key: sub.manageKey } })).data.ok, true);
    assert.equal((await t.call('/push/status', { method: 'POST', body: { id: sub.id, key: sub.manageKey } })).status, 404);
  } finally { t.restore(); }
});

test('push: owner is alerted for chats, sign-ins, new users, AI failures, reports and errors', async () => {
  const t = setup();
  try {
    await t.call('/push/key');
    const d = await makeDevice();
    const { data } = await t.call('/push/subscribe', { method: 'POST', headers: owner, body: { subscription: d.subscription } });
    const sub = data.subscription;
    const got = async () => { await t.settle(); const out = []; for (const p of t.pushes.splice(0)) out.push(await decrypt(d, p.body)); return out; };

    // Sign-in of a brand-new user: "New user" + "signed in", with the time.
    await t.call('/track', { method: 'POST', body: { user: 'kj', event: 'open', sid: 's1', host: 'school.example' } });
    let n = await got();
    assert.ok(n.find((m) => m.cat === 'newuser' && m.title === 'New user: kj'));
    const si = n.find((m) => m.cat === 'signin');
    assert.equal(si.title, 'kj signed in');
    assert.match(si.body, /\d{1,2}:\d{2} [AP]M/);
    assert.match(si.body, /on school\.example/);
    // A second open right away is throttled (no flood on every page load).
    await t.call('/track', { method: 'POST', body: { user: 'kj', event: 'open', sid: 's2' } });
    assert.equal((await got()).filter((m) => m.cat === 'signin').length, 0);
    // Plain heartbeats never alert.
    await t.call('/track', { method: 'POST', body: { user: 'kj', event: 'beat', sid: 's1' } });
    assert.equal((await got()).length, 0);

    // Chat: sender's name, the room and the message.
    await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'who has the notes?', room: 'public' } });
    n = await got();
    assert.deepEqual([n[0].cat, n[0].title, n[0].body, n[0].url], ['chat', 'kj in #public', 'who has the notes?', '/console/#tab=chat']);
    // The owner's own messages don't notify the owner.
    await t.call('/chat/send', { method: 'POST', headers: { 'X-GPA-Owner': 'owner-code-1' }, body: { user: 'boss', text: 'hi all', room: 'public' } });
    assert.equal((await got()).length, 0);

    // AI failure: who, what, never the key.
    t.setOpenAI(429);
    await t.call('/v1/chat/completions', { method: 'POST', headers: { 'X-GPA-User': 'kj', 'X-GPA-Key': 'sk-user-key-abcdefghijklmnop' }, body: { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] } });
    n = await got();
    const ai = n.find((m) => m.cat === 'aierror');
    assert.equal(ai.title, 'AI request failed: kj');
    assert.match(ai.body, /insufficient_quota \(429\)/);
    assert.ok(!/sk-abcdefghijklmnop|sk-user-key/.test(JSON.stringify(n)), 'no API key in a notification');
    t.setOpenAI(200);
    await t.call('/v1/chat/completions', { method: 'POST', headers: { 'X-GPA-User': 'kj', 'X-GPA-Key': 'sk-user-key-abcdefghijklmnop' }, body: { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal((await got()).filter((m) => m.cat === 'aierror').length, 0, 'successful AI requests are quiet');

    // Turning a category off on the phone stops just that kind.
    await t.call('/push/update', { method: 'POST', body: { id: sub.id, key: sub.manageKey, categories: { chat: false } } });
    await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'quiet now?', room: 'public' } });
    assert.equal((await got()).length, 0);

    // An expired subscription (410) is removed automatically.
    const gone = await makeDevice('https://web.push.apple.com/gone-device');
    await t.call('/push/subscribe', { method: 'POST', headers: owner, body: { subscription: gone.subscription } });
    await t.call('/track', { method: 'POST', body: { user: 'newbie', event: 'open', sid: 's9' } });
    await t.settle();
    const left = JSON.parse(t.env.TELEMETRY.store.get('push:subs'));
    assert.equal(left.length, 1, 'gone device dropped');
  } finally { t.restore(); }
});
