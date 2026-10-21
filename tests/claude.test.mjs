// Admin → Claude: the chat routes, starting a GitHub run and the run's
// callback. GitHub is stubbed. Run with `npm test`.
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
const SECRET = 'callback-secret-abcdefghijklmnop';
const owner = { Authorization: 'Bearer ' + ADMIN };

const dispatches = [];
let githubStatus = 204;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.github.com/')) return realFetch(url, init);
  dispatches.push({ url: u, auth: init.headers.Authorization, body: JSON.parse(init.body) });
  return githubStatus === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ message: 'nope' }), { status: githubStatus });
};

function setup(extra = {}) {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', GITHUB_TOKEN: 'ghp_test', CLAUDE_CALLBACK_SECRET: SECRET, ...extra };
  const ctx = { waitUntil: () => {} };
  const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { env, call };
}
const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
async function sessionFor(t, user, role) {
  await t.call('/auth/register', { method: 'POST', body: { user, verifier: v(user) } });
  if (role) await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: user, action: 'setrole', role } });
  const r = await t.call('/auth/login', { method: 'POST', body: { user, verifier: v(user) } });
  return { 'X-GPA-Session': r.data.token };
}
const callback = (t, body, secret = SECRET) => t.call('/claude/callback', { method: 'POST', headers: { 'X-Claude-Callback': secret }, body });

test('claude: owner sends a message, the run reports back, usage adds up', async () => {
  const t = setup();
  dispatches.length = 0;
  const info = await t.call('/admin/claude/convs', { headers: owner });
  assert.equal(info.status, 200);
  assert.deepEqual(info.data.ready, { github: true, callback: true });
  assert.ok(info.data.models.length >= 3);

  const sent = await t.call('/admin/claude/send', { method: 'POST', headers: owner, body: { text: 'Make the play button bigger', model: 'claude-sonnet-5-5', effort: 'medium' } });
  assert.equal(sent.status, 200);
  const conv = sent.data.conv;
  assert.equal(conv.messages.length, 2);
  const reply = conv.messages[1];
  assert.equal(reply.status, 'queued');
  assert.equal(dispatches.length, 1);
  const d = dispatches[0];
  assert.match(d.url, /\/repos\/viztrrx\/work-service\/actions\/workflows\/claude-chat\.yml\/dispatches$/);
  assert.equal(d.auth, 'Bearer ghp_test');
  assert.equal(d.body.ref, 'main');
  assert.equal(d.body.inputs.model, 'claude-sonnet-5-5');
  assert.equal(d.body.inputs.callback_url, 'https://w.test/claude/callback');
  assert.match(d.body.inputs.prompt, /Make the play button bigger/);

  // A second message in the same chat waits for the first.
  assert.equal((await t.call('/admin/claude/send', { method: 'POST', headers: owner, body: { convId: conv.id, text: 'and blue' } })).status, 409);

  // The callback needs the shared secret.
  assert.equal((await callback(t, { request_id: reply.id, conv_id: conv.id, status: 'running' }, 'wrong')).status, 401);
  assert.equal((await callback(t, { request_id: reply.id, conv_id: conv.id, status: 'running', run_url: 'https://github.com/x/y/actions/runs/1' })).status, 200);
  let got = await t.call('/admin/claude/conv?id=' + conv.id, { headers: owner });
  assert.equal(got.data.conv.messages[1].status, 'running');

  await callback(t, { request_id: reply.id, conv_id: conv.id, status: 'done', reply: 'Made it bigger.', commit: 'abcdef1234567', files: ['script.js'],
    usage: { input: 1000, output: 200, cache_read: 5000, cache_write: 100, cost_usd: 0.42, duration_ms: 61000, turns: 9 } });
  got = await t.call('/admin/claude/conv?id=' + conv.id, { headers: owner });
  const m = got.data.conv.messages[1];
  assert.equal(m.status, 'done');
  assert.equal(m.text, 'Made it bigger.');
  assert.equal(m.commit, 'abcdef1234567');
  assert.deepEqual(m.files, ['script.js']);
  assert.equal(m.usage.cost, 0.42);
  const after = await t.call('/admin/claude/convs', { headers: owner });
  assert.equal(after.data.usage.days[0].n, 1);
  assert.equal(after.data.usage.days[0].input, 1000);

  // Follow-ups carry the conversation so far.
  const next = await t.call('/admin/claude/send', { method: 'POST', headers: owner, body: { convId: conv.id, text: 'Now make it blue' } });
  assert.equal(next.status, 200);
  const p = dispatches[1].body.inputs.prompt;
  assert.match(p, /Earlier in this conversation/);
  assert.match(p, /Made it bigger\./);
  assert.match(p, /New message from boss:\n\nNow make it blue$/);
});

test('claude: admins can use it and see only their own chats; moderators and users cannot', async () => {
  const t = setup({ CLAUDE_ADMIN_DAILY: '1' });
  const adm = await sessionFor(t, 'ally', 'admin');
  const mod = await sessionFor(t, 'mo', 'moderator');
  const usr = await sessionFor(t, 'uma');
  assert.equal((await t.call('/admin/claude/convs', { headers: mod })).status, 403);
  assert.equal((await t.call('/admin/claude/convs', { headers: usr })).status, 403);
  assert.equal((await t.call('/admin/claude/convs')).status, 401);

  const mine = await t.call('/admin/claude/send', { method: 'POST', headers: adm, body: { text: 'hello' } });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.conv.by, 'ally');
  assert.equal((await t.call('/admin/claude/send', { method: 'POST', headers: adm, body: { text: 'again' } })).status, 429, 'daily cap for admins');

  const ownerChat = await t.call('/admin/claude/send', { method: 'POST', headers: owner, body: { text: 'owner only' } });
  const list = await t.call('/admin/claude/convs', { headers: adm });
  assert.deepEqual(list.data.convs.map((c) => c.by), ['ally']);
  assert.equal((await t.call('/admin/claude/conv?id=' + ownerChat.data.conv.id, { headers: adm })).status, 404);
  assert.equal((await t.call('/admin/claude/convs', { headers: owner })).data.convs.length, 2, 'the owner sees everyone’s');
});

test('claude: not set up, GitHub refusing, and bad input', async () => {
  const bare = setup({ GITHUB_TOKEN: '', CLAUDE_CALLBACK_SECRET: '' });
  assert.equal((await bare.call('/admin/claude/send', { method: 'POST', headers: owner, body: { text: 'hi' } })).status, 503);
  assert.equal((await bare.call('/claude/callback', { method: 'POST', body: {} })).status, 503);

  const t = setup();
  assert.equal((await t.call('/admin/claude/send', { method: 'POST', headers: owner, body: { text: '  ' } })).status, 400);
  assert.equal((await t.call('/admin/claude/send', { method: 'POST', headers: owner, body: { text: 'x'.repeat(9000) } })).status, 400);
  githubStatus = 403;
  try {
    const r = await t.call('/admin/claude/send', { method: 'POST', headers: owner, body: { text: 'hi', model: 'not-a-model' } });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /Actions: Read and write/);
    assert.equal(r.data.conv.messages[1].status, 'error');
    assert.equal(r.data.conv.model, 'claude-opus-5-5', 'unknown models fall back to the default');
  } finally { githubStatus = 204; }
  assert.equal((await callback(t, { request_id: 'NOPE', conv_id: 'x' })).status, 400);
});
