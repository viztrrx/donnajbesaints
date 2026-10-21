// Playlist → YouTube links (Music → Playlists, everyone signed in). Spotify,
// Apple Music and YouTube are replaced by stubs that answer in the shape of
// their public pages / API (the real services can't be reached from tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { parsePlaylistLink, readPlaylist, pickVideo, scoreVideo, decodeEntities, primaryArtist } from '../web/playlists.js';

function makeKV() {
  const store = new Map();
  return { store, async get(k, t) { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } };
}
const ADMIN = 'admin-token-very-secret-1234';
const owner = { Authorization: 'Bearer ' + ADMIN };

const SPOTIFY_EMBED = `<!doctype html><html><head><meta property="og:title" content="Late Night Drive"></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: {
  type: 'playlist', name: 'Late Night Drive', subtitle: 'kj', coverArt: { sources: [{ url: 'https://i.scdn.co/image/abc' }] },
  trackList: [
    { uri: 'spotify:track:1', title: 'Blinding Lights', subtitle: 'The Weeknd', duration: 200040 },
    { uri: 'spotify:track:2', title: 'Levitating (feat. DaBaby)', subtitle: 'Dua Lipa, DaBaby', duration: 203064 },
    { uri: 'spotify:track:3', title: 'A Song Nobody Uploaded', subtitle: 'Unknown Band', duration: 180000 }
  ] } } } } } })}</script></body></html>`;
const APPLE_PAGE = `<!doctype html><html><head><meta property="og:title" content="Chill Mix on Apple Music">
<meta property="og:image" content="https://is1-ssl.mzstatic.com/image/x.jpg">
<script type="application/ld+json">${JSON.stringify({ '@context': 'http://schema.org', '@type': 'MusicPlaylist', name: 'Chill Mix', author: { name: 'Apple Music' },
  track: [{ '@type': 'MusicRecording', name: 'Sunflower', duration: 'PT2M38S' }] })}</script>
<script type="application/json" id="serialized-server-data">${JSON.stringify([{ data: { sections: [{ itemKind: 'trackLockup', items: [
  { title: 'Sunflower', artistName: 'Post Malone & Swae Lee', duration: 158040 },
  { title: 'Ivy', artistName: 'Frank Ocean', duration: 249000 }
] }] } }])}</script></head><body></body></html>`;
const VIDEOS = {
  'The Weeknd - Blinding Lights': [
    { id: { videoId: 'aaaaaaaaaa1' }, snippet: { title: 'The Weeknd - Blinding Lights (Sped Up)', channelTitle: 'Speedy Edits' } },
    { id: { videoId: '4NRXx6U8ABQ' }, snippet: { title: 'The Weeknd - Blinding Lights (Official Audio)', channelTitle: 'TheWeekndVEVO' } },
    { id: { videoId: 'bbbbbbbbbb2' }, snippet: { title: 'Blinding Lights (cover)', channelTitle: 'Some Singer' } }
  ],
  'Dua Lipa - Levitating (feat. DaBaby)': [
    { id: { videoId: 'TUVcZfQe-Kw' }, snippet: { title: 'Levitating (feat. DaBaby)', channelTitle: 'Dua Lipa - Topic' } }
  ],
  'Unknown Band - A Song Nobody Uploaded': [
    { id: { videoId: 'cccccccccc3' }, snippet: { title: 'Totally different thing', channelTitle: 'Random' } }
  ]
};
function stubFetch({ quotaAfter = Infinity } = {}) {
  const real = globalThis.fetch;
  const seen = [];
  let searches = 0;
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input && input.url || input);
    seen.push(u);
    if (u.startsWith('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M')) return new Response(SPOTIFY_EMBED, { headers: { 'Content-Type': 'text/html' } });
    if (u.startsWith('https://open.spotify.com/embed/')) return new Response('nope', { status: 404 });
    if (u.startsWith('https://music.apple.com/us/playlist/chill-mix/pl.u-abcdefgh123')) return new Response(APPLE_PAGE, { headers: { 'Content-Type': 'text/html' } });
    if (u.startsWith('https://www.googleapis.com/youtube/v3/search')) {
      const q = new URL(u).searchParams;
      if (q.get('key') !== 'yt-key-1') return new Response(JSON.stringify({ error: { errors: [{ reason: 'keyInvalid' }] } }), { status: 400 });
      if (++searches > quotaAfter) return new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 });
      return new Response(JSON.stringify({ items: VIDEOS[q.get('q')] || [] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

test('playlists: links are recognized; anything else is refused', () => {
  assert.deepEqual(parsePlaylistLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123'), { service: 'spotify', kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(parsePlaylistLink('https://open.spotify.com/intl-es/album/4aawyAB9vmqN3uQ7FjRGTy'), { service: 'spotify', kind: 'album', id: '4aawyAB9vmqN3uQ7FjRGTy' });
  assert.deepEqual(parsePlaylistLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), { service: 'spotify', kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(parsePlaylistLink('https://music.apple.com/us/playlist/chill-mix/pl.u-abcdefgh123'), { service: 'apple', kind: 'playlist', id: 'pl.u-abcdefgh123', cc: 'us', slug: 'chill-mix' });
  assert.deepEqual(parsePlaylistLink('https://music.apple.com/gb/album/after-hours/1499378108?i=1'), { service: 'apple', kind: 'album', id: '1499378108', cc: 'gb', slug: 'after-hours' });
  for (const bad of ['https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M', 'https://open.spotify.com.evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M', 'javascript:alert(1)', 'https://music.apple.com/us/playlist/x/../../etc', 'hello'])
    assert.equal(parsePlaylistLink(bad), null, bad);
  assert.equal(decodeEntities('Rock &amp; Roll &#39;n&#x27; stuff'), "Rock & Roll 'n' stuff");
  for (const [a, want] of [['Post Malone & Swae Lee', 'Post Malone'], ['Dua Lipa, DaBaby', 'Dua Lipa'], ['Travis Scott feat. Drake', 'Travis Scott'], ['Lil Nas X', 'Lil Nas X'], ['Simon & Garfunkel', 'Simon']]) assert.equal(primaryArtist(a), want, a);
});

test('playlists: picks the official video over covers, sped-up edits and unrelated videos', () => {
  const song = { t: 'Blinding Lights', a: 'The Weeknd' };
  const items = VIDEOS['The Weeknd - Blinding Lights'].map((v) => ({ id: v.id.videoId, title: v.snippet.title, channel: v.snippet.channelTitle }));
  assert.equal(pickVideo(song, items).id, '4NRXx6U8ABQ');
  assert.ok(scoreVideo(song, items[1]) > scoreVideo(song, items[0]));
  assert.equal(pickVideo({ t: 'A Song Nobody Uploaded', a: 'Unknown Band' }, [{ id: 'cccccccccc3', title: 'Totally different thing', channel: 'Random' }]), null, 'no weak guesses');
  assert.equal(pickVideo(song, [{ id: 'bad id', title: 'Blinding Lights', channel: 'The Weeknd' }]), null, 'only real video ids');
});

test('playlists: reads Spotify (embed) and Apple Music pages', async () => {
  const f = stubFetch();
  try {
    const sp = await readPlaylist({}, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x');
    assert.equal(sp.name, 'Late Night Drive');
    assert.equal(sp.tracks.length, 3);
    assert.deepEqual(sp.tracks[1], { t: 'Levitating (feat. DaBaby)', a: 'Dua Lipa, DaBaby', d: 203 });
    assert.equal(sp.url, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    const ap = await readPlaylist({}, 'https://music.apple.com/us/playlist/chill-mix/pl.u-abcdefgh123');
    assert.equal(ap.name, 'Chill Mix');
    assert.deepEqual(ap.tracks, [{ t: 'Sunflower', a: 'Post Malone & Swae Lee', d: 158 }, { t: 'Ivy', a: 'Frank Ocean', d: 249 }]);
    await assert.rejects(readPlaylist({}, 'https://open.spotify.com/playlist/0000000000AAAAAAAAAAAA'), /wasn’t found/);
    await assert.rejects(readPlaylist({}, 'https://example.com/x'), /Paste a Spotify or Apple Music/);
    assert.ok(f.seen.every((u) => /^https:\/\/(open\.spotify\.com|music\.apple\.com)\//.test(u)), 'fetches only the two services');
  } finally { f.restore(); }
});

test('playlists: everyone signed in, app or website; Worker key only; each song searched once', async () => {
  const f = stubFetch({ quotaAfter: 2 });
  try {
    const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
    const APP = { Origin: 'https://w.test', Referer: 'https://w.test/console/' };
    const call = async (path, { method = 'GET', headers = {}, body, app = true } = {}) => {
      const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...(app ? APP : { Origin: 'https://school.example' }), ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
      return { status: res.status, data: await res.json().catch(() => ({})), text: '' };
    };
    const searches = () => f.seen.filter((u) => u.startsWith('https://www.googleapis.com/')).length;
    const SP = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1';
    // On a website (not the app) it works too now (owner's call).
    const web = await call('/music/lists?user=boss', { headers: owner, app: false });
    assert.equal(web.status, 200, JSON.stringify(web.data));
    assert.equal((await worker.fetch(new Request('https://w.test/music/lists?user=boss', { headers: owner }), env, { waitUntil() {} })).status, 200);
    // A typed name without signing in: refused (lists are saved to an account).
    const anon = await call('/music/lists?user=kj');
    assert.deepEqual([anon.status, anon.data.signIn], [401, true]);
    assert.equal((await call('/music/lists?user=boss')).status, 401, 'the owner’s name alone isn’t proof');
    // The owner, in the app: imports a playlist.
    const imp = await call('/music/lists/import?user=boss', { method: 'POST', headers: owner, body: { url: SP } });
    assert.equal(imp.status, 200, JSON.stringify(imp.data));
    const id = imp.data.list.id;
    assert.equal(imp.data.list.count, 3);
    assert.equal(imp.data.list.pending, 3);
    assert.match(imp.data.list.tracks[0].search, /^https:\/\/www\.youtube\.com\/results\?search_query=The%20Weeknd%20Blinding%20Lights$/);
    // No key on the Worker: search links only, and nothing is searched.
    const nokey = await call('/music/lists/find?user=boss', { method: 'POST', headers: owner, body: { id } });
    assert.equal(nokey.data.needKey, true);
    assert.equal(searches(), 0);
    // A key sent by the browser is ignored: only the Worker's own key is used.
    await call('/music/lists/find?user=boss', { method: 'POST', headers: { ...owner, 'X-GPA-YT-Key': 'yt-key-1' }, body: { id } });
    assert.equal(searches(), 0);
    // The owner adds YOUTUBE_API_KEY in Cloudflare: two found, then the key's daily quota runs out.
    env.YOUTUBE_API_KEY = 'yt-key-1';
    assert.equal((await call('/music/lists?user=boss', { headers: owner })).data.canFind, true);
    const r1 = await call('/music/lists/find?user=boss', { method: 'POST', headers: owner, body: { id } });
    assert.equal(r1.data.list.tracks[0].m.id, '4NRXx6U8ABQ');
    assert.equal(r1.data.list.tracks[1].m.id, 'TUVcZfQe-Kw');
    assert.equal(r1.data.list.tracks[2].m, undefined);
    assert.equal(r1.data.stop, true);
    assert.match(r1.data.error, /used up today/);
    assert.ok(!JSON.stringify(r1.data).includes('yt-key-1'), 'the key never leaves the Worker');
    // Saved on the account.
    const all = await call('/music/lists?user=boss', { headers: owner });
    assert.deepEqual(all.data.lists.map((l) => [l.name, l.count, l.found, l.pending]), [['Late Night Drive', 3, 2, 1]]);
    // Next day: the last song has no clear video → search link.
    f.restore();
    const g = stubFetch();
    try {
      const r2 = await call('/music/lists/find?user=boss', { method: 'POST', headers: owner, body: { id } });
      assert.equal(r2.data.list.tracks[2].m, null);
      assert.equal(r2.data.more, false);
      assert.equal(r2.data.searched, 1);
      const gSearches = () => g.seen.filter((u) => u.startsWith('https://www.googleapis.com/')).length;
      // An admin imports the same playlist: every song comes from the shared
      // cache, so the key isn't used at all.
      const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
      await call('/auth/register', { method: 'POST', body: { user: 'ana', verifier: v('ana') }, app: false });
      await call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'ana', action: 'setrole', role: 'admin' }, app: false });
      const tok = (await call('/auth/login', { method: 'POST', body: { user: 'ana', verifier: v('ana') } })).data.token;
      const anaH = { 'X-GPA-Session': tok };
      const before = gSearches();
      const aImp = await call('/music/lists/import?user=ana', { method: 'POST', headers: anaH, body: { url: SP } });
      const aFind = await call('/music/lists/find?user=ana', { method: 'POST', headers: anaH, body: { id: aImp.data.list.id } });
      assert.deepEqual(aFind.data.list.tracks.map((t) => t.m && t.m.id), ['4NRXx6U8ABQ', 'TUVcZfQe-Kw', null]);
      assert.equal(aFind.data.searched, 0);
      assert.equal(gSearches(), before, 'no YouTube searches for songs already looked up');
      // Admins have Playlists too, with the same daily limit as everyone (only the owner has none).
      assert.deepEqual((await call('/music/lists?user=ana', { headers: anaH })).data.songs, { perDay: 10, left: 10 });
      const day = new Date().toISOString().slice(0, 10);
      await env.TELEMETRY.put('ytlists-search:' + day + ':ana', '10');
      await call('/music/lists/retry?user=ana', { method: 'POST', headers: anaH, body: { id: aImp.data.list.id, i: 0 } });
      const aCap = await call('/music/lists/find?user=ana', { method: 'POST', headers: anaH, body: { id: aImp.data.list.id } });
      assert.deepEqual([aCap.data.capped, aCap.data.searched], [true, 0], 'admins are capped too');
      assert.equal((await call('/admin/config', { method: 'POST', headers: anaH, body: { listsDailySongs: 500 } })).status, 403, 'admins can’t raise it');
      // Her lists are hers; the owner's aren't.
      assert.deepEqual((await call('/music/lists?user=ana', { headers: anaH })).data.lists.map((l) => l.name), ['Late Night Drive']);
      assert.equal((await call('/music/lists/one?user=ana&id=' + id, { headers: anaH })).status, 404);
      // "Look it up again" really searches again (skips the cache).
      await call('/music/lists/retry?user=boss', { method: 'POST', headers: owner, body: { id, i: 0 } });
      const r3 = await call('/music/lists/find?user=boss', { method: 'POST', headers: owner, body: { id } });
      assert.equal(r3.data.searched, 1);
      // A wrong key on the Worker is reported, not hidden.
      env.YOUTUBE_API_KEY = 'wrong';
      await call('/music/lists/retry?user=boss', { method: 'POST', headers: owner, body: { id, i: 0 } });
      const bad = await call('/music/lists/find?user=boss', { method: 'POST', headers: owner, body: { id } });
      assert.match(bad.data.error, /refused the key/);
    } finally { g.restore(); }
    // Delete.
    assert.deepEqual((await call('/music/lists/delete?user=boss', { method: 'POST', headers: owner, body: { id } })).data.lists, []);
  } finally { f.restore(); }
});

test('playlists: a regular signed-in user can use them, with a daily cap on new lookups (cached songs are free)', async () => {
  const f = stubFetch();
  try {
    const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', YOUTUBE_API_KEY: 'yt-key-1' };
    const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
      const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', Origin: 'https://school.example', ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    };
    const searches = () => f.seen.filter((u) => u.startsWith('https://www.googleapis.com/')).length;
    const SP = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1';
    const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
    const tok = (await call('/auth/register', { method: 'POST', body: { user: 'kj', verifier: v('kj') } })).data.token;
    const kjH = { 'X-GPA-Session': tok };
    // kj (a regular user, on the website) imports a playlist.
    const imp = await call('/music/lists/import?user=kj', { method: 'POST', headers: kjH, body: { url: SP } });
    assert.equal(imp.status, 200, JSON.stringify(imp.data));
    // 10 new songs a day by default, shown to them.
    assert.deepEqual((await call('/music/lists?user=kj', { headers: kjH })).data.songs, { perDay: 10, left: 10 });
    // kj has already used 9 of today's 10 new lookups: one song is looked up, then it stops with a reason.
    const day = new Date().toISOString().slice(0, 10);
    await env.TELEMETRY.put('ytlists-search:' + day + ':kj', '9');
    const r1 = await call('/music/lists/find?user=kj', { method: 'POST', headers: kjH, body: { id: imp.data.list.id } });
    assert.deepEqual([r1.data.searched, r1.data.capped, r1.data.stop, r1.data.more], [1, true, true, false]);
    assert.match(r1.data.error, /your 10 new songs for today/);
    assert.deepEqual(r1.data.songs, { perDay: 10, left: 0 });
    assert.equal(searches(), 1);
    assert.equal(await env.TELEMETRY.get('ytlists-search:' + day + ':kj'), '10');
    // At the cap: nothing more is searched.
    const r2 = await call('/music/lists/find?user=kj', { method: 'POST', headers: kjH, body: { id: imp.data.list.id } });
    assert.deepEqual([r2.data.searched, r2.data.capped], [0, true]);
    assert.equal(searches(), 1);
    // The owner looks the same playlist up (no cap): the song kj found comes from the cache.
    const oImp = await call('/music/lists/import?user=boss', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN }, body: { url: SP } });
    const o = await call('/music/lists/find?user=boss', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN }, body: { id: oImp.data.list.id } });
    assert.equal(o.data.searched, 2);
    assert.equal(searches(), 3);
    // Next time kj asks, the songs the owner found are cached: they fill in with no new lookup, even at the cap.
    const r3 = await call('/music/lists/find?user=kj', { method: 'POST', headers: kjH, body: { id: imp.data.list.id } });
    assert.equal(r3.data.list.pending, 0, JSON.stringify(r3.data.list).slice(0, 300));
    assert.equal(searches(), 3);
    // The owner has no limit; the owner can change everyone's (0–500), nobody else can.
    assert.equal((await call('/music/lists?user=boss', { headers: { Authorization: 'Bearer ' + ADMIN } })).data.songs, null);
    assert.equal((await call('/admin/config', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN }, body: { listsDailySongs: 501 } })).status, 400);
    assert.equal((await call('/admin/config', { method: 'POST', headers: kjH, body: { listsDailySongs: 500 } })).status >= 401, true, 'not for users');
    assert.equal((await call('/admin/config', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN }, body: { listsDailySongs: 12 } })).status, 200);
    assert.deepEqual((await call('/music/lists?user=kj', { headers: kjH })).data.songs, { perDay: 12, left: 2 });
    assert.equal((await call('/admin/reports', { headers: { Authorization: 'Bearer ' + ADMIN } })).data.listsDailySongs, 12, 'the admin card reads it');
    // Regular users: 10 playlists a day.
    await env.TELEMETRY.put('ytlists-rate:' + day + ':kj', '10');
    const cap = await call('/music/lists/import?user=kj', { method: 'POST', headers: kjH, body: { url: SP } });
    assert.equal(cap.status, 429);
    assert.match(cap.data.error, /10 playlists today/);
  } finally { f.restore(); }
});
