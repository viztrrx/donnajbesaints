// Round 3 ("fun"): daily trivia, game leaderboards with record posts,
// weekday streaks, flair, chat extras, shared songs, the staff badge.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import realWorker, { ChatRoom } from '../worker.js';
import { signedIn } from './signed-in.mjs';
const worker = signedIn(realWorker);
import { TRIVIA } from '../chat/trivia.js';

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
  const cron = async () => { const p = []; await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil: (x) => p.push(x) }); await Promise.allSettled(p); };
  return { env, call, cron, settle: async () => { while (pending.length) await pending.shift(); } };
}
const send = (t, user, text, extra = {}) => t.call('/chat/send', { method: 'POST', body: { user, text, room: 'public', ...extra } });
const msgs = async (t) => (await t.call('/chat/poll?room=public&since=0&user=x')).data.messages;
const realNow = Date.now;

test('daily trivia: at noon (owner time), first correct answer wins a point', async () => {
  const t = setup();
  assert.ok(TRIVIA.length >= 50, 'a decent bank of questions');
  assert.ok(TRIVIA.every((x) => x.length >= 2 && x.every((y) => typeof y === 'string' && y.trim())), 'every question has an answer');
  try {
    Date.now = () => Date.parse('2026-10-20T15:55:00Z'); await t.cron();   // 11:55 AM EDT
    assert.equal((await msgs(t)).length, 0, 'not before noon');
    Date.now = () => Date.parse('2026-10-20T16:00:00Z'); await t.cron();   // 12:00 PM EDT
    let m = await msgs(t);
    assert.equal(m.length, 1);
    assert.equal(m[0].sys, 'trivia');
    assert.equal(m[0].u, 'Trivia');
    assert.match(m[0].t, /^🧠 Daily trivia: .+ First correct answer in chat wins a point!$/);
    Date.now = () => Date.parse('2026-10-20T16:05:00Z'); await t.cron();
    assert.equal((await msgs(t)).length, 1, 'one a day');
  } finally { Date.now = realNow; }
  // Find today's answer from the room itself (what the question is depends on the date).
  const open = await t.env.CHAT_ROOMS.get('public').fetch('https://chat-room/trivia_open', { method: 'POST', body: JSON.stringify({ id: 'public', q: 'What is 2 + 2?', a: ['4', 'four'], day: 'test' }) }).then((r) => r.json());
  assert.ok(open.prev.q, 'the noon question was open');
  await send(t, 'dub', 'is it 5?');
  await send(t, 'kj', 'pretty sure it’s four');
  await send(t, 'maya', '4!');
  await t.settle();
  const after = await msgs(t);
  const win = after.filter((x) => x.sys === 'trivia').pop();
  assert.equal(win.t, '🎉 kj got it! The answer was 4. kj has 1 trivia point.', 'kj was first; maya was too late');
  const extras = (await t.call('/chat/extras?user=x')).data;
  assert.deepEqual(extras.trivia, { kj: 1 });
  // Trivia messages don't count as anyone's chat in the weekly report.
  const r = (await t.call('/admin/weekly', { method: 'POST', headers: owner, body: {} })).data.report;
  assert.equal(r.top.some((p) => p.u === 'Trivia'), false);
});

test('daily trivia: yesterday’s unsolved answer is revealed; the owner can turn trivia off', async () => {
  const t = setup();
  try {
    Date.now = () => Date.parse('2026-10-20T16:00:00Z'); await t.cron();
    Date.now = () => Date.parse('2026-10-21T16:00:00Z'); await t.cron();
    const m = (await msgs(t)).filter((x) => x.sys === 'trivia');
    assert.equal(m.length, 2);
    assert.match(m[1].t, /^Yesterday’s answer: .+\. 🧠 Daily trivia: /);
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { fun: { trivia: false, shoutouts: true } } });
    Date.now = () => Date.parse('2026-10-22T16:00:00Z'); await t.cron();
    assert.equal((await msgs(t)).filter((x) => x.sys === 'trivia').length, 2, 'off: no question');
  } finally { Date.now = realNow; }
});

test('game leaderboards: top 10, one entry each, lower-is-better games, a new #1 is announced', async () => {
  const t = setup();
  const score = (user, game, s) => t.call('/games/score', { method: 'POST', body: { user, game, score: s } });
  assert.equal((await score('kj', 'snake', 120)).data.rank, 1);
  await t.settle();
  let m = (await msgs(t)).filter((x) => x.sys === 'game');
  assert.equal(m.length, 1);
  assert.equal(m[0].t, '🏆 kj set a new record in Snake: 120');
  assert.equal((await score('dub', 'snake', 90)).data.rank, 2);
  assert.equal((await score('kj', 'snake', 100)).data.improved, false, 'not a better score: nothing changes');
  const lb = (await t.call('/games/leaderboard?game=snake')).data;
  assert.deepEqual(lb.top.map((x) => [x.u, x.s]), [['kj', 120], ['dub', 90]]);
  // Reaction time: lower is better, and silly values are refused.
  assert.equal((await score('kj', 'reaction', 20)).data.ok, false, '20 ms isn’t humanly possible');
  await score('kj', 'reaction', 240);
  await score('maya', 'reaction', 190);
  assert.deepEqual((await t.call('/games/leaderboard?game=reaction')).data.top.map((x) => x.u), ['maya', 'kj']);
  await t.settle();
  // maya's #1 within 10 minutes of kj's reaction record: one post per game per 10 min.
  m = (await msgs(t)).filter((x) => x.sys === 'game');
  assert.deepEqual(m.map((x) => x.t), ['🏆 kj set a new record in Snake: 120', '🏆 kj set a new record in Reaction Test: 240 ms']);
  assert.equal((await score('x', 'notagame', 5)).status, 400);
  assert.equal((await t.call('/games/score', { method: 'POST', body: { game: 'snake', score: 5 } })).data.ok, false, 'anonymous scores aren’t kept');
  // Owner can turn the record posts off.
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { fun: { trivia: true, shoutouts: false } } });
  await score('sam', 'tetris', 5000);
  await t.settle();
  assert.equal((await msgs(t)).filter((x) => x.sys === 'game').length, 2);
});

test('streaks: weekdays in a row; weekends neither count nor break it (owner time zone)', async () => {
  const t = setup();
  const open = (user) => t.call('/track', { method: 'POST', body: { user, event: 'open', sid: 's-' + user + Math.random() } });
  try {
    // Oct 19-23 2026 is Monday-Friday.
    for (const [iso, want] of [
      ['2026-10-19T14:00:00Z', 1], ['2026-10-19T20:00:00Z', 1], ['2026-10-20T14:00:00Z', 2],
      ['2026-10-21T03:30:00Z', 2 /* still Tuesday in New York */], ['2026-10-21T14:00:00Z', 3],
      ['2026-10-22T14:00:00Z', 4], ['2026-10-23T14:00:00Z', 5],
      ['2026-10-24T15:00:00Z', 5 /* Saturday doesn't add */], ['2026-10-25T15:00:00Z', 5 /* nor Sunday */],
      ['2026-10-26T14:00:00Z', 6 /* Monday carries on */]]) {
      Date.now = () => Date.parse(iso);
      const r = (await open('kj')).data;
      assert.equal(r.yourStats.streak, want, iso);
    }
    assert.deepEqual((await t.call('/chat/extras?user=x')).data.streaks, { kj: 6 });
    // Someone who used it Mon-Fri and stays away all weekend is still on 5 on Monday.
    for (const d of [19, 20, 21, 22, 23]) { Date.now = () => Date.parse(`2026-10-${d}T15:00:00Z`); await open('sam'); }
    Date.now = () => Date.parse('2026-10-25T15:00:00Z');   // Sunday: still shown as alive
    assert.equal((await t.call('/chat/extras?user=x')).data.streaks.sam, 5);
    Date.now = () => Date.parse('2026-10-26T15:00:00Z');
    assert.equal((await t.call('/chat/extras?user=x')).data.streaks.sam, 5, 'alive on Monday before opening');
    assert.equal((await open('sam')).data.yourStats.streak, 6);
    // Skipping a weekday starts over (Mon 26 -> Wed 28).
    Date.now = () => Date.parse('2026-10-28T14:00:00Z');
    assert.equal((await open('kj')).data.yourStats.streak, 1, 'a missed weekday starts over');
    // First ever open on a weekend: no streak yet; the next weekday starts it.
    Date.now = () => Date.parse('2026-10-31T15:00:00Z');
    assert.equal((await open('new')).data.yourStats.streak, 0);
    Date.now = () => Date.parse('2026-11-02T15:00:00Z');
    assert.equal((await open('new')).data.yourStats.streak, 1);
    // A streak can start on any weekday: Wednesday -> Thu -> Fri -> (weekend) -> Mon.
    for (const [iso, want] of [['2026-11-04T15:00:00Z', 1], ['2026-11-05T15:00:00Z', 2], ['2026-11-06T15:00:00Z', 3],
      ['2026-11-07T15:00:00Z', 3], ['2026-11-08T15:00:00Z', 3], ['2026-11-09T15:00:00Z', 4]]) {
      Date.now = () => Date.parse(iso);
      assert.equal((await open('wed')).data.yourStats.streak, want, 'started Wednesday: ' + iso);
    }
    // ...even on a Friday: Fri 1, still 1 over the weekend, Monday 2.
    for (const [iso, want] of [['2026-11-13T15:00:00Z', 1], ['2026-11-14T15:00:00Z', 1], ['2026-11-15T15:00:00Z', 1], ['2026-11-16T15:00:00Z', 2]]) {
      Date.now = () => Date.parse(iso);
      assert.equal((await open('fri')).data.yourStats.streak, want, 'started Friday: ' + iso);
    }
  } finally { Date.now = realNow; }
});

test('flair: the owner gives someone a badge; staff get a shield; songs can be shared', async () => {
  const t = setup();
  assert.equal((await t.call('/admin/user/action', { method: 'POST', body: { u: 'kj', action: 'flair', emoji: '⭐', label: 'VIP' } })).status, 401, 'owner/admin only');
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'kj', action: 'flair', emoji: '⭐', label: 'VIP' } });
  assert.deepEqual((await t.call('/chat/extras?user=x')).data.flair, { kj: { e: '⭐', l: 'VIP' } });
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'kj', action: 'flair', emoji: '' } });
  assert.deepEqual((await t.call('/chat/extras?user=x')).data.flair, {}, 'removed');
  // A moderator's messages carry the staff mark.
  const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  await t.call('/auth/register', { method: 'POST', body: { user: 'mod', verifier: v('mod') } });
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'mod', action: 'setrole', role: 'moderator' } });
  const tok = (await t.call('/auth/login', { method: 'POST', body: { user: 'mod', verifier: v('mod') } })).data.token;
  await t.call('/chat/send', { method: 'POST', headers: { 'X-GPA-Session': tok }, body: { user: 'mod', text: 'hi', room: 'public' } });
  await send(t, 'kj', 'hey');
  const m = await msgs(t);
  assert.equal(m.find((x) => x.u === 'mod').staff, true);
  assert.equal(m.find((x) => x.u === 'kj').staff, undefined);
  // Sharing a song: the stream path is built by the Worker, never taken from the client.
  const id = '0123abcd-0123-4567-89ab-0123456789ab';
  await send(t, 'kj', '', { track: { source: 'shared', id, title: 'Sunrise', artist: 'Lo-fi Kid', duration: 183, stream: 'https://evil.example/x.mp3', art: 'javascript:alert(1)' } });
  const tr = (await msgs(t)).find((x) => x.track).track;
  assert.deepEqual(tr, { source: 'shared', id, title: 'Sunrise', artist: 'Lo-fi Kid', duration: 183, stream: '/music/file/' + id });
  assert.equal((await send(t, 'kj', '', { track: { source: 'youtube', id: 'abc' } })).data.ok, false);
  // Someone's own upload (My music) shares the same way.
  const mid = 'abcdef01-0123-4567-89ab-0123456789ab';
  await send(t, 'kj', '', { track: { source: 'mine', id: mid, title: 'Demo', artist: 'kj', duration: 60 } });
  assert.equal((await msgs(t)).filter((x) => x.track).pop().track.stream, '/music/file/' + mid);
});
