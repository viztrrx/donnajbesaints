// Owner tools: invite codes, the activity heatmap and the weekly report.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import realWorker, { ChatRoom } from '../worker.js';
import { signedIn } from './signed-in.mjs';
const worker = signedIn(realWorker);

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
  const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { env, call, settle: async () => { while (pending.length) await pending.shift(); } };
}
const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
const register = (t, user, extra = {}) => t.call('/auth/register', { method: 'POST', body: { user, verifier: v(user), ...extra } });

test('invite codes: names already approved keep working exactly as before', async () => {
  const t = setup();
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['kj', 'dub'] } } });
  // Nobody made codes for them: create works as it always did.
  assert.equal((await register(t, 'kj')).status, 200);
  assert.equal((await register(t, 'dub')).status, 200);
  // Adding a name later doesn't touch the ones already there.
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['kj', 'dub', 'sam'] } } });
  await t.call('/admin/invites', { method: 'POST', headers: owner, body: { action: 'create', user: 'sam' } });
  const login = await t.call('/auth/login', { method: 'POST', body: { user: 'kj', verifier: v('kj') } });
  assert.ok([200, 409].includes(login.status), 'kj still signs in (409 = already signed in elsewhere)');
});

test('invite codes: an invited name can only be created with its code, once', async () => {
  const t = setup();
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['sam'] } } });
  const made = await t.call('/admin/invites', { method: 'POST', headers: owner, body: { action: 'create', user: 'Sam' } });
  assert.equal(made.status, 200);
  const code = made.data.invite.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, 'easy to read out (no 0/O, 1/I/L)');
  let r = await register(t, 'sam');
  assert.equal(r.status, 403);
  assert.equal(r.data.inviteRequired, true);
  r = await register(t, 'sam', { invite: 'AAAA-BBBB' });
  assert.equal(r.status, 403);
  assert.equal(r.data.wrongInvite, true);
  r = await register(t, 'sam', { invite: code.toLowerCase().replace('-', ' ') });
  assert.equal(r.status, 200, 'case and spacing don’t matter');
  assert.equal(t.env.TELEMETRY.store.has('invite:sam'), false, 'used up');
  assert.deepEqual((await t.call('/admin/invites', { method: 'POST', headers: owner, body: { action: 'list' } })).data.invites, []);
  // Nothing to invite once the account exists; never for the owner's name.
  assert.equal((await t.call('/admin/invites', { method: 'POST', headers: owner, body: { action: 'create', user: 'sam' } })).status, 409);
  assert.equal((await t.call('/admin/invites', { method: 'POST', headers: owner, body: { action: 'create', user: 'boss' } })).status, 400);
  // Owner-only.
  assert.equal((await t.call('/admin/invites', { method: 'POST', body: { action: 'create', user: 'zed' } })).status, 401);
});

test('invite codes: removing a code, or the name, opens it again', async () => {
  const t = setup();
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['ana', 'bo'] } } });
  await t.call('/admin/invites', { method: 'POST', headers: owner, body: { action: 'create', user: 'ana' } });
  await t.call('/admin/invites', { method: 'POST', headers: owner, body: { action: 'create', user: 'bo' } });
  const sec = await t.call('/admin/security', { headers: owner });
  assert.ok(sec.data.config.allowAccounts.find((a) => a.user === 'ana').invite, 'Admin → Security shows the code');
  await t.call('/admin/invites', { method: 'POST', headers: owner, body: { action: 'revoke', user: 'ana' } });
  assert.equal((await register(t, 'ana')).status, 200);
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['ana'] } } });
  assert.equal(t.env.TELEMETRY.store.has('invite:bo'), false, 'taking bo off the list drops the code');
});

test('activity heatmap: one sample an hour, averaged per day and hour (owner time)', async () => {
  const t = setup();
  const kv = t.env.TELEMETRY;
  const realNow = Date.now;
  const cron = async () => { const p = []; await worker.scheduled({ cron: '*/5 * * * *' }, t.env, { waitUntil: (x) => p.push(x) }); await Promise.allSettled(p); };
  const online = async (...names) => { for (const k of [...kv.store.keys()].filter((k) => k.startsWith('session:'))) kv.store.delete(k); for (const n of names) await kv.put('session:' + n, JSON.stringify({ user: n })); };
  try {
    await online('kj', 'dub', 'boss');                 // the owner doesn't count
    Date.now = () => Date.parse('2026-10-20T23:00:00Z');   // Tue 7 PM EDT
    await cron();
    await online('kj', 'dub', 'sam', 'maya');
    Date.now = () => Date.parse('2026-10-20T23:05:00Z');   // same hour: not sampled again
    await cron();
    Date.now = () => Date.parse('2026-10-27T23:00:00Z');   // next Tuesday 7 PM: 4 online
    await cron();
    const h = (await t.call('/admin/heatmap', { headers: owner })).data;
    assert.equal(h.grid[2][19], 3, 'Tue 7 PM: (2 + 4) / 2 weeks');
    assert.equal(h.weeks, 2);
    assert.deepEqual(h.peak, { day: 2, hour: 19, avg: 3 });
    assert.equal(h.grid[3][19], null, 'no sample yet');
    const writes = [...kv.store.keys()].filter((k) => k.startsWith('heat:'));
    assert.equal(writes.length, 2, 'one key per week');
  } finally { Date.now = realNow; }
});

test('weekly report: people, top chatters across rooms, AI requests and money', async () => {
  const t = setup();
  const send = (user, text, room = 'public') => t.call('/chat/send', { method: 'POST', body: { user, text, room } });
  for (let i = 0; i < 5; i++) await send('kj', 'hi ' + i);
  for (let i = 0; i < 3; i++) await send('dub', 'yo ' + i);
  await send('maya', 'hey');
  await t.call('/admin/subscriptions', { method: 'POST', headers: owner, body: { action: 'add', user: 'kj', period: '1m', amount: 10 } });
  await t.call('/admin/subscriptions', { method: 'POST', headers: owner, body: { action: 'add', user: 'dub', period: '1m', amount: 15.5 } });
  await t.env.TELEMETRY.put(`usage:${new Date().toISOString().slice(0, 10)}:kj`, JSON.stringify({ n: 7 }));
  const r = (await t.call('/admin/weekly', { method: 'POST', headers: owner, body: {} })).data.report;
  assert.equal(r.messages, 9);
  assert.deepEqual(r.top.map((p) => [p.u, p.n]), [['kj', 5], ['dub', 3], ['maya', 1]]);
  assert.equal(r.ai, 7);
  assert.equal(r.money, 25.5);
  assert.match(r.text, /9 chat messages · top: kj 5, dub 3, maya 1/);
  assert.match(r.text, /\$25\.5 from 2 subscription payments/);
});
