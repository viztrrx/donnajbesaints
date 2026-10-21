// Texting (web/sms.js + /sms/* in worker.js) against a stubbed Telnyx API and
// webhooks signed with a real Ed25519 key, so the signature check is real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { normPhone, smsKeyword, telnyxSignatureOk, namesList } from '../web/sms.js';

const ADMIN = 'admin-token-very-secret-1234';
const owner = { Authorization: 'Bearer ' + ADMIN };
function makeKV() {
  const store = new Map();
  return {
    store,
    async get(k, type) { const e = store.get(k); if (!e) return null; return type === 'json' ? JSON.parse(e) : e; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; }
  };
}
const b64 = (u8) => Buffer.from(u8).toString('base64');
const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const PUB = b64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
const sign = async (t, body) => b64(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(t + '|' + body))));

// Telnyx stand-in: records every text "sent".
function stubTelnyx() {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://telnyx.test/v2/messages')) {
      const b = JSON.parse(init.body);
      if (init.headers.Authorization !== 'Bearer KEY_test') return Response.json({ errors: [{ detail: 'Authentication failed' }] }, { status: 401 });
      sent.push(b);
      return Response.json({ data: { id: 'msg_' + sent.length, to: [{ phone_number: b.to }] } });
    }
    return real(url, init);
  };
  return { sent, restore: () => { globalThis.fetch = real; } };
}
function setup(extra = {}) {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', TELNYX_API: 'https://telnyx.test/v2', TELNYX_API_KEY: 'KEY_test', TELNYX_FROM: '+12395550100', TELNYX_PUBLIC_KEY: PUB, ...extra };
  const call = async (path, { method = 'GET', headers = {}, body, raw, ip = '1.2.3.4' } = {}) => {
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': ip, ...headers }, body: raw != null ? raw : body == null ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await res.text();
    let data = {}; try { data = JSON.parse(text); } catch (e) { data = {}; }
    return { status: res.status, data };
  };
  const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  const signUp = async (u) => (await call('/auth/register', { method: 'POST', body: { user: u, verifier: v(u) } })).data.token;
  const inbound = async (from, text, { id = 'ev_' + Math.random().toString(36).slice(2), t = Math.floor(Date.now() / 1000), sig } = {}) => {
    const body = JSON.stringify({ data: { id, event_type: 'message.received', payload: { from: { phone_number: from }, to: [{ phone_number: '+12395550100' }], text } } });
    return call('/sms/inbound', { method: 'POST', headers: { 'telnyx-signature-ed25519': sig || await sign(t, body), 'telnyx-timestamp': String(t), 'Content-Type': 'application/json' }, raw: body });
  };
  return { env, call, signUp, inbound };
}

test('sms pieces: phone numbers, keywords, signatures, names', async () => {
  assert.equal(normPhone('(239) 555-0123'), '+12395550123');
  assert.equal(normPhone('1-239-555-0123'), '+12395550123');
  assert.equal(normPhone('555-0123'), '', 'too short');
  assert.equal(normPhone('+44 20 7946 0958'), '', 'US only');
  assert.deepEqual(['STOP', 'stop ', 'Unsubscribe', 'START', 'help', 'im paying cash', 'Cash!', 'hello'].map(smsKeyword), ['stop', 'stop', 'stop', 'start', 'help', 'cash', 'cash', 'other']);
  const t = Math.floor(Date.now() / 1000);
  assert.equal(await telnyxSignatureOk(PUB, await sign(t, 'hi'), t, 'hi'), true);
  assert.equal(await telnyxSignatureOk(PUB, await sign(t, 'hi'), t, 'hi!'), false, 'body changed');
  assert.equal(await telnyxSignatureOk(PUB, await sign(t - 900, 'hi'), t - 900, 'hi'), false, 'too old (replay)');
  assert.equal(namesList(['boss (owner)', 'ana', 'kj']), 'boss (owner), ana or kj');
});

test('sms: text yourself the subscribe link (signed in, limited, opt-out respected)', async () => {
  const tx = stubTelnyx();
  try {
    const t = setup();
    // Info for the Renew box: texting on, the number, the link, who takes cash (owner + admins).
    const info = (await t.call('/sms/info')).data;
    assert.deepEqual([info.sms, info.number, info.link, info.cash], [true, '(239) 555-0100', 'https://w.test/subscribe/', ['boss (owner)']]);
    // Not signed in: refused.
    assert.equal((await t.call('/sms/subscribe-link', { method: 'POST', body: { phone: '2395550123' } })).status, 401);
    const tok = await t.signUp('kj');
    const S = { 'X-GPA-Session': tok };
    assert.equal((await t.call('/sms/subscribe-link', { method: 'POST', headers: S, body: { phone: '12345' } })).status, 400);
    const ok = await t.call('/sms/subscribe-link', { method: 'POST', headers: S, body: { phone: '(239) 555-0123' } });
    assert.deepEqual([ok.status, ok.data.to], [200, '(239) 555-0123']);
    assert.equal(tx.sent.length, 1);
    assert.deepEqual([tx.sent[0].from, tx.sent[0].to], ['+12395550100', '+12395550123']);
    assert.match(tx.sent[0].text, /hi kj! Subscribe or renew here: https:\/\/w\.test\/subscribe\/ .*Reply CASH.*Reply STOP to opt out/);
    // The same number twice a day at most; the person 3 a day.
    await t.call('/sms/subscribe-link', { method: 'POST', headers: S, body: { phone: '2395550123' } });
    const third = await t.call('/sms/subscribe-link', { method: 'POST', headers: S, body: { phone: '2395550123' } });
    assert.equal(third.status, 429); assert.match(third.data.error, /twice today/);
    await t.call('/sms/subscribe-link', { method: 'POST', headers: S, body: { phone: '2395550124' } });
    const fourth = await t.call('/sms/subscribe-link', { method: 'POST', headers: S, body: { phone: '2395550125' } });
    assert.equal(fourth.status, 429); assert.match(fourth.data.error, /3 times a day/);
    assert.equal(tx.sent.length, 3);
    // A number that texted STOP is never texted.
    await t.inbound('+12395550199', 'STOP');
    const tok2 = await t.signUp('ana');
    const opted = await t.call('/sms/subscribe-link', { method: 'POST', headers: { 'X-GPA-Session': tok2 }, body: { phone: '2395550199' } });
    assert.equal(opted.status, 409); assert.match(opted.data.error, /opted out/);
    // Without the Telnyx keys: off (the Renew box shows the link instead).
    const off = setup({ TELNYX_API_KEY: '' });
    assert.equal((await off.call('/sms/info')).data.sms, false);
    const offTok = await off.signUp('kj');
    assert.equal((await off.call('/sms/subscribe-link', { method: 'POST', headers: { 'X-GPA-Session': offTok }, body: { phone: '2395550123' } })).status, 503);
  } finally { tx.restore(); }
});

test('sms: replies — CASH says who to pay (owner + admins, or the owner’s list) and alerts; STOP/START/HELP; bad signatures refused', async () => {
  const tx = stubTelnyx();
  try {
    const t = setup();
    // ana is an admin; kj asked for the link from this number earlier.
    await t.signUp('ana');
    await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'ana', action: 'setrole', role: 'admin' } });
    const kjTok = await t.signUp('kj');
    await t.call('/sms/subscribe-link', { method: 'POST', headers: { 'X-GPA-Session': kjTok }, body: { phone: '2395550123' } });
    const before = tx.sent.length;
    // A forged webhook (wrong key) is refused and nothing is sent.
    const forged = await t.inbound('+12395550123', 'CASH', { sig: b64(new Uint8Array(64)) });
    assert.equal(forged.status, 401);
    assert.equal(tx.sent.length, before);
    // CASH: who to pay, automatically the owner and the admins.
    assert.equal((await t.inbound('+12395550123', 'im paying cash')).status, 200);
    const reply = tx.sent[tx.sent.length - 1];
    assert.equal(reply.to, '+12395550123');
    assert.match(reply.text, /paying cash\? Give the monthly price in person to boss \(owner\) or ana\. They mark you as paid\./);
    // The owner's card shows who texted CASH (by name, since kj asked for the link from that number).
    const card = (await t.call('/admin/sms', { headers: owner })).data;
    assert.deepEqual(card.recent.map((x) => [x.user, x.phone]), [['kj', '(239) 555-0123']]);
    assert.deepEqual(card.autoNames, ['boss (owner)', 'ana']);
    // The owner sets their own list.
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { cashNames: 'Mr. Lopez\nana' } });
    await t.inbound('+12395550188', 'CASH');
    assert.match(tx.sent[tx.sent.length - 1].text, /in person to Mr\. Lopez or ana\./);
    assert.deepEqual((await t.call('/sms/info')).data.cash, ['Mr. Lopez', 'ana']);
    // The same webhook delivered twice is handled once.
    const n = tx.sent.length;
    await t.inbound('+12395550188', 'CASH', { id: 'ev_same' });
    await t.inbound('+12395550188', 'CASH', { id: 'ev_same' });
    assert.equal(tx.sent.length, n + 1);
    // STOP: confirmation, then silence; START turns it back on; HELP explains.
    await t.inbound('+12395550177', 'STOP');
    assert.match(tx.sent[tx.sent.length - 1].text, /unsubscribed/);
    const m = tx.sent.length;
    await t.inbound('+12395550177', 'CASH');
    assert.equal(tx.sent.length, m, 'no texts after STOP');
    await t.inbound('+12395550177', 'START');
    assert.match(tx.sent[tx.sent.length - 1].text, /you’ll get texts again/);
    await t.inbound('+12395550177', 'HELP');
    assert.match(tx.sent[tx.sent.length - 1].text, /subscribe or renew at https:\/\/w\.test\/subscribe\/ .*Reply CASH/);
    // Only the owner sees the card.
    assert.equal((await t.call('/admin/sms', { headers: { 'X-GPA-Session': kjTok } })).status >= 401, true);
  } finally { tx.restore(); }
});
