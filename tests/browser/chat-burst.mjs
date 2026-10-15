// Chat delivery against worker.js in workerd (the real Cloudflare runtime,
// with the CHAT_ROOMS Durable Object from wrangler.jsonc): many messages sent
// at the same moment all arrive, in order, and a client that keeps polling
// with "since" sees every one of them.
//   node tests/browser/chat-burst.mjs
import { startEnv } from './env.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef' } });
const W = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'text/plain' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const run = Date.now().toString(36).slice(-4);
try {
  const start = (await W('/chat/poll?room=public&since=0')).now;
  let since = start;
  const seen = new Set();
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const d = await W('/chat/poll?room=public&since=' + since);
      for (const m of d.messages || []) { if (m.t.endsWith(run)) seen.add(m.t); since = Math.max(since, m.ts); }
      await new Promise((r) => setTimeout(r, 40));
    }
  })();
  const N = 50;
  const sent = await Promise.all(Array.from({ length: N }, (_, i) => W('/chat/send', { user: 'p' + (i % 9) + run, text: `burst ${i} ${run}`, room: 'public' })));
  check(`${N} messages sent at the same moment are all accepted`, sent.every((r) => r.ok), JSON.stringify(sent.find((r) => !r.ok) || ''));
  await new Promise((r) => setTimeout(r, 800));
  polling = false; await poller;
  const all = ((await W('/chat/poll?room=public&since=' + start)).messages || []).filter((m) => m.t.endsWith(run));
  check('All of them are in the room log', all.length === N, `${all.length}/${N}`);
  check('In strictly increasing time order', all.every((m, i) => i === 0 || m.ts > all[i - 1].ts));
  check('A client polling the whole time saw every one', seen.size === N, `${seen.size}/${N}`);
} finally { await env.close(); }
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
