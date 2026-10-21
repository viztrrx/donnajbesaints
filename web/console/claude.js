// Claude in the admin console (Admin → Claude), for the owner and admins.
//
// Each message runs Claude Code on this repository in GitHub Actions
// (.github/workflows/claude-chat.yml) on the owner's Claude Pro plan, through
// the CLAUDE_CODE_OAUTH_TOKEN repository secret. Claude edits the code, the
// workflow checks it (syntax and the test suite) and pushes to main, and
// Cloudflare deploys it like any other push. The run then posts its reply,
// usage and commit back to /claude/callback, which stores them here.
//
// Worker settings:
//   GITHUB_TOKEN           — secret: fine-grained token for the repository
//                            with Actions: Read and write (to start runs).
//   CLAUDE_CALLBACK_SECRET — secret: the same value as the repository secret
//                            of that name; proves a callback came from the run.
//   CLAUDE_REPO            — optional, defaults to viztrrx/work-service.
//   CLAUDE_ADMIN_DAILY     — optional, messages per admin per day (25).
//
// KV: claude:conv:<id> (one conversation), claude:convs (the index) and
// claude:usage:<day> (totals for the usage meter).

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Most capable for code. Uses your plan’s limits fastest.' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Fast and strong. The everyday pick.' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'Quickest and lightest on your limits, for small changes.' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'Newest model family.' }
];
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const CLAUDE_DEFAULTS = { model: 'claude-opus-5-5', effort: 'high' };

const WORKFLOW = 'claude-chat.yml';
const MAX_TEXT = 8000;            // one message
const MAX_PROMPT = 40000;         // the whole conversation sent to the run
const MAX_REPLY = 30000;
const MAX_CONVS = 60;
const STALE_MS = 50 * 60 * 1000;  // no callback by then: the run died or was cancelled
const USAGE_TTL = 60 * 60 * 24 * 40;
const ID_RE = /^[a-z0-9]{12,40}$/;

const repoOf = (env) => String((env && env.CLAUDE_REPO) || 'viztrrx/work-service');
const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
const newId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Compares two secrets through fixed-length digests, so timing says nothing
// about how much of a guess was right.
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map((x) => crypto.subtle.digest('SHA-256', enc.encode(String(x || '')))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && !!a && !!b;
}

const getConv = (kv, id) => (ID_RE.test(id || '') ? kv.get('claude:conv:' + id, 'json') : null);
async function putConv(kv, conv) {
  conv.updated = Date.now();
  await kv.put('claude:conv:' + conv.id, JSON.stringify(conv));
  const index = ((await kv.get('claude:convs', 'json')) || []).filter((c) => c.id !== conv.id);
  index.unshift(summary(conv));
  const keep = index.slice(0, MAX_CONVS);
  for (const old of index.slice(MAX_CONVS)) await kv.delete('claude:conv:' + old.id);
  await kv.put('claude:convs', JSON.stringify(keep));
}
function summary(conv) {
  const last = conv.messages[conv.messages.length - 1];
  return { id: conv.id, title: conv.title, by: conv.by, updated: conv.updated, created: conv.created, status: last && last.role === 'assistant' ? last.status : 'done', count: conv.messages.length };
}
const busy = (m) => m && m.role === 'assistant' && (m.status === 'queued' || m.status === 'running');

// A message with no callback for STALE_MS is marked failed, so the chat
// never waits forever on a run that was cancelled or never started.
function settleStale(conv) {
  let changed = false;
  for (const m of conv.messages) {
    if (busy(m) && Date.now() - m.ts > STALE_MS) {
      m.status = 'error';
      m.error = 'No result came back from GitHub. The run may have been cancelled or timed out; open it to see why.';
      changed = true;
    }
  }
  return changed;
}

// The text the run gets: earlier turns (newest kept when it's too long),
// then the new message.
function buildPrompt(conv, text, by) {
  const turns = [];
  for (const m of conv.messages) {
    if (m.role === 'user') turns.push(`${m.by}: ${m.text}`);
    else if (m.status === 'done' || m.status === 'error') turns.push(`Claude: ${m.text || m.error || ''}${m.commit ? `\n(Pushed commit ${m.commit})` : ''}`);
  }
  let history = turns.join('\n\n');
  const room = MAX_PROMPT - text.length - 200;
  if (history.length > room) history = '…' + history.slice(history.length - room);
  return (history ? `Earlier in this conversation:\n\n${history}\n\n---\n\n` : '') + `New message from ${by}:\n\n${text}`;
}

async function usageFor(kv, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = dayOf(Date.now() - i * 86400000);
    out.push({ day, ...((await kv.get('claude:usage:' + day, 'json')) || { n: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, ms: 0, byModel: {}, byUser: {} }) });
  }
  return out;
}
async function addUsage(kv, by, model, u) {
  const key = 'claude:usage:' + dayOf(Date.now());
  const d = (await kv.get(key, 'json')) || { n: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, ms: 0, byModel: {}, byUser: {} };
  d.n += 1; d.input += u.input; d.output += u.output; d.cacheRead += u.cacheRead; d.cacheWrite += u.cacheWrite; d.cost += u.cost; d.ms += u.ms;
  const bm = d.byModel[model] || (d.byModel[model] = { n: 0, input: 0, output: 0, cost: 0 });
  bm.n += 1; bm.input += u.input; bm.output += u.output; bm.cost += u.cost;
  d.byUser[by] = (d.byUser[by] || 0) + 1;
  await kv.put(key, JSON.stringify(d), { expirationTtl: USAGE_TTL });
}
// Messages this person sent today (started runs, from the conversations).
async function sentToday(kv, by) {
  const d = await kv.get('claude:sent:' + dayOf(Date.now()), 'json');
  return (d && d[by]) || 0;
}
async function noteSent(kv, by) {
  const key = 'claude:sent:' + dayOf(Date.now());
  const d = (await kv.get(key, 'json')) || {};
  d[by] = (d[by] || 0) + 1;
  await kv.put(key, JSON.stringify(d), { expirationTtl: USAGE_TTL });
}

async function dispatch(env, inputs) {
  const res = await fetch(`https://api.github.com/repos/${repoOf(env)}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'work-service-admin-claude',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref: 'main', inputs })
  });
  if (res.status === 204 || res.ok) return null;
  let detail = '';
  try { detail = (await res.json()).message || ''; } catch (e) { /* no body */ }
  if (res.status === 401) return 'GitHub rejected GITHUB_TOKEN (expired or wrong). Make a new one and update the Worker secret.';
  if (res.status === 403 || res.status === 404) return `GitHub refused to start the run (${res.status}${detail ? ': ' + detail : ''}). The token needs Actions: Read and write on ${repoOf(env)}, and ${WORKFLOW} must be on main.`;
  return `GitHub error ${res.status}${detail ? ': ' + detail : ''}`;
}

// ---- /admin/claude/* (worker.js has already checked claude.use) ------------
export async function handleClaudeAdmin({ req, url, env, principal, owner, json, logAudit }) {
  const kv = env.TELEMETRY;
  const isOwner = principal.role === 'owner';
  const me = isOwner ? owner : String(principal.user || principal.actor || principal.role).slice(0, 40);
  const mine = (c) => isOwner || c.by === me;
  const readBody = async () => { try { const raw = await req.text(); if (raw.length > 64000) return null; return JSON.parse(raw) || {}; } catch (e) { return {}; } };
  const ready = { github: !!env.GITHUB_TOKEN, callback: !!env.CLAUDE_CALLBACK_SECRET };

  if (url.pathname === '/admin/claude/convs') {
    const all = (await kv.get('claude:convs', 'json')) || [];
    const days = await usageFor(kv, 7);
    const limit = isOwner ? null : Number(env.CLAUDE_ADMIN_DAILY || 25);
    return json({
      ok: true, me, isOwner, ready, repo: repoOf(env),
      models: CLAUDE_MODELS, efforts: CLAUDE_EFFORTS, defaults: CLAUDE_DEFAULTS,
      convs: all.filter(mine),
      usage: { days, limit, sentToday: await sentToday(kv, me) }
    });
  }

  if (url.pathname === '/admin/claude/conv') {
    const conv = await getConv(kv, url.searchParams.get('id'));
    if (!conv || !mine(conv)) return json({ error: 'Conversation not found' }, 404);
    if (settleStale(conv)) await putConv(kv, conv);
    return json({ ok: true, conv });
  }

  if (url.pathname === '/admin/claude/delete') {
    const body = await readBody();
    const conv = await getConv(kv, body && body.id);
    if (!conv || !mine(conv)) return json({ error: 'Conversation not found' }, 404);
    await kv.delete('claude:conv:' + conv.id);
    const index = ((await kv.get('claude:convs', 'json')) || []).filter((c) => c.id !== conv.id);
    await kv.put('claude:convs', JSON.stringify(index));
    await logAudit(kv, { route: url.pathname, action: 'claude_delete', target: conv.id });
    return json({ ok: true });
  }

  if (url.pathname === '/admin/claude/send') {
    if (!ready.github || !ready.callback) return json({ error: 'Claude isn’t set up yet: the Worker needs the GITHUB_TOKEN and CLAUDE_CALLBACK_SECRET secrets (see the setup card).' }, 503);
    const body = await readBody();
    if (!body) return json({ error: 'Message too long' }, 413);
    const text = String(body.text || '').trim();
    if (!text) return json({ error: 'Type a message first' }, 400);
    if (text.length > MAX_TEXT) return json({ error: `Keep a message under ${MAX_TEXT.toLocaleString()} characters` }, 400);
    const model = CLAUDE_MODELS.some((m) => m.id === body.model) ? body.model : CLAUDE_DEFAULTS.model;
    const effort = CLAUDE_EFFORTS.includes(body.effort) ? body.effort : CLAUDE_DEFAULTS.effort;
    if (!isOwner) {
      const limit = Number(env.CLAUDE_ADMIN_DAILY || 25);
      if ((await sentToday(kv, me)) >= limit) return json({ error: `You’ve sent today’s ${limit} Claude messages. The owner can raise this with CLAUDE_ADMIN_DAILY.` }, 429);
    }

    let conv;
    if (body.convId) {
      conv = await getConv(kv, body.convId);
      if (!conv || !mine(conv)) return json({ error: 'Conversation not found' }, 404);
      settleStale(conv);
      if (conv.messages.some(busy)) return json({ error: 'Claude is still working on the last message in this chat' }, 409);
    } else {
      conv = { id: newId(), title: clip(text.replace(/\s+/g, ' '), 70), by: me, byRole: principal.role, created: Date.now(), messages: [] };
    }
    conv.model = model; conv.effort = effort;
    const now = Date.now();
    const prompt = buildPrompt(conv, text, me);
    conv.messages.push({ id: newId(), role: 'user', by: me, text, ts: now });
    const reqId = newId();
    const reply = { id: reqId, role: 'assistant', status: 'queued', model, effort, ts: now, text: '' };
    conv.messages.push(reply);

    const err = await dispatch(env, {
      request_id: reqId, conv_id: conv.id, model, effort,
      requested_by: me, prompt, callback_url: url.origin + '/claude/callback'
    });
    if (err) { reply.status = 'error'; reply.error = err; }
    else await noteSent(kv, me);
    await putConv(kv, conv);
    await logAudit(kv, { route: url.pathname, action: 'claude_send', target: conv.id, meta: { model, effort, chars: text.length, ok: !err } });
    if (err) return json({ ok: false, error: err, conv }, 502);
    return json({ ok: true, conv });
  }
  return json({ error: 'not found' }, 404);
}

// ---- /claude/callback: the GitHub run reporting progress and its result ----
export async function handleClaudeCallback(req, env, json) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!env.CLAUDE_CALLBACK_SECRET || !env.TELEMETRY) return json({ error: 'not configured' }, 503);
  if (!(await sameSecret(req.headers.get('X-Claude-Callback'), env.CLAUDE_CALLBACK_SECRET))) return json({ error: 'unauthorized' }, 401);
  let b;
  try { const raw = await req.text(); if (raw.length > 120000) return json({ error: 'too large' }, 413); b = JSON.parse(raw); } catch (e) { return json({ error: 'bad json' }, 400); }
  if (!b || !ID_RE.test(b.request_id || '') || !ID_RE.test(b.conv_id || '')) return json({ error: 'bad ids' }, 400);
  const kv = env.TELEMETRY;
  const conv = await getConv(kv, b.conv_id);
  const m = conv && conv.messages.find((x) => x.id === b.request_id && x.role === 'assistant');
  if (!m) return json({ error: 'unknown request' }, 404);
  if (m.status === 'done' || m.status === 'error') return json({ ok: true, ignored: true });   // a late duplicate

  if (b.run_url && /^https:\/\/github\.com\//.test(b.run_url)) m.runUrl = clip(b.run_url, 300);
  if (b.status === 'running') {
    m.status = 'running';
    m.started = Date.now();
  } else {
    m.status = b.status === 'done' ? 'done' : 'error';
    m.text = clip(b.reply, MAX_REPLY);
    if (b.error) m.error = clip(b.error, 2000);
    if (/^[0-9a-f]{7,40}$/.test(b.commit || '')) m.commit = b.commit;
    m.files = Array.isArray(b.files) ? b.files.slice(0, 80).map((f) => clip(f, 200)) : [];
    m.tests = clip(b.tests, 4000);
    const u = b.usage || {};
    m.usage = {
      input: num(u.input), output: num(u.output), cacheRead: num(u.cache_read), cacheWrite: num(u.cache_write),
      cost: num(u.cost_usd), ms: num(u.duration_ms), turns: num(u.turns)
    };
    m.finished = Date.now();
    if (m.usage.input || m.usage.output) await addUsage(kv, conv.by, m.model, m.usage);
  }
  await putConv(kv, conv);
  return json({ ok: true });
}
