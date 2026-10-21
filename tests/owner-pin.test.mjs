// The owner's own PIN reset (Settings → Memory → "Forgot your PIN?"),
// proven by the admin token or the owner code. Run with `npm test`.
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
const ADMIN = 'admin-token-very-secret-1234';
function setup() {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', OWNER_CODE: 'owner-code-9' };
  env.CHAT_ROOMS = { idFromName: (n) => n, get() { return { fetch: async () => new Response('{"ok":true}') }; } };
  void ChatRoom;
  const ctx = { waitUntil() {} };
  const call = async (path, { method = 'POST', headers = {}, body } = {}) => {
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { env, call };
}
const V1 = 'a'.repeat(64), V2 = 'b'.repeat(64), V3 = 'c'.repeat(64);

test('owner PIN reset: with the admin token, without the old PIN; signs this device in', async () => {
  const t = setup();
  // The owner's account exists with a PIN the owner no longer knows.
  assert.equal((await t.call('/auth/register', { headers: { 'X-GPA-Owner': 'owner-code-9' }, body: { user: 'boss', verifier: V1 } })).data.ok, true);
  assert.equal((await t.call('/auth/login', { body: { user: 'boss', verifier: V2 } })).status, 401, 'the new PIN isn’t it yet');
  // No proof: refused, and counted.
  const no = await t.call('/auth/owner-pin', { body: { user: 'boss', verifier: V2 } });
  assert.equal(no.status, 403);
  assert.match(no.data.error, /Connect Admin/);
  assert.equal((await t.call('/auth/owner-pin', { headers: { 'X-GPA-Owner': 'wrong' }, body: { user: 'boss', verifier: V2 } })).status, 403);
  // Someone else's name: never.
  assert.equal((await t.call('/auth/owner-pin', { headers: { Authorization: 'Bearer ' + ADMIN }, body: { user: 'kj', verifier: V2 } })).status, 403);
  // With the admin token: reset, signed in, owner role.
  const r = await t.call('/auth/owner-pin', { headers: { Authorization: 'Bearer ' + ADMIN }, body: { user: 'boss', verifier: V2 } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.ok(r.data.token);
  assert.equal(r.data.account.role, 'owner');
  const me = await t.call('/auth/me', { method: 'GET', headers: { 'X-GPA-Session': r.data.token } });
  assert.equal(me.data.ok, true);
  // The new PIN works; the old one doesn't.
  assert.equal((await t.call('/auth/login', { body: { user: 'boss', verifier: V1 } })).status, 401);
  assert.notEqual((await t.call('/auth/login', { body: { user: 'boss', verifier: V2 } })).status, 401);
  // Audited.
  const audit = [...t.env.TELEMETRY.store.entries()].filter(([k]) => k.startsWith('audit')).map(([, v]) => v).join(' ');
  assert.match(audit, /owner_pin_reset/);
});

test('owner PIN reset: with the owner code; creates the owner account if there was none', async () => {
  const t = setup();
  const r = await t.call('/auth/owner-pin', { headers: { 'X-GPA-Owner': 'owner-code-9' }, body: { user: 'Boss', verifier: V3 } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.account.role, 'owner');
  assert.notEqual((await t.call('/auth/login', { body: { user: 'boss', verifier: V3 } })).status, 401);
});

test('owner PIN reset: older sign-ins stop working', async () => {
  const t = setup();
  const first = await t.call('/auth/register', { headers: { 'X-GPA-Owner': 'owner-code-9' }, body: { user: 'boss', verifier: V1 } });
  assert.equal((await t.call('/auth/me', { method: 'GET', headers: { 'X-GPA-Session': first.data.token } })).data.ok, true);
  await t.call('/auth/owner-pin', { headers: { Authorization: 'Bearer ' + ADMIN }, body: { user: 'boss', verifier: V2 } });
  assert.equal((await t.call('/auth/me', { method: 'GET', headers: { 'X-GPA-Session': first.data.token } })).status, 401);
});

test('owner name on an unconfirmed account: the app says how to set it up, and the reset confirms it', async () => {
  const t = setup();
  // "boss" registered as an ordinary account before it became the owner name.
  t.env.OWNER = 'someoneelse';
  assert.equal((await t.call('/auth/register', { body: { user: 'boss', verifier: V1 } })).data.ok, true);
  t.env.OWNER = 'boss';
  const app = { Origin: 'https://w.test' };
  const r = await t.call('/auth/login', { headers: app, body: { user: 'boss', verifier: V1 } });
  assert.equal(r.status, 403);
  assert.equal(r.data.ownerSetup, true);
  assert.match(r.data.error, /Set up your owner PIN/);
  // The reset (admin token) confirms it; then the app lets the owner in.
  const reset = await t.call('/auth/owner-pin', { headers: { Authorization: 'Bearer ' + ADMIN, ...app }, body: { user: 'boss', verifier: V1 } });
  assert.equal(reset.data.account.role, 'owner');
  const again = await t.call('/auth/login', { headers: app, body: { user: 'boss', verifier: V1 } });
  assert.notEqual(again.status, 403, JSON.stringify(again.data));
});
