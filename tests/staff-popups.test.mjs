// Staff pop-ups in the console: the owner and admins get the alerts the
// owner's phone gets (admins only the staff kinds, nobody their own doings),
// each person picks which ones pop up, and that choice never touches their
// phone notifications. Also the Welcome page's Security card.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { ChatRoom } from '../worker.js';

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
const ADMIN = 'admin-token-very-secret-1234';
const owner = { Authorization: 'Bearer ' + ADMIN };
function setup() {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  env.CHAT_ROOMS = makeRooms(env);
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const call = async (path, { method = 'GET', headers = {}, body, s, ip = '1.2.3.4' } = {}) => {
    const h = { 'CF-Connecting-IP': ip, ...headers };
    if (s) h['X-GPA-Session'] = s;
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const settle = async () => { while (pending.length) await pending.shift(); };
  const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  const reg = async (u) => (await call('/auth/register', { method: 'POST', body: { user: u, verifier: v(u) } })).data.token;
  const login = async (u) => (await call('/auth/login', { method: 'POST', body: { user: u, verifier: v(u), takeover: true } })).data.token;
  return { env, call, settle, reg, login };
}

test('staff pop-ups: the owner and admins get them, filtered by role, actor and each person’s choices', async () => {
  const t = setup();
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['kj', 'adm', 'mod'] } } });
  const kj = await t.reg('kj'); await t.reg('adm'); await t.reg('mod');
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'adm', action: 'setrole', role: 'admin' } });
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'mod', action: 'setrole', role: 'moderator' } });
  const adm = await t.login('adm'), mod = await t.login('mod');
  assert.ok(adm && mod && kj, JSON.stringify({ adm: !!adm, mod: !!mod, kj: !!kj }));
  const alerts = async (who, since = 0) => (await t.call('/staff/alerts?since=' + since, who === 'owner' ? { headers: owner } : { s: who })).data;

  // Only the owner and admins.
  assert.equal((await t.call('/staff/alerts', { s: mod })).status, 403, 'moderators don’t get them');
  assert.equal((await t.call('/staff/alerts', { s: kj })).status, 403, 'users don’t get them');
  assert.equal((await t.call('/staff/alerts')).status, 403, 'nobody signed in doesn’t either');
  const before = (await alerts('owner')).latest;

  // Someone not on the list tries to sign in; someone asks for access and writes.
  await t.call('/auth/login', { method: 'POST', body: { user: 'stranger', verifier: 'b'.repeat(64) }, ip: '9.9.9.9' });
  await t.call('/access/request', { method: 'POST', body: { user: 'dub', message: 'let me in' }, ip: '9.9.9.8' });
  const key = 'c3'.repeat(16);
  await t.call('/access/chat', { method: 'POST', body: { user: 'dub', chat: key }, ip: '9.9.9.8' });
  await t.call('/access/chat', { method: 'POST', body: { user: 'dub', chat: key, text: 'hello?' }, ip: '9.9.9.8' });
  // kj and the admin both launch the Proxy and open a site.
  await t.call('/proxy/log', { method: 'POST', s: kj, body: { user: 'kj', event: 'launch', mode: 'here' } });
  await t.call('/proxy/log', { method: 'POST', s: kj, body: { user: 'kj', event: 'visit', url: 'https://example.com/' } });
  await t.call('/proxy/log', { method: 'POST', s: adm, body: { user: 'adm', event: 'launch', mode: 'blank' } });
  await t.settle();

  const own = (await alerts('owner', before)).alerts;
  const titles = own.map((a) => a.title);
  const sec = own.find((a) => a.cat === 'security' && /not on your allowed-users list/.test(a.body));
  assert.ok(sec, 'the unauthorized sign-in is there: ' + titles.join(' | '));
  assert.equal(sec.urgent, true, 'and urgent');
  assert.ok(own.some((a) => a.cat === 'access' && a.title === 'Access request: dub' && a.urgent));
  assert.ok(own.some((a) => /Message from dub/.test(a.title)), 'the owner sees the message from dub');
  assert.ok(own.some((a) => a.title === 'kj launched the Proxy'));
  assert.ok(own.some((a) => a.cat === 'proxysites' && /kj opened example\.com/.test(a.title)));
  assert.ok(own.some((a) => a.title === 'adm launched the Proxy'), 'the owner sees the admin’s launch');
  assert.ok(own.every((a) => a.actor === undefined && a.staff === undefined), 'no internal fields');
  assert.ok(!own.some((a) => a.cat === 'mentions' || a.cat === 'chat'), 'chat alerts have their own pop-ups');

  const adminSees = (await alerts(adm, before)).alerts;
  assert.ok(adminSees.some((a) => a.cat === 'security' && a.urgent), 'admins see security alerts');
  assert.ok(adminSees.some((a) => a.title === 'Access request: dub'));
  assert.ok(!adminSees.some((a) => /Message from dub/.test(a.title)), 'messages from people not on the list are the owner’s');
  assert.ok(adminSees.some((a) => a.title === 'kj launched the Proxy'));
  assert.ok(!adminSees.some((a) => a.title === 'adm launched the Proxy'), 'not their own launch');

  // Choices: the admin turns off the Proxy ones. Only their pop-ups change.
  const defs = (await t.call('/staff/popup-prefs', { s: adm })).data;
  assert.equal(defs.prefs.cats.proxysites, true);
  assert.equal(defs.defs.admin, undefined, 'admins don’t get owner-only kinds to choose from');
  assert.ok((await t.call('/staff/popup-prefs', { headers: owner })).data.defs.admin, 'the owner does');
  const off = await t.call('/staff/popup-prefs', { method: 'POST', s: adm, body: { cats: { proxysites: false, proxylaunch: false } } });
  assert.equal(off.data.prefs.cats.proxysites, false);
  const filtered = (await alerts(adm, before)).alerts;
  assert.ok(filtered.length && !filtered.some((a) => /^proxy/.test(a.cat)), 'no Proxy pop-ups now');
  assert.ok((await alerts('owner', before)).alerts.some((a) => a.cat === 'proxysites'), 'the owner still gets them');
  assert.equal(await t.env.TELEMETRY.get('pushprefs:adm'), null, 'phone notification settings untouched');
  const phone = (await t.call('/push/me/prefs', { method: 'POST', s: adm, body: {} })).data;
  assert.equal(phone.categories.proxysites, true, 'the phone still gets Proxy alerts');
  // All off, and back on.
  await t.call('/staff/popup-prefs', { method: 'POST', s: adm, body: { on: false } });
  const none = await alerts(adm, before);
  assert.deepEqual(none.alerts, []);
  assert.equal(none.on, false);
  await t.call('/staff/popup-prefs', { method: 'POST', s: adm, body: { on: true } });
  // "since" hands out only newer ones.
  const latest = (await alerts('owner')).latest;
  assert.deepEqual((await alerts('owner', latest)).alerts, []);
});

test('welcome security card: locked devices, accounts and PIN requests for staff; access requests for the owner', async () => {
  const t = setup();
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['adm', 'kj'] } } });
  await t.reg('adm'); await t.reg('kj');
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'adm', action: 'setrole', role: 'admin' } });
  const adm = await t.login('adm');
  // Three names that aren't allowed from one device lock it.
  const dev = 'd'.repeat(32);
  for (const n of ['x1', 'x2', 'x3']) await t.call('/access?user=' + n + '&device=' + dev, { ip: '7.7.7.7' });
  await t.call('/access/request', { method: 'POST', body: { user: 'dub', message: 'pls' }, ip: '7.7.7.6' });
  await t.settle();
  const a = (await t.call('/admin/security-summary', { s: adm })).data;
  assert.equal(a.ok, true);
  assert.equal(a.owner, false);
  assert.equal(a.locks.length, 1);
  assert.deepEqual(a.locks[0].names, ['x1', 'x2', 'x3']);
  assert.ok(a.events.some((e) => /Device locked/.test(e.title) && e.urgent), 'the lock alert is in the recent events');
  assert.deepEqual(a.accessRequests, [], 'access requests are the owner’s');
  const o = (await t.call('/admin/security-summary', { headers: owner })).data;
  assert.equal(o.owner, true);
  assert.equal(o.accessRequests[0].user, 'dub');
  // The card's Approve (unlock) button uses Sign-in help, which admins can use.
  const un = await t.call('/admin/signin-help', { method: 'POST', s: adm, body: { action: 'unlock', id: a.locks[0].id } });
  assert.equal(un.status, 200);
  assert.equal((await t.call('/admin/security-summary', { s: adm })).data.locks.length, 0);
  // Users and moderators can't see it.
  const kjTok = await t.login('kj');
  assert.equal((await t.call('/admin/security-summary', { s: kjTok })).status, 403);
});
