// Music without keys or sign-ins, for the console's Music tab.
//
// 1. Audius (audius.co): an open music platform with a public API that needs
//    no key or account, only an app name. The Worker searches it and streams
//    tracks through itself, so the browser only ever talks to the Worker.
// 2. A shared library: audio files the owner and admins upload, kept in the
//    Worker's R2 bucket under music/ and playable by everyone the console
//    lets in. Metadata lives in KV ("music:lib").
//
// worker.js decides who is allowed (allowed-users list, staff for uploads)
// and calls these helpers.

const AUDIUS_APP = 'AgentConsole';
export const MUSIC_MAX_FILE = 25 * 1024 * 1024;          // per upload
export const MUSIC_MAX_TRACKS = 3000;
export const MUSIC_MAX_BYTES = 9.5 * 1024 * 1024 * 1024;  // stays inside R2's 10 GB free tier
const LIB_KEY = 'music:lib';

// ---- Audius --------------------------------------------------------------------
let audiusHost = null;   // a discovery node, remembered for this Worker instance
async function audiusBase(env, refresh = false) {
  const gateway = (env && env.AUDIUS_API) || 'https://api.audius.co';
  if (audiusHost && !refresh) return audiusHost;
  // The gateway answers /v1 itself; it also lists discovery nodes to fall
  // back on if it is down.
  audiusHost = gateway;
  if (refresh) {
    try {
      const r = await fetch(gateway, { headers: { Accept: 'application/json' } });
      const d = await r.json();
      const hosts = Array.isArray(d && d.data) ? d.data.filter((h) => /^https:\/\/[a-z0-9.-]+$/i.test(h)) : [];
      if (hosts.length) audiusHost = hosts[Math.floor(Math.random() * hosts.length)];
    } catch (e) { /* keep the gateway */ }
  }
  return audiusHost;
}
async function audiusGet(env, path) {
  for (const refresh of [false, true]) {
    const base = await audiusBase(env, refresh);
    try {
      const r = await fetch(base + path + (path.includes('?') ? '&' : '?') + 'app_name=' + AUDIUS_APP, { headers: { Accept: 'application/json' } });
      if (r.ok) return await r.json();
    } catch (e) { /* try another node */ }
  }
  throw Object.assign(new Error('Audius is not reachable right now.'), { status: 502 });
}
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k]) return o[k]; return null; };

export async function audiusSearch(env, query) {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) return [];
  const d = await audiusGet(env, '/v1/tracks/search?query=' + encodeURIComponent(q) + '&limit=20');
  return (Array.isArray(d && d.data) ? d.data : [])
    .filter((t) => t && t.id && t.title && t.is_streamable !== false && !t.is_delete)
    .slice(0, 20)
    .map((t) => ({
      source: 'audius',
      id: String(t.id),
      title: String(t.title).slice(0, 140),
      artist: String((t.user && (t.user.name || t.user.handle)) || 'Unknown artist').slice(0, 80),
      duration: Number(t.duration) || 0,
      genre: t.genre ? String(t.genre).slice(0, 40) : '',
      art: pick(t.artwork || {}, '150x150', '480x480') || null,
      plays: Number(t.play_count) || 0,
      stream: '/music/audius/stream/' + encodeURIComponent(String(t.id))
    }));
}

// Streams one Audius track through the Worker, passing Range through so the
// player can seek.
export async function audiusStream(env, id, req) {
  if (!/^[A-Za-z0-9]{1,24}$/.test(id)) return new Response('Not found', { status: 404 });
  const headers = {};
  const range = req.headers.get('Range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  for (const refresh of [false, true]) {
    const base = await audiusBase(env, refresh);
    let r;
    try { r = await fetch(`${base}/v1/tracks/${id}/stream?app_name=${AUDIUS_APP}`, { headers, redirect: 'follow' }); } catch (e) { continue; }
    if (!r.ok && r.status !== 206) continue;
    const type = r.headers.get('Content-Type') || 'audio/mpeg';
    if (!/^audio\//i.test(type) && !/octet-stream/i.test(type)) continue;
    const out = new Headers({ 'Content-Type': /^audio\//i.test(type) ? type : 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' });
    for (const h of ['Content-Length', 'Content-Range']) if (r.headers.get(h)) out.set(h, r.headers.get(h));
    return new Response(req.method === 'HEAD' ? null : r.body, { status: r.status, headers: out });
  }
  return new Response('Audius is not reachable right now.', { status: 502 });
}

// ---- Shared library ---------------------------------------------------------------
export async function readLibrary(kv) {
  try { return (await kv.get(LIB_KEY, 'json')) || []; } catch (e) { return []; }
}
const publicTrack = (t) => ({ source: 'shared', id: t.id, title: t.title, artist: t.artist, file: t.file || defaultFileName(t), duration: t.duration || 0, size: t.size, type: t.type, uploader: t.uploader, ts: t.ts, stream: '/music/file/' + t.id });

export async function listLibrary(kv, query) {
  const lib = await readLibrary(kv);
  const q = String(query || '').trim().toLowerCase();
  const words = q ? q.split(/\s+/).filter(Boolean) : [];
  return lib
    .filter((t) => !words.length || words.every((w) => (t.title + ' ' + t.artist).toLowerCase().includes(w)))
    .sort((a, b) => b.ts - a.ts)
    .map(publicTrack);
}

// Magic bytes for the formats browsers play, so nothing else is stored.
export function audioKind(bytes) {
  const at = (o, s) => [...s].every((ch, i) => bytes[o + i] === ch.charCodeAt(0));
  if (at(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    // MPEG frame sync also starts ADTS AAC (layer bits 00).
    if (bytes[0] === 0xff && (bytes[1] & 0x06) === 0) return 'audio/aac';
    return 'audio/mpeg';
  }
  if (at(4, 'ftyp')) return 'audio/mp4';
  if (at(0, 'OggS')) return 'audio/ogg';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
  if (at(0, 'fLaC')) return 'audio/flac';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  return null;
}
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// File names (what a download is saved as): no slashes, quotes or control
// characters, and the right extension for the audio inside.
const EXT = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/webm': 'webm' };
export function cleanFileName(name, type) {
  const ext = EXT[type] || 'mp3';
  let base = clean(String(name || '').replace(/[\\/:*?"<>|]+/g, ' '), 120).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^\.+/, '').trim();
  if (!base) return '';
  return base.slice(0, 110) + '.' + ext;
}
const defaultFileName = (t) => cleanFileName((t.artist && t.artist !== 'Unknown artist' ? t.artist + ' - ' : '') + (t.title || 'Untitled'), t.type) || 'song.mp3';
// New title / artist / file name for a song (the audio itself never changes).
function applyEdit(t, fields) {
  const f = fields || {};
  if ('title' in f) { const v = clean(f.title, 140); if (!v) throw Object.assign(new Error('The song needs a name.'), { status: 400 }); t.title = v; }
  if ('artist' in f) t.artist = clean(f.artist, 80) || 'Unknown artist';
  if ('file' in f) { const v = cleanFileName(f.file, t.type); if (!v) throw Object.assign(new Error('The file needs a name.'), { status: 400 }); t.file = v; }
  t.edited = Date.now();
  return t;
}
// "Artist - Title.mp3" → { artist, title }
export function nameFromFile(name) {
  const base = clean(String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' '), 200);
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  return m ? { artist: m[1], title: m[2] } : { artist: '', title: base || 'Untitled' };
}

export async function addToLibrary(env, form, uploader) {
  const bucket = env.donnajbe_eaglercraft_client, kv = env.TELEMETRY;
  if (!bucket || !kv) throw Object.assign(new Error('Music storage is not configured'), { status: 503 });
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) throw Object.assign(new Error('Choose an audio file'), { status: 400 });
  if (file.size > MUSIC_MAX_FILE) throw Object.assign(new Error('Each song must be 25 MB or less'), { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = audioKind(bytes);
  if (!type) throw Object.assign(new Error('That file isn’t a supported audio file (MP3, M4A, AAC, OGG, WAV, FLAC, WebM)'), { status: 400 });
  const lib = await readLibrary(kv);
  if (lib.length >= MUSIC_MAX_TRACKS) throw Object.assign(new Error('The shared library is full'), { status: 409 });
  const used = lib.reduce((n, t) => n + (t.size || 0), 0);
  if (used + bytes.length > MUSIC_MAX_BYTES) throw Object.assign(new Error('The shared library is out of space'), { status: 409 });
  const guess = nameFromFile(file.name);
  const track = {
    id: crypto.randomUUID(),
    title: clean(form.get('title'), 140) || guess.title,
    artist: clean(form.get('artist'), 80) || guess.artist || 'Unknown artist',
    duration: Math.max(0, Math.min(24 * 3600, Math.round(Number(form.get('duration')) || 0))),
    size: bytes.length, type, uploader: clean(uploader, 40) || 'owner', ts: Date.now()
  };
  track.file = cleanFileName(form.get('fileName') || file.name, type) || defaultFileName(track);
  await bucket.put('music/' + track.id, bytes, { httpMetadata: { contentType: type }, customMetadata: { title: track.title, artist: track.artist, uploader: track.uploader } });
  // Re-read before writing so two uploads at once both land.
  const fresh = await readLibrary(kv);
  fresh.push(track);
  await kv.put(LIB_KEY, JSON.stringify(fresh));
  return publicTrack(track);
}

export async function removeFromLibrary(env, id) {
  const kv = env.TELEMETRY, bucket = env.donnajbe_eaglercraft_client;
  const lib = await readLibrary(kv);
  const t = lib.find((x) => x.id === id);
  if (!t) return false;
  if (bucket) { try { await bucket.delete('music/' + id); } catch (e) { /* already gone */ } }
  await kv.put(LIB_KEY, JSON.stringify(lib.filter((x) => x.id !== id)));
  return true;
}

// ---- My music: each person's own uploads ------------------------------------
// Anyone signed in can upload their own songs from their computer. They're
// saved to their account ("mylib:<name>"), so they're there on any device
// after signing in, and stream through the same /music/file/<id> route as
// the shared library, which is what lets them be shared to chat. Files sit
// in the same R2 prefix; the shared library and everyone's uploads together
// stay under MUSIC_MAX_BYTES (R2's free tier).
export const MINE_MAX_SONGS = 50;
export const MINE_MAX_BYTES = 300 * 1024 * 1024;
export const MINE_DAILY_UPLOADS = 30;
const mineKey = (user) => 'mylib:' + String(user || '').trim().toLowerCase().slice(0, 40);
const MINE_TOTAL = 'mylib:total';
export async function readMine(kv, user) {
  try { return (await kv.get(mineKey(user), 'json')) || []; } catch (e) { return []; }
}
const publicMine = (t) => ({ source: 'mine', id: t.id, title: t.title, artist: t.artist, file: t.file || defaultFileName(t), duration: t.duration || 0, size: t.size, type: t.type, owner: t.owner, ts: t.ts, stream: '/music/file/' + t.id });
export async function listMine(kv, user) {
  return (await readMine(kv, user)).sort((a, b) => b.ts - a.ts).map(publicMine);
}
export async function mineUsage(kv, user) {
  const list = await readMine(kv, user);
  return { songs: list.length, bytes: list.reduce((n, t) => n + (t.size || 0), 0), maxSongs: MINE_MAX_SONGS, maxBytes: MINE_MAX_BYTES };
}
export async function addToMine(env, form, owner) {
  const bucket = env.donnajbe_eaglercraft_client, kv = env.TELEMETRY;
  if (!bucket || !kv) throw Object.assign(new Error('Music storage is not configured'), { status: 503 });
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) throw Object.assign(new Error('Choose an audio file'), { status: 400 });
  if (file.size > MUSIC_MAX_FILE) throw Object.assign(new Error('Each song must be 25 MB or less'), { status: 413 });
  const mine = await readMine(kv, owner);
  if (mine.length >= MINE_MAX_SONGS) throw Object.assign(new Error(`You can keep up to ${MINE_MAX_SONGS} songs. Delete one to add another.`), { status: 409 });
  const mineBytes = mine.reduce((n, t) => n + (t.size || 0), 0);
  if (mineBytes + file.size > MINE_MAX_BYTES) throw Object.assign(new Error('Your music is full (300 MB). Delete a song to make room.'), { status: 409 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = audioKind(bytes);
  if (!type) throw Object.assign(new Error('That file isn’t a supported audio file (MP3, M4A, AAC, OGG, WAV, FLAC, WebM)'), { status: 400 });
  const shared = (await readLibrary(kv)).reduce((n, t) => n + (t.size || 0), 0);
  const total = Number(await kv.get(MINE_TOTAL)) || 0;
  if (shared + total + bytes.length > MUSIC_MAX_BYTES) throw Object.assign(new Error('Music storage is full right now. Ask the owner.'), { status: 409 });
  const guess = nameFromFile(file.name);
  const track = {
    id: crypto.randomUUID(),
    title: clean(form.get('title'), 140) || guess.title,
    artist: clean(form.get('artist'), 80) || guess.artist || 'Unknown artist',
    duration: Math.max(0, Math.min(24 * 3600, Math.round(Number(form.get('duration')) || 0))),
    size: bytes.length, type, owner: clean(owner, 40), ts: Date.now()
  };
  track.file = cleanFileName(form.get('fileName') || file.name, type) || defaultFileName(track);
  await bucket.put('music/' + track.id, bytes, { httpMetadata: { contentType: type }, customMetadata: { title: track.title, artist: track.artist, owner: track.owner.toLowerCase() } });
  const fresh = await readMine(kv, owner);
  fresh.push(track);
  await kv.put(mineKey(owner), JSON.stringify(fresh));
  await kv.put(MINE_TOTAL, String(total + bytes.length));
  return publicMine(track);
}
// Renames one of a person's own songs: title, artist, file name.
export async function editMine(env, owner, id, fields) {
  const kv = env.TELEMETRY;
  const list = await readMine(kv, owner);
  const t = list.find((x) => x.id === id);
  if (!t) return null;
  applyEdit(t, fields);
  await kv.put(mineKey(owner), JSON.stringify(list));
  return publicMine(t);
}
// The same for a song in the shared library (owner and admins).
export async function editLibrary(env, id, fields) {
  const kv = env.TELEMETRY;
  const lib = await readLibrary(kv);
  const t = lib.find((x) => x.id === id);
  if (!t) return null;
  applyEdit(t, fields);
  await kv.put(LIB_KEY, JSON.stringify(lib));
  return publicTrack(t);
}
// Removes one of a person's songs (theirs; staff may pass anyone's id).
export async function removeFromMine(env, owner, id) {
  const kv = env.TELEMETRY, bucket = env.donnajbe_eaglercraft_client;
  let who = owner;
  if (!who && bucket) { try { const h = await bucket.head('music/' + id); who = h && h.customMetadata && h.customMetadata.owner; } catch (e) { who = ''; } }
  if (!who) return false;
  const list = await readMine(kv, who);
  const t = list.find((x) => x.id === id);
  if (!t) return false;
  if (bucket) { try { await bucket.delete('music/' + id); } catch (e) { /* already gone */ } }
  await kv.put(mineKey(who), JSON.stringify(list.filter((x) => x.id !== id)));
  const total = Number(await kv.get(MINE_TOTAL)) || 0;
  await kv.put(MINE_TOTAL, String(Math.max(0, total - (t.size || 0))));
  return true;
}

// Serves a shared song from R2 with Range support (seeking, iOS playback).
export async function serveLibraryFile(env, id, req) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const bucket = env.donnajbe_eaglercraft_client;
  if (!bucket) return new Response('Music storage is not configured', { status: 503 });
  const head = await bucket.head('music/' + id);
  if (!head) return new Response('Not found', { status: 404 });
  const size = head.size;
  const base = { 'Content-Type': (head.httpMetadata && head.httpMetadata.contentType) || 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    if (!m[1]) end = size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    const obj = await bucket.get('music/' + id, { range: { offset: start, length: end - start + 1 } });
    return new Response(req.method === 'HEAD' ? null : obj.body, { status: 206, headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } });
  }
  // ?dl=<name>: save as a file with that name (Download in My music).
  const dl = cleanFileName(new URL(req.url).searchParams.get('dl') || '', base['Content-Type']);
  if (dl) base['Content-Disposition'] = 'attachment; filename="' + dl.replace(/[^\x20-\x7e]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(dl);
  const obj = req.method === 'HEAD' ? null : await bucket.get('music/' + id);
  return new Response(obj ? obj.body : null, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
}
