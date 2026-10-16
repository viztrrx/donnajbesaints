// Chat room log: one Durable Object per room (binding CHAT_ROOMS).
//
// WHY: the log used to be a single Workers KV value per room, updated by
// read-modify-write on every send. KV is eventually consistent across
// Cloudflare locations (a write can take up to a minute to be seen
// elsewhere), so two people sending from different places could each read
// an old copy and the second write erased the first message for good,
// while its push notification had already gone out. A Durable Object is one
// strongly consistent place per room that handles one request at a time, so
// every send is appended to the latest log and nothing is overwritten.
//
// It also hands out the message timestamps: they strictly increase in log
// order, so a client polling with "since = newest ts I have" can't skip a
// message that a slower sender's request delivered a moment later.
//
// The first touch of a room adopts whatever the old KV log held (key
// roomlog:<id>), so messages from before the upgrade stay visible.
//
// Read receipts: each person's read cursor (the newest message they had on
// screen, and when) is kept here too, reported with their polls while the
// chat is open, and handed back to everyone so the sender's latest message
// can say "Delivered" or "Read by …".
const READS_MAX = 60;                  // cursors kept per room (most recent)
//
// Typing and who's here: each poll says whether the chat is on the
// person's screen (here) and whether they are typing. That lives in memory
// only (it is stale within seconds anyway); a "last seen" time per person
// is also saved, at most once a minute, so people who left can show
// "Last seen 20 min ago".
//
// Reactions (tapbacks, as in iMessage): one per person per message, kept on
// the message itself (m.r = { '❤️': ['kj', 'dub'] }). Picking the same one
// again takes it off; picking another replaces it.
const TYPING_MS = 6000;                // "typing…" lasts this long after the last keystroke report
const HERE_MS = 10000;                 // chat on screen: polls every 1.5-3 s
const ONLINE_MS = 45000;               // console open elsewhere: polls every 15 s
const SEEN_MAX = 100;                  // last-seen times kept per room
const SEEN_WRITE_MS = 60000;           // save a person's last-seen at most this often
export const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
//
// Replies: a message can quote an earlier one (m.re = { ts, u, t, photo }),
// a short copy so it still reads right once the original scrolls out.
//
// Unsend: the sender can take a message back within UNSEND_MS. It becomes
// a placeholder ("kj unsent a message": { u, ts, unsent: true }), quotes of
// it lose their text, and every poll lists the unsent ones so screens that
// already show the message replace it too.
export const UNSEND_MS = 2 * 60 * 1000;
//
// Counts for the owner's weekly report: messages per person per UTC day,
// kept for COUNT_DAYS days (stored here, not in KV, so they cost no KV writes).
const COUNT_DAYS = 14;

const TTL_MS = 7 * 24 * 3600 * 1000;   // same week-long lifetime as before
const MAX = 120;                       // newest messages kept per room

export class ChatRoom {
  constructor(ctx, env) { this.ctx = ctx; this.storage = ctx.storage; this.env = env; this.live = new Map(); }

  // Who is typing and who is around, for the person asking.
  async presence(reader, now) {
    const me = String(reader || '').toLowerCase();
    const seen = (await this.storage.get('seen')) || {};
    const out = new Map();
    for (const [k, v] of Object.entries(seen)) if (v && now - v.at < TTL_MS) out.set(k, { u: v.u, at: v.at, hereAt: 0 });
    for (const [k, v] of this.live) out.set(k, { u: v.u, at: Math.max(v.at, (out.get(k) || {}).at || 0), hereAt: v.hereAt || 0 });
    const typing = [...this.live.entries()].filter(([k, v]) => k !== me && v.typingUntil > now).sort((a, b) => a[1].typingSince - b[1].typingSince).map(([, v]) => v.u);
    const people = [...out.values()].map((v) => ({
      u: v.u,
      state: now - v.hereAt < HERE_MS ? 'here' : now - v.at < ONLINE_MS ? 'online' : 'away',
      ago: Math.max(0, now - v.at)
    })).sort((a, b) => a.ago - b.ago).slice(0, 50);
    return { typing, people };
  }

  // Records one poll: seen now, on screen or not, typing or not.
  async touch(reader, { here, typing }, now) {
    const key = reader.toLowerCase();
    const e = this.live.get(key) || { u: reader, at: 0, hereAt: 0, typingUntil: 0, typingSince: 0 };
    e.u = reader;
    e.at = now;
    if (here) e.hereAt = now;
    if (typing === true) { if (!(e.typingUntil > now)) e.typingSince = now; e.typingUntil = now + TYPING_MS; }
    else if (typing === false) e.typingUntil = 0;
    this.live.set(key, e);
    // Forget people nobody has heard from in a while (memory only).
    if (this.live.size > SEEN_MAX) for (const [k, v] of this.live) if (now - v.at > ONLINE_MS) this.live.delete(k);
    let seen = (await this.storage.get('seen')) || {};
    if (!seen[key] || now - seen[key].at > SEEN_WRITE_MS) {
      seen[key] = { u: reader, at: now };
      seen = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1].at - a[1].at).slice(0, SEEN_MAX));
      await this.storage.put('seen', seen);
    }
  }

  async load(id) {
    let log = await this.storage.get('log');
    const updatedAt = (await this.storage.get('updatedAt')) || 0;
    if (Array.isArray(log) && updatedAt && Date.now() - updatedAt > TTL_MS) log = [];
    if (!Array.isArray(log)) {
      log = [];
      if (!(await this.storage.get('seeded')) && id && this.env && this.env.TELEMETRY) {
        try {
          const old = await this.env.TELEMETRY.get('roomlog:' + id, 'json');
          if (Array.isArray(old)) log = old.filter((m) => m && typeof m.ts === 'number').sort((a, b) => a.ts - b.ts).slice(-MAX);
        } catch (e) { /* nothing to adopt */ }
        await this.storage.put('seeded', true);
        if (log.length) await this.save(log);
      }
    }
    return log;
  }

  async save(log) {
    await this.storage.put({ log, updatedAt: Date.now() });
  }

  async fetch(req) {
    const action = new URL(req.url).pathname.slice(1);
    let body = {};
    try { body = await req.json(); } catch (e) { body = {}; }
    const id = String(body.id || '').toLowerCase().slice(0, 40);
    // One request at a time per room: the read, append and write below can't
    // interleave with another send.
    return this.ctx.blockConcurrencyWhile(async () => {
      const log = await this.load(id);
      if (action === 'read') {
        const since = Number(body.since) || 0;
        let reads = (await this.storage.get('reads')) || {};
        // A reader moves their cursor forward only, and only to a message
        // that exists (no claiming to have read the future).
        const reader = String(body.reader || '').trim().slice(0, 40);
        const seen = Number(body.seen) || 0;
        const lastTs = log.length ? log[log.length - 1].ts : 0;
        if (reader && seen > 0) {
          const key = reader.toLowerCase();
          const upTo = Math.min(seen, lastTs);
          if (upTo > ((reads[key] && reads[key].ts) || 0)) {
            reads[key] = { u: reader, ts: upTo, at: Date.now() };
            const keep = Object.entries(reads).sort((a, b) => b[1].at - a[1].at).slice(0, READS_MAX);
            reads = Object.fromEntries(keep);
            await this.storage.put('reads', reads);
          }
        }
        const fresh = Object.values(reads).filter((r) => r && Date.now() - r.at < TTL_MS);
        const now = Date.now();
        if (reader) await this.touch(reader, { here: body.here === true, typing: body.typing === true ? true : body.typing === false ? false : null }, now);
        // Reactions on any message still in the room (they change after the
        // message was first delivered, so "since" can't cover them).
        const reactions = {};
        const unsent = [];
        for (const m of log) {
          if (m && m.unsent) unsent.push(m.ts);
          else if (m && m.r && Object.keys(m.r).length) reactions[m.ts] = m.r;
        }
        const { typing, people } = await this.presence(reader, now);
        return reply({ ok: true, messages: log.filter((m) => m && m.ts > since), reads: fresh, reactions, unsent, typing, people });
      }
      if (action === 'append') {
        const m = body.msg && typeof body.msg === 'object' ? body.msg : null;
        if (!m) return reply({ ok: false, error: 'no message' }, 400);
        const last = log.length ? log[log.length - 1].ts : 0;
        const ts = Math.max(Date.now(), last + 1);
        const msg = { ...m, ts };
        delete msg.re;
        // A reply quotes a message that is still in the room (and not unsent).
        const q = Number(body.replyTo) ? log.find((x) => x && x.ts === Number(body.replyTo) && !x.unsent) : null;
        if (q) msg.re = { ts: q.ts, u: q.u, t: String(q.t || '').slice(0, 140), ...(q.media ? { photo: true } : {}) };
        log.push(msg);
        await this.save(log.slice(-MAX));
        // Sending ends "typing…" at once.
        const e = this.live.get(String(m.u || '').toLowerCase());
        if (e) e.typingUntil = 0;
        const day = new Date(ts).toISOString().slice(0, 10);
        const counts = (await this.storage.get('counts')) || {};
        const who = String(m.u || '').toLowerCase();
        counts[day] = counts[day] || {};
        counts[day][who] = { u: m.u, n: ((counts[day][who] && counts[day][who].n) || 0) + 1 };
        for (const d of Object.keys(counts).sort().slice(0, -COUNT_DAYS)) delete counts[d];
        await this.storage.put('counts', counts);
        return reply({ ok: true, ts, re: msg.re || null });
      }
      if (action === 'stats') {
        // Messages per person since a UTC day (inclusive).
        const from = String(body.from || '');
        const counts = (await this.storage.get('counts')) || {};
        const people = {};
        let total = 0;
        for (const [d, byUser] of Object.entries(counts)) {
          if (d < from) continue;
          for (const [k, v] of Object.entries(byUser)) { people[k] = { u: v.u, n: ((people[k] && people[k].n) || 0) + v.n }; total += v.n; }
        }
        return reply({ ok: true, total, people: Object.values(people).sort((a, b) => b.n - a.n) });
      }
      if (action === 'unsend') {
        const key = String(body.user || '').trim().toLowerCase();
        const m = log.find((x) => x && x.ts === Number(body.ts));
        if (!m || !key || String(m.u || '').toLowerCase() !== key) return reply({ ok: false, error: 'message not found' }, 404);
        if (m.unsent) return reply({ ok: true, already: true });
        if (Date.now() - m.ts > UNSEND_MS) return reply({ ok: false, error: 'You can only unsend a message within 2 minutes of sending it.' }, 403);
        const media = m.media && m.media.id ? m.media.id : null;
        const i = log.indexOf(m);
        log[i] = { u: m.u, ts: m.ts, unsent: true, ...(m.owner ? { owner: true } : {}) };
        for (const x of log) if (x && x.re && x.re.ts === m.ts) x.re = { ts: m.ts, u: m.u, t: '', unsent: true };
        await this.save(log);
        return reply({ ok: true, media });
      }
      if (action === 'react') {
        const user = String(body.user || '').trim().slice(0, 40);
        const emoji = String(body.emoji || '');
        if (!user || !TAPBACKS.includes(emoji)) return reply({ ok: false, error: 'not a reaction' }, 400);
        const m = log.find((x) => x && x.ts === Number(body.ts));
        if (!m || m.unsent) return reply({ ok: false, error: 'message not found' }, 404);
        const key = user.toLowerCase();
        const had = Object.keys(m.r || {}).find((e) => (m.r[e] || []).some((n) => n.toLowerCase() === key));
        const r = {};
        for (const [e, names] of Object.entries(m.r || {})) {
          const left = (names || []).filter((n) => n.toLowerCase() !== key);
          if (left.length) r[e] = left;
        }
        if (had !== emoji) r[emoji] = [...(r[emoji] || []), user].slice(-50);
        if (Object.keys(r).length) m.r = r; else delete m.r;
        await this.save(log);
        return reply({ ok: true, r: m.r || {}, mine: had === emoji ? null : emoji });
      }
      if (action === 'delete') {
        const kept = log.filter((m) => !(m && m.ts === Number(body.ts) && m.u === body.u));
        await this.save(kept);
        return reply({ ok: true, deleted: log.length - kept.length });
      }
      if (action === 'clear') {
        const n = log.length;
        await this.storage.put({ log: [], reads: {}, updatedAt: Date.now(), seeded: true });
        return reply({ ok: true, deleted: n });
      }
      return reply({ ok: false, error: 'unknown action' }, 404);
    });
  }
}

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// Calls one room's object. Throws on any failure, so a caller never mistakes
// "the room couldn't be reached" for "the room is empty".
export async function chatRoomCall(env, id, action, body) {
  const room = String(id || 'public').toLowerCase().slice(0, 40);
  const ns = env.CHAT_ROOMS;
  const res = await ns.get(ns.idFromName(room)).fetch('https://chat-room/' + action, {
    method: 'POST', body: JSON.stringify({ ...(body || {}), id: room })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || ('chat room unavailable (' + res.status + ')'));
  return data;
}
