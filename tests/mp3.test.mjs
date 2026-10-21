// YouTube to MP3 (Music tab): the Worker's part. Links are recognized (one
// video; playlists and other pages refused with a reason), and only the
// verified owner can look a link up. The YouTube Data API is a local
// stand-in that answers in its shape (these tests check our handling, not
// YouTube itself). Conversion runs in the browser: tests/browser/mp3.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { parseYouTubeLink, isoSeconds, rightsNote } from '../web/mp3.js';

function makeKV() {
  const store = new Map();
  return { store, async get(k, t) { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } };
}
const ADMIN = 'admin-token-very-secret-1234';
const owner = { Authorization: 'Bearer ' + ADMIN };
const ID = 'dQw4w9WgXcQ';

test('mp3: YouTube links are recognized; playlists, channels and other sites are refused with a reason', () => {
  for (const [link, kind] of [
    ['https://www.youtube.com/watch?v=' + ID, 'video'],
    ['https://youtube.com/watch?v=' + ID + '&t=42s', 'video'],
    ['youtube.com/watch?v=' + ID, 'video'],
    ['https://m.youtube.com/watch?feature=share&v=' + ID, 'video'],
    ['https://youtu.be/' + ID + '?si=abc', 'video'],
    ['https://www.youtube.com/shorts/' + ID, 'short'],
    ['https://www.youtube.com/embed/' + ID, 'video'],
    ['https://www.youtube.com/live/' + ID + '?feature=share', 'live'],
    ['https://music.youtube.com/watch?v=' + ID + '&feature=share', 'video'],
    ['https://www.youtube-nocookie.com/embed/' + ID, 'video']
  ]) {
    const r = parseYouTubeLink(link);
    assert.equal(r.ok, true, link);
    assert.equal(r.id, ID, link);
    assert.equal(r.kind, kind, link);
    assert.equal(r.url, 'https://www.youtube.com/watch?v=' + ID);
  }
  // A video inside a playlist: the video, and it says the playlist is ignored.
  const inList = parseYouTubeLink('https://www.youtube.com/watch?v=' + ID + '&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&index=3');
  assert.deepEqual([inList.ok, inList.id, inList.ignoredList], [true, ID, true]);
  // Refused, each with its reason.
  const pl = parseYouTubeLink('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  assert.deepEqual([pl.ok, pl.playlist], [false, true]);
  assert.match(pl.error, /playlist link/);
  assert.match(parseYouTubeLink('https://www.youtube.com/@SomeChannel').error, /channel link/);
  assert.match(parseYouTubeLink('https://www.youtube.com/channel/UC123').error, /channel link/);
  for (const bad of ['https://vimeo.com/123456', 'https://youtube.com.evil.example/watch?v=' + ID, 'https://evil.example/?u=https://youtu.be/' + ID, 'javascript:alert(1)', 'ftp://youtube.com/watch?v=' + ID]) {
    const r = parseYouTubeLink(bad);
    assert.equal(r.ok, false, bad);
  }
  assert.equal(parseYouTubeLink('https://www.youtube.com/watch?v=tooShort').ok, false);
  assert.equal(parseYouTubeLink('https://www.youtube.com/watch?v=' + ID + '<script>').ok, false);
  assert.equal(parseYouTubeLink('').ok, false);
  assert.equal(parseYouTubeLink('x'.repeat(3000)).ok, false);
  assert.equal(isoSeconds('PT1H2M3S'), 3723);
  assert.equal(isoSeconds('PT4M13S'), 253);
  assert.equal(isoSeconds('P0D'), 0);
  assert.match(rightsNote(null), /doesn’t let apps download/);
  assert.match(rightsNote({ license: 'creativeCommon' }), /Creative Commons/);
});

test('mp3: link check is owner only (server-side), uses only the Worker key, caches, rate-limits, never downloads media', async () => {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input && input.url || input);
    seen.push(u);
    if (u.startsWith('https://www.googleapis.com/youtube/v3/videos')) {
      // Stand-in for the YouTube Data API (videos.list).
      const q = new URL(u).searchParams;
      if (q.get('key') !== 'yt-key-1') return new Response(JSON.stringify({ error: { errors: [{ reason: 'keyInvalid' }] } }), { status: 400 });
      if (q.get('id') !== ID) return new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ items: [{ id: ID, snippet: { title: 'My Song (Official Video)', channelTitle: 'My Channel', publishedAt: '2020-01-02T03:04:05Z', liveBroadcastContent: 'none', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/' + ID + '/mqdefault.jpg' } } }, contentDetails: { duration: 'PT3M33S' }, status: { license: 'youtube', privacyStatus: 'public' } }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  };
  try {
    const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
    const call = async (path, headers = {}) => {
      const res = await worker.fetch(new Request('https://w.test' + path, { headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers } }), env, { waitUntil() {} });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    };
    const link = encodeURIComponent('https://youtu.be/' + ID);
    // Nobody signed in, a regular user, a typed owner name, an admin: all refused.
    assert.equal((await call('/music/mp3/check?url=' + link)).status, 403);
    assert.equal((await call('/music/mp3/check?user=boss&url=' + link)).status, 403, 'the owner’s name alone isn’t proof');
    const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
    const reg = await worker.fetch(new Request('https://w.test/auth/register', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' }, body: JSON.stringify({ user: 'ana', verifier: v('ana') }) }), env, { waitUntil() {} });
    assert.equal(reg.status, 200);
    await worker.fetch(new Request('https://w.test/admin/user/action', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4', ...owner }, body: JSON.stringify({ u: 'ana', action: 'setrole', role: 'admin' }) }), env, { waitUntil() {} });
    const tok = (await (await worker.fetch(new Request('https://w.test/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' }, body: JSON.stringify({ user: 'ana', verifier: v('ana') }) }), env, { waitUntil() {} })).json()).token;
    const adminTry = await call('/music/mp3/check?user=ana&url=' + link, { 'X-GPA-Session': tok });
    assert.equal(adminTry.status, 403, 'admins aren’t the owner');
    assert.equal(adminTry.data.ownerOnly, true);
    // The owner: allowed. No key yet: the link is recognized, details need the key.
    const hello = await call('/music/mp3/check?user=boss', owner);
    assert.deepEqual([hello.status, hello.data.owner, hello.data.canLookUp], [200, true, false]);
    const nokey = await call('/music/mp3/check?user=boss&url=' + link, owner);
    assert.equal(nokey.status, 200);
    assert.equal(nokey.data.link.id, ID);
    assert.equal(nokey.data.video, null);
    assert.match(nokey.data.rights, /YouTube Studio/);
    assert.equal(seen.length, 0, 'nothing fetched without a key');
    // A key sent by the browser is ignored.
    await call('/music/mp3/check?user=boss&url=' + link, { ...owner, 'X-GPA-YT-Key': 'yt-key-1' });
    assert.equal(seen.length, 0);
    // With the Worker's key: the video's details.
    env.YOUTUBE_API_KEY = 'yt-key-1';
    const ok = await call('/music/mp3/check?user=boss&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + ID + '&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'), owner);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual([ok.data.video.title, ok.data.video.channel, ok.data.video.duration, ok.data.video.license, ok.data.link.ignoredList], ['My Song (Official Video)', 'My Channel', 213, 'youtube', true]);
    assert.match(ok.data.video.thumb, /^https:\/\/i\.ytimg\.com\//);
    assert.match(ok.data.rights, /doesn’t let apps download/);
    assert.ok(!JSON.stringify(ok.data).includes('yt-key-1'), 'the key never leaves the Worker');
    // Cached: the same video again doesn't call YouTube.
    const before = seen.length;
    await call('/music/mp3/check?user=boss&url=' + link, owner);
    assert.equal(seen.length, before);
    // Only the YouTube Data API was ever contacted: no media downloads.
    assert.ok(seen.every((u) => u.startsWith('https://www.googleapis.com/youtube/v3/videos?')), seen.join(' '));
    // Bad input and missing videos.
    const pl = await call('/music/mp3/check?user=boss&url=' + encodeURIComponent('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'), owner);
    assert.deepEqual([pl.status, pl.data.playlist], [400, true]);
    assert.equal((await call('/music/mp3/check?user=boss&url=' + encodeURIComponent('https://evil.example/watch?v=' + ID), owner)).status, 400);
    const gone = await call('/music/mp3/check?user=boss&url=' + encodeURIComponent('https://youtu.be/AAAAAAAAAAA'), owner);
    assert.equal(gone.status, 404);
    assert.match(gone.data.error, /no public video/);
    // A broken key is reported.
    env.YOUTUBE_API_KEY = 'wrong';
    const bad = await call('/music/mp3/check?user=boss&url=' + encodeURIComponent('https://youtu.be/BBBBBBBBBBB'), owner);
    assert.equal(bad.status, 502);
    assert.match(bad.data.error, /refused the key/);
    // At most 120 lookups an hour.
    env.YOUTUBE_API_KEY = 'yt-key-1';
    await env.TELEMETRY.put('mp3chk:' + Math.floor(Date.now() / 3600e3), '120');
    assert.equal((await call('/music/mp3/check?user=boss&url=' + encodeURIComponent('https://youtu.be/CCCCCCCCCCC'), owner)).status, 429);
  } finally { globalThis.fetch = real; }
});
