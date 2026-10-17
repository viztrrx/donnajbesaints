// Playlist → YouTube links (Music → Playlists, owner and admins).
//
// Paste a Spotify or Apple Music playlist or album link: the Worker reads its
// song list (title, artist, length) and finds each song's official video on
// YouTube with the YouTube Data API. The result is a list of links, kept on
// the person's account and organized by playlist. Nothing is downloaded or
// stored but the links.
//
// Reading the song list needs no account:
//   * Spotify: the Web API when SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET are
//     set (every song), otherwise Spotify's public embed page (up to the
//     first 100 songs it shows).
//   * Apple Music: the public web page's embedded data.
// Finding videos needs a YouTube Data API key: the Worker's YOUTUBE_API_KEY,
// or the key the person saved in the console (sent per request, never
// stored). A search costs 100 of the key's 10,000 daily units, so about 100
// songs a day per key; without a key every song gets a YouTube search link.
//
// Base URLs can be pointed elsewhere for tests: SPOTIFY_WEB, SPOTIFY_API,
// SPOTIFY_ACCOUNTS, APPLE_MUSIC_WEB, YOUTUBE_API.

export const LISTS_MAX = 20;          // playlists kept per person
export const LIST_MAX_TRACKS = 200;   // songs kept per playlist
export const MATCH_BATCH = 8;         // YouTube searches per request
const listsKey = (who) => 'ytlists:' + String(who || '').trim().toLowerCase().slice(0, 40);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const err = (message, status) => Object.assign(new Error(message), { status });

// ---- Links --------------------------------------------------------------------
// Only these shapes are accepted, and the Worker builds every address it
// fetches itself from the IDs, so a pasted link can't point it anywhere else.
export function parsePlaylistLink(input) {
  const s = String(input || '').trim();
  let m = /^spotify:(playlist|album|track):([A-Za-z0-9]{10,40})$/.exec(s);
  if (m) return { service: 'spotify', kind: m[1], id: m[2] };
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const p = parts[0] && /^intl-/.test(parts[0]) ? parts.slice(1) : parts;
    const at = p[0] === 'embed' ? 1 : 0;
    if (['playlist', 'album', 'track'].includes(p[at]) && /^[A-Za-z0-9]{10,40}$/.test(p[at + 1] || '')) return { service: 'spotify', kind: p[at], id: p[at + 1] };
    return null;
  }
  if (host === 'spotify.link' && /^[A-Za-z0-9]{4,20}$/.test(parts[0] || '')) return { service: 'spotify', kind: 'short', id: parts[0] };
  if (host === 'music.apple.com' || host === 'embed.music.apple.com' || host === 'geo.music.apple.com') {
    const cc = /^[a-z]{2}$/.test(parts[0] || '') ? parts[0] : 'us';
    const p = /^[a-z]{2}$/.test(parts[0] || '') ? parts.slice(1) : parts;
    if (!['playlist', 'album'].includes(p[0])) return null;
    const id = p[p.length - 1] || '';
    const slug = p.length >= 3 ? p[1] : '';
    if (p[0] === 'playlist' && /^pl\.[A-Za-z0-9-]{8,80}$/.test(id)) return { service: 'apple', kind: 'playlist', id, cc, slug: /^[a-z0-9-]{1,120}$/i.test(slug) ? slug : 'playlist' };
    if (p[0] === 'album' && /^\d{4,15}$/.test(id)) return { service: 'apple', kind: 'album', id, cc, slug: /^[a-z0-9-]{1,120}$/i.test(slug) ? slug : 'album' };
    return null;
  }
  return null;
}

// ---- Reading song lists -----------------------------------------------------------
const UA = 'Mozilla/5.0 (compatible; AgentConsole/1.0)';
const fetchText = async (url, init = {}) => {
  let r;
  try { r = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Language': 'en', ...(init.headers || {}) } }); }
  catch (e) { throw err('Couldn’t reach that music service. Try again in a minute.', 502); }
  if (r.status === 404) throw err('That playlist wasn’t found. Make sure it’s public and the link is complete.', 404);
  if (!r.ok) throw err('That music service answered ' + r.status + '. Try again in a minute.', 502);
  const text = await r.text();
  if (text.length > 6 * 1024 * 1024) throw err('That page is too big to read.', 502);
  return text;
};
const scriptJson = (html, attrRe) => {
  const re = new RegExp('<script[^>]*' + attrRe + '[^>]*>([\\s\\S]*?)</script>', 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(m[1])); } catch (e) { /* not JSON */ } }
  return out;
};
const metaContent = (html, prop) => {
  const m = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)', 'i').exec(html);
  return m ? decodeEntities(m[1]) : '';
};
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos' || k === '#39') return "'";
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
  });
}
const isoSeconds = (iso) => {
  const m = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(iso || ''));
  return m ? Math.round((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) : 0;
};
const track = (t, a, d) => ({ t: clean(t, 140), a: clean(a, 120), d: Math.max(0, Math.min(36000, Math.round(Number(d) || 0))) });

// Walks parsed page data for the first array that looks like a song list:
// objects with a title and an artist under one of the given field names.
function findTracks(root, titleKeys, artistKeys) {
  let best = null;
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const rows = node.filter((x) => x && typeof x === 'object' && titleKeys.some((k) => typeof x[k] === 'string') && artistKeys.some((k) => typeof x[k] === 'string' || (x[k] && typeof x[k] === 'object')));
      if (rows.length >= Math.max(1, node.length * 0.6) && (!best || rows.length > best.length)) best = rows;
      node.forEach((x) => visit(x, depth + 1));
      return;
    }
    Object.values(node).forEach((x) => visit(x, depth + 1));
  };
  visit(root, 0);
  return best || [];
}
const artistOf = (x, keys) => {
  for (const k of keys) {
    const v = x[k];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v)) return v.map((a) => (a && (a.name || a.title)) || '').filter(Boolean).join(', ');
    if (v && typeof v === 'object' && (v.name || v.title)) return v.name || v.title;
  }
  return '';
};

async function spotifyApiToken(env) {
  const accounts = (env && env.SPOTIFY_ACCOUNTS) || 'https://accounts.spotify.com';
  const r = await fetch(accounts + '/api/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw err('The Spotify keys on the Worker were refused.', 502);
  return d.access_token;
}
async function readSpotifyApi(env, kind, id) {
  const api = (env && env.SPOTIFY_API) || 'https://api.spotify.com/v1';
  const token = await spotifyApiToken(env);
  const get = async (url) => {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 404) throw err('That playlist wasn’t found (or Spotify doesn’t share it with apps). Make sure it’s public.', 404);
    if (!r.ok) throw err('Spotify answered ' + r.status + '.', 502);
    return r.json();
  };
  const head = await get(`${api}/${kind}s/${id}?fields=name,images,owner(display_name),artists(name)`);
  const tracks = [];
  let next = kind === 'playlist' ? `${api}/playlists/${id}/tracks?limit=100&fields=next,items(track(name,duration_ms,artists(name)))` : `${api}/albums/${id}/tracks?limit=50`;
  while (next && tracks.length < LIST_MAX_TRACKS) {
    const page = await get(next);
    for (const it of page.items || []) {
      const t = kind === 'playlist' ? it && it.track : it;
      if (t && t.name) tracks.push(track(t.name, (t.artists || []).map((a) => a.name).join(', '), (t.duration_ms || 0) / 1000));
    }
    next = page.next && page.next.startsWith(api) ? page.next : null;
  }
  return { name: clean(head.name, 120), by: clean((head.owner && head.owner.display_name) || (head.artists || []).map((a) => a.name).join(', '), 80), image: ((head.images || [])[0] || {}).url || '', tracks };
}
async function readSpotifyEmbed(env, kind, id) {
  const web = (env && env.SPOTIFY_WEB) || 'https://open.spotify.com';
  const html = await fetchText(`${web}/embed/${kind}/${id}`);
  const data = scriptJson(html, 'id=["\']__NEXT_DATA__["\']')[0];
  const entity = data && data.props && data.props.pageProps && data.props.pageProps.state && data.props.pageProps.state.data && data.props.pageProps.state.data.entity;
  let rows = entity && Array.isArray(entity.trackList) ? entity.trackList : null;
  if (!rows && entity && kind === 'track') rows = [{ title: entity.name || entity.title, subtitle: artistOf(entity, ['artists', 'subtitle']), duration: entity.duration }];
  if (!rows) rows = findTracks(data, ['title', 'name'], ['subtitle', 'artists']);
  const tracks = rows.map((x) => track(x.title || x.name, artistOf(x, ['subtitle', 'artists']).replace(/ /g, ' '), (Number(x.duration) || 0) / 1000)).filter((x) => x.t);
  const img = entity && entity.coverArt && Array.isArray(entity.coverArt.sources) && entity.coverArt.sources[0] ? entity.coverArt.sources[0].url : '';
  return { name: clean((entity && (entity.name || entity.title)) || metaContent(html, 'og:title'), 120), by: clean(entity && entity.subtitle, 80), image: img || metaContent(html, 'og:image'), tracks, partial: tracks.length >= 100 };
}
async function readApple(env, link) {
  const web = (env && env.APPLE_MUSIC_WEB) || 'https://music.apple.com';
  const html = await fetchText(`${web}/${link.cc}/${link.kind}/${link.slug}/${link.id}`);
  let name = '', by = '', tracks = [];
  // 1) The page's own app data (title + artistName per song).
  for (const d of scriptJson(html, 'id=["\']serialized-server-data["\']')) {
    const rows = findTracks(d, ['title'], ['artistName']);
    if (rows.length > tracks.length) tracks = rows.map((x) => track(x.title, x.artistName, (Number(x.duration) || 0) / 1000));
  }
  // 2) schema.org data (MusicPlaylist / MusicAlbum).
  for (const d of scriptJson(html, 'type=["\']application/ld\\+json["\']')) {
    const items = Array.isArray(d) ? d : [d];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      name = name || it.name || '';
      by = by || artistOf(it, ['byArtist', 'author', 'creator']);
      const list = Array.isArray(it.track) ? it.track : (it.track && Array.isArray(it.track.itemListElement) ? it.track.itemListElement.map((e) => e.item || e) : []);
      if (list.length > tracks.length) tracks = list.map((x) => track(x.name, artistOf(x, ['byArtist', 'artist']) || (it['@type'] === 'MusicAlbum' ? by : ''), isoSeconds(x.duration)));
    }
  }
  name = name || metaContent(html, 'og:title').replace(/\s+(?:on|by)\s+Apple Music.*$/i, '');
  return { name: clean(decodeEntities(name), 120), by: clean(decodeEntities(by), 80), image: metaContent(html, 'og:image'), tracks: tracks.filter((x) => x.t) };
}

// Reads a pasted link into { service, kind, name, by, image, url, tracks }.
export async function readPlaylist(env, input) {
  let link = parsePlaylistLink(input);
  if (!link) throw err('Paste a Spotify or Apple Music playlist or album link (open.spotify.com/… or music.apple.com/…).', 400);
  if (link.service === 'spotify' && link.kind === 'short') {
    // spotify.link short links: follow one redirect, to Spotify only.
    let r;
    try { r = await fetch('https://spotify.link/' + link.id, { redirect: 'manual', headers: { 'User-Agent': UA } }); } catch (e) { throw err('Couldn’t open that short link. Paste the full open.spotify.com link instead.', 502); }
    link = parsePlaylistLink(r.headers.get('Location') || '');
    if (!link || link.service !== 'spotify' || link.kind === 'short') throw err('That short link didn’t lead to a Spotify playlist. Paste the full open.spotify.com link instead.', 400);
  }
  let out;
  if (link.service === 'spotify') {
    out = env && env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET && link.kind !== 'track'
      ? await readSpotifyApi(env, link.kind, link.id)
      : await readSpotifyEmbed(env, link.kind, link.id);
  } else out = await readApple(env, link);
  if (!out.tracks.length) throw err('No songs found at that link. Make sure the playlist is public.', 422);
  out.tracks = out.tracks.slice(0, LIST_MAX_TRACKS);
  const url = link.service === 'spotify' ? `https://open.spotify.com/${link.kind}/${link.id}` : `https://music.apple.com/${link.cc}/${link.kind}/${link.slug}/${link.id}`;
  return { service: link.service, kind: link.kind, name: out.name || (link.kind === 'album' ? 'Album' : 'Playlist'), by: out.by || '', image: /^https:\/\/[^\s"'<>]{1,400}$/.test(out.image || '') ? out.image : '', url, partial: !!out.partial, tracks: out.tracks };
}

// ---- Finding the official video -------------------------------------------------------
// The first artist of "A, B", "A & B", "A feat. B" or "A x B" (Spotify uses
// commas, Apple Music "&"), which is what YouTube titles and channels carry.
export const primaryArtist = (a) => String(a || '').split(/\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring|x|with)\s+/i)[0].trim();
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const UNWANTED = ['cover', 'karaoke', 'instrumental', 'reaction', 'sped up', 'slowed', 'nightcore', '8d audio', 'remix', 'live', 'tutorial', 'lesson', 'bass boosted', 'mashup', '1 hour', '10 hours', 'loop'];
// Scores one search result for a song: the artist's own "Topic" channel or
// official channel, the song title in the video title and "official" win;
// covers, live versions, sped-up edits and the like lose (unless the song's
// own title says so).
export function scoreVideo(song, v) {
  const title = norm(song.t), artists = norm(primaryArtist(song.a));
  const vt = norm(decodeEntities(v.title)), ch = norm(decodeEntities(v.channel));
  let s = 0;
  if (title && vt.includes(title)) s += 4;
  else if (title && title.split(' ').filter((w) => w.length > 2 && vt.includes(w)).length >= Math.ceil(title.split(' ').length / 2)) s += 2;
  if (artists && (ch.includes(artists) || ch.replace(/ /g, '').includes(artists.replace(/ /g, '')))) s += 3;
  if (/ topic$/.test(ch)) s += 2;
  if (/vevo/.test(ch)) s += 2;
  if (artists && vt.includes(artists)) s += 1;
  if (/\bofficial\b/.test(vt)) s += 1;
  for (const w of UNWANTED) if (vt.includes(w) && !title.includes(w)) s -= 4;
  return s;
}
export function pickVideo(song, items) {
  let best = null, bestScore = -Infinity;
  for (const v of items) {
    if (!v || !/^[A-Za-z0-9_-]{11}$/.test(v.id || '')) continue;
    const sc = scoreVideo(song, v);
    if (sc > bestScore) { best = v; bestScore = sc; }
  }
  return best && bestScore >= 2 ? { id: best.id, title: clean(decodeEntities(best.title), 140), channel: clean(decodeEntities(best.channel), 80) } : null;
}
// One YouTube search for one song. Throws { status: 403, quota: true } when
// the key is out of searches for today.
export async function searchYouTube(env, key, song) {
  const api = (env && env.YOUTUBE_API) || 'https://www.googleapis.com/youtube/v3';
  const q = (song.a ? primaryArtist(song.a) + ' - ' : '') + song.t;
  let r;
  try { r = await fetch(`${api}/search?part=snippet&type=video&videoCategoryId=10&maxResults=5&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`); }
  catch (e) { throw err('Couldn’t reach YouTube.', 502); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = d && d.error && Array.isArray(d.error.errors) && d.error.errors[0] ? d.error.errors[0].reason : '';
    if (/quota|dailyLimit|rateLimit/i.test(reason)) throw Object.assign(err('This YouTube key has used up today’s searches (about 100 songs a day). The rest will be found tomorrow, or use another key.', 429), { quota: true });
    if (r.status === 400 || r.status === 403) throw Object.assign(err('YouTube refused the key. Check the YouTube API key.', 403), { badKey: true });
    throw err('YouTube answered ' + r.status + '.', 502);
  }
  const items = (d.items || []).map((it) => ({ id: it.id && it.id.videoId, title: it.snippet && it.snippet.title, channel: it.snippet && it.snippet.channelTitle }));
  return pickVideo(song, items);
}
export const youtubeSearchUrl = (song) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(((song.a ? primaryArtist(song.a) + ' ' : '') + song.t).trim());

// ---- Storage (KV ytlists:<name>) ---------------------------------------------------------
export async function readLists(kv, who) {
  try { return (await kv.get(listsKey(who), 'json')) || []; } catch (e) { return []; }
}
export async function writeLists(kv, who, lists) { await kv.put(listsKey(who), JSON.stringify(lists)); }
export function newList(read) {
  return {
    id: crypto.randomUUID(), service: read.service, kind: read.kind, name: read.name, by: read.by, image: read.image, url: read.url, partial: read.partial, ts: Date.now(),
    // m: undefined = not looked up yet, null = no good match, { id, title, channel } = found
    tracks: read.tracks.map((t) => ({ ...t }))
  };
}
export const listSummary = (l) => ({ id: l.id, service: l.service, kind: l.kind, name: l.name, by: l.by, image: l.image, url: l.url, ts: l.ts, count: l.tracks.length, found: l.tracks.filter((t) => t.m).length, pending: l.tracks.filter((t) => t.m === undefined).length, partial: !!l.partial });
export const publicList = (l) => ({ ...listSummary(l), tracks: l.tracks.map((t) => ({ t: t.t, a: t.a, d: t.d, m: t.m === undefined ? undefined : t.m, search: youtubeSearchUrl(t) })) });
