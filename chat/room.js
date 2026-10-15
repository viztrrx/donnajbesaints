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

const TTL_MS = 7 * 24 * 3600 * 1000;   // same week-long lifetime as before
const MAX = 120;                       // newest messages kept per room

export class ChatRoom {
  constructor(ctx, env) { this.ctx = ctx; this.storage = ctx.storage; this.env = env; }

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
        return reply({ ok: true, messages: log.filter((m) => m && m.ts > since), reads: fresh });
      }
      if (action === 'append') {
        const m = body.msg && typeof body.msg === 'object' ? body.msg : null;
        if (!m) return reply({ ok: false, error: 'no message' }, 400);
        const last = log.length ? log[log.length - 1].ts : 0;
        const ts = Math.max(Date.now(), last + 1);
        log.push({ ...m, ts });
        await this.save(log.slice(-MAX));
        return reply({ ok: true, ts });
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
