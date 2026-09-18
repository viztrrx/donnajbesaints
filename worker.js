// Agent Console — Cloudflare Worker proxy
// Deploy: Cloudflare dashboard → Workers & Pages → donnajbe → Edit code →
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

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GPA-Key, X-GPA-User',
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
    // Global, owner-controlled settings pushed to every client on its next
    // status poll: private mode, a broadcast banner, a reload counter the
    // clients compare against to force-refresh, and feature kill-switches.
    const CONFIG_DEFAULTS = { privateMode: false, broadcast: '', reloadVersion: 0, features: {}, announcement: null };
    const getConfig = async (kv) => {
      const stored = kv ? await kv.get('config', 'json') : null;
      return { ...CONFIG_DEFAULTS, ...(stored || {}) };
    };

    // Effective state for one user, combining their own moderation record with
    // global config. Order: owner is always active; an explicit block/lock
    // wins next; then private mode blocks anyone without an allow exemption.
    const resolveState = (mod, cfg, user) => {
      if (String(user).toLowerCase() === OWNER) return { state: 'active', reason: '', kickNonce: 0, owner: true };
      if (mod.state === 'blocked') return { state: 'blocked', reason: mod.reason || '', kickNonce: mod.kickNonce || 0 };
      if (mod.state === 'locked') return { state: 'locked', reason: mod.reason || '', kickNonce: mod.kickNonce || 0 };
      if (cfg.privateMode && !mod.allow) return { state: 'blocked', reason: mod.reason || 'This tool is currently private — access is limited to the owner.', kickNonce: mod.kickNonce || 0, private: true };
      return { state: 'active', reason: '', kickNonce: mod.kickNonce || 0 };
    };
    const resolve = async (kv, user) => resolveState(await getMod(kv, user), await getConfig(kv), user);
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
          '/admin/assignkey'
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
      const sid = clip(body.sid, 60) || crypto.randomUUID();
      const now = Date.now();
      const cf = req.cf || {};
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
          const uKey = 'user:' + user.toLowerCase();
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
        }
      } catch (e) { return json({ ok: false }, 200); }
      // Hand the caller its own effective state back on every beat, so a
      // block/lock/kick/private-mode change reaches them within one heartbeat
      // even without the separate /status poll.
      const r = await resolve(kv, user);
      const cfg = await getConfig(kv);
      return json({
        ok: true, state: r.state, reason: r.reason, kickNonce: r.kickNonce,
        owner: !!r.owner, private: !!r.private,
        broadcast: cfg.broadcast || '', reloadVersion: cfg.reloadVersion || 0, features: cfg.features || {},
        announcement: cfg.announcement || null
      });
    }

    // Read-only status for one user — the client polls this so a block takes
    // effect fast without waiting for the next (write-costing) heartbeat.
    if (url.pathname === '/status' && req.method === 'GET') {
      const kv = env && env.TELEMETRY;
      const r = await resolve(kv, url.searchParams.get('user') || '');
      const cfg = await getConfig(kv);
      return json({
        state: r.state, reason: r.reason, kickNonce: r.kickNonce,
        owner: !!r.owner, private: !!r.private,
        broadcast: cfg.broadcast || '', reloadVersion: cfg.reloadVersion || 0, features: cfg.features || {},
        announcement: cfg.announcement || null
      });
    }

    // Owner sets a user's moderation state. Token-gated like the other admin
    // routes, so only the owner can call it.
    if (url.pathname === '/admin/moderate' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || '').toLowerCase().slice(0, 80);
      if (!user) return json({ error: 'no user' }, 400);
      // The owner can never be blocked/locked/kicked.
      if (user === OWNER) return json({ ok: false, error: 'This user is the owner and is immune to moderation.' }, 200);
      const key = 'mod:' + user;
      const cur = (await kv.get(key, 'json')) || { state: 'active', reason: '', kickNonce: 0 };
      const action = body.action;
      if (action === 'block') { cur.state = 'blocked'; cur.allow = false; }
      else if (action === 'unblock') { cur.state = 'active'; cur.allow = true; }   // explicit allow (exempts from private mode)
      else if (action === 'lock') cur.state = 'locked';
      else if (action === 'unlock' || action === 'reset') cur.state = 'active';
      else if (action === 'kick') cur.kickNonce = (cur.kickNonce || 0) + 1;
      else return json({ error: 'unknown action' }, 400);
      cur.reason = String(body.reason || '').slice(0, 300);
      cur.updatedAt = Date.now();
      await kv.put(key, JSON.stringify(cur));
      return json({ ok: true, user, mod: cur });
    }

    // Global config: currently just private mode (block everyone but owner).
    if (url.pathname === '/admin/config' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
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
      // Bumping this makes every client notice it is out of date on its next
      // status poll and pull the latest script.
      if (body.bumpReload) cfg.reloadVersion = (cfg.reloadVersion || 0) + 1;
      await kv.put('config', JSON.stringify(cfg));
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
      const text = String(body.text || '').trim().slice(0, 500);
      if (!text) return json({ ok: false, error: 'empty message' }, 200);
      // A blocked user (or anyone shut out by private mode) can't post.
      const st = await resolve(kv, user);
      if (st.state === 'blocked') return json({ ok: false, error: 'You are blocked from chat.' }, 200);
      const access = await checkRoomAccess(kv, body.room, body.code);
      if (!access.ok) return json({ ok: false, error: access.error }, 200);
      const ts = Date.now();
      const key = `msg:${access.id}:${pad(ts)}:${Math.random().toString(36).slice(2, 7)}`;
      const meta = { u: user, t: text, ts, owner: String(user).toLowerCase() === OWNER };
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
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'chat storage not configured' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      const deleted = await clearAllChatMessages(kv);
      return json({ ok: true, deleted });
    }

    // Owner: create / list / delete private rooms.
    if (url.pathname === '/admin/rooms' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'chat storage not configured' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const action = body.action || 'list';

      if (action === 'create') {
        const name = String(body.name || '').trim().slice(0, 40);
        if (!name) return json({ error: 'name required' }, 400);
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || ('room' + Date.now().toString(36));
        if (id === 'public') return json({ error: '"public" is reserved' }, 400);
        const code = genCode();
        await kv.put(roomKey(id), JSON.stringify({
          id, name, codeHash: await sha256hex(id + '|' + code), createdAt: Date.now()
        }));
        return json({ ok: true, id, name, code });
      }
      if (action === 'delete') {
        const id = String(body.id || '').toLowerCase().slice(0, 40);
        if (!id || id === 'public') return json({ error: 'cannot delete that room' }, 400);
        await kv.delete(roomKey(id));
        const msgs = await kv.list({ prefix: `msg:${id}:` });
        for (const k of msgs.keys) await kv.delete(k.name);
        return json({ ok: true, deleted: id });
      }
      if (action === 'newcode') {
        const id = String(body.id || '').toLowerCase().slice(0, 40);
        const room = await kv.get(roomKey(id), 'json');
        if (!room) return json({ error: 'no such room' }, 404);
        const code = genCode();
        room.codeHash = await sha256hex(id + '|' + code);
        await kv.put(roomKey(id), JSON.stringify(room));
        return json({ ok: true, id, code });
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

    // Owner assigns a specific OpenAI key to one user. The key is stored here
    // (never sent to the browser) and the /v1/* forwarder below prefers it
    // over anything the client supplies, so it takes effect immediately and
    // stays in force until the owner clears it — the user never sees or
    // handles the key at all. Only OpenAI is supported: those calls already
    // route through this worker, so the key never has to leave the server.
    // Gemini calls go straight from the browser to Google and can't be
    // covered this way without exposing the key to that browser.
    if (url.pathname === '/admin/assignkey' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      let body = {};
      try { body = JSON.parse(await req.text()); } catch (e) { /* tolerate */ }
      const user = String(body.user || '').toLowerCase().slice(0, 80);
      if (!user) return json({ error: 'no user' }, 400);
      const key = String(body.key || '').trim();
      const rkey = 'key:openai:' + user;
      if (!key) {
        await kv.delete(rkey);
        return json({ ok: true, user, assigned: false });
      }
      await kv.put(rkey, JSON.stringify({ key, assignedAt: Date.now() }));
      return json({ ok: true, user, assigned: true });
    }

    // Owner mints a one-time unlock code for ONE user. We store only its hash,
    // and hand the plaintext back this once for the owner to pass along. The
    // code releases only this username's block, and is consumed on use.
    if (url.pathname === '/admin/setunlock' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
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
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound on the worker' }, 500);
      if (!ADMIN) return json({ error: 'ADMIN_TOKEN not set on the worker' }, 500);
      if ((url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);

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
      const keyed = new Set();
      const kl = await kv.list({ prefix: 'key:openai:' });
      kl.keys.forEach((k) => keyed.add(k.name.slice('key:openai:'.length)));
      const stampOne = (x) => {
        const r = resolveState(mods[String(x.user).toLowerCase()] || { state: 'active' }, cfg, x.user);
        return { ...x, state: r.state, reason: r.reason, owner: !!r.owner, private: !!r.private, hasOpenAiKey: keyed.has(String(x.user).toLowerCase()) };
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
        users: users.sort((a, b) => b.lastSeen - a.lastSeen).map(stampOne)
      });
    }

    if (url.pathname === '/admin/clear' && req.method === 'POST') {
      const kv = env && env.TELEMETRY;
      const ADMIN = (env && env.ADMIN_TOKEN) || '';
      if (!kv) return json({ error: 'telemetry KV not bound' }, 500);
      if (!ADMIN || (url.searchParams.get('token') || '') !== ADMIN) return json({ error: 'unauthorized' }, 401);
      let deleted = 0;
      for (const prefix of ['session:', 'user:']) {
        const list = await kv.list({ prefix });
        for (const k of list.keys) { await kv.delete(k.name); deleted++; }
      }
      return json({ ok: true, deleted });
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
    if (modUser && env && env.TELEMETRY) {
      const r = await resolve(env.TELEMETRY, modUser);   // owner resolves to active
      if (r.state === 'blocked') {
        return json({ error: { message: 'Access to this tool has been blocked by the owner.' + (r.reason ? ' ' + r.reason : ''), type: 'blocked_by_owner' } }, 403);
      }
      // An owner-assigned key (see /admin/assignkey) always wins over
      // whatever the client sent, and never leaves the server — the user's
      // browser never has to know or hold this value.
      try {
        const rec = await env.TELEMETRY.get('key:openai:' + String(modUser).toLowerCase(), 'json');
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

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      bodyText = await req.text();
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          if (parsed && typeof parsed._gpa_key === 'string') {
            keyFromBody = parsed._gpa_key;
            delete parsed._gpa_key;          // never forward it upstream
            bodyText = JSON.stringify(parsed);
          }
        } catch (e) { /* not JSON — forward untouched */ }
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
  // donnajbe → Triggers → Cron Triggers → Add "0 5 * * *".
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
