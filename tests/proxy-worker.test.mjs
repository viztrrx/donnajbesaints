// The separate saints-proxy-test Worker (proxy-worker/index.js), run in Node
// with a stubbed upstream. Workers' HTMLRewriter isn't in Node, so link
// rewriting is exercised through a minimal stand-in that calls the Worker's
// own element handlers on each matching tag (the real rewriter runs in
// tests/browser/proxy.mjs, in workerd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../proxy-worker/index.js';
import { NAV_REPORT, NAV_REPORT_JS, NAV_REPORT_HASH } from '../proxy-worker/nav.js';

const W = 'https://saints-proxy-test.viztrrx.workers.dev';
const env = { TARGET_ORIGINS: 'https://example.com, https://docs.example.org' };
const call = (p, init = {}, e = env) => worker.fetch(new Request(W + p, init), e);

function stubUpstream(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => { seen.push({ url: String(url), init }); return handler(String(url), init); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

// Minimal HTMLRewriter stand-in: for each `tag[attr]` selector, finds those
// tags and runs the handler with getAttribute/setAttribute on that attribute.
class FakeRewriter {
  constructor() { this.rules = []; this.ends = []; }
  onDocument(handler) { if (handler.end) this.ends.push(handler.end); return this; }
  on(selector, handler) { const m = /^(\w+)\[(\w+)\]$/.exec(selector); this.rules.push({ tag: m[1], attr: m[2], handler }); return this; }
  transform(res) {
    const rules = this.rules;
    const body = res.text().then((html) => html.replace(/<(\w+)\b([^>]*)>/g, (all, tag, attrs) => {
      let out = attrs;
      for (const r of rules) {
        if (r.tag !== tag.toLowerCase()) continue;
        const re = new RegExp('(\\s' + r.attr + '=")([^"]*)(")', 'i');
        const m = re.exec(out);
        if (!m) continue;
        let val = m[2];
        r.handler.element({ getAttribute: () => m[2], setAttribute: (_n, v) => { val = v; } });
        out = out.replace(re, (_a, p1, _p2, p3) => p1 + val + p3);
      }
      return '<' + tag + out + '>';
    })).then((html) => { let tail = ''; for (const end of this.ends) end({ append: (c) => { tail += c; } }); return html + tail; });
    return body.then((b) => new Response(b, { status: res.status, headers: res.headers }));
  }
}

test('proxy: health lists every approved site (CORS); preview links them; config is validated', async () => {
  const h = await call('/health');
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await h.json(), { status: 'ok', service: 'saints-proxy-test', targets: ['example.com', 'docs.example.org'], invalid: 0 });
  // Back-compat: the old single TARGET_ORIGIN still works.
  assert.deepEqual((await (await call('/health', {}, { TARGET_ORIGIN: 'https://example.com' })).json()).targets, ['example.com']);
  // Unsafe entries are dropped (and counted): http, IP literals, localhost,
  // private/internal names, metadata, ports, paths, credentials.
  const bad = { TARGET_ORIGINS: [
    'http://plain.example.com', 'https://127.0.0.1', 'https://10.0.0.5', 'https://[::1]', 'https://2130706433',
    'https://localhost', 'https://printer.local', 'https://db.internal', 'https://metadata.google.internal',
    'https://example.com:8443', 'https://example.com/path', 'https://user:pw@example.com', 'https://intranet',
    'https://good.example.net'].join(' ') };
  const hb = await (await call('/health', {}, bad)).json();
  assert.deepEqual(hb.targets, ['good.example.net'], 'only the safe public https origin survives');
  assert.equal(hb.invalid, 13);
  const none = await call('/health', {}, { TARGET_ORIGINS: 'https://localhost' });
  assert.equal(none.status, 500);
  // The preview lists the approved sites as /site/<host>/ links, with no
  // scripts but the address report the CSP allows by its exact hash.
  const pv = await call('/preview');
  assert.match(pv.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(NAV_REPORT_HASH, "'sha256-" + createHash('sha256').update(NAV_REPORT_JS).digest('base64') + "'");
  assert.ok(pv.headers.get('content-security-policy').includes("script-src " + NAV_REPORT_HASH + ";"));
  const pvHtml = await pv.text();
  assert.equal(pvHtml.split('<script').length - 1, 1);
  assert.ok(pvHtml.includes(NAV_REPORT + '</body>'));
  assert.match(pvHtml, /href="\/site\/example\.com\/"/);
  assert.match(pvHtml, /href="\/site\/docs\.example\.org\/"/);
  // /site/ alone goes to the first approved site.
  const site = await call('/site/');
  assert.equal(site.status, 302);
  assert.equal(site.headers.get('location'), W + '/site/example.com/');
});

test('proxy: YouTube public hosts need exact host authorization', async () => {
  const youtubeEnv = { TARGET_ORIGINS: 'https://example.com https://youtube.com https://www.youtube.com https://m.youtube.com https://youtu.be' };
  const health = await (await call('/health', {}, youtubeEnv)).json();
  assert.deepEqual(health.targets, ['example.com', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
  const up = stubUpstream(async (href) => href === 'https://youtube.com/'
    ? new Response(null, { status: 301, headers: { location: 'https://www.youtube.com/' } })
    : new Response('test', { headers: { 'content-type': 'text/plain' } }));
  try {
    let res = await call('/site/youtube.com/', {}, youtubeEnv);
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), W + '/site/www.youtube.com/');
    for (const host of ['www.youtube.com', 'm.youtube.com', 'youtu.be']) {
      res = await call('/site/' + host + '/', {}, youtubeEnv);
      assert.equal(res.status, 200, host);
      assert.equal(up.seen.at(-1).url, 'https://' + host + '/');
    }
    const count = up.seen.length;
    assert.equal((await call('/site/accounts.google.com/', {}, youtubeEnv)).status, 403);
    assert.equal((await call('/site/notyoutube.com/', {}, youtubeEnv)).status, 403);
    assert.equal(up.seen.length, count, 'nonapproved hosts cannot be fetched');
  } finally { up.restore(); }
});

test('proxy: each approved site by host; anything else refused before any request', async () => {
  const up = stubUpstream(async () => new Response('plain', { headers: { 'content-type': 'text/plain', 'set-cookie': 'a=1', 'content-security-policy': "frame-ancestors 'self'", 'strict-transport-security': 'max-age=1' } }));
  try {
    let r = await call('/site/example.com/path?q=1', { headers: { cookie: 'saints=secret', authorization: 'Bearer x', 'accept-language': 'en' } });
    assert.equal(r.status, 200);
    assert.equal(up.seen.at(-1).url, 'https://example.com/path?q=1');
    const sent = up.seen.at(-1).init.headers;
    assert.equal(sent.get('cookie'), null, 'cookies never forwarded');
    assert.equal(sent.get('authorization'), null, 'credentials never forwarded');
    assert.equal(sent.get('accept-language'), 'en');
    assert.equal(r.headers.get('set-cookie'), null, 'upstream cookies dropped');
    assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'self'", 'upstream framing rules kept, not bypassed');
    r = await call('/site/docs.example.org/guide');
    assert.equal(r.status, 200);
    assert.equal(up.seen.at(-1).url, 'https://docs.example.org/guide', 'the second approved site');
    r = await call('/site/EXAMPLE.com/');
    assert.equal(up.seen.at(-1).url, 'https://example.com/', 'host match is case-insensitive');
    // Hosts and tricks that must never reach the network.
    const before = up.seen.length;
    const tricks = ['/site/evil.example/', '/site/example.com.evil.example/', '/site/example.com@evil.example/',
      '/site/127.0.0.1/', '/site/localhost/', '/site/169.254.169.254/latest/meta-data/', '/site/metadata.google.internal/',
      '/site/example.com//evil.example/x', '/site/example%2Ecom/', '/site/example.com/..//evil.example/',
      '/site/www.example.com/'];
    for (const p of tricks) {
      const t = await call(p);
      assert.ok([403, 404].includes(t.status), p + ' → ' + t.status);
    }
    assert.equal(up.seen.length, before, 'none of those made an upstream request');
    const f = await call('/site/evil.example/');
    assert.match(await f.text(), /opens only: example\.com, docs\.example\.org/);
    // Only GET/HEAD.
    assert.equal((await call('/site/example.com/', { method: 'POST', body: 'x' })).status, 405);
    assert.equal((await call('/site/example.com/', { method: 'HEAD' })).status, 200);
  } finally { up.restore(); }
});

test('proxy: redirects only to approved sites; odd 3xx pass; size, timeout and errors are handled', async () => {
  let next = null;
  const up = stubUpstream(async (u, init) => next(u, init));
  try {
    next = () => new Response(null, { status: 301, headers: { location: '/moved?a=1' } });
    let r = await call('/site/example.com/old');
    assert.deepEqual([r.status, r.headers.get('location')], [301, W + '/site/example.com/moved?a=1']);
    next = () => new Response(null, { status: 302, headers: { location: 'https://docs.example.org/x' } });
    r = await call('/site/example.com/old');
    assert.deepEqual([r.status, r.headers.get('location')], [302, W + '/site/docs.example.org/x'], 'to another approved site: allowed, rewritten');
    for (const loc of ['https://evil.example/', 'http://example.com/', 'https://127.0.0.1/', 'https://localhost/', 'javascript:alert(1)']) {
      next = () => new Response(null, { status: 302, headers: { location: loc } });
      r = await call('/site/example.com/old');
      assert.equal(r.status, 403, 'redirect to ' + loc);
    }
    next = () => new Response(null, { status: 304 });
    assert.equal((await call('/site/example.com/', { headers: { 'if-none-match': '"x"' } })).status, 304);
    next = () => new Response('choose', { status: 300 });
    assert.equal((await call('/site/example.com/')).status, 300);
    // A declared-too-large body is refused up front.
    next = () => new Response('x', { headers: { 'content-type': 'application/octet-stream', 'content-length': String(50 * 1024 * 1024) } });
    r = await call('/site/example.com/big.bin');
    assert.equal(r.status, 413);
    // Timeout → 504 with a readable page; other failures → 502.
    next = () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
    r = await call('/site/example.com/');
    assert.equal(r.status, 504);
    assert.match(await r.text(), /didn&#39;t answer within 12 seconds/);
    next = () => { throw new Error('down'); };
    r = await call('/site/example.com/');
    assert.equal(r.status, 502);
    assert.match(r.headers.get('content-type'), /text\/html/);
    // The upstream fetch always gets a timeout signal and manual redirects.
    next = () => new Response('ok');
    await call('/site/example.com/');
    assert.equal(up.seen.at(-1).init.redirect, 'manual');
    assert.ok(up.seen.at(-1).init.signal, 'a timeout signal is attached');
  } finally { up.restore(); }
});

test('proxy: links, images, srcset and scripts on approved sites go through /site/<host>/; others stay', async () => {
  globalThis.HTMLRewriter = FakeRewriter;
  const html = [
    '<a href="https://example.com/more?x=1#top">more</a>', '<a href="/rel">rel</a>', '<a href="sub/page">relative</a>',
    '<a href="https://docs.example.org/g">docs</a>', '<a href="https://www.iana.org/x">iana</a>',
    '<img src="/logo.png">', '<img srcset="/a.png 1x, https://example.com/b.png 2x">',
    '<script src="/app.js"></script>', '<link href="/style.css">', '<a href="#frag">f</a>', '<a href="javascript:alert(1)">j</a>',
    '<a href="mailto:a@b.c">m</a>'].join('');
  const up = stubUpstream(async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    const out = await (await call('/site/example.com/dir/index.html')).text();
    const has = (s) => assert.ok(out.includes(s), 'expected ' + s);
    has(`href="${W}/site/example.com/more?x=1#top"`);
    has(`href="${W}/site/example.com/rel"`);
    has(`href="${W}/site/example.com/dir/sub/page"`);
    has(`href="${W}/site/docs.example.org/g"`);
    has('href="https://www.iana.org/x"');
    has(`src="${W}/site/example.com/logo.png"`);
    has(`srcset="${W}/site/example.com/a.png 1x, ${W}/site/example.com/b.png 2x"`);
    has(`src="${W}/site/example.com/app.js"`);
    has(`href="${W}/site/example.com/style.css"`);
    has('href="#frag"');
    has('href="javascript:alert(1)"');
    has('href="mailto:a@b.c"');
    // The page reports its own address to the Proxy tab (for Back / Forward).
    assert.ok(out.endsWith(NAV_REPORT), 'the address report is appended');
  } finally { up.restore(); delete globalThis.HTMLRewriter; }
});

test('proxy: optional access key gates /site/ (and rides along in rewritten links)', async () => {
  const keyed = { ...env, PROXY_KEY: 'sesame' };
  const up = stubUpstream(async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }));
  try {
    assert.equal((await call('/site/example.com/', {}, keyed)).status, 401);
    assert.equal((await call('/site/example.com/?k=wrong', {}, keyed)).status, 401);
    const ok = await call('/site/example.com/p?a=1&k=sesame', {}, keyed);
    assert.equal(ok.status, 200);
    assert.equal(up.seen.at(-1).url, 'https://example.com/p?a=1', 'the key is not sent to the site');
    assert.equal((await call('/preview', {}, keyed)).status, 200, 'the connection test stays open');
    assert.equal((await call('/health', {}, keyed)).status, 200);
  } finally { up.restore(); }
});

test('proxy: /status/ reports only status + outcome (never page content), with the same refusals', async () => {
  let next = null;
  const up = stubUpstream(async (u, init) => next(u, init));
  try {
    const st = async (p, e = env) => { const r = await call('/status/' + p, {}, e); return { code: r.status, cors: r.headers.get('access-control-allow-origin'), ...(await r.json()) }; };
    next = (u, init) => { assert.equal(init.method, 'HEAD', 'status checks use HEAD'); return new Response('SECRET PAGE BODY', { status: 200 }); };
    let s = await st('example.com/page');
    assert.deepEqual([s.outcome, s.status, s.host, s.cors], ['ok', 200, 'example.com', '*']);
    assert.ok(!JSON.stringify(s).includes('SECRET'), 'no page content');
    next = () => new Response(null, { status: 404 });
    s = await st('docs.example.org/missing');
    assert.deepEqual([s.outcome, s.status], ['http-error', 404]);
    next = () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
    assert.equal((await st('example.com/r')).outcome, 'redirect-blocked');
    next = () => new Response(null, { status: 302, headers: { location: '/fine' } });
    assert.equal((await st('example.com/r')).outcome, 'redirect');
    next = () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
    assert.equal((await st('example.com/')).outcome, 'timeout');
    next = () => { throw new Error('down'); };
    assert.equal((await st('example.com/')).outcome, 'unreachable');
    const before = up.seen.length;
    for (const p of ['evil.example/', '127.0.0.1/', 'example.com//evil.example/x', 'localhost/']) {
      const r = await st(p);
      assert.deepEqual([r.code, r.outcome], [403, 'not-permitted'], p);
    }
    assert.equal(up.seen.length, before, 'refused checks never reach the network');
    assert.equal((await st('example.com/', { ...env, PROXY_KEY: 'k1' })).outcome, 'key-required');
  } finally { up.restore(); }
});

test('proxy: the start page has a search box; /go opens what was typed when it names an approved site', async () => {
  const pv = await call('/preview');
  assert.match(pv.headers.get('content-security-policy'), /form-action 'self'/);
  const html = await pv.text();
  assert.match(html, /<form action="\/go" method="get" role="search">/);
  assert.match(html, /<input name="q"/);
  for (const [typed, to] of [['example.com', '/site/example.com/'], ['https://example.com/a?b=1', '/site/example.com/a?b=1'], ['www.example.com/x', '/site/example.com/x'], ['example', '/site/example.com/'], ['docs.example.org', '/site/docs.example.org/'], ['http://example.com/', '/site/example.com/']]) {
    const r = await call('/go?q=' + encodeURIComponent(typed));
    assert.equal(r.status, 200, typed);
    assert.equal(r.headers.get('refresh'), '1;url=' + to, typed);
    assert.ok((await r.text()).endsWith(NAV_REPORT + '</body>\n</html>'), 'the page reports what was typed (its own address) to the tab');
  }
  for (const typed of ['google.com', 'best restaurants near me', 'example.com.evil.test', 'https://example.com:8443/', 'javascript:alert(1)', 'localhost']) {
    const r = await call('/go?q=' + encodeURIComponent(typed));
    assert.equal(r.status, 404, typed);
    assert.equal(r.headers.get('refresh'), null, typed);
    const body = await r.text();
    assert.ok(body.includes('an approved site') && body.includes('<form action="/go"'), typed);
  }
  assert.equal((await call('/go?q=')).status, 400);
  // What was typed is escaped back into the form.
  assert.ok((await (await call('/go?q=' + encodeURIComponent('"><script>x</script>'))).text()).includes('value="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
});
