// Music: keyless Audius search and streaming through the Worker, and the
// shared library in R2 (owner/admin uploads, Range playback, allowed users).
// Audius is replaced by a stub that answers in the shape of its public API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { audioKind, nameFromFile } from '../web/music.js';

function makeKV() {
  const store = new Map();
  return { store, async get(k, t) { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } };
}
function makeR2() {
  const objs = new Map();
  return { objs,
    async put(k, v, o = {}) { objs.set(k, { bytes: new Uint8Array(v), httpMetadata: o.httpMetadata || {}, customMetadata: o.customMetadata || {} }); },
    async head(k) { const o = objs.get(k); return o ? { size: o.bytes.length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata } : null; },
    async get(k, opts = {}) { const o = objs.get(k); if (!o) return null; const r = opts.range; const b = r ? o.bytes.slice(r.offset, r.offset + r.length) : o.bytes; return { body: new Blob([b]).stream(), size: o.bytes.length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata }; },
    async delete(k) { objs.delete(k); } };
}
const ADMIN = 'admin-token-very-secret-1234';
const owner = { Authorization: 'Bearer ' + ADMIN };
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, ...Array.from({ length: 2000 }, (_, i) => i % 251)]);

const AUDIUS_TRACKS = { data: [
  { id: 'D7KyD', title: 'Midnight Drive', duration: 187, genre: 'Lo-Fi', is_streamable: true, play_count: 1200, artwork: { '150x150': 'https://creatornode.audius.co/content/a/150x150.jpg' }, user: { name: 'Nova', handle: 'novabeats' } },
  { id: 'Xk9Lm', title: 'Gone Track', is_streamable: false, user: { name: 'X' } },
  { id: 'Pq2Rs', title: 'Late Bus Home', duration: 201, user: { handle: 'quietkid' } }
] };
function setup({ audiusDown = false } = {}) {
  const env = { TELEMETRY: makeKV(), donnajbe_eaglercraft_client: makeR2(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', OWNER_CODE: 'owner-code-1' };
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input && input.url || input);
    if (u.includes('audius')) {
      seen.push({ url: u, headers: init.headers || {} });
      if (audiusDown) throw new Error('blocked');
      if (/\/v1\/tracks\/search\?/.test(u)) return new Response(JSON.stringify(AUDIUS_TRACKS), { headers: { 'Content-Type': 'application/json' } });
      const m = /\/v1\/tracks\/([A-Za-z0-9]+)\/stream/.exec(u);
      if (m) {
        const range = (init.headers || {}).Range;
        return range
          ? new Response(MP3.slice(0, 100), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes 0-99/${MP3.length}`, 'Content-Length': '100' } })
          : new Response(MP3, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(MP3.length) } });
      }
      return new Response('{"data":[]}', { headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  };
  const ctx = { waitUntil() {} };
  const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const res = await worker.fetch(new Request('https://worker.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body }), env, ctx);
    return res;
  };
  const jsonOf = async (r) => JSON.parse(await r.text());
  const upload = (headers, file, name, fields = {}) => {
    const fd = new FormData();
    fd.append('file', new File([file], name, { type: 'audio/mpeg' }));
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return call('/music/upload', { method: 'POST', headers, body: fd });
  };
  return { env, call, jsonOf, upload, seen, restore: () => { globalThis.fetch = real; } };
}

test('music: file checks and names from "Artist - Title.mp3"', () => {
  assert.equal(audioKind(MP3), 'audio/mpeg');
  assert.equal(audioKind(new Uint8Array([0xff, 0xfb, 0x90, 0x64])), 'audio/mpeg');
  assert.equal(audioKind(new Uint8Array([0xff, 0xf1, 0x50, 0x80])), 'audio/aac');
  assert.equal(audioKind(new TextEncoder().encode('....ftypM4A ')), 'audio/mp4');
  assert.equal(audioKind(new TextEncoder().encode('OggS....')), 'audio/ogg');
  assert.equal(audioKind(new TextEncoder().encode('RIFF....WAVEfmt ')), 'audio/wav');
  assert.equal(audioKind(new TextEncoder().encode('<html><script>')), null);
  assert.equal(audioKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null, 'a PNG is not audio');
  assert.deepEqual(nameFromFile('Nova - Midnight Drive.mp3'), { artist: 'Nova', title: 'Midnight Drive' });
  assert.deepEqual(nameFromFile('just_a_song.m4a'), { artist: '', title: 'just a song' });
});

test('music: Audius search and streaming need no key and go through the Worker', async () => {
  const t = setup();
  try {
    const r = await t.jsonOf(await t.call('/music/search?q=late%20night&user=kj'));
    assert.equal(r.ok, true);
    assert.deepEqual(r.audius.map((x) => x.title), ['Midnight Drive', 'Late Bus Home'], 'unstreamable tracks are dropped');
    assert.deepEqual(r.audius[0], { source: 'audius', id: 'D7KyD', title: 'Midnight Drive', artist: 'Nova', duration: 187, genre: 'Lo-Fi', art: 'https://creatornode.audius.co/content/a/150x150.jpg', plays: 1200, stream: '/music/audius/stream/D7KyD' });
    assert.equal(r.audius[1].artist, 'quietkid', 'falls back to the handle');
    assert.ok(t.seen[0].url.includes('app_name=AgentConsole') && !/key=|api_key/i.test(t.seen[0].url), 'only an app name, no key');
    const s = await t.call('/music/audius/stream/D7KyD?user=kj', { headers: { Range: 'bytes=0-99' } });
    assert.equal(s.status, 206);
    assert.equal(s.headers.get('Content-Type'), 'audio/mpeg');
    assert.equal(s.headers.get('Content-Range'), `bytes 0-99/${MP3.length}`);
    assert.equal((await s.arrayBuffer()).byteLength, 100);
    assert.equal(t.seen.at(-1).headers.Range, 'bytes=0-99', 'seeking passes Range through');
    assert.equal((await t.call('/music/audius/stream/bad..id')).status, 404);
  } finally { t.restore(); }
});

test('music: if Audius is unreachable, search still returns the shared library', async () => {
  const t = setup({ audiusDown: true });
  try {
    await t.upload(owner, MP3, 'Nova - Night Bus.mp3');
    const r = await t.jsonOf(await t.call('/music/search?q=night'));
    assert.equal(r.ok, true);
    assert.deepEqual(r.audius, []);
    assert.match(r.audiusError, /not reachable/);
    assert.equal(r.shared[0].title, 'Night Bus');
  } finally { t.restore(); }
});

test('music: owner and admins build the shared library; everyone plays it with seeking', async () => {
  const t = setup();
  try {
    // Listeners can browse but not upload.
    let lib = await t.jsonOf(await t.call('/music/library?user=kj'));
    assert.deepEqual([lib.tracks, lib.canUpload, lib.storage], [[], false, true]);
    assert.equal((await t.upload({}, MP3, 'x.mp3')).status, 403, 'anonymous cannot upload');
    assert.equal((await t.upload({ 'X-GPA-Owner': 'nope' }, MP3, 'x.mp3')).status, 403);
    // The owner (token or owner code) can.
    assert.equal((await t.jsonOf(await t.call('/music/library', { headers: owner }))).canUpload, true);
    const up = await t.jsonOf(await t.upload(owner, MP3, 'Nova - Midnight Drive.mp3', { duration: '187.4' }));
    assert.equal(up.ok, true);
    assert.deepEqual([up.track.title, up.track.artist, up.track.duration, up.track.type], ['Midnight Drive', 'Nova', 187, 'audio/mpeg']);
    const up2 = await t.jsonOf(await t.upload({ 'X-GPA-Owner': 'owner-code-1' }, MP3, 'song.mp3', { title: 'Custom Title', artist: 'DJ Me' }));
    assert.deepEqual([up2.track.title, up2.track.artist], ['Custom Title', 'DJ Me']);
    // Not audio / too big.
    const bad = await t.upload(owner, new TextEncoder().encode('<html>not a song</html>'), 'evil.mp3');
    assert.equal(bad.status, 400);
    const big = await t.upload(owner, new Uint8Array(26 * 1024 * 1024).fill(0x49), 'big.mp3');
    assert.ok([400, 413].includes(big.status));
    // Everyone sees and searches it.
    lib = await t.jsonOf(await t.call('/music/library?user=kj'));
    assert.deepEqual(lib.tracks.map((x) => x.title), ['Custom Title', 'Midnight Drive'], 'newest first');
    assert.deepEqual((await t.jsonOf(await t.call('/music/library?q=nova%20mid'))).tracks.map((x) => x.title), ['Midnight Drive']);
    // Playback: whole file and ranges.
    const id = up.track.id;
    const whole = await t.call('/music/file/' + id + '?user=kj');
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('Accept-Ranges'), 'bytes');
    assert.equal((await whole.arrayBuffer()).byteLength, MP3.length);
    const part = await t.call('/music/file/' + id, { headers: { Range: 'bytes=10-19' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('Content-Range'), `bytes 10-19/${MP3.length}`);
    assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...MP3.slice(10, 20)]);
    const tail = await t.call('/music/file/' + id, { headers: { Range: 'bytes=-5' } });
    assert.deepEqual([...new Uint8Array(await tail.arrayBuffer())], [...MP3.slice(-5)]);
    assert.equal((await t.call('/music/file/' + id, { headers: { Range: 'bytes=99999-' } })).status, 416);
    // Removing.
    assert.equal((await t.call('/music/delete', { method: 'POST', body: JSON.stringify({ id }) })).status, 403);
    assert.equal((await t.call('/music/delete', { method: 'POST', headers: owner, body: JSON.stringify({ id }) })).status, 200);
    assert.equal((await t.call('/music/file/' + id)).status, 404);
    assert.equal(t.env.donnajbe_eaglercraft_client.objs.has('music/' + id), false);
  } finally { t.restore(); }
});

test('music: the allowed-users list applies to listening too', async () => {
  const t = setup();
  try {
    const up = await t.jsonOf(await t.upload(owner, MP3, 'Nova - Midnight Drive.mp3'));
    await t.call('/admin/config', { method: 'POST', headers: { ...owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: true, users: ['kj'] } }) });
    assert.equal((await t.call('/music/search?q=x&user=stranger')).status, 403);
    assert.equal((await t.call('/music/library')).status, 403, 'anonymous refused while the list is on');
    assert.equal((await t.call('/music/file/' + up.track.id + '?user=stranger')).status, 403);
    assert.equal((await t.call('/music/audius/stream/D7KyD?user=stranger')).status, 403);
    assert.equal((await t.call('/music/file/' + up.track.id + '?user=KJ')).status, 403, 'a listed name alone is not enough');
    const reg = await t.jsonOf(await t.call('/auth/register', { method: 'POST', body: JSON.stringify({ user: 'kj', verifier: 'a'.repeat(64) }) }));
    assert.ok(reg.token);
    assert.equal((await t.call('/music/file/' + up.track.id + '?user=KJ&s=' + encodeURIComponent(reg.token))).status, 200, 'listed names in any case, with their session');
  } finally { t.restore(); }
});

test('my music: anyone signed in uploads their own songs; saved to their account; shareable', async () => {
  const t = setup();
  try {
    const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
    const login = async (u) => {
      await t.call('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, verifier: v(u) }) });
      return (await t.jsonOf(await t.call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, verifier: v(u) }) }))).token;
    };
    const kj = await login('kj'), sam = await login('sam');
    assert.ok(kj && sam);
    const up = (tok, user, bytes = MP3, name = 'Nova - Midnight Drive.mp3') => {
      const fd = new FormData();
      fd.append('file', new File([bytes], name, { type: 'audio/mpeg' }));
      fd.append('duration', '187');
      // Encode like a browser does, Content-Length included.
      const enc = new Response(fd);
      return enc.arrayBuffer().then((body) => t.call('/music/mine/upload?user=' + user, { method: 'POST',
        headers: { 'Content-Type': enc.headers.get('Content-Type'), 'Content-Length': String(body.byteLength), ...(tok ? { 'X-GPA-Session': tok } : {}) }, body }));
    };
    // Needs a real sign-in: a typed name alone can't write to someone's music.
    assert.equal((await up(null, 'kj')).status, 401);
    assert.equal((await t.call('/music/mine?user=kj')).status, 401);
    // Upload, then it's listed for kj only.
    const r = await up(kj, 'kj');
    const d = await t.jsonOf(r);
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.equal(d.track.source, 'mine');
    assert.equal(d.track.title, 'Midnight Drive');
    assert.equal(d.track.artist, 'Nova');
    assert.equal(d.track.stream, '/music/file/' + d.track.id);
    assert.equal(d.usage.songs, 1);
    const mine = await t.jsonOf(await t.call('/music/mine?user=kj', { headers: { 'X-GPA-Session': kj } }));
    assert.deepEqual(mine.tracks.map((x) => x.id), [d.track.id]);
    assert.equal(mine.tracks[0].owner, 'kj');
    // A new sign-in (another device) still sees it.
    const kj2 = (await t.jsonOf(await t.call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'kj', verifier: v('kj') }) }))).token;
    assert.equal((await t.jsonOf(await t.call('/music/mine?user=kj', { headers: { 'X-GPA-Session': kj2 } }))).tracks.length, 1);
    // Sam's list is separate, and asking for kj's with sam's session gives sam's.
    assert.equal((await t.jsonOf(await t.call('/music/mine?user=kj', { headers: { 'X-GPA-Session': sam } }))).tracks.length, 0);
    // It isn't in the shared library...
    assert.equal((await t.jsonOf(await t.call('/music/library?user=sam'))).tracks.length, 0);
    // ...but anyone it's shared with can stream it (with seeking).
    const range = await t.call(d.track.stream + '?user=sam', { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    // Not audio is refused; the per-person cap holds.
    assert.equal((await up(kj, 'kj', new TextEncoder().encode('<html>'), 'x.mp3')).status, 400);
    // Sam can't delete kj's song; kj can.
    const del = (tok, user, id) => t.call('/music/mine/delete?user=' + user, { method: 'POST', headers: { 'X-GPA-Session': tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    assert.equal((await del(sam, 'sam', d.track.id)).status, 404);
    assert.ok(t.env.donnajbe_eaglercraft_client.objs.has('music/' + d.track.id));
    assert.equal((await del(kj, 'kj', d.track.id)).status, 200);
    assert.ok(!t.env.donnajbe_eaglercraft_client.objs.has('music/' + d.track.id));
    assert.equal((await t.jsonOf(await t.call('/music/mine?user=kj', { headers: { 'X-GPA-Session': kj } }))).tracks.length, 0);
    assert.equal(t.env.TELEMETRY.store.get('mylib:total'), '0');
    // The owner can remove anyone's upload.
    const again = await t.jsonOf(await up(kj, 'kj'));
    assert.equal((await t.call('/music/mine/delete?user=sam', { method: 'POST', headers: { 'X-GPA-Session': sam, 'X-GPA-Owner': 'owner-code-1', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: again.track.id }) })).status, 200);
    assert.equal((await t.jsonOf(await t.call('/music/mine?user=kj', { headers: { 'X-GPA-Session': kj } }))).tracks.length, 0);
  } finally { t.restore(); }
});

test('my music: rename a song (title, artist, file name); downloads use the file name', async () => {
  const t = setup();
  try {
    const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
    const login = async (u) => {
      await t.call('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, verifier: v(u) }) });
      return (await t.jsonOf(await t.call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, verifier: v(u) }) }))).token;
    };
    const kj = await login('kj'), sam = await login('sam');
    const fd = new FormData();
    fd.append('file', new File([MP3], 'Grupo Frontera, Fuerza Regida - COQUETA (Letra Oficial).mp3', { type: 'audio/mpeg' }));
    const enc = new Response(fd);
    const body = await enc.arrayBuffer();
    const up = await t.jsonOf(await t.call('/music/mine/upload?user=kj', { method: 'POST', headers: { 'Content-Type': enc.headers.get('Content-Type'), 'Content-Length': String(body.byteLength), 'X-GPA-Session': kj }, body }));
    assert.equal(up.track.file, 'Grupo Frontera, Fuerza Regida - COQUETA (Letra Oficial).mp3');
    assert.equal(up.track.artist, 'Grupo Frontera, Fuerza Regida');
    const edit = (tok, user, fields) => t.call('/music/mine/edit?user=' + user, { method: 'POST', headers: { 'X-GPA-Session': tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: up.track.id, ...fields }) });
    const r = await t.jsonOf(await edit(kj, 'kj', { title: 'Coqueta', artist: 'Grupo Frontera & Fuerza Regida', file: 'coqueta/final:.wav' }));
    assert.equal(r.ok, true);
    assert.equal(r.track.title, 'Coqueta');
    assert.equal(r.track.artist, 'Grupo Frontera & Fuerza Regida');
    assert.equal(r.track.file, 'coqueta final.mp3', 'no slashes; the extension matches the audio');
    const mine = await t.jsonOf(await t.call('/music/mine?user=kj', { headers: { 'X-GPA-Session': kj } }));
    assert.equal(mine.tracks[0].title, 'Coqueta');
    assert.equal((await t.jsonOf(await edit(kj, 'kj', { title: '  ' }))).ok, false, 'a song needs a name');
    assert.equal((await edit(sam, 'sam', { title: 'mine now' })).status, 404, 'not someone else’s');
    assert.equal((await edit(null, 'kj', { title: 'x' })).status, 401, 'signed in only');
    // Download with the name.
    const dl = await t.call('/music/file/' + up.track.id + '?user=sam&dl=' + encodeURIComponent('coqueta final.mp3'));
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-disposition'), /attachment; filename="coqueta final\.mp3"/);
    // Shared library: owner and admins only.
    const lib = await t.jsonOf(await t.upload(owner, MP3, 'Nova - Midnight Drive.mp3'));
    const le = (h) => t.call('/music/edit', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lib.track.id, title: 'Midnight Drive (Remix)' }) });
    assert.equal((await le({ 'X-GPA-Session': kj })).status, 403);
    assert.equal((await t.jsonOf(await le(owner))).track.title, 'Midnight Drive (Remix)');
  } finally { t.restore(); }
});

test('my music: the owner with Admin connected (admin token + session) can upload', async () => {
  const t = setup();
  try {
    const v = 'b'.repeat(64);
    await t.call('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'boss', verifier: v }) });
    const tok = (await t.jsonOf(await t.call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'boss', verifier: v }) }))).token;
    const send = async (headers) => {
      const fd = new FormData();
      fd.append('file', new File([MP3], 'A - B.mp3', { type: 'audio/mpeg' }));
      const enc = new Response(fd);
      const body = await enc.arrayBuffer();
      return t.call('/music/mine/upload?user=boss', { method: 'POST', headers: { 'Content-Type': enc.headers.get('Content-Type'), 'Content-Length': String(body.byteLength), ...headers }, body });
    };
    assert.equal((await send({ 'X-GPA-Session': tok, ...owner })).status, 200, 'session + admin token');
    assert.equal((await send({ 'X-GPA-Owner': 'owner-code-1' })).status, 200, 'owner code alone');
    assert.equal((await send({ 'X-GPA-Owner': 'wrong' })).status, 401);
    assert.equal((await t.jsonOf(await t.call('/music/mine?user=boss', { headers: { 'X-GPA-Session': tok, ...owner } }))).tracks.length, 2);
  } finally { t.restore(); }
});
