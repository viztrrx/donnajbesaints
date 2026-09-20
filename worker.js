// Agent Console — Cloudflare Worker proxy
// Deploy: Cloudflare dashboard → Workers & Pages → donnajbesaints → Edit code →
// replace ALL of the code with this file → Deploy.
//
// What it does:
//   OPTIONS            — answers CORS preflights itself. Browsers send one
//                        before the real API call; forwarding it to OpenAI
//                        gets a response that doesn't allow the Authorization
//                        header, and the browser then blocks the real request.
//   /v1/*              — forwards to api.openai.com (chat completions etc.)
//   /gemini/*          — forwards to generativelanguage.googleapis.com, with
//                        the key attached server-side as x-goog-api-key.
//   /read?url=…        — fetches a public web page server-side and returns it
//                        as inert text so research mode can read pages the
//                        browser itself is not allowed to fetch (CORS).
//   Anything else      — 404. Unrouted paths are never forwarded anywhere.
//
// SECURITY MODEL (read this before changing a route):
//   * The worker is the ONLY enforcement point. script.js runs inside whatever
//     page the user loaded it on; every check there is a convenience, and
//     anyone with DevTools can turn it off. Nothing may be trusted because the
//     client said so.
//   * Admin credentials travel in `Authorization: Bearer <token>`, never in
//     the URL, and are compared in constant time. Every /admin/* path must be
//     listed in ADMIN_ROUTES with the role it needs or it 404s.
//   * API keys assigned by the owner never leave this worker. They are
//     attached to the upstream request here; the browser is told only whether
//     a key exists for it (a boolean), never its value.
//   * Anything written to KV or handed to the admin console is scrubbed first
//     (URLs lose their query strings; tokens and guesses are never logged).
//
// Env vars: TELEMETRY (KV binding), ADMIN_TOKEN (owner secret), OWNER
// (username, defaults 'viztrrx'). Optional, all off unless set:
//   OWNER_CODE     — a shared secret a client must send as the X-GPA-Owner
//                    header to post to /track or /chat/send as the OWNER
//                    username. Prevents anyone else from claiming that name.
//   COADMIN_TOKEN  — a second, lower-privilege admin token. A request
//                    bearing it may call /admin/moderate, /admin/rooms,
//                    /admin/clearchat, /admin/setunlock, /admin/summary, but
//                    gets 403 on /admin/assignkey, /admin/config,
//                    /admin/clear, /admin/audit, /admin/backup, /admin/restore.
//   ALLOW_QUERY_TOKEN — set to "1" ONLY to let an old client keep passing the
//                    admin token as ?token=… while it is being updated. Off by
//                    default; every use is recorded in the audit trail.
//
// Moderation additions on top of the existing block/lock/kick (all via
// /admin/moderate action, all reversible, all no-ops until used):
//   mute/unmute        — a timed block (hours) that self-expires; no manual
//                        unblock needed.
//   warn/clearstrikes  — 3 warnings auto-escalates to a 24h mute and resets.
//   approve/unapprove  — releases/re-flags a user held by approvalMode.
//   freezeai/unfreezeai — cuts off only /v1/*; chat and /read keep working.
//   shadowmute/unshadowmute — messages "send" successfully but are never
//                        stored or shown to anyone.
//   setfeatures        — per-user feature-flag overrides, merged over the
//                        global features map in /track and /status.
// /admin/rooms additions: slowmode (id, seconds) and banuser/unbanuser (id,
// user) — a per-room cooldown and ban list, public room included.
// /admin/config additions: readOnly (chat accepts only the owner),
// approvalMode (new usernames start pending), blockedCountries (2-letter cf
// country codes, blocks /v1/* and /chat/send), allowedModels + maxTokens
// (caps on /v1/* request bodies), allowedOrigins (Origin allowlist for
// /v1/*) — every one defaults to off/empty, i.e. today's behavior.
// /admin/audit (GET) — last 100 admin actions, newest first, 90-day TTL.
// /admin/backup (GET) / /admin/restore (POST) — full state export/import
// (config, moderation records, rooms, audit), owner only.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GPA-Key, X-GPA-User, X-GPA-Owner',
  'Access-Control-Max-Age': '86400'
};
// Applied to every response this worker generates itself. no-store keeps admin
// payloads and per-user state out of shared caches; no-referrer stops the URL
// of a request (which may carry a room code) from being handed to the next
// site; nosniff stops a text response being re-read as something executable.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Vary': 'Origin'
};
const jsonResponse = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: { ...CORS_HEADERS, ...SECURITY_HEADERS, 'Content-Type': 'application/json' }
});

export default {
  // WHY THIS WRAPPER EXISTS: when a worker throws, Cloudflare replies with a
  // bare 500 carrying no Access-Control-Allow-Origin header. The browser then
  // reports "blocked by CORS policy" and hides the actual error, which sends
  // you hunting for a CORS bug that was never there. Catching here means the
  // real reason always reaches the client, with CORS headers on it.
  async fetch(req, env) {
    try {
      return await handleRequest(req, env);
    } catch (err) {
      // Also goes to the Workers live log (dashboard → the worker → Logs), so
      // the full error is recoverable server-side even though the response
      // deliberately carries only a short message.
      console.error('Worker error:', err);
      return jsonResponse({
        error: {
          message: 'The worker hit an unexpected error handling this request.',
          type: 'worker_exception',
          // The message only — never a stack (names internals) and never the
          // request body (may carry an API key).
          detail: String((err && err.message) || err).slice(0, 200),
          path: (() => { try { return new URL(req.url).pathname; } catch (e) { return ''; } })()
        }
      }, 500);
    }
  },

  // Daily chat reset. Cloudflare Cron Triggers run in UTC and don't shift for
  // daylight saving, so this fixed UTC time drifts by an hour against local
  // New York time across the DST boundary (early Nov/mid Mar) — set here to
  // land at local midnight during EST; during EDT it'll fire at 1am instead.
  // Add/adjust the actual schedule in the dashboard: Workers & Pages →
  // donnajbesaints → Triggers → Cron Triggers → Add "0 5 * * *".
  async scheduled(event, env, ctx) {
    const kv = env && env.TELEMETRY;
    if (!kv) return;
    ctx.waitUntil(clearAllChatMessages(kv));
  }
};

async function handleRequest(req, env) {
    const cors = CORS_HEADERS;
    const json = jsonResponse;

    // Moderation state for one user: active (default), blocked, or locked,
    // plus a kick counter the client compares against to force a one-time
    // sign-out. Read wherever we need to enforce or report it.
    // The owner is immune to all moderation and always allowed, even in
    // private mode. Defaults to 'viztrrx'; override with an OWNER env var.
    const OWNER = String((env && env.OWNER) || 'viztrrx').toLowerCase();

    const getMod = async (kv, user) => {
      if (!kv || !user) return { state: 'active', reason: '', kickNonce: 0 };
      const m = await kv.get('mod:' + String(user).toLowerCase(), 'json');
      return m || { state: 'active', reason: '', kickNonce: 0 };
    };

    // ---- Roles ------------------------------------------------------------
    // Two roles, defined once here rather than re-derived per route:
    //   owner   — full control, including anything that can spend money or
    //             read/alter whole-system state (keys, config, wipes, audit,
    //             backup/restore).
    //   coadmin — day-to-day moderation only (mute, kick, rooms, unlock
    //             codes, the summary they need to know who to moderate).
    // COADMIN_TOKEN is unset by default, so the co-admin role simply doesn't
    // exist until the owner opts in.
    const ROLE_RANK = { coadmin: 1, owner: 2 };
    const roleAllows = (level, need) => !!level && (ROLE_RANK[level] || 0) >= (ROLE_RANK[need] || 0);

    // The admin credential travels in the Authorization header, never the URL:
    // a token in a query string ends up in request logs, Referer headers,
    // browser history and screenshots. `?token=` is refused unless the owner
    // deliberately re-enables it with ALLOW_QUERY_TOKEN=1 while migrating an
    // old client, and even then it is flagged in the audit trail.
    const presentedToken = (req, url, env) => {
      const m = /^Bearer\s+(.+)$/i.exec((req.headers.get('Authorization') || '').trim());
      if (m) return { token: m[1].trim(), viaQuery: false };
      if (env && env.ALLOW_QUERY_TOKEN === '1') {
        const q = url.searchParams.get('token') || '';
        if (q) return { token: q, viaQuery: true };
      }
      return { token: '', viaQuery: false };
    };
    // Set by guard() so audit entries can record who acted without every call
    // site re-running the comparison.
    let authedLevel = null;
    let authedViaQuery = false;
    const authLevel = async (req, url, env) => {
      const { token, viaQuery } = presentedToken(req, url, env);
      if (!token) return null;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      const COADMIN = (env && env.COADMIN_TOKEN) || '';
      // Both comparisons always run: returning early on the first match would
      // leak which token was presented through the response time.
      const isOwner = ADMIN ? await timingSafeEqualStr(token, ADMIN) : false;
      const isCoadmin = COADMIN ? await timingSafeEqualStr(token, COADMIN) : false;
      const level = isOwner ? 'owner' : (isCoadmin ? 'coadmin' : null);
      if (level) authedViaQuery = viaQuery;
      return level;
    };

    // ---- Failed-auth throttling -------------------------------------------
    // Guessing an admin token or an unlock code should get slower, not stay
    // free. Counters live in KV keyed by a hash of the client IP, so the raw
    // address is never written down. KV reads are eventually consistent (up to
    // ~60s), so this slows sustained brute force rather than being an exact
    // per-request counter — it is a speed bump layered under a real secret,
    // not the only thing standing in the way.
    const clientIp = (req) => req.headers.get('CF-Connecting-IP') || req.headers.get('X-Real-IP') || '';
    const FAIL_LIMITS = { admin: { max: 10, windowSec: 900 }, unlock: { max: 8, windowSec: 900 } };
    const failKey = async (scope, ip) => `fail:${scope}:${(await sha256hex(String(ip || 'unknown'))).slice(0, 32)}`;
    const isLockedOut = async (kv, scope, ip) => {
      if (!kv) return false;
      try {
        const n = parseInt(await kv.get(await failKey(scope, ip)), 10) || 0;
        return n >= FAIL_LIMITS[scope].max;
      } catch (e) { return false; }
    };
    const noteFailure = async (kv, scope, ip) => {
      if (!kv) return;
      try {
        const k = await failKey(scope, ip);
        const n = parseInt(await kv.get(k), 10) || 0;
        await kv.put(k, String(n + 1), { expirationTtl: FAIL_LIMITS[scope].windowSec });
      } catch (e) { /* throttling must never break the route itself */ }
    };
    const clearFailures = async (kv, scope, ip) => {
      if (!kv) return;
      try { await kv.delete(await failKey(scope, ip)); } catch (e) { /* best-effort */ }
    };

    // Single gate for every admin route. Returns a Response to send back
    // immediately, or null when the caller holds `need` or better.
    const guard = async (req, url, env, need) => {
      const kv = env && env.TELEMETRY;
      const ip = clientIp(req);
      if (await isLockedOut(kv, 'admin', ip)) {
        return json({ error: 'too many failed attempts — try again later' }, 429);
      }
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!ADMIN) return json({ error: 'ADMIN_TOKEN not set on the worker' }, 500);
      const level = await authLevel(req, url, env);
      if (!level) {
        await noteFailure(kv, 'admin', ip);
        // Never record the presented token — an audit trail is not a place to
        // collect guesses at your own secret.
        await logAudit(kv, { route: url.pathname, action: 'auth_failed', target: null, admin: null });
        return json({ error: 'unauthorized' }, 401);
      }
      authedLevel = level;
      await clearFailures(kv, 'admin', ip);
      if (!roleAllows(level, need)) {
        await logAudit(kv, { route: url.pathname, action: 'forbidden', target: null, admin: level });
        return json({ error: `forbidden — ${need} only` }, 403);
      }
      if (authedViaQuery) {
        await logAudit(kv, { route: url.pathname, action: 'legacy_query_token', target: null, admin: level });
      }
      return null;
    };
    const requireOwner = (req, url, env) => guard(req, url, env, 'owner');
    const requireStaff = (req, url, env) => guard(req, url, env, 'coadmin');
    // Hashes both sides to a fixed-length digest before comparing, so neither
    // the comparison time nor an early-exit reveals how much of the guess was
    // right or how long the real value is. Used only for OWNER_CODE, the
    // shared secret that proves a client claiming the owner's username
    // actually is the owner (see /track and /chat/send).
    const timingSafeEqualStr = async (a, b) => {
      const ha = await sha256hex(String(a || ''));
      const hb = await sha256hex(String(b || ''));
      let diff = 0;
      for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
      return diff === 0;
    };
    // Appends one line to the append-only audit trail (every /admin/* write).
    // Zero-padded timestamp so lexicographic KV order is also chronological
    // order. Best-effort: a logging failure never blocks the action itself.
    const AUDIT_TTL = 60 * 60 * 24 * 90; // 90 days
    const logAudit = async (kv, entry) => {
      if (!kv) return;
      try {
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        await kv.put(`audit:${String(ts).padStart(13, '0')}:${rand}`, JSON.stringify({ ...entry, ts }), { expirationTtl: AUDIT_TTL });
      } catch (e) { /* auditing must never block the real action */ }
    };
    // Global, owner-controlled settings pushed to every client on its next
    // status poll: private mode, a broadcast banner, a reload counter the
    // clients compare against to force-refresh, and feature kill-switches.
    const CONFIG_DEFAULTS = {
      privateMode: false, broadcast: '', reloadVersion: 0, features: {}, announcement: null,
      dailyQuota: 0,        // OpenAI requests/day per non-owner user; 0 = unlimited
      brandName: '',        // '' = client keeps its own built-in "Agent Console" name
      defaultTheme: '',     // '' = client keeps its own built-in default theme
      readOnly: false,          // true = only the owner can post to chat
      approvalMode: false,      // true = a brand-new username starts pending, needs /admin/moderate approve
      blockedCountries: [],     // 2-letter cf.country codes refused on /v1/* and /chat/send
      allowedModels: [],        // empty = allow any model on /v1/*
      maxTokens: 0,             // 0 = no cap on body.max_tokens
      allowedOrigins: []        // empty = allow any Origin on /v1/*
    };
    const getConfig = async (kv) => {
      const stored = kv ? await kv.get('config', 'json') : null;
      return { ...CONFIG_DEFAULTS, ...(stored || {}) };
    };

    // Effective state for one user, combining their own moderation record with
    // global config. Order: owner is always active; a timed mute wins while
    // it's still running (self-expires, no manual unblock needed); an
    // explicit block/lock wins next; then private mode blocks anyone without
    // an allow exemption.
    const resolveState = (mod, cfg, user) => {
      if (String(user).toLowerCase() === OWNER) return { state: 'active', reason: '', kickNonce: 0, owner: true };
      if (mod.mutedUntil && mod.mutedUntil > Date.now()) {
        return { state: 'blocked', reason: mod.reason || 'Temporarily muted.', kickNonce: mod.kickNonce || 0, muted: true, mutedUntil: mod.mutedUntil };
      }
      if (mod.state === 'blocked') return { state: 'blocked', reason: mod.reason || '', kickNonce: mod.kickNonce || 0 };
      if (mod.state === 'locked') return { state: 'locked', reason: mod.reason || '', kickNonce: mod.kickNonce || 0 };
      if (cfg.privateMode && !mod.allow) return { state: 'blocked', reason: mod.reason || 'This tool is currently private — access is limited to the owner.', kickNonce: mod.kickNonce || 0, private: true };
      return { state: 'active', reason: '', kickNonce: mod.kickNonce || 0 };
    };
    const resolve = async (kv, user) => resolveState(await getMod(kv, user), await getConfig(kv), user);
    // Resolves one provider's assigned key for one user: a key aimed at this
    // exact username wins; otherwise an "assign to everyone" key (see
    // /admin/assignkey) applies.
    //
    // SERVER-SIDE ONLY. An earlier version handed these keys back to the
    // browser on every /track and /status so the client could stash them in
    // localStorage — which meant anyone could read another user's API key by
    // calling /status?user=<name>, unauthenticated. Keys now never leave the
    // worker: both providers are proxied (/v1/* for OpenAI, /gemini/* for
    // Google) and the key is attached here, in flight.
    const getAssignedKey = async (kv, provider, user) => {
      if (!kv || !user) return '';
      const u = String(user).toLowerCase();
      const specific = await kv.get(`key:${provider}:${u}`, 'json');
      const rec = specific || await kv.get(`key:${provider}:*`, 'json');
      return (rec && rec.key) ? String(rec.key) : '';
    };
    // What the client is allowed to know: whether a key exists for it, never
    // the key. This is what stops the "paste your API key" prompt for users
    // the owner has already covered.
    const assignedKeyFlags = async (kv, user) => ({
      openai: !!(await getAssignedKey(kv, 'openai', user)),
      gemini: !!(await getAssignedKey(kv, 'gemini', user))
    });
    const sha256hex = async (str) => {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
    };
    // Reduces a URL to origin + path: everything after "?" or "#" is dropped
    // before anything is written to storage or shown in the admin console.
    const scrubUrl = (raw) => {
      const s = String(raw == null ? '' : raw);
      if (!s) return '';
      try {
        const u = new URL(s);
        if (u.username || u.password) return u.origin + u.pathname;  // drop embedded credentials
        return u.origin + u.pathname;
      } catch (e) {
        return s.split(/[?#]/)[0].slice(0, 200);
      }
    };

    // ---- SSRF guard for /read ----------------------------------------------
    // /read fetches a URL on the server's behalf, which makes it an obvious
    // lever for reaching things the caller cannot reach directly: cloud
    // metadata endpoints, private RFC1918 addresses, loopback, and internal
    // hostnames resolvable only from inside a network the worker can see.
    // Only public http(s) hosts are allowed, and every redirect hop is
    // re-checked rather than trusted.
    // Names that resolve somewhere private. Matched after the trailing root dot
    // is stripped — "metadata.google.internal." and "localhost." resolve to the
    // same place as the dotless spellings, and an anchored pattern that forgets
    // that is defeated by one character.
    const PRIVATE_HOST_RE = /^(localhost|.*\.local|.*\.internal|.*\.localdomain|.*\.home\.arpa|metadata(\..*)?|instance-data(\..*)?)$/i;

    // Decides whether a 32-bit IPv4 value is somewhere we refuse to fetch from.
    const isPrivateIPv4Value = (v) => {
      const a = (v >>> 24) & 255, b = (v >>> 16) & 255;
      if (a === 0 || a === 10 || a === 127) return true;   // this-network, private, loopback
      if (a === 169 && b === 254) return true;             // link-local, incl. 169.254.169.254
      if (a === 172 && b >= 16 && b <= 31) return true;    // private
      if (a === 192 && b === 168) return true;             // private
      if (a === 192 && b === 0) return true;               // 192.0.0.0/24, 192.0.2.0/24
      if (a === 100 && b >= 64 && b <= 127) return true;   // carrier-grade NAT
      if (a >= 224) return true;                           // multicast and reserved
      return false;
    };
    // Parses the shorthand forms a resolver accepts — "127.1", "0177.0.0.1",
    // "0x7f000001", "2130706433". The URL parser normalizes most of these
    // already, but it is the only thing that does, so this does not rely on it.
    // Returns a 32-bit value, or null when the host is not an IPv4 literal.
    const parseIPv4Loose = (host) => {
      const parts = host.split('.');
      if (parts.length < 1 || parts.length > 4) return null;
      const nums = [];
      for (const p of parts) {
        if (p === '') return null;
        let n;
        if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p.slice(2), 16);
        else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
        else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10);
        else return null;
        if (!Number.isFinite(n) || n < 0) return null;
        nums.push(n);
      }
      for (let i = 0; i < nums.length - 1; i++) if (nums[i] > 255) return null;
      const lastMax = Math.pow(256, 4 - (nums.length - 1)) - 1;
      if (nums[nums.length - 1] > lastMax) return null;
      let value = 0;
      for (let i = 0; i < nums.length - 1; i++) value += nums[i] * Math.pow(256, 3 - i);
      value += nums[nums.length - 1];
      return value >>> 0;
    };
    // Expands an IPv6 literal (with or without brackets, "::" compression, or a
    // trailing dotted-quad) into its eight 16-bit groups. Returns null if it
    // isn't a well-formed IPv6 address.
    const parseIPv6 = (raw) => {
      let h = String(raw).replace(/^\[|\]$/g, '').toLowerCase();
      if (!h.includes(':')) return null;
      h = h.split('%')[0];                                   // drop any zone id
      let tail4 = null;
      const lastColon = h.lastIndexOf(':');
      const afterColon = h.slice(lastColon + 1);
      if (afterColon.includes('.')) {
        const v4 = parseIPv4Loose(afterColon);
        if (v4 === null) return null;
        tail4 = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
        h = h.slice(0, lastColon + 1) + '0:0';
      }
      const halves = h.split('::');
      if (halves.length > 2) return null;
      const toGroups = (s) => (s === '' ? [] : s.split(':').map((g) => {
        if (!/^[0-9a-f]{1,4}$/.test(g)) return NaN;
        return parseInt(g, 16);
      }));
      let groups;
      if (halves.length === 2) {
        const head = toGroups(halves[0]);
        const tail = toGroups(halves[1]);
        const fill = 8 - head.length - tail.length;
        if (fill < 0) return null;
        groups = [...head, ...new Array(fill).fill(0), ...tail];
      } else {
        groups = toGroups(halves[0]);
      }
      if (groups.length !== 8 || groups.some((g) => !Number.isFinite(g))) return null;
      if (tail4) { groups[6] = tail4[0]; groups[7] = tail4[1]; }
      return groups;
    };
    const isPrivateIPv6Groups = (g) => {
      const allZeroPrefix = g.slice(0, 5).every((x) => x === 0);
      if (g.every((x) => x === 0)) return true;                      // ::
      if (allZeroPrefix && g[5] === 0 && g[6] === 0 && g[7] === 1) return true;  // ::1
      // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): the
      // address that actually gets dialled is the embedded IPv4 one, so it has
      // to be judged as IPv4. new URL() rewrites ::ffff:127.0.0.1 into
      // ::ffff:7f00:1, so string-matching on "::ffff:" misses it entirely.
      if (allZeroPrefix && (g[5] === 0xffff || g[5] === 0)) {
        return isPrivateIPv4Value((((g[6] << 16) >>> 0) + g[7]) >>> 0);
      }
      if (g[0] === 0x64 && g[1] === 0xff9b) {                        // NAT64 translation
        return isPrivateIPv4Value((((g[6] << 16) >>> 0) + g[7]) >>> 0);
      }
      if ((g[0] & 0xfe00) === 0xfc00) return true;                   // unique local fc00::/7
      if ((g[0] & 0xffc0) === 0xfe80) return true;                   // link-local fe80::/10
      if ((g[0] & 0xff00) === 0xff00) return true;                   // multicast ff00::/8
      return false;
    };
    // Returns a URL object to fetch, or null when the target must be refused.
    // Everything ambiguous fails closed: a host that looks like a number but
    // cannot be parsed as one is refused rather than passed through as a name.
    const safeTargetUrl = (raw) => {
      let u;
      try { u = new URL(String(raw)); } catch (e) { return null; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.username || u.password) return null;
      let host = u.hostname.toLowerCase();
      if (!host) return null;
      if (host.startsWith('[')) {                                    // IPv6 literal
        const groups = parseIPv6(host);
        if (!groups) return null;
        return isPrivateIPv6Groups(groups) ? null : u;
      }
      host = host.replace(/\.+$/, '');                               // "localhost." === "localhost"
      if (!host) return null;
      const lastLabel = host.slice(host.lastIndexOf('.') + 1);
      if (/^(0x[0-9a-f]+|[0-9]+)$/i.test(lastLabel)) {               // numeric host = IPv4 literal
        const v = parseIPv4Loose(host);
        if (v === null) return null;
        return isPrivateIPv4Value(v) ? null : u;
      }
      if (PRIVATE_HOST_RE.test(host)) return null;
      return u;
    };

    // Human-friendly code: uppercase, no 0/O/1/I/L ambiguity.
    const genCode = () => {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      const a = new Uint8Array(8); crypto.getRandomValues(a);
      return [...a].map((x) => chars[x % chars.length]).join('');
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
    }

    const url = new URL(req.url);

    // ---- Admin surface: default deny ---------------------------------------
    // Every /admin/* path must be named here with the role and method it
    // accepts, and is checked BEFORE any handler runs. A new admin route that
    // nobody remembered to guard therefore 404s instead of being wide open,
    // and the per-handler guards further down stay as a second layer.
    const ADMIN_ROUTES = {
      '/admin/summary':   { method: 'GET',  role: 'coadmin' },
      '/admin/moderate':  { method: 'POST', role: 'coadmin' },
      '/admin/setunlock': { method: 'POST', role: 'coadmin' },
      '/admin/clearchat': { method: 'POST', role: 'coadmin' },
      '/admin/rooms':     { method: 'POST', role: 'coadmin' },
      '/admin/config':    { method: 'POST', role: 'owner' },
      '/admin/assignkey': { method: 'POST', role: 'owner' },
      '/admin/clear':     { method: 'POST', role: 'owner' },
      '/admin/audit':     { method: 'GET',  role: 'owner' },
      '/admin/backup':    { method: 'GET',  role: 'owner' },
      '/admin/restore':   { method: 'POST', role: 'owner' }
    };
    if (url.pathname.startsWith('/admin/')) {
      const spec = Object.prototype.hasOwnProperty.call(ADMIN_ROUTES, url.pathname)
        ? ADMIN_ROUTES[url.pathname] : null;
      if (!spec) return json({ error: 'not found' }, 404);
      if (req.method !== spec.method) return json({ error: 'method not allowed' }, 405);
      const denied = await guard(req, url, env, spec.role);
      if (denied) return denied;
    }

    // ==== Usage telemetry (Cloudflare KV) ================================
    //
    // Backed by a KV namespace you bind as `TELEMETRY` in the Cloudflare
    // dashboard, and an admin secret you set as the `ADMIN_TOKEN` variable.
    // Neither the KV nor the token is ever exposed to the browser: users can
    // only WRITE their own heartbeat (/track), and only a request bearing the
    // ADMIN_TOKEN can READ the logs (/admin/*). That is real, server-side
    // access control — unlike a key placed in the public script, which anyone
    // could read. Presence ("active now") is a per-session KV key with a short
    // TTL, so a user drops off the live list on their own ~2.5 min after their
    // last heartbeat, with no cleanup job.
    const SESSION_TTL = 150;        // seconds a session counts as "active"

    // Health/diagnostics. Safe to call without a token: it reports only whether
    // things are CONFIGURED, never any secret value. The admin panel's
    // Diagnostics tab uses it to tell you exactly what still needs wiring up.
    if (url.pathname === '/health') {
      const kv = env && env.TELEMETRY;
      let kvWritable = false;
      if (kv) {
        try { await kv.put('health:ping', String(Date.now()), { expirationTtl: 60 }); kvWritable = true; } catch (e) { kvWritable = false; }
      }
      let cfg = { privateMode: false };
      try { cfg = await getConfig(kv); } catch (e) { /* unbound */ }
      return json({
        ok: true,
        worker: 'agent-console',
        time: Date.now(),
        owner: OWNER,
        kvBound: !!kv,
        kvWritable,
        adminTokenSet: !!(env && env.ADMIN_TOKEN),
        telemetryReady: !!kv && !!(env && env.ADMIN_TOKEN),
        privateMode: !!cfg.privateMode,
        routes: [
          '/v1/*', '/gemini/*', '/read', '/track', '/status', '/health',
          '/chat/poll', '/chat/send',
          '/admin/summary', '/admin/moderate', '/admin/setunlock', '/unlock',
          '/admin/config', '/admin/clear', '/admin/clearchat', '/admin/rooms',
          '/admin/assignkey', '/admin/audit', '/admin/backup', '/admin/restore'
        ]
      });
    }

    if (url.pathname === '/track' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ ok: false, error: 'telemetry KV not bound' }, 200);
      // text/plain body so the browser sends no CORS preflight.
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
      const user = clip(body.user || 'anonymous', 80);
      const userLower = user.toLowerCase();
      // Nobody may claim the owner's username without proving it (see
      // /chat/send for the full rationale). Inactive until OWNER_CODE is set.
      if (userLower === OWNER && env && env.OWNER_CODE) {
        const proof = req.headers.get('X-GPA-Owner') || '';
        if (!(await timingSafeEqualStr(proof, env.OWNER_CODE))) {
          return json({ ok: false, error: 'name reserved' }, 200);
        }
      }
      const sid = clip(body.sid, 60) || crypto.randomUUID();
      const now = Date.now();
      const cf = req.cf || {};
      const cfg = await getConfig(kv);
      const rec = {
        user,
        host: clip(body.host, 120),
        // Origin + path only. A full URL routinely carries session tokens,
        // password-reset codes, search terms and document ids in its query
        // string — none of which the owner needs in order to see who is
        // active, and all of which would then sit in KV and in every admin
        // console that loads the summary.
        url: clip(scrubUrl(body.url), 200),
        country: cf.country || '??',
        region: clip(cf.region || cf.city || '', 60),
        lastSeen: now
      };
      try {
        // Presence: expires on its own -> "active now" needs no cleanup.
        await kv.put('session:' + sid, JSON.stringify(rec), { expirationTtl: SESSION_TTL });
        // All-time rollup, refreshed on the "open" event (not every beat) to
        // stay well inside KV's free-tier write budget.
        if (body.event === 'open') {
          const uKey = 'user:' + userLower;
          const prev = await kv.get(uKey, 'json');
          await kv.put(uKey, JSON.stringify({
            user,
            host: rec.host,
            country: rec.country,
            region: rec.region,
            firstSeen: (prev && prev.firstSeen) || now,
            lastSeen: now,
            opens: ((prev && prev.opens) || 0) + 1
          }));
          // Approval queue: a genuinely new username (no prior rollup) starts
          // pending when the owner has approvalMode on — /v1/* then refuses
          // them until /admin/moderate action "approve" is used.
          if (!prev && cfg.approvalMode && userLower !== OWNER) {
            const modKey = 'mod:' + userLower;
            const curMod = (await kv.get(modKey, 'json')) || { state: 'active', reason: '', kickNonce: 0 };
            curMod.pending = true;
            await kv.put(modKey, JSON.stringify(curMod));
          }
        }
      } catch (e) { return json({ ok: false }, 200); }
      // Hand the caller its own effective state back on every beat, so a
      // block/lock/kick/private-mode change reaches them within one heartbeat
      // even without the separate /status poll.
      const r = await resolve(kv, user);
      const mod = await getMod(kv, user);
      const assignedKeys = await assignedKeyFlags(kv, user);
      return json({
        ok: true, state: r.state, reason: r.reason, kickNonce: r.kickNonce,
        owner: !!r.owner, private: !!r.private,
        broadcast: cfg.broadcast || '', reloadVersion: cfg.reloadVersion || 0,
        features: { ...(cfg.features || {}), ...(mod.features || {}) },
        announcement: cfg.announcement || null, assignedKeys,   // booleans only — see assignedKeyFlags
        brandName: cfg.brandName || '', defaultTheme: cfg.defaultTheme || ''
      });
    }

    // Read-only status for one user — the client polls this so a block takes
    // effect fast without waiting for the next (write-costing) heartbeat.
    if (url.pathname === '/status' && req.method === 'GET') {
      const kv = env && env.TELEMETRY;
      const statusUser = url.searchParams.get('user') || '';
      const r = await resolve(kv, statusUser);
      const cfg = await getConfig(kv);
      const mod = await getMod(kv, statusUser);
      const assignedKeys = await assignedKeyFlags(kv, statusUser);
      return json({
        state: r.state, reason: r.reason, kickNonce: r.kickNonce,
        owner: !!r.owner, private: !!r.private,
        broadcast: cfg.broadcast || '', reloadVersion: cfg.reloadVersion || 0,
        features: { ...(cfg.features || {}), ...(mod.features || {}) },
        announcement: cfg.announcement || null, assignedKeys,   // booleans only — see assignedKeyFlags
        brandName: cfg.brandName || '', defaultTheme: cfg.defaultTheme || ''
      });
    }

    // Sets a user's moderation state. Owner or co-admin (see authLevel above).
    if (url.pathname === '/admin/moderate' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = await requireStaff(req, url, env);
      if (denied) return denied;
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || '').toLowerCase().slice(0, 80);
      if (!user) return json({ error: 'no user' }, 400);
      // The owner can never be blocked/locked/kicked/muted/frozen/etc.
      if (user === OWNER) return json({ ok: false, error: 'This user is the owner and is immune to moderation.' }, 200);
      const key = 'mod:' + user;
      const cur = (await kv.get(key, 'json')) || { state: 'active', reason: '', kickNonce: 0 };
      const action = body.action;
      if (action === 'block') { cur.state = 'blocked'; cur.allow = false; }
      else if (action === 'unblock') { cur.state = 'active'; cur.allow = true; }   // explicit allow (exempts from private mode)
      else if (action === 'lock') cur.state = 'locked';
      else if (action === 'unlock' || action === 'reset') cur.state = 'active';
      else if (action === 'kick') cur.kickNonce = (cur.kickNonce || 0) + 1;
      // Timed mute: self-expires (see resolveState's mutedUntil check), no
      // manual unblock needed. `hours` may be fractional (e.g. 0.5 = 30 min).
      else if (action === 'mute') cur.mutedUntil = Date.now() + Math.max(0, Number(body.hours) || 0) * 3600000;
      else if (action === 'unmute') delete cur.mutedUntil;
      // Strike system: 3 warnings auto-escalates to a 24h mute and resets
      // the counter, so a warned-and-behaving user isn't left flagged.
      else if (action === 'warn') {
        cur.strikes = (cur.strikes || 0) + 1;
        if (cur.strikes >= 3) { cur.mutedUntil = Date.now() + 24 * 3600000; cur.strikes = 0; }
      } else if (action === 'clearstrikes') cur.strikes = 0;
      // Approval queue (see approvalMode in /admin/config and /track).
      else if (action === 'approve') cur.pending = false;
      else if (action === 'unapprove') cur.pending = true;
      // Per-user AI freeze: blocks only /v1/*, chat and /read still work.
      else if (action === 'freezeai') cur.aiFrozen = true;
      else if (action === 'unfreezeai') cur.aiFrozen = false;
      // Shadow mute: the user believes every message sent, nobody sees any of them.
      else if (action === 'shadowmute') cur.shadowMuted = true;
      else if (action === 'unshadowmute') cur.shadowMuted = false;
      // Per-user feature-flag overrides, merged over the global features map
      // (see /track and /status) — e.g. turn quiz-solving off for one user
      // without touching everyone else's access.
      else if (action === 'setfeatures') {
        if (!body.features || typeof body.features !== 'object') return json({ error: 'features object required' }, 400);
        cur.features = { ...(cur.features || {}), ...body.features };
      } else return json({ error: 'unknown action' }, 400);
      cur.reason = String(body.reason || '').slice(0, 300);
      cur.updatedAt = Date.now();
      await kv.put(key, JSON.stringify(cur));
      await logAudit(kv, { route: '/admin/moderate', action, target: user, admin: authedLevel });
      return json({ ok: true, user, mod: cur });
    }

    // Global config. Owner only — a co-admin never touches whole-system state.
    if (url.pathname === '/admin/config' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = await requireOwner(req, url, env);
      if (denied) return denied;
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const cfg = await getConfig(kv);
      if ('privateMode' in body) cfg.privateMode = !!body.privateMode;
      if ('broadcast' in body) cfg.broadcast = String(body.broadcast || '').slice(0, 400);
      // An announcement is a modal everyone sees once. A fresh id each time is
      // what makes it pop again rather than being silently ignored as "seen".
      if ('announcement' in body) {
        const a = body.announcement;
        cfg.announcement = (a && (a.text || a.title))
          ? { id: 'a' + Date.now().toString(36), title: String(a.title || 'Announcement').slice(0, 80), text: String(a.text || '').slice(0, 600), ts: Date.now() }
          : null;
      }
      if (body.features && typeof body.features === 'object') cfg.features = { ...cfg.features, ...body.features };
      if ('dailyQuota' in body) cfg.dailyQuota = Math.max(0, parseInt(body.dailyQuota, 10) || 0);
      if ('brandName' in body) cfg.brandName = String(body.brandName || '').slice(0, 60);
      if ('defaultTheme' in body) cfg.defaultTheme = String(body.defaultTheme || '').slice(0, 20);
      if ('readOnly' in body) cfg.readOnly = !!body.readOnly;
      if ('approvalMode' in body) cfg.approvalMode = !!body.approvalMode;
      if (Array.isArray(body.blockedCountries)) cfg.blockedCountries = body.blockedCountries.map((c) => String(c || '').toUpperCase().slice(0, 2)).filter(Boolean).slice(0, 250);
      if (Array.isArray(body.allowedModels)) cfg.allowedModels = body.allowedModels.map((m) => String(m || '').slice(0, 80)).filter(Boolean).slice(0, 100);
      if ('maxTokens' in body) cfg.maxTokens = Math.max(0, parseInt(body.maxTokens, 10) || 0);
      if (Array.isArray(body.allowedOrigins)) cfg.allowedOrigins = body.allowedOrigins.map((o) => String(o || '').slice(0, 200)).filter(Boolean).slice(0, 100);
      // Bumping this makes every client notice it is out of date on its next
      // status poll and pull the latest script.
      if (body.bumpReload) cfg.reloadVersion = (cfg.reloadVersion || 0) + 1;
      await kv.put('config', JSON.stringify(cfg));
      await logAudit(kv, { route: '/admin/config', action: 'update', target: null, admin: 'owner' });
      return json({ ok: true, config: cfg, owner: OWNER });
    }

    // ==== Chat ==============================================================
    //
    // One public room everyone can use, plus private rooms the owner creates.
    // A private room is gated by a secret code: the hash is stored, the code
    // is shown once, and every read and write must present it. That is a real
    // shared secret rather than a username check — usernames here are
    // self-asserted, so gating on them alone would stop nobody.
    //
    // STORAGE: one key per room holding that room's recent messages, read with
    // a single get().
    //
    // This used to be one KV key per message, with a poll doing a list() over
    // the room's prefix. That reads nicely but it is the wrong operation to put
    // on a timer: clients poll every 1.5s while the chat is open, so a single
    // signed-in user spends thousands of list operations a day — and list is
    // the scarcest KV operation by a wide margin (the free plan allows far more
    // reads than lists). Once the allowance is gone, list() throws, the worker
    // returns an uncaught 500 with no CORS header, and the browser blames CORS.
    // A poll is now one read against a much larger budget.
    //
    // The trade: a send is read-modify-write, so two messages posted in the
    // same instant can cost one of them. For a room this size that is a fair
    // price for a chat that keeps working; a busier room wants Durable Objects,
    // which is a different design, not a bigger number here.
    const CHAT_TTL = 60 * 60 * 24 * 7;   // a room's log lives a week at most
    const CHAT_MAX = 120;                // messages kept (and returned) per room
    const roomLogKey = (id) => 'roomlog:' + String(id).toLowerCase().slice(0, 40);
    const readRoomLog = async (kv, id) => {
      const stored = await kv.get(roomLogKey(id), 'json');
      return Array.isArray(stored) ? stored : [];
    };
    const roomKey = (id) => 'room:' + String(id).toLowerCase().slice(0, 40);
    // Per-room moderation settings (slow mode + bans), kept separate from
    // roomKey's name/codeHash record so this also works for the public room,
    // which has no room: record of its own.
    const roomCfgKey = (id) => 'roomcfg:' + String(id).toLowerCase().slice(0, 40);
    const getRoomCfg = async (kv, id) => {
      const stored = await kv.get(roomCfgKey(id), 'json');
      return { slowModeSec: 0, bannedUsers: [], ...(stored || {}) };
    };

    // Returns { ok } or { ok:false, error } for a room + supplied code.
    const checkRoomAccess = async (kv, roomId, code) => {
      const id = String(roomId || 'public').toLowerCase().slice(0, 40);
      if (id === 'public') return { ok: true, id };
      if (!kv) return { ok: false, error: 'chat storage not configured' };
      const room = await kv.get(roomKey(id), 'json');
      if (!room) return { ok: false, error: 'no such room' };
      const h = await sha256hex(id + '|' + String(code || '').trim().toUpperCase());
      if (!(await timingSafeEqualStr(h, room.codeHash))) return { ok: false, error: 'wrong room code' };
      return { ok: true, id, room };
    };

    if (url.pathname === '/chat/send' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ ok: false, error: 'chat storage not configured' }, 200);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || 'anonymous').slice(0, 40);
      const userLower = user.toLowerCase();
      const text = String(body.text || '').trim().slice(0, 500);
      if (!text) return json({ ok: false, error: 'empty message' }, 200);
      // Nobody may claim the owner's username without proving it (OWNER_CODE,
      // sent as X-GPA-Owner) — otherwise any visitor could sign in as the
      // owner's name and inherit the 👑 badge and moderation immunity in
      // other users' eyes. Inactive until OWNER_CODE is actually set, so
      // this can't lock out the real owner on a worker that hasn't opted in.
      if (userLower === OWNER && env && env.OWNER_CODE) {
        const proof = req.headers.get('X-GPA-Owner') || '';
        if (!(await timingSafeEqualStr(proof, env.OWNER_CODE))) {
          return json({ ok: false, error: 'name reserved' }, 200);
        }
      }
      // A blocked user (or anyone shut out by private mode or a timed mute) can't post.
      const st = await resolve(kv, user);
      if (st.state === 'blocked') return json({ ok: false, error: 'You are blocked from chat.' }, 200);
      const cfg = await getConfig(kv);
      if (cfg.readOnly && userLower !== OWNER) return json({ ok: false, error: 'chat is read-only' }, 200);
      const cf = req.cf || {};
      if (cfg.blockedCountries.length && cfg.blockedCountries.includes(String(cf.country || '').toUpperCase())) {
        return json({ ok: false, error: 'not available in your region' }, 403);
      }
      const access = await checkRoomAccess(kv, body.room, body.code);
      if (!access.ok) return json({ ok: false, error: access.error }, 200);
      const roomCfg = await getRoomCfg(kv, access.id);
      if (roomCfg.bannedUsers.includes(userLower)) {
        return json({ ok: false, error: 'banned from this room' }, 200);
      }
      // Slow mode: one message per cooldown window per user per room. The
      // cooldown key's own TTL doubles as its cleanup — nothing to sweep.
      if (roomCfg.slowModeSec > 0 && userLower !== OWNER) {
        const coolKey = `cooldown:${access.id}:${userLower}`;
        const last = parseInt(await kv.get(coolKey), 10) || 0;
        const elapsed = (Date.now() - last) / 1000;
        if (last && elapsed < roomCfg.slowModeSec) {
          return json({ ok: false, error: `slow mode: wait ${Math.ceil(roomCfg.slowModeSec - elapsed)}s` }, 200);
        }
        await kv.put(coolKey, String(Date.now()), { expirationTtl: Math.max(roomCfg.slowModeSec, 60) + 5 });
      }
      const ts = Date.now();
      // Shadow mute: report success so the sender is none the wiser, but
      // store nothing — /chat/poll (for anyone, including the sender's other
      // devices) never has it to return.
      const mod = await getMod(kv, user);
      if (mod.shadowMuted) return json({ ok: true, ts });
      try {
        const log = await readRoomLog(kv, access.id);
        log.push({ u: user, t: text, ts, owner: userLower === OWNER });
        // Keep the newest CHAT_MAX so one room's log can't grow past the
        // 25MB per-value ceiling however long it runs.
        const trimmed = log.slice(-CHAT_MAX);
        await kv.put(roomLogKey(access.id), JSON.stringify(trimmed), { expirationTtl: CHAT_TTL });
      } catch (e) {
        return json({ ok: false, error: 'could not store message' }, 200);
      }
      return json({ ok: true, ts });
    }

    if (url.pathname === '/chat/poll' && req.method === 'GET') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ ok: false, error: 'chat storage not configured', messages: [] }, 200);
      const access = await checkRoomAccess(kv, url.searchParams.get('room'), url.searchParams.get('code'));
      if (!access.ok) return json({ ok: false, error: access.error, messages: [] }, 200);
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      // A storage hiccup here must not take the whole panel down with it: the
      // client polls this every couple of seconds, so it answers with a
      // readable error and an empty list rather than throwing.
      let messages;
      try {
        messages = (await readRoomLog(kv, access.id))
          .filter((m) => m && m.ts > since)
          .sort((a, b) => a.ts - b.ts)
          .slice(-CHAT_MAX);
      } catch (e) {
        return json({ ok: false, error: 'chat storage is temporarily unavailable', messages: [], now: Date.now() }, 200);
      }
      return json({ ok: true, room: access.id, messages, now: Date.now() });
    }

    // Owner: manually wipe every room's chat history right now, same routine
    // the daily Cron Trigger runs. Handy for testing the cron without
    // waiting for it, or for an ad-hoc reset.
    if (url.pathname === '/admin/clearchat' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'chat storage not configured' }, 500);
      const denied = await requireStaff(req, url, env);
      if (denied) return denied;
      const deleted = await clearAllChatMessages(kv);
      await logAudit(kv, { route: '/admin/clearchat', action: 'clearchat', target: null, admin: authedLevel });
      return json({ ok: true, deleted });
    }

    // Create / list / delete private rooms, plus per-room slow mode and bans.
    // Owner or co-admin.
    if (url.pathname === '/admin/rooms' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'chat storage not configured' }, 500);
      const denied = await requireStaff(req, url, env);
      if (denied) return denied;
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const action = body.action || 'list';
      const admin = authedLevel;

      if (action === 'create') {
        const name = String(body.name || '').trim().slice(0, 40);
        if (!name) return json({ error: 'name required' }, 400);
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || ('room' + Date.now().toString(36));
        if (id === 'public') return json({ error: '"public" is reserved' }, 400);
        const code = genCode();
        await kv.put(roomKey(id), JSON.stringify({
          id, name, codeHash: await sha256hex(id + '|' + code), createdAt: Date.now()
        }));
        await logAudit(kv, { route: '/admin/rooms', action, target: id, admin });
        return json({ ok: true, id, name, code });
      }
      if (action === 'delete') {
        const id = String(body.id || '').toLowerCase().slice(0, 40);
        if (!id || id === 'public') return json({ error: 'cannot delete that room' }, 400);
        await kv.delete(roomKey(id));
        await kv.delete(roomCfgKey(id));
        await kv.delete(roomLogKey(id));
        await logAudit(kv, { route: '/admin/rooms', action, target: id, admin });
        return json({ ok: true, deleted: id });
      }
      if (action === 'newcode') {
        const id = String(body.id || '').toLowerCase().slice(0, 40);
        const room = await kv.get(roomKey(id), 'json');
        if (!room) return json({ error: 'no such room' }, 404);
        const code = genCode();
        room.codeHash = await sha256hex(id + '|' + code);
        await kv.put(roomKey(id), JSON.stringify(room));
        await logAudit(kv, { route: '/admin/rooms', action, target: id, admin });
        return json({ ok: true, id, code });
      }
      // Slow mode: seconds between messages, per user, in this room (public
      // room included — pass id:"public" or omit id).
      if (action === 'slowmode') {
        const id = String(body.id || 'public').toLowerCase().slice(0, 40);
        const seconds = Math.max(0, parseInt(body.seconds, 10) || 0);
        const rc = await getRoomCfg(kv, id);
        rc.slowModeSec = seconds;
        await kv.put(roomCfgKey(id), JSON.stringify(rc));
        await logAudit(kv, { route: '/admin/rooms', action, target: id, admin });
        return json({ ok: true, id, slowModeSec: seconds });
      }
      // Room bans: this room only, the user can still use every other room.
      if (action === 'banuser' || action === 'unbanuser') {
        const id = String(body.id || 'public').toLowerCase().slice(0, 40);
        const target = String(body.user || '').toLowerCase().slice(0, 80);
        if (!target) return json({ error: 'no user' }, 400);
        if (target === OWNER) return json({ error: 'the owner cannot be banned' }, 400);
        const rc = await getRoomCfg(kv, id);
        const set = new Set(rc.bannedUsers);
        if (action === 'banuser') set.add(target); else set.delete(target);
        rc.bannedUsers = [...set];
        await kv.put(roomCfgKey(id), JSON.stringify(rc));
        await logAudit(kv, { route: '/admin/rooms', action, target: `${id}:${target}`, admin });
        return json({ ok: true, id, bannedUsers: rc.bannedUsers });
      }
      // list
      const listed = await kv.list({ prefix: 'room:' });
      const rooms = [];
      for (const k of listed.keys) {
        const r = await kv.get(k.name, 'json');
        if (r) rooms.push({ id: r.id, name: r.name, createdAt: r.createdAt });
      }
      return json({ ok: true, rooms });
    }

    // Owner assigns an OpenAI or Gemini key to one user, several users, or
    // everyone. The key is stored server-side under key:<provider>:<user>
    // (or key:<provider>:* for "everyone"). Two delivery paths apply it:
    //  - OpenAI: the /v1/* forwarder below prefers it over anything the
    //    client supplies, so it works immediately without the key ever
    //    reaching that user's browser.
    //  - Both providers: every /track heartbeat and /status poll hands the
    //    calling user their own resolved key back (see getAssignedKeys
    //    above), and script.js writes it into that user's own localStorage
    //    on receipt — this is required for Gemini (called straight from the
    //    browser, no proxy to inject into) and is also how OpenAI keys reach
    //    a user who then goes into direct/no-proxy mode.
    // Accepts either the current multi-target shape ({provider, users:[...],
    // all:true, key}) or the original single-user shape ({user, key}) for
    // back-compat with older admin-panel builds.
    if (url.pathname === '/admin/assignkey' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = await requireOwner(req, url, env);
      if (denied) return denied;
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const provider = (String(body.provider || 'openai').toLowerCase() === 'gemini') ? 'gemini' : 'openai';
      const key = String(body.key || '').trim();
      const all = !!body.all;
      let targets = Array.isArray(body.users) ? body.users : (body.user ? [body.user] : []);
      targets = [...new Set(targets.map((u) => String(u || '').toLowerCase().slice(0, 80)).filter(Boolean))];
      if (!all && !targets.length) return json({ error: 'no user(s) specified' }, 400);
      const keysTouched = all ? ['*'] : targets;
      for (const u of keysTouched) {
        const rkey = `key:${provider}:${u}`;
        if (!key) await kv.delete(rkey);
        else await kv.put(rkey, JSON.stringify({ key, assignedAt: Date.now() }));
      }
      await logAudit(kv, { route: '/admin/assignkey', action: key ? 'assign' : 'remove', target: all ? '*' : targets.join(','), admin: 'owner' });
      return json({ ok: true, provider, all, users: targets, assigned: !!key });
    }

    // Owner mints a one-time unlock code for ONE user. We store only its hash,
    // and hand the plaintext back this once for the owner to pass along. The
    // code releases only this username's block, and is consumed on use.
    if (url.pathname === '/admin/setunlock' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = await requireStaff(req, url, env);
      if (denied) return denied;
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || '').toLowerCase().slice(0, 80);
      if (!user) return json({ error: 'no user' }, 400);
      const key = 'mod:' + user;
      const cur = (await kv.get(key, 'json')) || { state: 'active', reason: '', kickNonce: 0 };
      const code = genCode();
      cur.unlock = await sha256hex(user + '|' + code);   // only the hash is stored
      cur.unlockAt = Date.now();
      await kv.put(key, JSON.stringify(cur));
      await logAudit(kv, { route: '/admin/setunlock', action: 'setunlock', target: user, admin: authedLevel });
      return json({ ok: true, user, code });
    }

    // A blocked user redeems the code the owner gave them. Not token-gated —
    // knowing the code is the credential. Only flips this one username, and
    // only when the code matches; the code is single-use.
    if (url.pathname === '/unlock' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ ok: false, error: 'telemetry KV not bound' }, 200);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || '').toLowerCase().slice(0, 80);
      const code = String(body.code || '').trim().toUpperCase();
      if (!user || !code) return json({ ok: false, error: 'missing user or code' }, 200);
      // An unlock code is short enough to be worth guessing, and this route is
      // deliberately unauthenticated, so failed attempts are counted per IP
      // and cut off for a while.
      const unlockIp = clientIp(req);
      if (await isLockedOut(kv, 'unlock', unlockIp)) {
        return json({ ok: false, error: 'too many attempts — try again later' }, 429);
      }
      const key = 'mod:' + user;
      const cur = await kv.get(key, 'json');
      if (!cur || !cur.unlock) {
        await noteFailure(kv, 'unlock', unlockIp);
        return json({ ok: false, error: 'invalid code' }, 200);
      }
      if (!(await timingSafeEqualStr(await sha256hex(user + '|' + code), cur.unlock))) {
        await noteFailure(kv, 'unlock', unlockIp);
        return json({ ok: false, error: 'invalid code' }, 200);
      }
      await clearFailures(kv, 'unlock', unlockIp);
      cur.state = 'active';
      cur.reason = '';
      cur.allow = true;             // also exempts them from private mode
      delete cur.unlock;            // single use
      delete cur.unlockAt;
      cur.updatedAt = Date.now();
      await kv.put(key, JSON.stringify(cur));
      return json({ ok: true, state: 'active' });
    }

    if (url.pathname === '/admin/summary' && req.method === 'GET') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound on the worker' }, 500);
      const denied = await requireStaff(req, url, env);   // a co-admin needs this to know who to moderate
      if (denied) return denied;

      const active = [];
      const sess = await kv.list({ prefix: 'session:' });
      for (const k of sess.keys) { const v = await kv.get(k.name, 'json'); if (v) active.push(v); }
      const users = [];
      const ul = await kv.list({ prefix: 'user:' });
      for (const k of ul.keys) { const v = await kv.get(k.name, 'json'); if (v) users.push(v); }

      // Effective states, so the admin sees who's blocked/locked/private and
      // who the owner is at a glance.
      const cfg = await getConfig(kv);
      const mods = {};
      const ml = await kv.list({ prefix: 'mod:' });
      for (const k of ml.keys) { const v = await kv.get(k.name, 'json'); if (v) mods[k.name.slice(4)] = v; }
      const keyedOpenai = new Set();
      const keyedGemini = new Set();
      const kl = await kv.list({ prefix: 'key:openai:' });
      kl.keys.forEach((k) => keyedOpenai.add(k.name.slice('key:openai:'.length)));
      const glk = await kv.list({ prefix: 'key:gemini:' });
      glk.keys.forEach((k) => keyedGemini.add(k.name.slice('key:gemini:'.length)));
      const allOpenaiKeyed = keyedOpenai.has('*');
      const allGeminiKeyed = keyedGemini.has('*');
      // Today's per-user request count, for the Usage tab's analytics — reuses
      // the same usage:<day>:<user> counters /v1/*'s quota check maintains.
      const today = new Date().toISOString().slice(0, 10);
      const usageToday = {};
      const ul2 = await kv.list({ prefix: `usage:${today}:` });
      for (const k of ul2.keys) {
        const u = k.name.slice(`usage:${today}:`.length);
        usageToday[u] = parseInt(await kv.get(k.name), 10) || 0;
      }
      const stampOne = (x) => {
        const u = String(x.user).toLowerCase();
        const mod = mods[u] || { state: 'active' };
        const r = resolveState(mod, cfg, x.user);
        return {
          ...x, state: r.state, reason: r.reason, owner: !!r.owner, private: !!r.private,
          hasOpenAiKey: keyedOpenai.has(u) || allOpenaiKeyed,
          hasGeminiKey: keyedGemini.has(u) || allGeminiKeyed,
          requestsToday: usageToday[u] || 0,
          strikes: mod.strikes || 0,
          pending: !!mod.pending,
          muted: !!r.muted, mutedUntil: r.mutedUntil || 0,
          aiFrozen: !!mod.aiFrozen,
          shadowMuted: !!mod.shadowMuted
        };
      };

      // Collapse multiple live sessions from one user into a single presence.
      const activeByUser = {};
      active.forEach((s) => {
        const u = activeByUser[s.user];
        if (!u || s.lastSeen > u.lastSeen) activeByUser[s.user] = s;
      });
      return json({
        now: Date.now(),
        owner: OWNER,
        privateMode: !!cfg.privateMode,
        activeCount: Object.keys(activeByUser).length,
        active: Object.values(activeByUser).sort((a, b) => b.lastSeen - a.lastSeen).map(stampOne),
        users: users.sort((a, b) => b.lastSeen - a.lastSeen).map(stampOne),
        allOpenaiKeyed, allGeminiKeyed, dailyQuota: cfg.dailyQuota || 0
      });
    }

    if (url.pathname === '/admin/clear' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = await requireOwner(req, url, env);
      if (denied) return denied;
      let deleted = 0;
      for (const prefix of ['session:', 'user:']) {
        const list = await kv.list({ prefix });
        for (const k of list.keys) { await kv.delete(k.name); deleted++; }
      }
      await logAudit(kv, { route: '/admin/clear', action: 'clear', target: null, admin: 'owner' });
      return json({ ok: true, deleted });
    }

    // Append-only audit trail of every /admin/* mutation (see logAudit
    // above). Owner only — a co-admin's own actions are logged in it, but
    // they don't get to read it. Newest first, capped at the most recent
    // 1000 KV entries so this stays a single fast list() call.
    if (url.pathname === '/admin/audit' && req.method === 'GET') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = await requireOwner(req, url, env);
      if (denied) return denied;
      const listed = await kv.list({ prefix: 'audit:', limit: 1000 });
      const entries = [];
      for (const k of listed.keys) {
        const v = await kv.get(k.name, 'json');
        if (v) entries.push(v);
      }
      entries.sort((a, b) => b.ts - a.ts);
      return json({ ok: true, entries: entries.slice(0, 100) });
    }

    // Full-state export/import: config, every mod: record, every room: and
    // roomcfg: record, and the audit log. Owner only, dependency-free JSON —
    // meant as a portable snapshot you can save externally and restore from,
    // not an automatic backup schedule.
    if (url.pathname === '/admin/backup' && req.method === 'GET') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = await requireOwner(req, url, env);
      if (denied) return denied;
      const cfg = await getConfig(kv);
      const dumpPrefix = async (prefix) => {
        const out = {};
        let cursor;
        do {
          const listed = await kv.list({ prefix, cursor });
          for (const k of listed.keys) { const v = await kv.get(k.name, 'json'); if (v) out[k.name] = v; }
          cursor = listed.list_complete ? undefined : listed.cursor;
        } while (cursor);
        return out;
      };
      const mods = await dumpPrefix('mod:');
      const rooms = await dumpPrefix('room:');
      const roomCfgs = await dumpPrefix('roomcfg:');
      const auditKeys = [];
      let cursor;
      do {
        const listed = await kv.list({ prefix: 'audit:', cursor });
        for (const k of listed.keys) { const v = await kv.get(k.name, 'json'); if (v) auditKeys.push({ key: k.name, entry: v }); }
        cursor = listed.list_complete ? undefined : listed.cursor;
      } while (cursor);
      return json({ ok: true, backupAt: Date.now(), config: cfg, mods, rooms, roomCfgs, audit: auditKeys });
    }

    // Writes a backup object (from /admin/backup) back into KV. Owner only.
    // Additive/overwriting per key — it does not first wipe state that isn't
    // present in the backup, so restoring an older snapshot won't erase
    // moderation added since, only overwrite records the backup actually has.
    if (url.pathname === '/admin/restore' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = await requireOwner(req, url, env);
      if (denied) return denied;
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { return json({ error: 'invalid JSON body' }, 400); }
      // A backup file is just JSON someone hands us, so its keys decide what
      // gets written unless we say otherwise. Each group may only write its
      // own namespace — notably NOT key:* (assigned API keys) and not the
      // throttling counters, so a doctored backup cannot plant a key or
      // quietly lift a lockout.
      let restored = 0;
      let rejected = 0;
      const putChecked = async (group, prefix, opts) => {
        if (!group || typeof group !== 'object') return;
        for (const [key, val] of Object.entries(group)) {
          if (typeof key !== 'string' || !key.startsWith(prefix) || key.length > 512) { rejected++; continue; }
          await kv.put(key, JSON.stringify(val), opts);
          restored++;
        }
      };
      if (body.config && typeof body.config === 'object') { await kv.put('config', JSON.stringify(body.config)); restored++; }
      await putChecked(body.mods, 'mod:');
      await putChecked(body.rooms, 'room:');
      await putChecked(body.roomCfgs, 'roomcfg:');
      if (Array.isArray(body.audit)) {
        for (const item of body.audit) {
          if (!item || typeof item.key !== 'string' || !item.entry) { rejected++; continue; }
          if (!item.key.startsWith('audit:') || item.key.length > 512) { rejected++; continue; }
          await kv.put(item.key, JSON.stringify(item.entry), { expirationTtl: AUDIT_TTL });
          restored++;
        }
      }
      await logAudit(kv, { route: '/admin/restore', action: 'restore', target: null, admin: 'owner' });
      return json({ ok: true, restored, rejected });
    }

    // ---- /read?url=… : server-side page fetch for research mode ----
    // Public http(s) pages only (see safeTargetUrl), redirects followed by
    // hand so each hop is re-checked, and the result is returned as inert
    // text: the client parses it, and nobody can turn this route into a page
    // that executes attacker HTML on the worker's own origin.
    if (url.pathname === '/read') {
      const target = url.searchParams.get('url');
      let safe = safeTargetUrl(target);
      if (!safe) {
        return json({ error: 'missing, malformed, or non-public ?url= (only public http/https pages can be fetched)' }, 400);
      }
      // A blocked user loses research mode too, not just the model.
      const readUser = req.headers.get('X-GPA-User');
      if (readUser && env && env.TELEMETRY) {
        const rs = await resolve(env.TELEMETRY, readUser);
        if (rs.state === 'blocked') return json({ error: 'blocked by the owner' }, 403);
      }
      const MAX_HOPS = 4;
      const MAX_BYTES = 3000000;
      let upstream = null;
      try {
        for (let hop = 0; hop < MAX_HOPS; hop++) {
          upstream = await fetch(safe.toString(), {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; AgentConsole/1.0; research reader)',
              'Accept': 'text/html, text/plain;q=0.9'
            },
            redirect: 'manual',
            signal: AbortSignal.timeout(15000)
          });
          if (upstream.status < 300 || upstream.status > 399) break;
          const loc = upstream.headers.get('location');
          if (!loc) break;
          const next = safeTargetUrl(new URL(loc, safe).toString());
          if (!next) return json({ error: 'refused: redirect pointed at a non-public address' }, 400);
          safe = next;
          upstream = null;
        }
      } catch (e) {
        return json({ error: 'fetch failed' }, 502);
      }
      if (!upstream) return json({ error: 'too many redirects' }, 502);
      if (upstream.status >= 400) return json({ error: `upstream returned ${upstream.status}` }, 502);
      const type = upstream.headers.get('content-type') || '';
      if (!type.includes('text/html') && !type.includes('text/plain')) {
        return json({ error: 'not an HTML/text page: ' + type.slice(0, 80) }, 415);
      }
      let body;
      try { body = await upstream.text(); } catch (e) { return json({ error: 'could not read the page' }, 502); }
      if (body.length > MAX_BYTES) body = body.slice(0, MAX_BYTES);
      return new Response(body, {
        status: 200,
        headers: {
          ...cors, ...SECURITY_HEADERS,
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment',
          'Content-Security-Policy': "default-src 'none'; sandbox"
        }
      });
    }

    // ---- AI proxies: /v1/* (OpenAI) and /gemini/* (Google) ----
    // Server-side moderation tooth: a blocked user is refused here, so blocking
    // actually costs them the AI features rather than only hiding the panel.
    // The client sends its signed-in name as X-GPA-User. Both providers are
    // proxied so an owner-assigned key is attached HERE and never reaches the
    // browser; a user who brings their own key in direct mode still bypasses
    // the worker entirely, which is their key to spend.
    //
    // Anything that is not one of these two prefixes is refused: an earlier
    // version fell through to "forward whatever path was asked for to
    // api.openai.com", which made every unrouted request an open proxy hop.
    const AI_ROUTES = {
      openai: { prefix: '/v1/', upstream: 'https://api.openai.com' },
      gemini: { prefix: '/gemini/', upstream: 'https://generativelanguage.googleapis.com' }
    };
    const provider = url.pathname.startsWith(AI_ROUTES.openai.prefix) ? 'openai'
      : (url.pathname.startsWith(AI_ROUTES.gemini.prefix) ? 'gemini' : null);
    if (!provider) return json({ error: 'not found' }, 404);
    const modUser = req.headers.get('X-GPA-User');
    let assignedKey = '';
    // Config-driven checks that apply to every /v1/* call, whether or not it
    // carries X-GPA-User (Origin/country are request-level, not user-level).
    // Both are opt-in: empty lists (the default) allow everything, so this
    // changes nothing until the owner configures them.
    let vCfg = null;
    if (env && env.TELEMETRY) {
      vCfg = await getConfig(env.TELEMETRY);
      const country = String((req.cf && req.cf.country) || '').toUpperCase();
      if (vCfg.blockedCountries.length && vCfg.blockedCountries.includes(country)) {
        return json({ error: { message: 'This service is not available in your region.', type: 'region_blocked' } }, 403);
      }
      const origin = req.headers.get('Origin');
      if (vCfg.allowedOrigins.length && origin && !vCfg.allowedOrigins.includes(origin)) {
        return json({ error: { message: 'Requests from this origin are not allowed.', type: 'origin_blocked' } }, 403);
      }
    }
    if (modUser && env && env.TELEMETRY) {
      const r = await resolve(env.TELEMETRY, modUser);   // owner resolves to active
      if (r.state === 'blocked') {
        return json({ error: { message: 'Access to this tool has been blocked by the owner.' + (r.reason ? ' ' + r.reason : ''), type: 'blocked_by_owner' } }, 403);
      }
      if (!r.owner) {
        const mod = await getMod(env.TELEMETRY, modUser);
        // Approval queue: a brand-new user (see /track) can't reach the
        // model at all until /admin/moderate action "approve".
        //
        // The pending flag is only set by /track, so a caller who skips the
        // heartbeat and comes straight here used to sail past the queue with
        // any made-up name. With approvalMode on, a name the owner has never
        // seen is therefore treated as pending whether or not it has a record.
        if (mod.pending) {
          return json({ error: { message: 'Your access is awaiting approval from the owner.', type: 'awaiting_approval' } }, 403);
        }
        if (vCfg && vCfg.approvalMode && !mod.allow) {
          const known = await env.TELEMETRY.get('user:' + String(modUser).toLowerCase(), 'json');
          if (!known) {
            return json({ error: { message: 'Your access is awaiting approval from the owner.', type: 'awaiting_approval' } }, 403);
          }
        }
        // Per-user AI freeze: chat and /read keep working, only this route
        // is cut off — a lighter lever than a full block.
        if (mod.aiFrozen) {
          return json({ error: { message: 'AI access has been frozen by the owner.', type: 'ai_frozen' } }, 403);
        }
      }
      // Per-user daily request cap (see /admin/config's dailyQuota, 0 =
      // unlimited). The owner is exempt. Counted per calendar day (UTC) with
      // a 2-day TTL so old counters clean themselves up — no cron needed.
      if (!r.owner && vCfg && vCfg.dailyQuota > 0) {
        const day = new Date().toISOString().slice(0, 10);
        const qKey = `usage:${day}:${String(modUser).toLowerCase()}`;
        const used = parseInt(await env.TELEMETRY.get(qKey), 10) || 0;
        if (used >= vCfg.dailyQuota) {
          return json({ error: { message: `Daily request limit reached (${vCfg.dailyQuota}/day). Ask the owner to raise it, or try again tomorrow.`, type: 'quota_exceeded' } }, 429);
        }
        await env.TELEMETRY.put(qKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 });
      }
      // An owner-assigned key (see /admin/assignkey) always wins over
      // whatever the client sent. A key aimed at this exact user wins over
      // an "assign to everyone" key.
      try {
        assignedKey = await getAssignedKey(env.TELEMETRY, provider, modUser);
      } catch (e) { /* fall back to whatever the client sent */ }
    }

    // Absent an assigned key, the key can arrive three ways, tried in order:
    //   1. a normal Authorization header
    //   2. the X-GPA-Key header    — for pages that rewrite Authorization
    //   3. a _gpa_key field in the JSON body — for pages whose wrappers strip
    //      custom headers too.
    // A key in the query string (the old ?key=) is no longer accepted at all:
    // URLs end up in browser history, Referer headers, proxy and CDN logs and
    // screenshots, so a key sent that way should be considered burned. Any
    // ?key= still arriving is dropped before the request is forwarded.
    let bodyText;
    let keyFromBody = '';
    let parsedBody = null;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      bodyText = await req.text();
      if (bodyText) {
        try {
          parsedBody = JSON.parse(bodyText);
          if (parsedBody && typeof parsedBody._gpa_key === 'string') {
            keyFromBody = parsedBody._gpa_key;
            delete parsedBody._gpa_key;          // never forward it upstream
            bodyText = JSON.stringify(parsedBody);
          }
        } catch (e) { /* not JSON — forward untouched */ }
      }
    }

    // Server-side model/token caps (see /admin/config's allowedModels and
    // maxTokens). Defaults — an empty allowlist and a 0 cap — allow anything,
    // so this is a no-op until the owner configures it. OpenAI names the model
    // in the body; Gemini names it in the path
    // (/gemini/v1beta/models/<model>:generateContent), so it is read from
    // whichever place this provider actually puts it.
    const requestedModel = provider === 'gemini'
      ? (/\/models\/([^/:]+)/.exec(url.pathname) || [])[1] || ''
      : (parsedBody && typeof parsedBody === 'object' ? parsedBody.model : '');
    if (vCfg && vCfg.allowedModels.length && requestedModel && !vCfg.allowedModels.includes(requestedModel)) {
      return json({ error: { message: `Model "${requestedModel}" is not allowed.`, type: 'model_not_allowed' } }, 400);
    }
    if (vCfg && vCfg.maxTokens > 0 && parsedBody && typeof parsedBody === 'object') {
      const asked = provider === 'gemini'
        ? (parsedBody.generationConfig && parsedBody.generationConfig.maxOutputTokens)
        : parsedBody.max_tokens;
      if (typeof asked === 'number' && asked > vCfg.maxTokens) {
        return json({ error: { message: `max_tokens exceeds the configured cap of ${vCfg.maxTokens}.`, type: 'max_tokens_exceeded' } }, 400);
      }
    }

    // A header value may only contain printable ASCII. If a key picked up an
    // invisible character somewhere (a zero-width space pasted in with it, a
    // stray newline), passing it straight to fetch throws a TypeError and the
    // whole worker 500s. Strip it here so the request still goes through.
    const strip = (v) => (v ? String(v).replace(/[^\x21-\x7E]/g, '') : '');
    const apiKey = strip(assignedKey)
      || strip((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''))
      || strip(req.headers.get('X-GPA-Key'))
      || strip(keyFromBody);

    // Without this, a missing key was forwarded as the literal header
    // "Authorization: null", and OpenAI's reply ("You didn't provide an API
    // key") made it look like the key itself was at fault.
    if (!apiKey) {
      return json({
        error: {
          message: 'No API key reached the proxy. Either ask the owner to assign you one, or paste your own in Settings — and make sure script.js and worker.js are both up to date, since keys are no longer accepted in the URL.',
          type: 'agent_console_no_key'
        }
      }, 401);
    }

    // The upstream URL is rebuilt from the route's own prefix, never taken
    // from caller-supplied input, and the query string is dropped entirely so
    // a stray ?key= can't be relayed onward.
    const route = AI_ROUTES[provider];
    const upstreamPath = provider === 'gemini'
      ? url.pathname.slice('/gemini'.length)
      : url.pathname;
    const upstreamHeaders = { 'Content-Type': 'application/json' };
    if (provider === 'gemini') upstreamHeaders['x-goog-api-key'] = apiKey;
    else upstreamHeaders['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(route.upstream + upstreamPath, {
      method: req.method,
      headers: upstreamHeaders,
      body: bodyText
    });
    const r = new Response(res.body, res);
    r.headers.set('Access-Control-Allow-Origin', '*');
    Object.entries(SECURITY_HEADERS).forEach(([k, v]) => r.headers.set(k, v));
    return r;
}

// Deletes every stored chat message across every room (public and private).
// Rooms themselves (their codes) are untouched — only the message logs under
// them. Runs once a day from the Cron Trigger, so a list() here is fine; it is
// per-poll listing that this file deliberately avoids.
//
// The msg: prefix is the old one-key-per-message layout. It is swept too so a
// worker upgraded mid-life doesn't strand the previous scheme's keys in KV
// (they also carry their own TTL, so this only hurries them along).
async function clearAllChatMessages(kv) {
  let deleted = 0;
  for (const prefix of ['roomlog:', 'msg:']) {
    let cursor;
    do {
      const listed = await kv.list({ prefix, cursor });
      for (const k of listed.keys) { await kv.delete(k.name); deleted++; }
      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor);
  }
  return deleted;
}
