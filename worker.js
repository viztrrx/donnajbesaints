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
//   /read?url=…        — fetches a web page server-side and returns its HTML
//                        so research mode can read pages the browser itself
//                        is not allowed to fetch (CORS). HTML/text only.
//
// Env vars: TELEMETRY (KV binding), ADMIN_TOKEN (owner secret), OWNER
// (username, defaults 'viztrrx'). Optional, both off unless set:
//   OWNER_CODE     — a shared secret a client must send as the X-GPA-Owner
//                    header to post to /track or /chat/send as the OWNER
//                    username. Prevents anyone else from claiming that name.
//   COADMIN_TOKEN  — a second, lower-privilege admin token. A request
//                    bearing it may call /admin/moderate, /admin/rooms,
//                    /admin/clearchat, /admin/setunlock, /admin/summary, but
//                    gets 403 on /admin/assignkey, /admin/config,
//                    /admin/clear, /admin/audit, /admin/backup, /admin/restore.
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

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GPA-Key, X-GPA-User, X-GPA-Owner',
      'Access-Control-Max-Age': '86400'
    };
    const json = (obj, status) => new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });

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

    // ---- Auth levels: owner (?token=ADMIN_TOKEN) vs an optional co-admin
    // (?token=COADMIN_TOKEN). A co-admin may moderate day-to-day (mute, kick,
    // room management, unlock codes) but never touch billing-sensitive or
    // whole-system state (keys, global config, wipes, audit, backup/restore).
    // Neither token is set by default, so nothing here changes behavior until
    // the owner opts in by setting COADMIN_TOKEN.
    const authLevel = (url, env) => {
      const token = url.searchParams.get('token') || '';
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      const COADMIN = (env && env.COADMIN_TOKEN) || '';
      if (ADMIN && token === ADMIN) return 'owner';
      if (COADMIN && token === COADMIN) return 'coadmin';
      return null;
    };
    // Owner-only route guard. Returns a Response to send back immediately, or
    // null if the caller may proceed.
    const requireOwner = (url, env) => {
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!ADMIN) return json({ error: 'ADMIN_TOKEN not set on the worker' }, 500);
      const level = authLevel(url, env);
      if (!level) return json({ error: 'unauthorized' }, 401);
      if (level !== 'owner') return json({ error: 'forbidden — owner only' }, 403);
      return null;
    };
    // Owner-or-co-admin route guard, for the handful of day-to-day moderation
    // routes a co-admin is allowed to use.
    const requireStaff = (url, env) => {
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!ADMIN) return json({ error: 'ADMIN_TOKEN not set on the worker' }, 500);
      const level = authLevel(url, env);
      if (!level) return json({ error: 'unauthorized' }, 401);
      return null;
    };
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
    // Resolves both providers' assigned keys for one user: a key aimed at
    // this exact username wins; otherwise an "assign to everyone" key (see
    // /admin/assignkey) applies. Delivered to the client via /track and
    // /status so it lands in their own localStorage without them ever
    // pasting it — see the client-side handling in script.js.
    const getAssignedKeys = async (kv, user) => {
      if (!kv || !user) return {};
      const u = String(user).toLowerCase();
      const out = {};
      for (const provider of ['openai', 'gemini']) {
        const specific = await kv.get(`key:${provider}:${u}`, 'json');
        const wildcard = specific ? null : await kv.get(`key:${provider}:*`, 'json');
        const rec = specific || wildcard;
        if (rec && rec.key) out[provider] = rec.key;
      }
      return out;
    };
    const sha256hex = async (str) => {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
    };
    // Human-friendly code: uppercase, no 0/O/1/I/L ambiguity.
    const genCode = () => {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      const a = new Uint8Array(8); crypto.getRandomValues(a);
      return [...a].map((x) => chars[x % chars.length]).join('');
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(req.url);

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
          '/v1/*', '/read', '/track', '/status', '/health',
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
        url: clip(body.url, 300),
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
      const assignedKeys = await getAssignedKeys(kv, user);
      return json({
        ok: true, state: r.state, reason: r.reason, kickNonce: r.kickNonce,
        owner: !!r.owner, private: !!r.private,
        broadcast: cfg.broadcast || '', reloadVersion: cfg.reloadVersion || 0,
        features: { ...(cfg.features || {}), ...(mod.features || {}) },
        announcement: cfg.announcement || null, assignedKeys,
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
      const assignedKeys = await getAssignedKeys(kv, statusUser);
      return json({
        state: r.state, reason: r.reason, kickNonce: r.kickNonce,
        owner: !!r.owner, private: !!r.private,
        broadcast: cfg.broadcast || '', reloadVersion: cfg.reloadVersion || 0,
        features: { ...(cfg.features || {}), ...(mod.features || {}) },
        announcement: cfg.announcement || null, assignedKeys,
        brandName: cfg.brandName || '', defaultTheme: cfg.defaultTheme || ''
      });
    }

    // Sets a user's moderation state. Owner or co-admin (see authLevel above).
    if (url.pathname === '/admin/moderate' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = requireStaff(url, env);
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
      await logAudit(kv, { route: '/admin/moderate', action, target: user, admin: authLevel(url, env) });
      return json({ ok: true, user, mod: cur });
    }

    // Global config. Owner only — a co-admin never touches whole-system state.
    if (url.pathname === '/admin/config' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      const denied = requireOwner(url, env);
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
    // Messages are stored in the KV key's METADATA with an empty value, so
    // polling a room is a single list() call with no per-message reads, and
    // they expire on their own via TTL rather than needing a cleanup job.
    // The TTL is a backstop only — the real daily reset is the Cron Trigger
    // at the bottom of this file, which wipes every room's messages outright.
    const CHAT_TTL = 60 * 60 * 24 * 7;   // messages live a week at most
    const CHAT_MAX = 120;                // messages returned per poll
    const pad = (n) => String(n).padStart(13, '0');
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
      if (h !== room.codeHash) return { ok: false, error: 'wrong room code' };
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
      const key = `msg:${access.id}:${pad(ts)}:${Math.random().toString(36).slice(2, 7)}`;
      const meta = { u: user, t: text, ts, owner: userLower === OWNER };
      try {
        await kv.put(key, '', { expirationTtl: CHAT_TTL, metadata: meta });
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
      const listed = await kv.list({ prefix: `msg:${access.id}:` });
      const messages = (listed.keys || [])
        .map((k) => k.metadata)
        .filter((m) => m && m.ts > since)
        .sort((a, b) => a.ts - b.ts)
        .slice(-CHAT_MAX);
      return json({ ok: true, room: access.id, messages, now: Date.now() });
    }

    // Owner: manually wipe every room's chat history right now, same routine
    // the daily Cron Trigger runs. Handy for testing the cron without
    // waiting for it, or for an ad-hoc reset.
    if (url.pathname === '/admin/clearchat' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'chat storage not configured' }, 500);
      const denied = requireStaff(url, env);
      if (denied) return denied;
      const deleted = await clearAllChatMessages(kv);
      await logAudit(kv, { route: '/admin/clearchat', action: 'clearchat', target: null, admin: authLevel(url, env) });
      return json({ ok: true, deleted });
    }

    // Create / list / delete private rooms, plus per-room slow mode and bans.
    // Owner or co-admin.
    if (url.pathname === '/admin/rooms' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      if (!kv) return json({ error: 'chat storage not configured' }, 500);
      const denied = requireStaff(url, env);
      if (denied) return denied;
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const action = body.action || 'list';
      const admin = authLevel(url, env);

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
        const msgs = await kv.list({ prefix: `msg:${id}:` });
        for (const k of msgs.keys) await kv.delete(k.name);
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
      const denied = requireOwner(url, env);
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
      const denied = requireStaff(url, env);
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
      await logAudit(kv, { route: '/admin/setunlock', action: 'setunlock', target: user, admin: authLevel(url, env) });
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
      const key = 'mod:' + user;
      const cur = await kv.get(key, 'json');
      if (!cur || !cur.unlock) return json({ ok: false, error: 'no unlock code set for this user' }, 200);
      const h = await sha256hex(user + '|' + code);
      if (h !== cur.unlock) return json({ ok: false, error: 'invalid code' }, 200);
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
      const denied = requireStaff(url, env);   // a co-admin needs this to know who to moderate
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
      const denied = requireOwner(url, env);
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
      const denied = requireOwner(url, env);
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
      const denied = requireOwner(url, env);
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
      const denied = requireOwner(url, env);
      if (denied) return denied;
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { return json({ error: 'invalid JSON body' }, 400); }
      let restored = 0;
      if (body.config && typeof body.config === 'object') { await kv.put('config', JSON.stringify(body.config)); restored++; }
      for (const group of [body.mods, body.rooms, body.roomCfgs]) {
        if (!group || typeof group !== 'object') continue;
        for (const [key, val] of Object.entries(group)) { await kv.put(key, JSON.stringify(val)); restored++; }
      }
      if (Array.isArray(body.audit)) {
        for (const item of body.audit) {
          if (!item || !item.key || !item.entry) continue;
          await kv.put(item.key, JSON.stringify(item.entry), { expirationTtl: AUDIT_TTL });
          restored++;
        }
      }
      await logAudit(kv, { route: '/admin/restore', action: 'restore', target: null, admin: 'owner' });
      return json({ ok: true, restored });
    }

    // ---- /read?url=… : server-side page fetch for research mode ----
    if (url.pathname === '/read') {
      const target = url.searchParams.get('url');
      if (!target || !/^https?:\/\//i.test(target)) {
        return new Response(JSON.stringify({ error: 'missing or bad ?url=' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      let upstream;
      try {
        upstream = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentConsole/1.0; research reader)' },
          redirect: 'follow'
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'fetch failed' }), {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      const type = upstream.headers.get('content-type') || '';
      if (!type.includes('text/html') && !type.includes('text/plain')) {
        return new Response(JSON.stringify({ error: 'not an HTML/text page: ' + type }), {
          status: 415,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      let body = await upstream.text();
      if (body.length > 3000000) body = body.slice(0, 3000000);
      return new Response(body, {
        status: 200,
        headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ---- /v1/* : forward to OpenAI ----
    // Server-side moderation tooth: a blocked user is refused here, so blocking
    // actually costs them the AI features rather than only hiding the panel.
    // The client sends its signed-in name as X-GPA-User. (This can't gate
    // Gemini, which the browser calls directly, or a user who supplies their
    // own key in direct mode — those bypass the worker entirely.)
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
        if (mod.pending) {
          return json({ error: { message: 'Your access is awaiting approval from the owner.', type: 'awaiting_approval' } }, 403);
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
        const specific = await env.TELEMETRY.get('key:openai:' + String(modUser).toLowerCase(), 'json');
        const rec = specific || await env.TELEMETRY.get('key:openai:*', 'json');
        if (rec && rec.key) assignedKey = rec.key;
      } catch (e) { /* fall back to whatever the client sent */ }
    }

    // Absent an assigned key, the key can arrive four ways, tried in order:
    //   1. a normal Authorization header
    //   2. the X-GPA-Key header    — for pages that rewrite Authorization
    //   3. a _gpa_key field in the JSON body — for pages whose wrappers strip
    //      custom headers too. Preferred over a query parameter because a key
    //      in a URL leaks into browser history, Referer headers, proxy/CDN
    //      logs and screenshots; a key in a body leaks into none of those.
    //   4. ?key= in the query string — legacy, still accepted so an older
    //      copy of script.js keeps working, but it should be considered
    //      compromised once used and rotated.
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
    // so this is a no-op until the owner configures it.
    if (vCfg && parsedBody && typeof parsedBody === 'object') {
      if (vCfg.allowedModels.length && parsedBody.model && !vCfg.allowedModels.includes(parsedBody.model)) {
        return json({ error: { message: `Model "${parsedBody.model}" is not allowed.`, type: 'model_not_allowed' } }, 400);
      }
      if (vCfg.maxTokens > 0 && typeof parsedBody.max_tokens === 'number' && parsedBody.max_tokens > vCfg.maxTokens) {
        return json({ error: { message: `max_tokens exceeds the configured cap of ${vCfg.maxTokens}.`, type: 'max_tokens_exceeded' } }, 400);
      }
    }

    // A header value may only contain printable ASCII. If a key picked up an
    // invisible character somewhere (a zero-width space pasted in with it, a
    // stray newline), passing it straight to fetch throws a TypeError and the
    // whole worker 500s. Strip it here so the request still goes through.
    const strip = (v) => (v ? String(v).replace(/[^\x21-\x7E]/g, '') : '');
    const bearer = strip(assignedKey)
      || strip((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''))
      || strip(req.headers.get('X-GPA-Key'))
      || strip(keyFromBody)
      || strip(url.searchParams.get('key'));

    // Without this, a missing key was forwarded as the literal header
    // "Authorization: null", and OpenAI's reply ("You didn't provide an API
    // key") made it look like the key itself was at fault.
    if (!bearer) {
      return new Response(JSON.stringify({
        error: {
          message: 'No API key reached the proxy. The page is probably stripping headers — make sure script.js and worker.js are both up to date, since the key channel they agree on changed.',
          type: 'agent_console_no_key'
        }
      }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const res = await fetch('https://api.openai.com' + url.pathname, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      },
      body: bodyText
    });
    const r = new Response(res.body, res);
    r.headers.set('Access-Control-Allow-Origin', '*');
    return r;
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

// Deletes every stored chat message across every room (public and private).
// Rooms themselves (their codes) are untouched — only the msg: entries under
// them. Paginates past KV's 1000-keys-per-list() page so this stays correct
// even if a very chatty day left more than one page of messages.
async function clearAllChatMessages(kv) {
  let deleted = 0;
  let cursor;
  do {
    const listed = await kv.list({ prefix: 'msg:', cursor });
    for (const k of listed.keys) { await kv.delete(k.name); deleted++; }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
  return deleted;
}
