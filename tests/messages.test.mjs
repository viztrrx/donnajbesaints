// Messages: direct messages, group chats, safety review by the owner and
// admins, @everyone, and the public stats. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { ChatRoom } from '../worker.js';
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
  return { inst, idFromName: (n) => n, get(n) {
    if (!inst.has(n)) { const data = new Map(); let chain = Promise.resolve();
      inst.set(n, new ChatRoom({ storage: { get: async (k) => structuredClone(data.get(k)), put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) data.set(a, structuredClone(b)); else data.set(k, structuredClone(v)); } },
        blockConcurrencyWhile(fn) { const r = chain.then(fn); chain = r.catch(() => {}); return r; } }, env)); }
    const room = inst.get(n);
    return { fetch: (u, init) => room.fetch(new Request(u, init)) };
  } };
}
const ADMIN = 'admin-token-very-secret-1234';
const ownerTok = { Authorization: 'Bearer ' + ADMIN };
const pushes = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = String(input && input.url || input);
  if (/push\.apple\.com/.test(u)) { pushes.push({ endpoint: u }); return new Response('', { status: 201 }); }
  return realFetch(input, init);
};
function setup() {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', OWNER_CODE: 'owner-code-9' };
  env.CHAT_ROOMS = makeRooms(env);
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const call = async (path, { method = 'GET', headers = {}, body, s } = {}) => {
    const h = { 'CF-Connecting-IP': '1.2.3.4', ...(s ? { 'X-GPA-Session': s } : {}), ...headers };
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  const reg = async (u) => (await call('/auth/register', { method: 'POST', body: { user: u, verifier: v(u) } })).data.token;
  const login = async (u) => (await call('/auth/login', { method: 'POST', body: { user: u, verifier: v(u) } })).data.token;
  return { env, call, reg, login, settle: async () => { while (pending.length) await pending.shift(); } };
}
const send = (t, s, room, text, extra = {}) => t.call('/chat/send', { method: 'POST', s, body: { room, text, ...extra } });
const poll = (t, s, room, q = '') => t.call(`/chat/poll?room=${room}&since=0${q}`, { s });
async function makeDevice() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { endpoint: 'https://web.push.apple.com/' + Math.random().toString(36).slice(2), keys: { p256dh: b64u.enc(pub), auth: b64u.enc(crypto.getRandomValues(new Uint8Array(16))) } };
}

test('direct messages: only the two people can read or post; the same pair gets the same conversation', async () => {
  const t = setup();
  const kj = await t.reg('kj'), maya = await t.reg('maya'), zed = await t.reg('zed');
  assert.equal((await t.call('/dm/start', { method: 'POST', body: { to: 'maya' } })).status, 401, 'needs a session');
  const r = await t.call('/dm/start', { method: 'POST', s: kj, body: { to: 'Maya' } });
  assert.equal(r.data.ok, true);
  const id = r.data.conv.id;
  assert.match(id, /^dm-[a-f0-9]{24}$/);
  assert.equal(r.data.conv.title, 'maya');
  assert.equal((await t.call('/dm/start', { method: 'POST', s: maya, body: { to: 'kj' } })).data.conv.id, id, 'same pair, same conversation');
  assert.equal((await t.call('/dm/start', { method: 'POST', s: kj, body: { to: 'nobody' } })).data.ok, false, 'only people with accounts');
  assert.equal((await t.call('/dm/start', { method: 'POST', s: kj, body: { to: 'kj' } })).data.ok, false, 'not yourself');

  assert.equal((await send(t, kj, id, 'hey maya')).data.ok, true);
  await t.settle();
  const mp = (await poll(t, maya, id)).data;
  assert.equal(mp.ok, true);
  assert.deepEqual(mp.messages.map((m) => m.t), ['hey maya']);
  assert.equal(mp.conv.kind, 'dm');
  // Outsiders: no such room, whether reading, posting or reacting.
  assert.equal((await poll(t, zed, id)).data.error, 'no such room');
  assert.equal((await send(t, zed, id, 'let me in')).data.ok, false);
  assert.equal((await t.call(`/chat/poll?room=${id}&since=0&user=kj`)).data.ok, false, 'a name without a session is not enough');
  assert.equal((await t.call('/chat/react', { method: 'POST', s: zed, body: { room: id, ts: mp.messages[0].ts, emoji: '❤️' } })).data.ok, false);

  // Inboxes: unread for maya until she reads it; none for kj.
  const mayaList = (await t.call('/dm/list', { s: maya })).data;
  assert.equal(mayaList.convs.length, 1);
  assert.equal(mayaList.convs[0].n, 1);
  assert.equal(mayaList.convs[0].title, 'kj');
  assert.equal(mayaList.convs[0].last.t, 'hey maya');
  assert.equal((await t.call('/dm/list', { s: kj })).data.convs[0].n, 0);
  assert.equal((await t.call('/dm/list', { s: zed })).data.convs.length, 0);
  await poll(t, maya, id, '&read=' + mp.messages[0].ts);
  await t.settle();
  assert.equal((await t.call('/dm/list', { s: maya })).data.convs[0].n, 0, 'reading clears it');
});

test('group chats: create, add, rename, remove, leave; members only', async () => {
  const t = setup();
  const a = await t.reg('ana'), b = await t.reg('ben'), c = await t.reg('cy'), d = await t.reg('dee');
  assert.equal((await t.call('/dm/group', { method: 'POST', s: a, body: { name: 'Study', members: ['ben'] } })).data.ok, false, 'needs 2 others');
  assert.equal((await t.call('/dm/group', { method: 'POST', s: a, body: { name: '', members: ['ben', 'cy'] } })).data.ok, false, 'needs a name');
  const g = (await t.call('/dm/group', { method: 'POST', s: a, body: { name: 'Study', members: ['ben', 'cy'] } })).data;
  assert.equal(g.ok, true);
  const id = g.conv.id;
  assert.match(id, /^g-[a-f0-9]{24}$/);
  assert.deepEqual(g.conv.members, ['ana', 'ben', 'cy']);
  assert.equal((await send(t, b, id, 'hi all')).data.ok, true);
  const msgs = (await poll(t, c, id)).data.messages;
  assert.match(msgs[0].t, /ana started “Study” with ben, cy/);
  assert.equal(msgs[0].sys, 'group');
  assert.equal(msgs[1].t, 'hi all');
  assert.equal((await poll(t, d, id)).data.ok, false, 'not a member');
  // Add dee; rename; only the creator removes; anyone leaves.
  assert.equal((await t.call('/dm/manage', { method: 'POST', s: b, body: { id, action: 'add', members: ['dee'] } })).data.ok, true);
  assert.equal((await poll(t, d, id)).data.ok, true, 'dee is in now');
  assert.equal((await t.call('/dm/manage', { method: 'POST', s: c, body: { id, action: 'rename', name: 'Bio study' } })).data.conv.title, 'Bio study');
  assert.equal((await t.call('/dm/manage', { method: 'POST', s: b, body: { id, action: 'remove', member: 'cy' } })).data.ok, false, 'only the creator removes people');
  assert.equal((await t.call('/dm/manage', { method: 'POST', s: a, body: { id, action: 'remove', member: 'cy' } })).data.ok, true);
  assert.equal((await poll(t, c, id)).data.ok, false, 'cy is out');
  assert.equal((await t.call('/dm/list', { s: c })).data.convs.length, 0, 'and it is off her list');
  assert.equal((await t.call('/dm/manage', { method: 'POST', s: d, body: { id, action: 'leave' } })).data.left, true);
  assert.equal((await send(t, d, id, 'still here?')).data.ok, false);
  await t.settle();
  const list = (await t.call('/dm/list', { s: b })).data.convs;
  assert.equal(list[0].title, 'Bio study');
  assert.deepEqual(list[0].members, ['ana', 'ben']);
  const log = (await poll(t, a, id)).data.messages.map((m) => m.t);
  assert.ok(log.some((x) => /renamed the group “Bio study”/.test(x)) && log.some((x) => /removed cy/.test(x)) && log.some((x) => /dee left the group/.test(x)));
});

test('safety review: the owner and admins can read every conversation, read-only; others and moderators cannot', async () => {
  const t = setup();
  const kj = await t.reg('kj'), maya = await t.reg('maya');
  await t.reg('adm'); await t.reg('mod'); await t.reg('boss');
  await t.call('/admin/user/action', { method: 'POST', headers: ownerTok, body: { u: 'adm', action: 'setrole', role: 'admin' } });
  await t.call('/admin/user/action', { method: 'POST', headers: ownerTok, body: { u: 'mod', action: 'setrole', role: 'moderator' } });
  const adm = await t.login('adm'), mod = await t.login('mod');
  const id = (await t.call('/dm/start', { method: 'POST', s: kj, body: { to: 'maya' } })).data.conv.id;
  await send(t, kj, id, 'private words');
  await t.settle();

  const rev = (await t.call('/dm/review', { s: adm })).data;
  assert.equal(rev.ok, true);
  assert.equal(rev.convs.length, 1);
  assert.equal(rev.convs[0].title, 'kj & maya');
  assert.equal(rev.convs[0].last.t, 'private words');
  const seen = (await poll(t, adm, id, '&read=' + Date.now())).data;
  assert.equal(seen.ok, true);
  assert.equal(seen.monitor, true);
  assert.equal(seen.messages[0].t, 'private words');
  assert.equal(seen.reads.length, 0, 'reviewing leaves no read receipt');
  assert.equal((await send(t, adm, id, 'hello')).data.ok, false, 'read-only');
  assert.equal((await t.call('/dm/review-open', { method: 'POST', s: adm, body: { id } })).data.ok, true);
  const audit = [...t.env.TELEMETRY.store.entries()].filter(([k]) => k.startsWith('audit')).map(([, v]) => v).join(' ');
  assert.match(audit, /dm\/review-open/, 'opening one is audited');
  // The owner (owner code, as the console sends it) too.
  assert.equal((await t.call(`/chat/poll?room=${id}&since=0&user=boss`, { headers: { 'X-GPA-Owner': 'owner-code-9' } })).data.monitor, true);
  // Moderators and members of the public can't.
  assert.equal((await t.call('/dm/review', { s: mod })).status, 403);
  assert.equal((await poll(t, mod, id)).data.ok, false);
  assert.equal((await t.call('/dm/review', { s: maya })).status, 403);
});

test('@everyone: highlighted for all, alerts phones, once per 10 minutes (staff unlimited)', async () => {
  const t = setup();
  const kj = await t.reg('kj'), maya = await t.reg('maya'), sam = await t.reg('sam');
  for (const s of [maya, sam]) await t.call('/push/me/subscribe', { method: 'POST', s, body: { subscription: await makeDevice(), name: 'iPhone' } });
  pushes.length = 0;
  const r = await send(t, kj, 'public', 'meeting now @everyone');
  assert.equal(r.data.everyone, 'sent');
  await t.settle();
  assert.equal(pushes.length, 2, 'maya and sam');
  const m = (await poll(t, maya, 'public')).data.messages.find((x) => x.t === 'meeting now @everyone');
  assert.equal(m.ev, true);
  const again = await send(t, kj, 'public', '@everyone again');
  assert.equal(again.data.ok, true, 'still sent');
  assert.equal(again.data.everyone, 'cooldown');
  await t.settle();
  assert.equal(pushes.length, 2, 'but no alerts');
  assert.equal((await poll(t, maya, 'public')).data.messages.find((x) => x.t === '@everyone again').ev, undefined);
  // In a group: its members only.
  const g = (await t.call('/dm/group', { method: 'POST', s: maya, body: { name: 'Crew', members: ['kj', 'sam'] } })).data.conv.id;
  pushes.length = 0;
  assert.equal((await send(t, maya, g, '@everyone dinner?')).data.everyone, 'sent');
  await t.settle();
  assert.equal(pushes.length, 1, 'sam (kj has no alerts on; maya sent it)');
  // Staff aren't limited.
  assert.equal((await t.call('/chat/send', { method: 'POST', headers: { ...ownerTok, 'X-GPA-Owner': 'owner-code-9' }, body: { user: 'boss', room: 'public', text: '@everyone 1' } })).data.everyone, 'sent');
  assert.equal((await t.call('/chat/send', { method: 'POST', headers: { ...ownerTok, 'X-GPA-Owner': 'owner-code-9' }, body: { user: 'boss', room: 'public', text: '@everyone 2' } })).data.everyone, 'sent');
});

test('DM alerts: the other person, once per minute per sender', async () => {
  const t = setup();
  const kj = await t.reg('kj'), maya = await t.reg('maya');
  await t.call('/push/me/subscribe', { method: 'POST', s: maya, body: { subscription: await makeDevice(), name: 'iPhone' } });
  const id = (await t.call('/dm/start', { method: 'POST', s: kj, body: { to: 'maya' } })).data.conv.id;
  pushes.length = 0;
  await send(t, kj, id, 'one'); await t.settle();
  await send(t, kj, id, 'two'); await t.settle();
  assert.equal(pushes.length, 1);
});

test('public stats: counts without contents; signed-in people only when the list is on', async () => {
  const t = setup();
  const kj = await t.reg('kj'), maya = await t.reg('maya');
  await send(t, kj, 'public', 'hi');
  await send(t, maya, 'public', 'hello');
  await send(t, kj, 'public', 'how are you');
  const id = (await t.call('/dm/start', { method: 'POST', s: kj, body: { to: 'maya' } })).data.conv.id;
  await send(t, kj, id, 'secret'); await t.settle();
  await t.call('/dm/group', { method: 'POST', s: kj, body: { name: 'G', members: ['maya', 'boss'] } }).catch(() => {});
  const st = (await t.call('/stats/public?user=kj&fresh=1')).data;
  assert.equal(st.ok, true);
  assert.equal(st.publicToday, 3);
  assert.equal(st.privateToday, 1);
  assert.equal(st.dms, 1);
  assert.equal(st.topChatters[0].u, 'kj');
  assert.equal(st.topChatters[0].n, 2);
  assert.ok(!JSON.stringify(st).includes('secret'), 'no message contents');
  assert.ok(st.people >= 2);
});

test('private rooms can’t take a conversation-shaped name', async () => {
  const t = setup();
  const r = await t.call('/admin/rooms', { method: 'POST', headers: ownerTok, body: { action: 'create', name: 'dm-aaaaaaaaaaaaaaaaaaaaaaaa' } });
  assert.equal(r.status, 400);
});

test('pop-up notifications: each message once per browser; skipped where the app already alerts', async () => {
  const t = setup();
  const maya = await t.reg('maya');
  const CROS = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const claim = (keys, ua = CROS, s = maya) => t.call('/notify/claim', { method: 'POST', s, headers: { 'User-Agent': ua }, body: { keys } });
  assert.equal((await t.call('/notify/claim', { method: 'POST', body: { keys: ['msg:public:1'] } })).status, 401, 'signed in only');
  const a = (await claim(['msg:dm-aaaaaaaaaaaaaaaaaaaaaaaa:5', 'msg:public:7'])).data;
  assert.deepEqual(a.fresh, ['msg:dm-aaaaaaaaaaaaaaaaaaaaaaaa:5', 'msg:public:7']);
  assert.deepEqual(a.push, { mention: false, chat: false });
  // A second tab (or website) in the same browser asks for the same message: no.
  assert.deepEqual((await claim(['msg:public:7', 'msg:public:8'])).data.fresh, ['msg:public:8']);
  // Another computer still gets its own.
  assert.deepEqual((await claim(['msg:public:7'], 'Mozilla/5.0 (iPhone)')).data.fresh, ['msg:public:7']);
  // Odd keys are dropped.
  assert.deepEqual((await claim(['<script>', 'ok:key:1'])).data.fresh, ['ok:key:1']);
  // Push alerts turned on in the app in this same browser: the page skips messages and mentions.
  await t.call('/push/me/subscribe', { method: 'POST', s: maya, headers: { 'User-Agent': CROS }, body: { subscription: await makeDevice(), name: 'Chromebook' } });
  assert.equal((await claim(['msg:public:9'])).data.push.mention, true);
  assert.equal((await claim(['msg:public:10'], 'Mozilla/5.0 (Windows NT 10.0) Chrome/130')).data.push.mention, false, 'a different browser');
});

test('the owner with no server sign-in (Admin connected, or the owner code) can use Messages', async () => {
  const t = setup();
  const maya = await t.reg('maya');
  // No session for the owner name at all: only the admin token.
  const r = await t.call('/dm/start', { method: 'POST', headers: ownerTok, body: { to: 'maya' } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  const id = r.data.conv.id;
  assert.equal(r.data.conv.title, 'maya');
  assert.equal((await t.call('/chat/send', { method: 'POST', headers: ownerTok, body: { user: 'boss', room: id, text: 'hi from the owner' } })).data.ok, true);
  await t.settle();
  assert.equal((await poll(t, maya, id)).data.messages[0].t, 'hi from the owner');
  assert.equal((await t.call('/dm/list', { headers: ownerTok })).data.convs.length, 1);
  // Maya answers; the owner reads it with the owner code instead.
  await send(t, maya, id, 'hi boss');
  const code = { 'X-GPA-Owner': 'owner-code-9' };
  const seen = (await t.call(`/chat/poll?room=${id}&since=0&user=boss`, { headers: code })).data;
  assert.equal(seen.ok, true);
  assert.equal(seen.monitor, undefined, 'a member, not a reviewer');
  assert.deepEqual(seen.messages.map((m) => m.t), ['hi from the owner', 'hi boss']);
  assert.equal((await t.call('/chat/send', { method: 'POST', headers: code, body: { user: 'boss', room: id, text: 'got it' } })).data.ok, true);
  // A wrong code is nobody.
  assert.equal((await t.call('/dm/list', { headers: { 'X-GPA-Owner': 'nope' } })).status, 401);
});
