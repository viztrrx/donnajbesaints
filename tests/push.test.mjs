// Owner push notifications: real RFC 8291 encryption and RFC 8292 VAPID
// signatures, checked by decrypting each push exactly as a phone would, plus
// the owner-only routes and the events that trigger alerts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { ChatRoom } from '../worker.js';
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
        : new Response(JSON.stringify({ error: openaiStatus === 429
          ? { type: 'insufficient_quota', message: 'You exceeded your quota sk-abcdefghijklmnop' }
          : { type: 'server_error', message: 'The server had an error' } }), { status: openaiStatus, headers: { 'Content-Type': 'application/json' } });
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
  return { env, call, settle, settleList: [], pushes, setOpenAI: (s) => { openaiStatus = s; }, restore: () => { globalThis.fetch = realFetch; } };
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
    assert.equal(sub.categories.presence, false, '"Who\'s online" starts off');
    assert.ok(Object.entries(sub.categories).filter(([k]) => k !== 'presence').every(([, v]) => v), 'everything else on by default');
    assert.ok(Object.values(key.data.categories).every((c) => c.label && c.group), 'categories carry labels and groups');
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
    // Tapping either opens kj's profile in Admin.
    assert.equal(si.url, '/console/#tab=admin&sec=users&user=kj');
    assert.equal(n.find((m) => m.cat === 'newuser').url, '/console/#tab=admin&sec=users&user=kj');
    // A second open right away is throttled (no flood on every page load).
    await t.call('/track', { method: 'POST', body: { user: 'kj', event: 'open', sid: 's2' } });
    assert.equal((await got()).filter((m) => m.cat === 'signin').length, 0);
    // Plain heartbeats never alert.
    await t.call('/track', { method: 'POST', body: { user: 'kj', event: 'beat', sid: 's1' } });
    assert.equal((await got()).length, 0);

    // Chat: sender's name, the room and the message.
    await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'who has the notes?', room: 'public' } });
    n = await got();
    assert.deepEqual([n[0].cat, n[0].title, n[0].body, n[0].url], ['chat', 'kj in #public', 'who has the notes?', '/console/#tab=chat&room=public']);
    // The owner's own messages don't notify the owner.
    await t.call('/chat/send', { method: 'POST', headers: { 'X-GPA-Owner': 'owner-code-1' }, body: { user: 'boss', text: 'hi all', room: 'public' } });
    assert.equal((await got()).length, 0);

    // Quota/rate limits are their own kind; other failures are "AI failed".
    t.setOpenAI(429);
    await t.call('/v1/chat/completions', { method: 'POST', headers: { 'X-GPA-User': 'kj', 'X-GPA-Key': 'sk-user-key-abcdefghijklmnop' }, body: { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] } });
    n = await got();
    const lim = n.find((m) => m.cat === 'limits');
    assert.equal(lim.title, 'Limit reached: kj');
    assert.match(lim.body, /insufficient_quota \(429\)/);
    assert.equal(lim.url, '/console/#tab=admin&sec=users&user=kj&focus=quota', 'a limit opens their quota');
    assert.ok(!/sk-abcdefghijklmnop|sk-user-key/.test(JSON.stringify(n)), 'no API key in a notification');
    t.setOpenAI(500);
    await t.call('/v1/chat/completions', { method: 'POST', headers: { 'X-GPA-User': 'kj', 'X-GPA-Key': 'sk-user-key-abcdefghijklmnop' }, body: { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] } });
    n = await got();
    const ai = n.find((m) => m.cat === 'aierror');
    assert.equal(ai.title, 'AI request failed: kj');
    assert.match(ai.body, /server_error \(500\)/);
    assert.equal(ai.url, '/console/#tab=admin&sec=users&user=kj&focus=key', 'a failure opens their profile at the API key');
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

test('push: private rooms, mentions, approval queue, quiet hours, who\'s online and the daily summary', async () => {
  const t = setup();
  try {
    await t.call('/push/key');
    const d = await makeDevice();
    const { data } = await t.call('/push/subscribe', { method: 'POST', headers: owner, body: { subscription: d.subscription, categories: { presence: true } } });
    const sub = data.subscription;
    assert.equal(sub.categories.presence, true);
    const got = async () => { await t.settle(); const out = []; for (const p of t.pushes.splice(0)) out.push(await decrypt(d, p.body)); return out; };

    // Private room messages are their own kind and name the room.
    const room = await t.call('/admin/rooms', { method: 'POST', headers: owner, body: { action: 'create', name: 'Study Group' } });
    await got();
    await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'test tomorrow?', room: room.data.id, code: room.data.code } });
    let n = await got();
    assert.deepEqual([n[0].cat, n[0].title, n[0].body], ['chatrooms', 'kj in #Study Group', 'test tomorrow?']);
    assert.equal(n[0].url, '/console/#tab=chat&room=' + encodeURIComponent(room.data.id), 'opens that room');

    // A mention of the owner gets its own alert instead of the plain chat one.
    await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'hey @boss can you unmute dub', room: 'public' } });
    n = await got();
    assert.equal(n.length, 1);
    assert.deepEqual([n[0].cat, n[0].title], ['mentions', 'kj mentioned you in #public']);
    await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'bossy people', room: 'public' } });
    assert.equal((await got())[0].cat, 'chat', 'a word that only starts with the name is not a mention');

    // A reply to one of the owner's messages is a mention too (rooms only).
    const store = new Map();
    t.env.CHAT_ROOMS = { idFromName: (n) => n, get: (n) => {
      if (!store.has(n)) { const data = new Map(); store.set(n, new ChatRoom({ storage: { get: async (k) => structuredClone(data.get(k)), put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) data.set(a, structuredClone(b)); else data.set(k, structuredClone(v)); } }, blockConcurrencyWhile: (fn) => fn() }, t.env)); }
      return { fetch: (u, init) => store.get(n).fetch(new Request(u, init)) };
    } };
    const mine = (await t.call('/chat/send', { method: 'POST', headers: { 'X-GPA-Owner': 'owner-code-1' }, body: { user: 'boss', text: 'gym closes at 9', room: 'public' } })).data.ts;
    await got();
    await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'ok thanks', room: 'public', replyTo: mine } });
    n = await got();
    assert.deepEqual([n.length, n[0].cat, n[0].title], [1, 'mentions', 'kj replied to you in #public']);
    delete t.env.CHAT_ROOMS;

    // Approval queue on: a brand-new user is held and the owner is told.
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { approvalMode: true } });
    await got();
    await t.call('/track', { method: 'POST', body: { user: 'zed', event: 'open', sid: 'z1' } });
    n = await got();
    assert.ok(n.find((m) => m.cat === 'approval' && m.title === 'zed is waiting for approval'));
    assert.equal(n.find((m) => m.cat === 'approval').url, '/console/#tab=admin&sec=users&user=zed&focus=actions', 'opens zed at the Approve button');

    // Who's online: one replaceable alert with the count as the icon badge.
    t.env.TELEMETRY.store.delete('push:presence:chk');
    await t.call('/track', { method: 'POST', body: { user: 'amy', event: 'beat', sid: 'a1' } });
    n = (await got()).filter((m) => m.cat === 'presence');
    assert.equal(n.length, 1);
    assert.equal(n[0].tag, 'presence');
    assert.equal(n[0].badge, 2, 'zed and amy have live sessions');
    assert.match(n[0].title, /2 people online/);
    assert.match(n[0].body, /amy/);
    assert.equal(n[0].url, '/console/#tab=admin&sec=users&filter=active', 'opens who is around');
    // Nothing changed: no new alert, even when the cron checks.
    await worker.scheduled({ cron: '*/5 * * * *' }, t.env, { waitUntil: (p) => t.settleList.push(p) });
    await Promise.all(t.settleList.splice(0));
    assert.equal((await got()).filter((m) => m.cat === 'presence').length, 0);
    // Sessions expire (people leave): the 5-minute cron notices.
    t.env.TELEMETRY.store.delete('session:z1');
    await worker.scheduled({ cron: '*/5 * * * *' }, t.env, { waitUntil: (p) => t.settleList.push(p) });
    await Promise.all(t.settleList.splice(0));
    n = (await got()).filter((m) => m.cat === 'presence');
    assert.equal(n.length, 1);
    assert.equal(n[0].badge, 1);
    assert.match(n[0].body, /Left: zed/);

    // Quiet hours over every hour: ordinary alerts wait, urgent ones don't.
    await t.call('/push/update', { method: 'POST', body: { id: sub.id, key: sub.manageKey, quiet: { start: 0, end: 23 } } });
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date())) % 24;
    if (hour !== 23) {
      await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'late night', room: 'public' } });
      assert.equal((await got()).length, 0, 'chat held during quiet hours');
      await t.call('/chat/send', { method: 'POST', body: { user: 'kj', text: '@boss urgent', room: 'public' } });
      assert.equal((await got())[0].cat, 'mentions', 'mentions still come through');
    }
    const st = await t.call('/push/status', { method: 'POST', body: { id: sub.id, key: sub.manageKey } });
    assert.deepEqual(st.data.subscription.quiet, { start: 0, end: 23 });
    await t.call('/push/update', { method: 'POST', body: { id: sub.id, key: sub.manageKey, quiet: null } });

    // Daily summary: at 12 noon New York time, once a day, from the 5-minute
    // cron — not from the nightly jobs. Checked in summer (EDT) and winter (EST).
    const cron5 = () => worker.scheduled({ cron: '*/5 * * * *' }, t.env, { waitUntil: (p) => t.settleList.push(p) }).then(() => Promise.all(t.settleList.splice(0)));
    const realNow = Date.now;
    const at = (iso) => { Date.now = () => Date.parse(iso); };
    try {
      await worker.scheduled({ cron: '0 5 * * *' }, t.env, { waitUntil: (p) => t.settleList.push(p) });
      await Promise.all(t.settleList.splice(0));
      assert.equal((await got()).filter((m) => m.cat === 'digest').length, 0, 'the nightly jobs no longer send it');
      at('2026-10-20T15:55:00Z'); await cron5();   // 11:55 AM EDT
      assert.equal((await got()).filter((m) => m.cat === 'digest').length, 0, 'not before noon');
      at('2026-10-20T16:00:00Z'); await cron5();   // 12:00 PM EDT
      n = (await got()).filter((m) => m.cat === 'digest');
      assert.equal(n.length, 1, 'sent at noon');
      at('2026-10-20T16:05:00Z'); await cron5();   // 12:05 PM: already sent today
      assert.equal((await got()).filter((m) => m.cat === 'digest').length, 0, 'only once a day');
      at('2026-12-01T16:00:00Z'); await cron5();   // 11:00 AM EST: not yet in winter
      assert.equal((await got()).filter((m) => m.cat === 'digest').length, 0);
      at('2026-12-01T17:00:00Z'); await cron5();   // 12:00 PM EST
      assert.equal((await got()).filter((m) => m.cat === 'digest').length, 1, 'noon in winter too');
      // Weekly report: Sundays at 6 PM New York time, once.
      at('2026-10-25T21:55:00Z'); await cron5();   // Sun 5:55 PM EDT
      assert.equal((await got()).filter((m) => m.cat === 'weekly').length, 0, 'not before 6 PM');
      at('2026-10-25T22:00:00Z'); await cron5();   // Sun 6:00 PM EDT
      const wk = (await got()).filter((m) => m.cat === 'weekly');
      assert.equal(wk.length, 1, 'sent Sunday at 6 PM');
      assert.match(wk[0].body, /people active|person active/);
      assert.match(wk[0].body, /AI request/);
      assert.equal(wk[0].url, '/console/#tab=admin&sec=overview');
      at('2026-10-25T22:30:00Z'); await cron5();
      assert.equal((await got()).filter((m) => m.cat === 'weekly').length, 0, 'once a week');
      at('2026-10-26T22:00:00Z'); await cron5();   // Monday 6 PM
      assert.equal((await got()).filter((m) => m.cat === 'weekly').length, 0, 'only on Sundays');
    } finally { Date.now = realNow; }
    assert.equal(n.length, 1);
    assert.match(n[0].body, /used the console/);
    assert.equal(n[0].url, '/console/#tab=admin&sec=overview');
  } finally { t.restore(); }
});

test('push: every alert opens its own spot in the app', async () => {
  const t = setup();
  try {
    await t.call('/push/key');
    const d = await makeDevice();
    const { data } = await t.call('/push/subscribe', { method: 'POST', headers: owner, body: { subscription: d.subscription } });
    const got = async () => { await t.settle(); const out = []; for (const p of t.pushes.splice(0)) out.push(await decrypt(d, p.body)); return out; };
    const sub = data.subscription;
    const ofCat = async (cat) => (await got()).find((m) => m.cat === cat);

    // Test notification: Settings → Account → Phone notifications.
    await t.call('/push/test', { method: 'POST', body: { id: sub.id, key: sub.manageKey } });
    assert.equal((await ofCat('test')).url, '/console/#tab=theme&sec=account&focus=push');

    // Access request: Security, at that person's request.
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['kj'] } } });
    await got();
    await t.call('/access/request', { method: 'POST', body: { user: 'Dub', message: 'let me in' } });
    assert.equal((await ofCat('access')).url, '/console/#tab=admin&sec=security&focus=requests&user=Dub');

    // Security alerts: wrong PIN → that name under Allowed users; an
    // unlisted name → Access requests.
    await t.call('/auth/register', { method: 'POST', body: { user: 'kj', verifier: 'a'.repeat(64) } });
    await got();
    await t.call('/auth/login', { method: 'POST', body: { user: 'kj', verifier: 'b'.repeat(64) } });
    assert.equal((await ofCat('security')).url, '/console/#tab=admin&sec=security&focus=allow&user=kj');
    await t.call('/auth/login', { method: 'POST', body: { user: 'stranger', verifier: 'b'.repeat(64) } });
    assert.equal((await ofCat('security')).url, '/console/#tab=admin&sec=security&focus=requests&user=stranger');
  } finally { t.restore(); }
});

test('push: subscriptions — a reminder 3 days before, and an alert when one ends', async () => {
  const t = setup();
  const realNow = Date.now;
  try {
    await t.call('/push/key');
    const d = await makeDevice();
    await t.call('/push/subscribe', { method: 'POST', headers: owner, body: { subscription: d.subscription } });
    const got = async () => { await t.settle(); const out = []; for (const p of t.pushes.splice(0)) out.push(await decrypt(d, p.body)); return out; };
    const cron = () => worker.scheduled({ cron: '*/5 * * * *' }, t.env, { waitUntil: (p) => t.settleList.push(p) }).then(() => Promise.all(t.settleList.splice(0)));
    Date.now = () => Date.parse('2026-10-15T18:00:00Z');
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: [] } } });
    await t.call('/admin/subscriptions', { method: 'POST', headers: owner, body: { action: 'add', user: 'Renzo', period: '1m' } });
    await got();
    Date.now = () => Date.parse('2026-11-13T18:00:00Z');   // 2 days left
    await cron();
    let n = (await got()).filter((m) => m.cat === 'subs');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, 'Renzo’s subscription ends soon');
    assert.match(n[0].body, /^Ends Nov 15/);
    assert.equal(n[0].url, '/console/#tab=admin&sec=security&focus=subs&user=Renzo');
    await cron();
    assert.equal((await got()).filter((m) => m.cat === 'subs').length, 0, 'reminded once');
    Date.now = () => Date.parse('2026-11-15T18:01:00Z');
    await cron();
    n = (await got()).filter((m) => m.cat === 'subs');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, 'Renzo’s subscription ended');
    await cron();
    assert.equal((await got()).filter((m) => m.cat === 'subs').length, 0, 'told once');
  } finally { Date.now = realNow; t.restore(); }
});

test('push: the Proxy tab — a launch (tab or about:blank) and each site opened alert the owner', async () => {
  const t = setup();
  try {
    await t.call('/push/key');
    const d = await makeDevice();
    await t.call('/push/subscribe', { method: 'POST', headers: owner, body: { subscription: d.subscription } });
    const got = async () => { await t.settle(); const out = []; for (const p of t.pushes.splice(0)) out.push(await decrypt(d, p.body)); return out; };
    const tok = (await t.call('/auth/register', { method: 'POST', body: { user: 'ria', verifier: 'ab'.repeat(32) } })).data.token;
    await got();   // sign-up alerts aren't this test's
    const S = { 'X-GPA-Session': tok };
    await t.call('/proxy/log', { method: 'POST', headers: S, body: { user: 'ria', event: 'launch', mode: 'blank' } });
    let n = (await got()).filter((m) => m.cat === 'proxy');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, 'ria launched the Proxy');
    assert.match(n[0].body, /^In an about:blank window · \d{1,2}:\d{2} [AP]M/);
    assert.equal(n[0].url, '/console/#tab=admin&sec=proxy&user=ria');
    await t.call('/proxy/log', { method: 'POST', headers: S, body: { user: 'ria', event: 'visit', url: 'https://example.com/news?id=7' } });
    n = (await got()).filter((m) => m.cat === 'proxy');
    assert.equal(n[0].title, 'ria opened example.com/news');
    assert.match(n[0].body, /^https:\/\/example\.com\/news · in an about:blank window · /);
    // The same page again within a minute (a reload) doesn't alert again.
    await t.call('/proxy/log', { method: 'POST', headers: S, body: { user: 'ria', event: 'visit', url: 'https://example.com/news' } });
    assert.equal((await got()).filter((m) => m.cat === 'proxy').length, 0);
    // A device that turned Proxy alerts off gets none.
    const subs = JSON.parse(t.env.TELEMETRY.store.get('push:subs'));
    subs[0].categories = { ...(subs[0].categories || {}), proxy: false };
    t.env.TELEMETRY.store.set('push:subs', JSON.stringify(subs));
    await t.call('/proxy/log', { method: 'POST', headers: S, body: { user: 'ria', event: 'launch', mode: 'here' } });
    assert.equal((await got()).filter((m) => m.cat === 'proxy').length, 0);
  } finally { t.restore(); }
});
