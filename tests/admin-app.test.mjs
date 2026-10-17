// Admins in the phone app: the home-screen app (/console/, the Worker's own
// origin) is for the owner and admins only; admins get the Admin panel from
// their role (no admin token) and may be signed in on several devices.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

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
const owner = { Authorization: 'Bearer ' + ADMIN };
const APP = { Origin: 'https://w.test', Referer: 'https://w.test/console/' };       // the phone app
const SITE = { Origin: 'https://school.example' };                                   // the injected console
const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');

function setup() {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
  const ctx = { waitUntil() {} };
  const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const register = (user, headers = SITE) => call('/auth/register', { method: 'POST', headers: { ...headers, 'User-Agent': 'laptop' }, body: { user, verifier: v(user) } });
  const login = (user, headers = SITE, ua = 'laptop') => call('/auth/login', { method: 'POST', headers: { ...headers, 'User-Agent': ua }, body: { user, verifier: v(user), takeover: true } });
  return { env, call, register, login };
}

test('admin app: only the owner and admins can sign in to the phone app', async () => {
  const t = setup();
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['kj', 'ana'] } } });
  assert.equal((await t.register('kj')).status, 200);
  assert.equal((await t.register('ana')).status, 200);
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'ana', action: 'setrole', role: 'admin' } });
  // The app asks for a server sign-in first, except for the owner's name.
  assert.equal((await t.call('/access?user=kj', { headers: APP })).data.appStaffOnly, true);
  assert.equal((await t.call('/access?user=kj', { headers: SITE })).data.appStaffOnly, undefined, 'not on other websites');
  assert.equal((await t.call('/access?user=boss', { headers: APP })).data.appStaffOnly, undefined, 'the owner as before');
  // A regular user: refused in the app, fine on a website.
  const r = await t.login('kj', APP, 'iphone');
  assert.equal(r.status, 403);
  assert.equal(r.data.appStaffOnly, true);
  assert.match(r.data.error, /only for the owner and admins/);
  assert.equal((await t.login('kj', SITE)).status, 200);
  // New accounts can't be made in the app (they'd be regular users).
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['kj', 'ana', 'new'] } } });
  assert.equal((await t.register('new', APP)).data.appStaffOnly, true);
  // An admin gets in.
  const a = await t.login('ana', APP, 'iphone');
  assert.equal(a.status, 200);
  assert.equal(a.data.account.role, 'admin');
  // A user who was made a regular user again is signed out of the app on reload.
  const kjSite = (await t.login('kj', SITE)).data.token;
  assert.equal((await t.call('/auth/me', { headers: { ...APP, 'X-GPA-Session': kjSite } })).data.appStaffOnly, true);
  assert.equal((await t.call('/auth/me', { headers: { ...SITE, 'X-GPA-Session': kjSite } })).status, 200);
  // The owner can turn the rule off.
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { appStaffOnly: false } });
  assert.equal((await t.call('/admin/security', { headers: owner })).data.config.appStaffOnly, false);
  assert.equal((await t.call('/access?user=kj', { headers: APP })).data.appStaffOnly, undefined);
});

test('admin app: admins use the Admin panel with their sign-in, on phone and computer at once', async () => {
  const t = setup();
  await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['kj', 'ana'] } } });
  await t.register('kj'); await t.register('ana');
  await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'ana', action: 'setrole', role: 'admin' } });
  const phone = (await t.login('ana', APP, 'iphone')).data.token;
  // A second device while the phone is in use: fine for an admin...
  const laptop = (await t.login('ana', SITE, 'laptop'));
  assert.equal(laptop.status, 200, JSON.stringify(laptop.data));
  // ...and both keep working.
  for (const tok of [phone, laptop.data.token]) {
    const who = await t.call('/admin/whoami', { headers: { 'X-GPA-Session': tok } });
    assert.equal(who.status, 200);
    assert.equal(who.data.role, 'admin');
    assert.equal((await t.call('/admin/users', { headers: { 'X-GPA-Session': tok } })).status, 200, 'no admin token needed');
  }
  // Admins still can't do owner-only things.
  assert.equal((await t.call('/admin/config', { method: 'POST', headers: { 'X-GPA-Session': phone }, body: { appStaffOnly: false } })).status, 403);
  // A regular user keeps one device at a time.
  await t.login('kj', SITE, 'laptop');
  assert.equal((await t.login('kj', SITE, 'other-laptop')).data.inUse, true);
});
