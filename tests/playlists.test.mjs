// Playlist → YouTube links (Music → Playlists, owner and admins). Spotify,
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

test('playlists: owner and admins only; import, find videos, saved per account, copy-ready', async () => {
  const f = stubFetch({ quotaAfter: 2 });
  try {
    const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss' };
    const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
      const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    };
    // A regular user can't.
    assert.equal((await call('/music/lists?user=kj')).status, 403);
    assert.equal((await call('/music/lists/import?user=kj', { method: 'POST', body: { url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' } })).status, 403);
    // The owner imports a playlist.
    const imp = await call('/music/lists/import?user=boss', { method: 'POST', headers: owner, body: { url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1' } });
    assert.equal(imp.status, 200, JSON.stringify(imp.data));
    const id = imp.data.list.id;
    assert.equal(imp.data.list.count, 3);
    assert.equal(imp.data.list.pending, 3);
    assert.match(imp.data.list.tracks[0].search, /^https:\/\/www\.youtube\.com\/results\?search_query=The%20Weeknd%20Blinding%20Lights$/);
    // No key: search links only.
    const nokey = await call('/music/lists/find?user=boss', { method: 'POST', headers: owner, body: { id } });
    assert.equal(nokey.data.needKey, true);
    // With the console's saved key (sent per request): two found, then the key's quota runs out.
    const yt = { ...owner, 'X-GPA-YT-Key': 'yt-key-1' };
    const r1 = await call('/music/lists/find?user=boss', { method: 'POST', headers: yt, body: { id } });
    assert.equal(r1.data.list.tracks[0].m.id, '4NRXx6U8ABQ');
    assert.equal(r1.data.list.tracks[1].m.id, 'TUVcZfQe-Kw');
    assert.equal(r1.data.list.tracks[2].m, undefined);
    assert.equal(r1.data.stop, true);
    assert.match(r1.data.error, /used up today/);
    // Saved: the list (with what was found) is there on the next load, from any device.
    const all = await call('/music/lists?user=boss', { headers: owner });
    assert.deepEqual(all.data.lists.map((l) => [l.name, l.count, l.found, l.pending]), [['Late Night Drive', 3, 2, 1]]);
    // Next day (quota back): the last song has no clear video → search link.
    f.restore();
    const g = stubFetch();
    try {
      const r2 = await call('/music/lists/find?user=boss', { method: 'POST', headers: yt, body: { id } });
      assert.equal(r2.data.list.tracks[2].m, null);
      assert.equal(r2.data.more, false);
      assert.equal(r2.data.list.found, 2);
      // A wrong key is reported, not hidden.
      await call('/music/lists/retry?user=boss', { method: 'POST', headers: owner, body: { id, i: 0 } });
      const bad = await call('/music/lists/find?user=boss', { method: 'POST', headers: { ...owner, 'X-GPA-YT-Key': 'wrong' }, body: { id } });
      assert.match(bad.data.error, /refused the key/);
    } finally { g.restore(); }
    // An admin has their own lists; the owner's aren't theirs.
    const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
    await call('/auth/register', { method: 'POST', body: { user: 'ana', verifier: v('ana') } });
    await call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'ana', action: 'setrole', role: 'admin' } });
    const tok = (await call('/auth/login', { method: 'POST', body: { user: 'ana', verifier: v('ana') } })).data.token;
    const ana = await call('/music/lists?user=ana', { headers: { 'X-GPA-Session': tok } });
    assert.equal(ana.status, 200);
    assert.deepEqual(ana.data.lists, []);
    assert.equal((await call('/music/lists/one?user=ana&id=' + id, { headers: { 'X-GPA-Session': tok } })).status, 404);
    // Delete.
    assert.deepEqual((await call('/music/lists/delete?user=boss', { method: 'POST', headers: owner, body: { id } })).data.lists, []);
  } finally { f.restore(); }
});
