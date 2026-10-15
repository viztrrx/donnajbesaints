// Chat delivery: every sent message reaches the room log, even when many
// people send at once from different places. Run with `npm test`.
//
// The bug this guards against: the room log was one KV value updated by
// read-modify-write. KV is eventually consistent across Cloudflare
// locations, so a send that read a stale copy wrote it back without the
// message another location had just added. That message was gone for good,
// but its push notification had already been sent. Rooms now live in a
// Durable Object (chat/room.js); here it runs in memory with the same
// one-request-at-a-time behavior Cloudflare gives it.
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
    async list({ prefix = '', cursor } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { keys: keys.map((name) => ({ name })), list_complete: true, cursor: undefined };
    }
  };
}
// KV as other Cloudflare locations see it: reads come from a copy taken a
// moment ago, so a write made elsewhere isn't visible yet.
function makeStaleKV() {
  const kv = makeKV();
  let snapshot = null;
  const realGet = kv.get;
  kv.freeze = () => { snapshot = new Map(kv.store); };
  kv.thaw = () => { snapshot = null; };
  kv.get = async (k, type) => {
    if (snapshot && k.startsWith('roomlog:')) { const v = snapshot.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; }
    return realGet.call(kv, k, type);
  };
  return kv;
}
// A Durable Object namespace: one instance per name, storage in memory, and
// blockConcurrencyWhile running callbacks one at a time like the runtime.
function makeRooms(env) {
  const instances = new Map();
  const make = () => {
    const data = new Map();
    let chain = Promise.resolve();
    const ctx = {
      storage: {
        async get(k) { return data.has(k) ? structuredClone(data.get(k)) : undefined; },
        async put(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) data.set(a, structuredClone(b)); } else data.set(k, structuredClone(v)); }
      },
      blockConcurrencyWhile(fn) { const run = chain.then(fn); chain = run.catch(() => {}); return run; }
    };
    return new ChatRoom(ctx, env);
  };
  return {
    instances,
    idFromName: (name) => name,
    get(name) {
      if (!instances.has(name)) instances.set(name, make());
      const room = instances.get(name);
      // A small random delay per request, like requests arriving from
      // different locations.
      return { fetch: async (url, init) => { await new Promise((r) => setTimeout(r, Math.random() * 15)); return room.fetch(new Request(url, init)); } };
    }
  };
}
const ADMIN = 'admin-token-very-secret-1234';
const owner = { Authorization: 'Bearer ' + ADMIN };
function client(env) {
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const call = async (path, { method = 'GET', headers = {}, body, ip = '1.2.3.4' } = {}) => {
    const res = await worker.fetch(new Request('https://worker.test' + path, { method, headers: { 'CF-Connecting-IP': ip, ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { call, settle: async () => { while (pending.length) await pending.shift(); } };
}
const send = (c, user, text, room = 'public', code) => c.call('/chat/send', { method: 'POST', body: { user, text, room, code } });
const poll = (c, since = 0, room = 'public', code) => c.call(`/chat/poll?room=${room}&since=${since}${code ? '&code=' + code : ''}`);

test('chat (old KV log): a send that reads a stale copy erases another message — the bug', async () => {
  const env = { TELEMETRY: makeStaleKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  const c = client(env);
  await send(c, 'kj', 'first');
  env.TELEMETRY.freeze();                       // reads now see the log as it is at this moment
  await send(c, 'dub', 'from school');          // stored…
  await send(c, 'sam', 'from home');            // …but this send read the copy without it
  env.TELEMETRY.thaw();
  const texts = (await poll(c)).data.messages.map((m) => m.t);
  assert.ok(!texts.includes('from school'), 'reproduced: the message is lost (this is what the fix removes)');
});

test('chat (rooms): 40 people sending at once, every message is kept in order', async () => {
  const env = { TELEMETRY: makeStaleKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  env.TELEMETRY.freeze();   // stale KV everywhere: the room log no longer depends on it
  const sent = await Promise.all(Array.from({ length: 40 }, (_, i) => send(c, 'u' + (i % 7), 'msg ' + i)));
  env.TELEMETRY.thaw();
  assert.ok(sent.every((r) => r.data.ok), 'every send succeeded');
  const msgs = (await poll(c)).data.messages;
  assert.equal(msgs.length, 40, 'none lost');
  assert.deepEqual(new Set(msgs.map((m) => m.t)), new Set(Array.from({ length: 40 }, (_, i) => 'msg ' + i)));
  for (let i = 1; i < msgs.length; i++) assert.ok(msgs[i].ts > msgs[i - 1].ts, 'timestamps strictly increase in log order');
  // Each send was told the timestamp the room gave it.
  assert.deepEqual(new Set(sent.map((r) => r.data.ts)), new Set(msgs.map((m) => m.ts)));
});

test('chat (rooms): a client polling with "since" never skips a late arrival', async () => {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  // Like the app: remember the newest ts, and skip what it already shows
  // (two polls can be in flight at once).
  let since = 0;
  const seen = new Set();
  const pollOnce = async () => { const r = await poll(c, since); for (const m of r.data.messages) { seen.add(m.ts + '|' + m.t); since = Math.max(since, m.ts); } };
  // Sends and polls interleaved, like the app polling while people type.
  const jobs = [];
  for (let i = 0; i < 30; i++) { jobs.push(send(c, 'u' + (i % 4), 'm' + i)); if (i % 3 === 0) jobs.push(pollOnce()); }
  await Promise.all(jobs);
  await pollOnce();
  assert.equal(seen.size, 30, 'every message reached the client');
});

test('chat (rooms): old KV messages carry over, and reports, room delete and cleanup still work', async () => {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  // Messages from before the upgrade, in the old KV log.
  await env.TELEMETRY.put('roomlog:public', JSON.stringify([{ u: 'kj', t: 'before the upgrade', ts: 1000 }]));
  await send(c, 'dub', 'after the upgrade');
  assert.deepEqual((await poll(c)).data.messages.map((m) => m.t), ['before the upgrade', 'after the upgrade']);

  // A reported message can be deleted by staff.
  const reg = await c.call('/auth/register', { method: 'POST', body: { user: 'rep', verifier: 'a'.repeat(64) } });
  const target = (await poll(c)).data.messages.find((m) => m.t === 'after the upgrade');
  assert.equal((await c.call('/chat/report', { method: 'POST', headers: { 'X-GPA-Session': reg.data.token }, body: { room: 'public', ts: target.ts, reason: 'spam' } })).data.ok, true);
  const rep = (await c.call('/admin/reports', { headers: owner })).data.reports[0];
  await c.call('/admin/reports/action', { method: 'POST', headers: owner, body: { id: rep.id, action: 'delete_message' } });
  assert.deepEqual((await poll(c)).data.messages.map((m) => m.t), ['before the upgrade']);

  // Private rooms: their own log; deleting the room clears it.
  const room = (await c.call('/admin/rooms', { method: 'POST', headers: owner, body: { action: 'create', name: 'Study' } })).data;
  await send(c, 'kj', 'secret', room.id, room.code);
  assert.deepEqual((await poll(c, 0, room.id, room.code)).data.messages.map((m) => m.t), ['secret']);
  assert.equal((await poll(c)).data.messages.some((m) => m.t === 'secret'), false, 'rooms are separate');

  // The nightly cleanup (and Admin → Clear chat) empties every room.
  await c.call('/admin/jobs/run', { method: 'POST', headers: owner, body: { id: 'chat-cleanup' } });
  assert.equal((await poll(c)).data.messages.length, 0);
  assert.equal((await poll(c, 0, room.id, room.code)).data.messages.length, 0);
  // …and the old KV copy isn't adopted again afterwards.
  await env.TELEMETRY.put('roomlog:public', JSON.stringify([{ u: 'kj', t: 'stale copy', ts: 5 }]));
  assert.equal((await poll(c)).data.messages.length, 0);
});

test('chat (rooms): read receipts — cursors move forward only, per person, and come back to everyone', async () => {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  const pollAs = (user, read) => c.call(`/chat/poll?room=public&since=0&user=${user}${read != null ? '&read=' + read : ''}`);
  const sent = (await send(c, 'maya', 'are you coming?')).data.ts;
  let r = (await pollAs('maya')).data;
  assert.deepEqual(r.reads, [], 'nobody has read it yet: "Delivered"');
  // kj has it on screen and says so.
  await pollAs('kj', sent);
  r = (await pollAs('maya')).data;
  assert.equal(r.reads.length, 1);
  assert.equal(r.reads[0].u, 'kj');
  assert.equal(r.reads[0].ts, sent);
  assert.ok(Date.now() - r.reads[0].at < 5000, 'with the time they read it');
  // A cursor never goes backwards, and can't point past the newest message.
  await pollAs('kj', 1);
  assert.equal((await pollAs('maya')).data.reads.find((x) => x.u === 'kj').ts, sent);
  await pollAs('dub', sent + 999999);
  assert.equal((await pollAs('maya')).data.reads.find((x) => x.u === 'dub').ts, sent, 'clamped to the newest message');
  // Polling without ?read= (chat not on screen) records nothing.
  await pollAs('sam');
  assert.equal((await pollAs('maya')).data.reads.some((x) => x.u === 'sam'), false);
  // Rooms keep separate receipts, and Clear chat resets them.
  const room = (await c.call('/admin/rooms', { method: 'POST', headers: owner, body: { action: 'create', name: 'Study' } })).data;
  assert.deepEqual((await poll(c, 0, room.id, room.code)).data.reads, []);
  await c.call('/admin/jobs/run', { method: 'POST', headers: owner, body: { id: 'chat-cleanup' } });
  assert.deepEqual((await pollAs('maya')).data.reads, []);
});
