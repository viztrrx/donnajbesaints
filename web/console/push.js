// Web Push to the owner's devices (the Saints Service home-screen app).
//
// Standard Web Push, which iOS supports for Home Screen web apps (16.4+):
// the Worker encrypts each notification for the device (RFC 8291,
// aes128gcm) and signs a VAPID token (RFC 8292) itself, so no Apple
// developer account, relay server or npm package is involved.
//
// Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url raw P-256 keys) when
// set as Worker secrets; otherwise one key pair is generated on first use
// and kept in KV ("push:vapid"), next to the rest of the console's data.
//
// Subscriptions ("push:subs") are owner-only: worker.js checks owner proof
// before calling addSubscription. Each one gets a random manage key, which
// the device uses to change its own categories, test or unsubscribe.

// Every kind of alert, its group in the app's settings and whether a new
// device gets it by default. Keys are stored per device, so new kinds added
// later start at their default on devices that subscribed before.
export const PUSH_CATEGORIES = {
  chat: { label: 'Public chat messages', group: 'Chat', on: true },
  chatrooms: { label: 'Private room messages', group: 'Chat', on: true },
  mentions: { label: 'Mentions of you (@name)', group: 'Chat', on: true },
  reports: { label: 'Chat reports', group: 'Chat', on: true },
  signin: { label: 'Sign-ins', group: 'People', on: true },
  newuser: { label: 'New users and accounts', group: 'People', on: true },
  approval: { label: 'Waiting for your approval', group: 'People', on: true },
  access: { label: 'Access requests', group: 'People', on: true },
  subs: { label: 'Subscriptions ending', group: 'People', on: true },
  presence: { label: 'Who’s online (live)', group: 'People', on: false },
  proxy: { label: 'Proxy tab: launches and sites opened', group: 'People', on: true },
  aierror: { label: 'AI request failures', group: 'AI', on: true },
  limits: { label: 'Rate limits and quotas reached', group: 'AI', on: true },
  error: { label: 'Worker errors', group: 'System', on: true },
  security: { label: 'Security alerts', group: 'System', on: true },
  admin: { label: 'Actions by your admins', group: 'System', on: true },
  jobs: { label: 'Failed scheduled jobs', group: 'System', on: true },
  digest: { label: 'Daily summary at 12 PM', group: 'System', on: true },
  weekly: { label: 'Weekly report (Sundays at 6 PM)', group: 'System', on: true }
};
const MAX_SUBS = 10;
// Only real push services: the endpoint comes from the browser, and the
// Worker must never be pointed at arbitrary hosts.
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

const enc = new TextEncoder();
export const b64u = {
  enc(bytes) {
    let s = '';
    new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
export async function sha256hex(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- VAPID keys ------------------------------------------------------------
export async function vapidKeys(env, { create = false } = {}) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    const pub = b64u.dec(env.VAPID_PUBLIC_KEY);
    const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)) };
    return { publicKey: env.VAPID_PUBLIC_KEY, jwk };
  }
  const kv = env.TELEMETRY;
  if (!kv) return null;
  const stored = await kv.get('push:vapid', 'json');
  if (stored && stored.publicKey && stored.jwk) return stored;
  if (!create) return null;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = b64u.enc(await crypto.subtle.exportKey('raw', pair.publicKey));
  const rec = { publicKey, jwk: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y }, created: Date.now() };
  await kv.put('push:vapid', JSON.stringify(rec));
  // Read back: if two first-time requests raced, both use the stored pair.
  return (await kv.get('push:vapid', 'json')) || rec;
}

async function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...keys.jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return `vapid t=${header}.${claims}.${b64u.enc(sig)}, k=${keys.publicKey}`;
}

// ---- RFC 8291 payload encryption (aes128gcm) ------------------------------
export async function encryptPayload(sub, plaintext) {
  const uaPublic = b64u.dec(sub.p256dh);
  const authSecret = b64u.dec(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = (await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const data = concat(enc.encode(plaintext), new Uint8Array([2]));   // 0x02: final record, no padding
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export async function sendPush(sub, message, keys, subject) {
  const body = await encryptPayload(sub, JSON.stringify(message));
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, keys, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: message.urgency || 'normal'
      },
      body
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false };
  }
}

// ---- Subscriptions ------------------------------------------------------------
export function validSubscription(s) {
  if (!s || typeof s !== 'object' || typeof s.endpoint !== 'string' || s.endpoint.length > 1000) return false;
  let u;
  try { u = new URL(s.endpoint); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return false;
  const keys = s.keys || {};
  try {
    return b64u.dec(keys.p256dh || '').length === 65 && b64u.dec(keys.auth || '').length === 16;
  } catch (e) { return false; }
}
export function cleanCategories(cats) {
  const out = {};
  const given = cats && typeof cats === 'object' ? cats : {};
  for (const [k, c] of Object.entries(PUSH_CATEGORIES)) out[k] = typeof given[k] === 'boolean' ? given[k] : c.on;
  return out;
}
const wants = (s, cat) => (s.categories && typeof s.categories[cat] === 'boolean' ? s.categories[cat] : PUSH_CATEGORIES[cat].on);
// Quiet hours: { start, end } whole hours in the owner's time zone, or null.
export function cleanQuiet(q) {
  if (!q || typeof q !== 'object') return null;
  const ok = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
  return ok(q.start) && ok(q.end) && q.start !== q.end ? { start: q.start, end: q.end } : null;
}
export function ownerHour(env, ts = Date.now()) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: env.OWNER_TZ || 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ts))) % 24;
  } catch (e) { return new Date(ts).getUTCHours(); }
}
const inQuiet = (q, h) => !!q && (q.start < q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end);
const readSubs = async (kv) => { try { return (await kv.get('push:subs', 'json')) || []; } catch (e) { return []; } };
const writeSubs = (kv, subs) => kv.put('push:subs', JSON.stringify(subs));
const publicSub = (s) => ({ id: s.id, categories: cleanCategories(s.categories), quiet: s.quiet || null, created: s.created, name: s.name });

export async function addSubscription(env, sub, { categories, name, quiet, ua } = {}) {
  const kv = env.TELEMETRY;
  const subs = (await readSubs(kv)).filter((s) => s.endpoint !== sub.endpoint);
  if (subs.length >= MAX_SUBS) subs.splice(0, subs.length - MAX_SUBS + 1);   // drop the oldest
  const manageKey = b64u.enc(crypto.getRandomValues(new Uint8Array(24)));
  const rec = {
    id: crypto.randomUUID(), keyHash: await sha256hex(manageKey), endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh, auth: sub.keys.auth, categories: cleanCategories(categories),
    quiet: cleanQuiet(quiet), name: String(name || 'iPhone').slice(0, 40), created: Date.now(), ...(ua ? { ua: String(ua).slice(0, 32) } : {})
  };
  subs.push(rec);
  await writeSubs(kv, subs);
  return { ...publicSub(rec), manageKey };
}
async function findOwn(kv, id, manageKey) {
  const subs = await readSubs(kv);
  const hash = await sha256hex(String(manageKey || ''));
  const i = subs.findIndex((s) => s.id === id && s.keyHash === hash);
  return { subs, i };
}
export async function updateSubscription(env, id, manageKey, categories, quiet) {
  const { subs, i } = await findOwn(env.TELEMETRY, id, manageKey);
  if (i < 0) return null;
  if (categories !== undefined) subs[i].categories = cleanCategories({ ...cleanCategories(subs[i].categories), ...categories });
  if (quiet !== undefined) subs[i].quiet = cleanQuiet(quiet);
  await writeSubs(env.TELEMETRY, subs);
  return publicSub(subs[i]);
}
export async function removeSubscription(env, id, manageKey) {
  const { subs, i } = await findOwn(env.TELEMETRY, id, manageKey);
  if (i < 0) return false;
  subs.splice(i, 1);
  await writeSubs(env.TELEMETRY, subs);
  return true;
}
export async function getSubscription(env, id, manageKey) {
  const { subs, i } = await findOwn(env.TELEMETRY, id, manageKey);
  return i < 0 ? null : subs[i];
}

// ---- Sending ----------------------------------------------------------------------
// Owner's local time for notification text ("signed in at 9:41 PM").
export function ownerTime(env, ts = Date.now()) {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { timeZone: env.OWNER_TZ || 'America/New_York', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return new Date(ts).toISOString().slice(11, 16) + ' UTC'; }
}

// event: { cat, title, body, tag?, url?, urgent?, badge?, silent?, throttle?: { key, seconds } }
// Urgent alerts (errors, security) still arrive during quiet hours.
// Never throws: a notification must never break the request that caused it.
export async function notifyOwner(env, event, origin) {
  try {
    const kv = env && env.TELEMETRY;
    if (!kv || !PUSH_CATEGORIES[event.cat]) return { sent: 0 };
    const hour = ownerHour(env);
    const subs = (await readSubs(kv)).filter((s) => wants(s, event.cat) && (event.urgent || !inQuiet(s.quiet, hour)));
    if (!subs.length) return { sent: 0 };
    if (event.throttle) {
      const tk = 'push:rl:' + (await sha256hex(event.throttle.key)).slice(0, 32);
      if (await kv.get(tk)) return { sent: 0, throttled: true };
      await kv.put(tk, '1', { expirationTtl: Math.max(60, event.throttle.seconds || 300) });
    }
    const keys = await vapidKeys(env);
    if (!keys) return { sent: 0 };
    const subject = env.VAPID_SUBJECT || origin || 'https://donnajbe.viztrrx.workers.dev';
    const message = {
      title: String(event.title || 'Saints Service').slice(0, 120),
      body: String(event.body || '').slice(0, 400),
      tag: event.tag ? String(event.tag).slice(0, 64) : undefined,
      url: event.url || '/console/',
      cat: event.cat,
      ts: Date.now(),
      badge: Number.isInteger(event.badge) ? event.badge : undefined,
      silent: event.silent ? true : undefined,
      urgency: event.urgent ? 'high' : 'normal'
    };
    const results = await Promise.all(subs.map((s) => sendPush(s, message, keys, subject)));
    const gone = subs.filter((s, i) => results[i].gone).map((s) => s.id);
    if (gone.length) {
      const all = await readSubs(kv);
      await writeSubs(kv, all.filter((s) => !gone.includes(s.id)));
    }
    return { sent: results.filter((r) => r.ok).length, results };
  } catch (e) {
    return { sent: 0, error: String(e && e.message || e) };
  }
}

// ---- Mention alerts for everyone (not just the owner) ---------------------------
// Each signed-in person can turn on alerts for when someone @mentions them,
// on up to USER_MAX_DEVICES devices. Stored per person ("push:user:<name>"),
// separate from the owner's subscriptions; same manage-key scheme.
const USER_MAX_DEVICES = 3;
const userKey = (user) => 'push:user:' + String(user || '').trim().toLowerCase().slice(0, 40);
async function readUserSubs(kv, user) { try { return (await kv.get(userKey(user), 'json')) || []; } catch (e) { return []; } }
export async function addUserSubscription(env, user, sub, name, ua) {
  const kv = env.TELEMETRY;
  const subs = (await readUserSubs(kv, user)).filter((s) => s.endpoint !== sub.endpoint);
  if (subs.length >= USER_MAX_DEVICES) subs.splice(0, subs.length - USER_MAX_DEVICES + 1);
  const manageKey = b64u.enc(crypto.getRandomValues(new Uint8Array(24)));
  const rec = { id: crypto.randomUUID(), keyHash: await sha256hex(manageKey), endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    name: String(name || 'iPhone').slice(0, 40), created: Date.now(), ...(ua ? { ua: String(ua).slice(0, 32) } : {}) };
  subs.push(rec);
  await kv.put(userKey(user), JSON.stringify(subs));
  return { id: rec.id, manageKey, name: rec.name, created: rec.created };
}
export async function findUserSubscription(env, user, id, manageKey) {
  const subs = await readUserSubs(env.TELEMETRY, user);
  const hash = await sha256hex(String(manageKey || ''));
  return subs.find((s) => s.id === id && s.keyHash === hash) || null;
}
export async function removeUserSubscription(env, user, id, manageKey) {
  const kv = env.TELEMETRY;
  const subs = await readUserSubs(kv, user);
  const hash = await sha256hex(String(manageKey || ''));
  const left = subs.filter((s) => !(s.id === id && s.keyHash === hash));
  if (left.length === subs.length) return false;
  if (left.length) await kv.put(userKey(user), JSON.stringify(left)); else await kv.delete(userKey(user));
  return true;
}
// A device that already gets push alerts, by its browser (ua: a hash of the
// User-Agent, saved when alerts were turned on): the console page skips its
// own pop-up for the same message there, so nothing shows twice.
export async function rememberUserDevice(env, user, id, ua) {
  const kv = env.TELEMETRY;
  const subs = await readUserSubs(kv, user);
  const s = subs.find((x) => x.id === id);
  if (!s || !ua || s.ua === ua) return;
  s.ua = String(ua).slice(0, 32);
  await kv.put(userKey(user), JSON.stringify(subs));
}
export async function pushOnDevice(env, user, ua, isOwner) {
  const out = { mention: false, chat: false };
  if (!ua) return out;
  try {
    if ((await readUserSubs(env.TELEMETRY, user)).some((s) => s.ua === ua)) out.mention = true;
    if (isOwner) for (const s of await readSubs(env.TELEMETRY)) {
      if (s.ua !== ua) continue;
      if (wants(s, 'mentions')) out.mention = true;
      if (wants(s, 'chat') && wants(s, 'chatrooms')) out.chat = true;
    }
  } catch (e) { /* no alerts known */ }
  return out;
}
export async function userHasAlerts(env, user) { return (await readUserSubs(env.TELEMETRY, user)).length > 0; }
// event: { title, body, url, tag? }. Never throws.
export async function notifyUser(env, user, event, origin) {
  try {
    const kv = env && env.TELEMETRY;
    const subs = await readUserSubs(kv, user);
    if (!subs.length) return { sent: 0 };
    const keys = await vapidKeys(env);
    if (!keys) return { sent: 0 };
    const subject = env.VAPID_SUBJECT || origin || 'https://donnajbe.viztrrx.workers.dev';
    const message = { title: String(event.title || 'Saints Service').slice(0, 120), body: String(event.body || '').slice(0, 400),
      tag: event.tag ? String(event.tag).slice(0, 64) : undefined, url: event.url || '/console/', cat: 'mention', ts: Date.now(), urgency: 'high' };
    const results = await Promise.all(subs.map((s) => sendPush(s, message, keys, subject)));
    const gone = subs.filter((s, i) => results[i].gone).map((s) => s.id);
    if (gone.length) {
      const left = subs.filter((s) => !gone.includes(s.id));
      if (left.length) await kv.put(userKey(user), JSON.stringify(left)); else await kv.delete(userKey(user));
    }
    return { sent: results.filter((r) => r.ok).length };
  } catch (e) { return { sent: 0, error: String(e && e.message || e) }; }
}

export async function anySubscriberWants(env, cat) {
  try { return (await readSubs(env.TELEMETRY)).some((s) => wants(s, cat)); } catch (e) { return false; }
}
