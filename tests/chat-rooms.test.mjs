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

test('staff chat: only moderators, admins and the owner can read or post; it doesn’t exist for anyone else', async () => {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, COADMIN_TOKEN: 'coadmin-token-secret-5678', OWNER: 'boss', OWNER_CODE: 'owner-code-9' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  const v = (u) => u.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  const login = async (user) => (await c.call('/auth/login', { method: 'POST', body: { user, verifier: v(user) } })).data.token;
  const reg = async (user) => (await c.call('/auth/register', { method: 'POST', body: { user, verifier: v(user) } })).data.token;
  const pollStaff = (headers, extra = '') => c.call('/chat/poll?room=staff&since=0' + extra, { headers });
  const sendStaff = (headers, user, text) => c.call('/chat/send', { method: 'POST', headers, body: { user, text, room: 'staff' } });

  // A regular user: by name, and with a signed-in session.
  await reg('kj');
  const kjTok = await login('kj');
  for (const h of [{}, { 'X-GPA-Session': kjTok }]) {
    const p = await pollStaff(h, '&user=kj');
    assert.equal(p.data.ok, false);
    assert.equal(p.data.error, 'no such room', 'looks like it doesn’t exist');
    assert.equal((p.data.messages || []).length, 0);
    assert.equal((await sendStaff(h, 'kj', 'let me in')).data.ok, false);
  }
  // A wrong owner code or a made-up session don't work either.
  assert.equal((await pollStaff({ 'X-GPA-Owner': 'nope' })).data.ok, false);
  assert.equal((await pollStaff({ 'X-GPA-Session': 'forged.token' })).data.ok, false);

  // Make dub a moderator: after signing in again he's in.
  await reg('dub');
  await c.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'dub', action: 'setrole', role: 'moderator' } });
  const dubTok = await login('dub');
  assert.equal((await sendStaff({ 'X-GPA-Session': dubTok }, 'dub', 'staff meeting at 5')).data.ok, true);
  let p = await pollStaff({ 'X-GPA-Session': dubTok }, '&user=dub');
  assert.deepEqual(p.data.messages.map((m) => m.t), ['staff meeting at 5']);
  // The owner (owner code, admin token) and a co-admin token are staff too.
  assert.equal((await sendStaff({ 'X-GPA-Owner': 'owner-code-9' }, 'boss', 'got it')).data.ok, true);
  assert.equal((await pollStaff(owner)).data.messages.length, 2);
  assert.equal((await pollStaff({ Authorization: 'Bearer coadmin-token-secret-5678' })).data.messages.length, 2);
  // An admin role works as well.
  await reg('sam');
  await c.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'sam', action: 'setrole', role: 'admin' } });
  assert.equal((await pollStaff({ 'X-GPA-Session': await login('sam') })).data.messages.length, 2);
  // Demoted: out again.
  await c.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'dub', action: 'setrole', role: 'user' } });
  assert.equal((await pollStaff({ 'X-GPA-Session': await login('dub') })).data.ok, false);

  // Staff messages never show up in #public, reports can't reach them, and
  // nobody can create or delete a room called "staff".
  assert.equal((await poll(c)).data.messages.some((m) => m.t === 'got it'), false);
  const staffMsg = (await pollStaff(owner)).data.messages[0];
  assert.equal((await c.call('/chat/report', { method: 'POST', headers: { 'X-GPA-Session': kjTok }, body: { room: 'staff', ts: staffMsg.ts } })).status, 403);
  assert.equal((await c.call('/admin/rooms', { method: 'POST', headers: owner, body: { action: 'create', name: 'Staff' } })).status, 400);
  assert.equal((await c.call('/admin/rooms', { method: 'POST', headers: owner, body: { action: 'delete', id: 'staff' } })).status, 400);
  // The nightly cleanup empties it like the other rooms.
  await c.call('/admin/jobs/run', { method: 'POST', headers: owner, body: { id: 'chat-cleanup' } });
  assert.equal((await pollStaff(owner)).data.messages.length, 0);
});

test('chat (rooms): typing, who’s here and last seen', async () => {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', OWNER_CODE: 'owner-code-9' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  const pollAs = (user, extra = '', headers = {}) => c.call(`/chat/poll?room=public&since=0&user=${user}${extra}`, { headers });
  // kj has the chat open and starts typing; dub has the console open elsewhere.
  await pollAs('kj', '&here=1&typing=1');
  await pollAs('dub');
  let r = (await pollAs('maya', '&here=1&typing=0')).data;
  assert.deepEqual(r.typing, ['kj'], 'maya sees kj typing');
  const state = (d, u) => (d.people.find((p) => p.u === u) || {}).state;
  assert.equal(state(r, 'kj'), 'here');
  assert.equal(state(r, 'dub'), 'online', 'console open, chat not on screen');
  assert.equal(state(r, 'maya'), 'here');
  assert.deepEqual((await pollAs('kj', '&here=1&typing=1')).data.typing, [], 'nobody sees themselves typing');
  // Two typing at once, in the order they started.
  await pollAs('maya', '&here=1&typing=1');
  assert.deepEqual((await pollAs('dub', '&here=1')).data.typing, ['kj', 'maya']);
  // Sending ends it at once; so does clearing the box (typing=0).
  await send(c, 'kj', 'hey');
  await pollAs('maya', '&here=1&typing=0');
  assert.deepEqual((await pollAs('dub', '&here=1')).data.typing, []);
  // Typing runs out on its own a few seconds after the last report.
  await pollAs('kj', '&here=1&typing=1');
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 7000;
    r = (await pollAs('dub', '&here=1')).data;
    assert.deepEqual(r.typing, [], 'gone after 6 s without a report');
    Date.now = () => realNow() + 20 * 60e3;
    r = (await pollAs('dub', '&here=1')).data;
    assert.equal(state(r, 'kj'), 'away', 'left: shows as away…');
    assert.ok(r.people.find((p) => p.u === 'kj').ago >= 19 * 60e3, '…with how long ago they were last seen');
  } finally { Date.now = realNow; }
  await pollAs('kj', '&here=1&typing=0');

  // People who can't post never show as typing: shadow-muted, blocked,
  // banned from the room, or while chat is read-only.
  await c.call('/admin/moderate', { method: 'POST', headers: owner, body: { user: 'sam', action: 'shadowmute' } });
  await pollAs('sam', '&here=1&typing=1');
  assert.deepEqual((await pollAs('dub', '&here=1')).data.typing, [], 'a shadow-muted person isn’t seen typing');
  await c.call('/admin/moderate', { method: 'POST', headers: owner, body: { user: 'zed', action: 'block' } });
  await pollAs('zed', '&here=1&typing=1');
  assert.deepEqual((await pollAs('dub', '&here=1')).data.typing, [], 'nor a blocked one');
  // The owner's name needs proof, as for posting.
  await pollAs('boss', '&here=1&typing=1');
  r = (await pollAs('dub', '&here=1')).data;
  assert.deepEqual(r.typing, [], 'someone just typing the owner’s name');
  assert.equal(r.people.some((p) => p.u === 'boss'), false);
  await pollAs('boss', '&here=1&typing=1', { 'X-GPA-Owner': 'owner-code-9' });
  assert.deepEqual((await pollAs('dub', '&here=1')).data.typing, ['boss'], 'the real owner');
  // Anonymous readers are never listed.
  await c.call('/chat/poll?room=public&since=0&here=1&typing=1');
  assert.equal((await pollAs('dub', '&here=1')).data.people.some((p) => /anonymous/i.test(p.u)), false);
});

test('chat (rooms): reactions — one per person, toggle, replace, and everyone gets them', async () => {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  const react = (user, ts, emoji, room = 'public', code) => c.call('/chat/react', { method: 'POST', body: { user, ts, emoji, room, code } });
  const ts = (await send(c, 'maya', 'practice at 4')).data.ts;
  // A reader that already has the message (since = its ts) still gets reactions.
  const reactionsSeenBy = async () => (await poll(c, ts)).data.reactions[ts] || {};
  assert.equal((await react('kj', ts, '❤️')).data.ok, true);
  assert.equal((await react('dub', ts, '❤️')).data.ok, true);
  assert.deepEqual(await reactionsSeenBy(), { '❤️': ['kj', 'dub'] });
  // kj changes to 👍 (replaces), dub taps ❤️ again (takes it off).
  await react('kj', ts, '👍');
  const off = await react('dub', ts, '❤️');
  assert.equal(off.data.mine, null);
  assert.deepEqual(await reactionsSeenBy(), { '👍': ['kj'] });
  // Only the six tapbacks; only real messages; only people who can post.
  assert.equal((await react('kj', ts, '💩')).data.ok, false);
  assert.equal((await react('kj', ts + 12345, '❤️')).data.ok, false);
  await c.call('/admin/moderate', { method: 'POST', headers: owner, body: { user: 'zed', action: 'block' } });
  assert.equal((await react('zed', ts, '❤️')).data.ok, false, 'blocked');
  await c.call('/admin/moderate', { method: 'POST', headers: owner, body: { user: 'sam', action: 'shadowmute' } });
  assert.equal((await react('sam', ts, '😂')).data.ok, true, 'shadow-muted: looks like it worked…');
  assert.deepEqual(await reactionsSeenBy(), { '👍': ['kj'] }, '…but nobody sees it');
  assert.equal((await c.call('/chat/react', { method: 'POST', body: { ts, emoji: '❤️', room: 'public' } })).data.ok, false, 'anonymous');
  // A private room needs its code to react, like to read.
  const room = (await c.call('/admin/rooms', { method: 'POST', headers: owner, body: { action: 'create', name: 'Study' } })).data;
  const rts = (await send(c, 'kj', 'secret', room.id, room.code)).data.ts;
  assert.equal((await react('dub', rts, '😂', room.id, 'WRONG')).data.ok, false);
  assert.equal((await react('dub', rts, '😂', room.id, room.code)).data.ok, true);
  assert.deepEqual((await poll(c, 0, room.id, room.code)).data.messages[0].r, { '😂': ['dub'] });
  assert.deepEqual(await reactionsSeenBy(), { '👍': ['kj'] }, 'rooms are separate');
});

test('chat (rooms): replies quote the message they answer, and only real messages', async () => {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  const reply = (user, text, replyTo) => c.call('/chat/send', { method: 'POST', body: { user, text, room: 'public', replyTo } });
  const first = (await send(c, 'maya', 'who has the notes from bio?')).data.ts;
  await reply('kj', 'i do, sending now', first);
  let msgs = (await poll(c)).data.messages;
  assert.deepEqual(msgs[1].re, { ts: first, u: 'maya', t: 'who has the notes from bio?' });
  // Quoting something that isn't in the room is just a plain message.
  await reply('kj', 'hm', 12345);
  msgs = (await poll(c)).data.messages;
  assert.equal(msgs[2].re, undefined);
  // A client can't make up the quote: only replyTo is read.
  await c.call('/chat/send', { method: 'POST', body: { user: 'kj', text: 'fake', room: 'public', re: { ts: 1, u: 'boss', t: 'I never said this' } } });
  assert.equal((await poll(c)).data.messages[3].re, undefined);
});

test('chat (rooms): unsend — only your own, only within 2 minutes; everyone sees it go', async () => {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  env.CHAT_ROOMS = makeRooms(env);
  const c = client(env);
  const unsend = (user, ts) => c.call('/chat/unsend', { method: 'POST', body: { user, ts, room: 'public' } });
  const oops = (await send(c, 'kj', 'wrong chat lol')).data.ts;
  const answer = (await c.call('/chat/send', { method: 'POST', body: { user: 'maya', text: 'what?', room: 'public', replyTo: oops } })).data.ts;
  await c.call('/chat/react', { method: 'POST', body: { user: 'maya', ts: oops, emoji: '😂', room: 'public' } });
  // Someone who already has it on screen (since = newest).
  const before = (await poll(c, answer)).data;
  assert.deepEqual(before.unsent, []);
  assert.equal((await unsend('maya', oops)).data.ok, false, 'not yours');
  assert.equal((await unsend('kj', oops)).data.ok, true);
  const after = (await poll(c, answer)).data;
  assert.deepEqual(after.unsent, [oops], 'screens that already show it learn it was unsent');
  assert.equal(after.reactions[oops], undefined, 'its reactions go with it');
  const all = (await poll(c)).data.messages;
  assert.deepEqual(all[0], { u: 'kj', ts: oops, unsent: true }, 'a placeholder, without the text');
  assert.deepEqual(all[1].re, { ts: oops, u: 'kj', t: '', unsent: true }, 'quotes of it lose the text too');
  assert.ok(!JSON.stringify(all).includes('wrong chat lol'));
  assert.equal((await c.call('/chat/react', { method: 'POST', body: { user: 'maya', ts: oops, emoji: '❤️', room: 'public' } })).data.ok, false, 'no reacting to it');
  assert.equal((await unsend('kj', oops)).data.ok, true, 'unsending twice is harmless');
  // Too late after 2 minutes.
  const late = (await send(c, 'kj', 'old news')).data.ts;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 2 * 60e3 + 1000;
    const r = (await unsend('kj', late)).data;
    assert.equal(r.ok, false);
    assert.match(r.error, /within 2 minutes/);
  } finally { Date.now = realNow; }
  assert.equal((await poll(c)).data.messages.find((m) => m.ts === late).t, 'old news');
});
