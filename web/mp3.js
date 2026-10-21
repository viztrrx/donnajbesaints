// YouTube to MP3 (Music tab, owner only): the Worker's part.
//
// The conversion itself runs in the owner's browser (FFmpeg compiled to
// WebAssembly, see script.js "YouTube to MP3"), on a media file the owner
// provides. Nothing here downloads video or audio: YouTube offers no
// download API and its terms don't allow fetching media from a link, so a
// link is only read for its details (the YouTube Data API, with the Worker's
// own YOUTUBE_API_KEY) and the owner is told how to get the file of their
// own video (YouTube Studio).
//
// parseYouTubeLink: accepts watch, youtu.be, Shorts, embed, live and
// music.youtube.com links for one video; a playlist-only link is refused
// with a reason, and a video link that also names a playlist says the
// playlist part is ignored. Only YouTube hosts are accepted.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const LIST_RE = /^[A-Za-z0-9_-]{10,64}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

export function parseYouTubeLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'Paste a YouTube link.' };
  if (s.length > 2048) return { ok: false, error: 'That link is too long.' };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return { ok: false, error: 'That isn’t a link.' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'That isn’t a web link.' };
  const host = u.hostname.toLowerCase();
  if (!HOSTS.has(host)) return { ok: false, error: 'That isn’t a YouTube link.' };
  const parts = u.pathname.split('/').filter(Boolean);
  const list = u.searchParams.get('list') || '';
  let id = '', kind = 'video';
  if (host.endsWith('youtu.be')) id = parts[0] || '';
  else if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
  else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v' || parts[0] === 'e') { id = parts[1] || ''; if (parts[0] === 'shorts') kind = 'short'; if (parts[0] === 'live') kind = 'live'; }
  else if (parts[0] === 'playlist') {
    return { ok: false, playlist: true, error: 'That’s a playlist link. Paste the link of one video (…/watch?v=… or youtu.be/…).' };
  } else if (parts[0] === 'channel' || parts[0] === 'c' || parts[0] === 'user' || (parts[0] && parts[0].startsWith('@'))) {
    return { ok: false, error: 'That’s a channel link. Paste the link of one video.' };
  }
  if (!id && list) return { ok: false, playlist: true, error: 'That’s a playlist link. Paste the link of one video (…/watch?v=… or youtu.be/…).' };
  if (!ID_RE.test(id)) return { ok: false, error: 'That YouTube link doesn’t point to a video.' };
  const out = { ok: true, id, kind, url: 'https://www.youtube.com/watch?v=' + id };
  if (list && LIST_RE.test(list)) out.ignoredList = true;
  return out;
}

// ISO 8601 duration (PT1H2M3S) → seconds.
export function isoSeconds(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(d || ''));
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}

const err = (message, status) => Object.assign(new Error(message), { status });

// One video's public details from the YouTube Data API (videos.list costs
// 1 unit of the key's 10,000 a day). Returns null when there's no public
// video with that id.
export async function videoDetails(env, key, id) {
  const api = (env && env.YOUTUBE_API) || 'https://www.googleapis.com/youtube/v3';
  let r;
  try { r = await fetch(`${api}/videos?part=snippet,contentDetails,status&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`); }
  catch (e) { throw err('Couldn’t reach YouTube.', 502); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = d && d.error && Array.isArray(d.error.errors) && d.error.errors[0] ? d.error.errors[0].reason : '';
    if (/quota|dailyLimit|rateLimit/i.test(reason)) throw err('The YouTube key has used up today’s lookups. Try again tomorrow.', 429);
    if (r.status === 400 || r.status === 403) throw err('YouTube refused the key. Check YOUTUBE_API_KEY on the Worker.', 502);
    throw err('YouTube answered ' + r.status + '.', 502);
  }
  const it = Array.isArray(d.items) ? d.items[0] : null;
  if (!it) return null;
  const sn = it.snippet || {}, cd = it.contentDetails || {}, st = it.status || {};
  const th = sn.thumbnails || {};
  const thumb = (th.medium || th.high || th.default || {}).url || '';
  return {
    id,
    url: 'https://www.youtube.com/watch?v=' + id,
    title: String(sn.title || '').slice(0, 200),
    channel: String(sn.channelTitle || '').slice(0, 120),
    published: String(sn.publishedAt || '').slice(0, 10),
    duration: isoSeconds(cd.duration),
    live: sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none' ? sn.liveBroadcastContent : '',
    license: st.license === 'creativeCommon' ? 'creativeCommon' : 'youtube',
    privacy: String(st.privacyStatus || ''),
    thumb: /^https:\/\/i\.ytimg\.com\//.test(thumb) ? thumb : ''
  };
}

// What the owner is told about getting this video's audio. YouTube has no
// download API for apps, whoever owns the video, so the link alone is never
// enough: the file has to come from the owner (YouTube Studio for their own
// uploads) or from whoever holds the rights.
export function rightsNote(video) {
  const studio = 'If it’s your own video, download it in YouTube Studio (Content → ⋮ next to the video → Download), then choose that file below.';
  if (video && video.license === 'creativeCommon') {
    return 'This video is Creative Commons (CC BY), so you may reuse it with credit, but YouTube still doesn’t let apps download it. ' + studio + ' Otherwise ask the creator for the file.';
  }
  return 'YouTube doesn’t let apps download a video’s audio from its link, so this tool can’t fetch it. ' + studio + ' For anyone else’s video you need the rights holder’s file and permission.';
}
