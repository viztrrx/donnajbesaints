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
//
// Edit: the sender can change a message's text within EDIT_MS (it then
// says "edited"; quotes of it follow). Pins: staff pin up to PINS_MAX
// messages to the top of a room. Polls: a message can carry a poll
// (m.poll = { q, options }); each person has one vote (m.pv = { index:
// [names] }), voting again for the same option takes it back.
export const EDIT_MS = 2 * 60 * 1000;
//
// Daily trivia (round 3): the open question lives here, in #public's
// object, so "first correct answer wins" is decided one message at a time.
// System messages (trivia, game records) carry m.sys and aren't counted.
const normAnswer = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
export function triviaMatches(text, answers) {
  const t = ' ' + normAnswer(text) + ' ';
  return (answers || []).some((a) => { const n = normAnswer(a); return n && t.includes(' ' + n + ' '); });
}
const PINS_MAX = 3;
const INBOX_MAX = 200;                 // conversations kept per inbox (newest)
const ALERTS_MAX = 150;                // staff alerts kept for the console's pop-ups

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

  // Messages (direct messages and group chats): each person has an inbox
  // object (named "inbox-<name>") listing their conversations with the
  // latest message and how many arrived since they last read it, so the
  // Messages list and its badge cost one call instead of one per
  // conversation. "inbox-@all" lists every conversation for the owner and
  // admins (safety review) and counts private messages per day for the
  // public stats. The messages themselves live in each conversation's own
  // room object, like any chat room.
  async inbox(action, body) {
    let box = (await this.storage.get('inbox')) || {};
    const cid = String(body.conv && body.conv.id || body.convId || '').toLowerCase().slice(0, 40);
    const meta = (c) => ({ id: cid, kind: c.kind === 'group' ? 'group' : 'dm', name: String(c.name || '').slice(0, 40), members: (Array.isArray(c.members) ? c.members : []).map(String).slice(0, 25) });
    const save = async () => {
      const keep = Object.values(box).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, INBOX_MAX);
      box = Object.fromEntries(keep.map((e) => [e.id, e]));
      await this.storage.put('inbox', box);
    };
    if (action === 'inbox_list') {
      const list = Object.values(box).sort((a, b) => (b.at || 0) - (a.at || 0));
      const days = (await this.storage.get('days')) || {};
      return reply({ ok: true, convs: list, days });
    }
    if (!cid) return reply({ ok: false, error: 'no conversation' }, 400);
    if (action === 'inbox_put') {
      box[cid] = { ...(box[cid] || { n: 0, last: null, at: Date.now() }), ...meta(body.conv) };
      await save();
      return reply({ ok: true });
    }
    if (action === 'inbox_bump') {
      const m = body.msg || {};
      const e = { ...(box[cid] || { n: 0 }), ...meta(body.conv) };
      e.last = { u: String(m.u || '').slice(0, 40), t: String(m.t || '').slice(0, 120), ts: Number(m.ts) || Date.now() };
      e.at = e.last.ts;
      e.n = body.self ? 0 : Math.min(999, (e.n || 0) + 1);
      box[cid] = e;
      await save();
      if (body.count) {
        // Private messages per UTC day (14 days), for the public stats.
        const days = (await this.storage.get('days')) || {};
        const d = new Date(e.at).toISOString().slice(0, 10);
        days[d] = (days[d] || 0) + 1;
        for (const k of Object.keys(days).sort().slice(0, -COUNT_DAYS)) delete days[k];
        await this.storage.put('days', days);
      }
      return reply({ ok: true });
    }
    if (action === 'inbox_read') {
      const e = box[cid];
      if (e && e.n && (!e.last || Number(body.ts) >= e.last.ts)) { e.n = 0; await this.storage.put('inbox', box); }
      return reply({ ok: true });
    }
    if (action === 'inbox_claim') {
      // Pop-up notifications: each key once per browser ("dev"), for a day.
      const now = Date.now();
      const dev = String(body.dev || '').slice(0, 48);
      let claims = (await this.storage.get('claims')) || {};
      const fresh = [];
      for (const k of (Array.isArray(body.keys) ? body.keys : []).slice(0, 20)) {
        const id = dev + '|' + String(k).slice(0, 80);
        if (claims[id]) continue;
        claims[id] = now;
        fresh.push(k);
      }
      if (fresh.length) {
        claims = Object.fromEntries(Object.entries(claims).filter(([, at]) => now - at < 864e5).sort((a, b) => b[1] - a[1]).slice(0, 1000));
        await this.storage.put('claims', claims);
      }
      return reply({ ok: true, fresh });
    }
    if (action === 'inbox_remove') {
      if (box[cid]) { delete box[cid]; await this.storage.put('inbox', box); }
      return reply({ ok: true });
    }
    return reply({ ok: false, error: 'unknown action' }, 404);
  }

  // Staff alerts for the console's pop-ups (owner and admins): the same
  // alerts the owner's phone gets, kept here (object "inbox-@alerts") so
  // each staff console can ask "anything since <ts>?" every few seconds.
  // Timestamps strictly increase, so polling with the newest one can't skip
  // an alert. An alert with a throttle key is kept at most once per window.
  async alerts(action, body) {
    let list = (await this.storage.get('alerts')) || [];
    if (action === 'alerts_push') {
      const a = body.alert || {};
      const now = Date.now();
      const tk = body.throttle && body.throttle.key ? String(body.throttle.key).slice(0, 120) : '';
      if (tk) {
        let thr = (await this.storage.get('athr')) || {};
        if (thr[tk] && thr[tk] > now) return reply({ ok: true, throttled: true });
        thr[tk] = now + Math.max(10, Math.min(3600, Number(body.throttle.seconds) || 300)) * 1000;
        thr = Object.fromEntries(Object.entries(thr).filter(([, until]) => until > now).slice(-300));
        await this.storage.put('athr', thr);
      }
      const last = list.length ? list[list.length - 1].ts : 0;
      const entry = {
        ts: Math.max(now, last + 1),
        cat: String(a.cat || 'other').slice(0, 20),
        title: String(a.title || 'Saints Service').slice(0, 120),
        body: String(a.body || '').slice(0, 300),
        url: String(a.url || '').slice(0, 300),
        urgent: !!a.urgent,
        staff: !!a.staff,
        actor: String(a.actor || '').toLowerCase().slice(0, 40)
      };
      list = [...list, entry].slice(-ALERTS_MAX);
      await this.storage.put('alerts', list);
      return reply({ ok: true, ts: entry.ts });
    }
    if (action === 'alerts_list') {
      const since = Number(body.since) || 0;
      return reply({ ok: true, alerts: list.filter((x) => x.ts > since).slice(-60), latest: list.length ? list[list.length - 1].ts : 0, now: Date.now() });
    }
    return reply({ ok: false, error: 'unknown action' }, 404);
  }

  async fetch(req) {
    const action = new URL(req.url).pathname.slice(1);
    let body = {};
    try { body = await req.json(); } catch (e) { body = {}; }
    const id = String(body.id || '').toLowerCase().slice(0, 40);
    if (action.startsWith('inbox_')) return this.ctx.blockConcurrencyWhile(() => this.inbox(action, body));
    if (action.startsWith('alerts_')) return this.ctx.blockConcurrencyWhile(() => this.alerts(action, body));
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
        let advanced = 0;
        if (reader && seen > 0) {
          const key = reader.toLowerCase();
          const upTo = Math.min(seen, lastTs);
          if (upTo > ((reads[key] && reads[key].ts) || 0)) {
            reads[key] = { u: reader, ts: upTo, at: Date.now() };
            advanced = upTo;
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
        const edits = {};
        const votes = {};
        for (const m of log) {
          if (!m) continue;
          if (m.unsent) { unsent.push(m.ts); continue; }
          if (m.r && Object.keys(m.r).length) reactions[m.ts] = m.r;
          if (m.edited) edits[m.ts] = { t: m.t, at: m.edited };
          if (m.poll) votes[m.ts] = m.pv || {};
        }
        const pins = ((await this.storage.get('pins')) || []).filter((p) => log.some((m) => m && m.ts === p.ts && !m.unsent));
        const { typing, people } = await this.presence(reader, now);
        return reply({ ok: true, messages: log.filter((m) => m && m.ts > since), reads: fresh, reactions, unsent, edits, votes, pins, typing, people, ...(advanced ? { advanced } : {}) });
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
        // A correct answer to the open trivia question (first one wins).
        let trivia = null;
        if (!msg.sys && msg.t) {
          const open = await this.storage.get('trivia');
          if (open && !open.solved && triviaMatches(msg.t, open.a)) {
            open.solved = { u: msg.u, at: ts };
            await this.storage.put('trivia', open);
            trivia = { won: true, answer: open.a[0] };
          }
        }
        log.push(msg);
        await this.save(log.slice(-MAX));
        // Sending ends "typing…" at once.
        const e = this.live.get(String(m.u || '').toLowerCase());
        if (e) e.typingUntil = 0;
        const day = new Date(ts).toISOString().slice(0, 10);
        const counts = msg.sys ? null : ((await this.storage.get('counts')) || {});
        if (counts) {
          const who = String(m.u || '').toLowerCase();
          counts[day] = counts[day] || {};
          counts[day][who] = { u: m.u, n: ((counts[day][who] && counts[day][who].n) || 0) + 1 };
          for (const d of Object.keys(counts).sort().slice(0, -COUNT_DAYS)) delete counts[d];
          await this.storage.put('counts', counts);
        }
        return reply({ ok: true, ts, re: msg.re || null, trivia });
      }
      if (action === 'edit') {
        const key = String(body.user || '').trim().toLowerCase();
        const text = String(body.text || '').trim().slice(0, 500);
        const m = log.find((x) => x && x.ts === Number(body.ts));
        if (!m || m.unsent || !key || String(m.u || '').toLowerCase() !== key) return reply({ ok: false, error: 'message not found' }, 404);
        if (Date.now() - m.ts > EDIT_MS) return reply({ ok: false, error: 'You can only edit a message within 2 minutes of sending it.' }, 403);
        if (!text && !m.media) return reply({ ok: false, error: 'A message can’t be empty. Unsend it instead.' }, 400);
        if (m.poll) return reply({ ok: false, error: 'Polls can’t be edited.' }, 400);
        m.t = text;
        m.edited = Date.now();
        for (const x of log) if (x && x.re && x.re.ts === m.ts && !x.re.unsent) x.re = { ...x.re, t: text.slice(0, 140) };
        const pins = (await this.storage.get('pins')) || [];
        if (pins.some((p) => p.ts === m.ts)) await this.storage.put('pins', pins.map((p) => (p.ts === m.ts ? { ...p, t: text.slice(0, 140) } : p)));
        await this.save(log);
        return reply({ ok: true, t: m.t, edited: m.edited });
      }
      if (action === 'pin') {
        const m = log.find((x) => x && x.ts === Number(body.ts) && !x.unsent);
        let pins = (await this.storage.get('pins')) || [];
        if (body.pin === false) pins = pins.filter((p) => p.ts !== Number(body.ts));
        else {
          if (!m) return reply({ ok: false, error: 'message not found' }, 404);
          pins = [{ ts: m.ts, u: m.u, t: String(m.t || (m.media ? (/^audio\//.test(m.media.type) ? '🎤 Voice message' : '📷 Photo') : '')).slice(0, 140), by: String(body.by || '').slice(0, 40), at: Date.now() },
            ...pins.filter((p) => p.ts !== m.ts)].slice(0, PINS_MAX);
        }
        await this.storage.put('pins', pins);
        return reply({ ok: true, pins });
      }
      if (action === 'vote') {
        const user = String(body.user || '').trim().slice(0, 40);
        const key = user.toLowerCase();
        const m = log.find((x) => x && x.ts === Number(body.ts) && !x.unsent && x.poll);
        const opt = Number(body.option);
        if (!m || !user) return reply({ ok: false, error: 'poll not found' }, 404);
        if (!Number.isInteger(opt) || opt < 0 || opt >= m.poll.options.length) return reply({ ok: false, error: 'not an option' }, 400);
        const had = Object.keys(m.pv || {}).find((k) => (m.pv[k] || []).some((n) => n.toLowerCase() === key));
        const pv = {};
        for (const [k, names] of Object.entries(m.pv || {})) { const left = names.filter((n) => n.toLowerCase() !== key); if (left.length) pv[k] = left; }
        if (had !== String(opt)) pv[opt] = [...(pv[opt] || []), user].slice(-500);
        m.pv = pv;
        await this.save(log);
        return reply({ ok: true, votes: pv, mine: had === String(opt) ? null : opt });
      }
      if (action === 'trivia_open') {
        // A new question replaces yesterday's; the old one comes back so its
        // answer can be revealed if nobody got it.
        const prev = (await this.storage.get('trivia')) || null;
        await this.storage.put('trivia', { q: String(body.q || ''), a: Array.isArray(body.a) ? body.a.map(String) : [], day: String(body.day || ''), askedAt: Date.now(), solved: null });
        return reply({ ok: true, prev });
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
        const pins = (await this.storage.get('pins')) || [];
        if (pins.some((p) => p.ts === m.ts)) await this.storage.put('pins', pins.filter((p) => p.ts !== m.ts));
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
        await this.storage.put({ log: [], reads: {}, pins: [], updatedAt: Date.now(), seeded: true });
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
