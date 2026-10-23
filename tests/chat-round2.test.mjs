// Chat round 2: edit within 2 minutes, pins (staff), polls, quiet hours,
// @mention alerts for everyone, voice messages. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import realWorker, { ChatRoom } from '../worker.js';
import { signedIn } from './signed-in.mjs';
const worker = signedIn(realWorker);
import { b64u } from '../web/console/push.js';

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; }
  };
}
function makeRooms(env) {
  const inst = new Map();
  return { idFromName: (n) => n, get(n) {
    if (!inst.has(n)) { const data = new Map(); let chain = Promise.resolve();
      inst.set(n, new ChatRoom({ storage: { get: async (k) => structuredClone(data.get(k)), put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) data.set(a, structuredClone(b)); else data.set(k, structuredClone(v)); } },
        blockConcurrencyWhile(fn) { const r = chain.then(fn); chain = r.catch(() => {}); return r; } }, env)); }
    const room = inst.get(n);
    return { fetch: (u, init) => room.fetch(new Request(u, init)) };
  } };
}
// R2 as the Worker uses it: put / head / get (with range).
function makeR2() {
  const objs = new Map();
  return {
    objs,
    async put(key, bytes, opts) { objs.set(key, { bytes: new Uint8Array(bytes), customMetadata: (opts && opts.customMetadata) || {}, httpMetadata: (opts && opts.httpMetadata) || {} }); },
    async head(key) { const o = objs.get(key); return o ? { size: o.bytes.length, customMetadata: o.customMetadata, httpMetadata: o.httpMetadata } : null; },
    async get(key, opts) {
      const o = objs.get(key); if (!o) return null;
      const r = opts && opts.range;
      const b = r ? o.bytes.slice(r.offset, r.offset + r.length) : o.bytes;
      return { body: new Blob([b]).stream(), size: o.bytes.length, customMetadata: o.customMetadata };
    },
    async delete(key) { objs.delete(key); }
  };
}
const ADMIN = 'admin-token-very-secret-1234';
const owner = { Authorization: 'Bearer ' + ADMIN };
const pushes = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = String(input && input.url || input);
  if (/push\.apple\.com/.test(u)) { pushes.push({ endpoint: u }); return new Response('', { status: 201 }); }
  return realFetch(input, init);
};
function setup() {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', OWNER_CODE: 'owner-code-9', donnajbe_eaglercraft_client: makeR2() };
  env.CHAT_ROOMS = makeRooms(env);
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const raw = async (path, init = {}) => worker.fetch(new Request('https://w.test' + path, { ...init, headers: { 'CF-Connecting-IP': '1.2.3.4', ...(init.headers || {}) } }), env, ctx);
  const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const res = await raw(path, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { env, raw, call, settle: async () => { while (pending.length) await pending.shift(); } };
}
const send = (t, user, text, extra = {}) => t.call('/chat/send', { method: 'POST', body: { user, text, room: 'public', ...extra } });
const poll = (t, user = 'viewer', since = 0) => t.call(`/chat/poll?room=public&since=${since}&user=${user}`);
const realNow = Date.now;
const at = (ms) => { Date.now = () => ms; };

test('edit: your own message, within 2 minutes; quotes follow; everyone sees “edited”', async () => {
  const t = setup();
  const ts = (await send(t, 'kj', 'practise at 4')).data.ts;
  const reply = (await send(t, 'maya', 'ok', { replyTo: ts })).data.ts;
  const edit = (user, text, which = ts) => t.call('/chat/edit', { method: 'POST', body: { user, text, ts: which, room: 'public' } });
  assert.equal((await edit('maya', 'hacked')).data.ok, false, 'not yours');
  assert.equal((await edit('kj', '   ')).data.ok, false, 'not empty');
  const r = await edit('kj', 'practice at 4');
  assert.equal(r.data.ok, true);
  const d = (await poll(t, 'viewer', reply)).data;
  assert.equal(d.edits[ts].t, 'practice at 4', 'screens that already have it learn the new text');
  const all = (await poll(t)).data.messages;
  assert.equal(all[0].t, 'practice at 4');
  assert.ok(all[0].edited);
  assert.equal(all[1].re.t, 'practice at 4', 'the reply’s quote follows');
  try {
    at(realNow() + 2 * 60e3 + 1000);
    const late = await edit('kj', 'too late');
    assert.equal(late.data.ok, false);
    assert.match(late.data.error, /within 2 minutes/);
  } finally { Date.now = realNow; }
});

test('polls: a question with 2-6 options; one vote each; change or take back', async () => {
  const t = setup();
  assert.equal((await send(t, 'kj', '', { poll: { q: 'Pizza or tacos?', options: ['Pizza'] } })).data.ok, false, 'needs 2+ options');
  assert.equal((await send(t, 'kj', '', { poll: { q: 'x', options: ['a', 'A'] } })).data.ok, false, 'options must differ');
  const ts = (await send(t, 'kj', '', { poll: { q: 'Pizza or tacos?', options: ['Pizza', 'Tacos'] } })).data.ts;
  const m = (await poll(t)).data.messages[0];
  assert.equal(m.t, 'Pizza or tacos?');
  assert.deepEqual(m.poll, { q: 'Pizza or tacos?', options: ['Pizza', 'Tacos'] });
  const vote = (user, option) => t.call('/chat/vote', { method: 'POST', body: { user, ts, option, room: 'public' } });
  await vote('maya', 0); await vote('dub', 1); await vote('sam', 1);
  assert.deepEqual((await poll(t, 'x', ts)).data.votes[ts], { 0: ['maya'], 1: ['dub', 'sam'] });
  await vote('dub', 0);                 // changes
  const back = await vote('sam', 1);    // takes it back
  assert.equal(back.data.mine, null);
  assert.deepEqual((await poll(t, 'x', ts)).data.votes[ts], { 0: ['maya', 'dub'] });
  assert.equal((await vote('maya', 5)).data.ok, false, 'not an option');
  assert.equal((await t.call('/chat/edit', { method: 'POST', body: { user: 'kj', text: 'x', ts, room: 'public' } })).data.ok, false, 'polls can’t be edited');
});

test('pins: staff only, up to 3, dropped when the message is unsent', async () => {
  const t = setup();
  const a = (await send(t, 'kj', 'practice moved to 4')).data.ts;
  const pin = (headers, ts, on = true, user = 'kj') => t.call('/chat/pin', { method: 'POST', headers, body: { user, ts, pin: on, room: 'public' } });
  assert.equal((await pin({}, a)).status, 403, 'regular people can’t pin');
  const r = await pin(owner, a, true, 'boss');
  assert.equal(r.data.ok, true);
  assert.equal(r.data.pins[0].t, 'practice moved to 4');
  assert.equal((await poll(t)).data.pins.length, 1, 'everyone sees it');
  for (const x of ['b', 'c', 'd']) { const ts = (await send(t, 'kj', x)).data.ts; await pin(owner, ts, true, 'boss'); }
  const pins = (await poll(t)).data.pins;
  assert.deepEqual(pins.map((p) => p.t), ['d', 'c', 'b'], 'newest first, 3 at most');
  await pin(owner, pins[0].ts, false, 'boss');
  assert.equal((await poll(t)).data.pins.length, 2, 'unpin');
  await t.call('/chat/unsend', { method: 'POST', body: { user: 'kj', ts: pins[1].ts, room: 'public' } });
  assert.deepEqual((await poll(t)).data.pins.map((p) => p.t), ['b'], 'an unsent message loses its pin');
});

test('quiet hours: off by default; when on, only staff post; everyone sees it', async () => {
  const t = setup();
  // 11 PM - 6 AM New York; 2026-10-21T04:00Z is midnight EDT.
  try {
    at(Date.parse('2026-10-21T04:00:00Z'));
    assert.equal((await send(t, 'kj', 'still up?')).data.ok, true, 'off by default: nothing changes');
    assert.equal((await t.call('/admin/config', { method: 'POST', body: { chatQuiet: { on: true, start: 23, end: 6 } } })).status, 401, 'owner only');
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { chatQuiet: { on: true, start: 23, end: 6 } } });
    const no = await send(t, 'kj', 'hello?');
    assert.equal(no.data.ok, false);
    assert.match(no.data.error, /quiet hours until 6 AM/);
    const q = (await poll(t, 'kj')).data.quiet;
    assert.equal(q.active, true);
    assert.equal(q.exempt, false);
    assert.equal(q.until, '6 AM');
    assert.equal((await t.call('/chat/react', { method: 'POST', body: { user: 'kj', ts: 1, emoji: '❤️', room: 'public' } })).data.ok, false);
    assert.equal((await send(t, 'boss', 'night all', {})).data.ok, false, 'the owner’s name needs proof');
    const ownerSend = await t.call('/chat/send', { method: 'POST', headers: { 'X-GPA-Owner': 'owner-code-9' }, body: { user: 'boss', text: 'night all', room: 'public' } });
    assert.equal(ownerSend.data.ok, true, 'the owner can still post');
    at(Date.parse('2026-10-21T10:30:00Z'));   // 6:30 AM
    assert.equal((await send(t, 'kj', 'morning')).data.ok, true, 'over at 6 AM');
    assert.equal((await poll(t, 'kj')).data.quiet, undefined);
  } finally { Date.now = realNow; }
});

async function makeDevice() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { endpoint: 'https://web.push.apple.com/' + Math.random().toString(36).slice(2), keys: { p256dh: b64u.enc(pub), auth: b64u.enc(crypto.getRandomValues(new Uint8Array(16))) } };
}

test('@mention alerts: anyone can turn them on for their own phone; #public and staff only', async () => {
  const t = setup();
  const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  const reg = async (u) => (await t.call('/auth/register', { method: 'POST', body: { user: u, verifier: v(u) } })).data.token;
  const maya = await reg('maya');
  assert.equal((await t.call('/push/me/subscribe', { method: 'POST', body: { subscription: await makeDevice() } })).status, 401, 'needs a signed-in session');
  const sub = await t.call('/push/me/subscribe', { method: 'POST', headers: { 'X-GPA-Session': maya }, body: { subscription: await makeDevice(), name: 'iPhone' } });
  assert.equal(sub.data.ok, true);
  const { id, manageKey } = sub.data.subscription;
  assert.equal((await t.call('/push/me/status', { method: 'POST', headers: { 'X-GPA-Session': maya }, body: { id, key: manageKey } })).data.ok, true);
  pushes.length = 0;
  await send(t, 'kj', 'hey @maya are you coming?');
  await t.settle();
  assert.equal(pushes.length, 1, 'maya gets an alert');
  await send(t, 'kj', '@maya again');
  await t.settle();
  assert.equal(pushes.length, 1, 'one per sender per minute');
  await send(t, 'dub', 'no mention here, maya');
  await send(t, 'maya', 'talking to myself @maya');
  await t.settle();
  assert.equal(pushes.length, 1, 'only real @mentions, never yourself');
  // Private room: no alert. Staff chat: only staff get alerted.
  const room = (await t.call('/admin/rooms', { method: 'POST', headers: owner, body: { action: 'create', name: 'Study' } })).data;
  await t.call('/chat/send', { method: 'POST', body: { user: 'sam', text: '@maya secret', room: room.id, code: room.code } });
  await t.call('/chat/send', { method: 'POST', headers: owner, body: { user: 'boss', text: '@maya staff stuff', room: 'staff' } });
  await t.settle();
  assert.equal(pushes.length, 1, 'no alert from a private room, nor staff chat for a non-staff person');
  // Turning it off.
  await t.call('/push/me/unsubscribe', { method: 'POST', headers: { 'X-GPA-Session': maya }, body: { id, key: manageKey } });
  await send(t, 'zed', '@maya hi');
  await t.settle();
  assert.equal(pushes.length, 1, 'off means off');
});

test('voice messages: real audio only, Range streaming for Safari', async () => {
  const t = setup();
  // A tiny WebM file: the EBML magic, then filler.
  const webm = new Uint8Array(4000); webm.set([0x1a, 0x45, 0xdf, 0xa3]); for (let i = 4; i < webm.length; i++) webm[i] = i % 251;
  const up = async (bytes, type, field = 'voice') => {
    const form = new FormData();
    form.append(field, new Blob([bytes], { type }), 'v');
    form.append('user', 'kj'); form.append('room', 'public'); form.append('dur', '7.4');
    const body = new Request('https://x', { method: 'POST', body: form });
    const buf = await body.arrayBuffer();
    const res = await t.raw('/chat/media/upload', { method: 'POST', headers: { 'Content-Type': body.headers.get('Content-Type'), 'Content-Length': String(buf.byteLength) }, body: buf });
    return res.json();
  };
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  assert.equal((await up(png, 'audio/webm')).ok, false, 'a picture dressed up as audio is refused');
  const r = await up(webm, 'audio/webm;codecs=opus');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.type, 'audio/webm');
  assert.equal(r.dur, 7);
  const sent = await send(t, 'kj', '', { mediaId: r.id });
  assert.equal(sent.data.ok, true);
  const m = (await poll(t)).data.messages[0];
  assert.deepEqual(m.media, { id: r.id, type: 'audio/webm', dur: 7 });
  const part = await t.raw('/chat/media/' + r.id, { headers: { Range: 'bytes=0-99' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Range'), 'bytes 0-99/4000');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())].slice(0, 4), [0x1a, 0x45, 0xdf, 0xa3]);
  const whole = await t.raw('/chat/media/' + r.id);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, 4000);
});

test('personal alert settings: everyone picks chat alerts; staff also pick proxy and staff alerts', async () => {
  const t = setup();
  const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  const reg = async (u) => (await t.call('/auth/register', { method: 'POST', body: { user: u, verifier: v(u) } })).data.token;
  const maya = await reg('maya');
  await reg('adi');
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'adi', action: 'setrole', role: 'admin' } });
  // A new role ends old sign-ins: sign in again as the admin.
  const adi = (await t.call('/auth/login', { method: 'POST', body: { user: 'adi', verifier: v('adi'), takeover: true } })).data.token;
  const S = (tok) => ({ 'X-GPA-Session': tok });
  // A regular person sees only the chat alerts.
  const mine = (await t.call('/push/me/prefs', { method: 'POST', headers: S(maya), body: {} })).data;
  assert.deepEqual(Object.keys(mine.defs), ['dm', 'mentions', 'everyone']);
  assert.equal((await t.call('/push/me/prefs', { method: 'POST', body: {} })).status, 401, 'needs a session');
  // Mentions off: no mention alert for maya.
  await t.call('/push/me/subscribe', { method: 'POST', headers: S(maya), body: { subscription: await makeDevice(), name: 'iPhone' } });
  const off = (await t.call('/push/me/prefs', { method: 'POST', headers: S(maya), body: { categories: { mentions: false } } })).data;
  assert.equal(off.categories.mentions, false);
  pushes.length = 0;
  await send(t, 'kj', 'hey @maya');
  await t.settle();
  assert.equal(pushes.length, 0, 'mentions off means no alert');
  await t.call('/push/me/prefs', { method: 'POST', headers: S(maya), body: { categories: { mentions: true } } });
  await send(t, 'zed', 'hey @maya');
  await t.settle();
  assert.equal(pushes.length, 1, 'back on');
  // An admin also gets the proxy and staff toggles, and they work.
  const adm = (await t.call('/push/me/prefs', { method: 'POST', headers: S(adi), body: {} })).data;
  for (const k of ['proxylaunch', 'proxysites', 'security', 'pinhelp', 'newuser', 'staff']) assert.ok(k in adm.defs, k);
  await t.call('/push/me/subscribe', { method: 'POST', headers: S(adi), body: { subscription: await makeDevice(), name: 'Browser' } });
  const ria = await reg('ria');
  pushes.length = 0;
  await t.call('/proxy/log', { method: 'POST', headers: S(ria), body: { user: 'ria', event: 'launch', mode: 'blank' } });
  await t.settle();
  assert.equal(pushes.length, 1, 'the admin is told about a launch');
  await t.call('/push/me/prefs', { method: 'POST', headers: S(adi), body: { categories: { proxylaunch: false } } });
  pushes.length = 0;
  await t.call('/proxy/log', { method: 'POST', headers: S(ria), body: { user: 'ria', event: 'launch', mode: 'here' } });
  await t.settle();
  assert.equal(pushes.length, 0, 'launch alerts off');
  await t.call('/proxy/log', { method: 'POST', headers: S(ria), body: { user: 'ria', event: 'visit', url: 'https://example.com/' } });
  await t.settle();
  assert.equal(pushes.length, 1, 'site alerts are separate and still on');
  // A regular person can't switch staff alerts on for themselves.
  const tried = (await t.call('/push/me/prefs', { method: 'POST', headers: S(maya), body: { categories: { proxylaunch: true } } })).data;
  assert.ok(!('proxylaunch' in tried.categories));
});
