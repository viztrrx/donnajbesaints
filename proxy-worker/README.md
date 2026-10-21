# Saints Proxy Worker (`saints-proxy-test`)

A **restricted multi-site proxy** on Cloudflare Workers for [Saints Service](https://github.com/viztrrx/work-service)'s Proxy tab. It opens **only the HTTPS sites you approve** in its configuration, for reading (GET/HEAD). It is **not** an unrestricted web proxy, and not a Scramjet/Ultraviolet-style browser: anything not on the approved list is refused.

Only approve sites you **own or are authorized to proxy**.

## Deploy (Cloudflare Builds)

1. Cloudflare → **Workers & Pages** → the Worker connected to `viztrrx/work-service`, branch `main` (do **not** reconnect the `donnajbe` Worker).
2. Root `./`, deploy command:
   ```sh
   npx wrangler deploy --config proxy-worker/wrangler.jsonc
   ```
3. URL: `https://saints-proxy-test.viztrrx.workers.dev`.

The root `wrangler.jsonc` / `worker.js` (the `donnajbe` Worker) are separate and unaffected; it keeps deploying with `npx wrangler deploy`.

## Approving sites

Edit `TARGET_ORIGINS` in `proxy-worker/wrangler.jsonc` (then push to `main`; Cloudflare redeploys):

```jsonc
"vars": {
  "TARGET_ORIGINS": "https://example.com https://www.my-site.org https://docs.my-site.org"
}
```

- Separate with spaces, commas or new lines. Each must be a plain `https://host` (no path, port, query or `user@`).
- Each subdomain is its own entry (`www.my-site.org` ≠ `my-site.org`).
- Common YouTube hostnames are included in the default approved list: `youtube.com`, `www.youtube.com`, `m.youtube.com`, and `youtu.be`. This allows these destinations but does **not** make YouTube's complex browser app, login, or video playback fully compatible with this lightweight proxy. Use YouTube's official embed mechanism where permitted, and respect its embedding restrictions.
- Refused automatically (and counted as `invalid` in `/health`): `http://`, IP addresses (v4/v6/decimal/hex), `localhost`, bare names without a dot, `.local` / `.internal` / `.lan` / `.home.arpa` / `.intranet`, cloud metadata names.
- `TARGET_ORIGIN` (the old single-site variable) still works and is merged in.
- Values set in `wrangler.jsonc` overwrite dashboard values on each deploy, so keep the list in the file.

Optional:

| Variable | Effect |
|---|---|
| `PROXY_KEY` | `/site/` and `/status/` need `?k=<key>`; the Proxy tab sends it when you enter it under **Connection settings → Proxy access key**. A soft gate: the key travels in URLs, so it keeps casual visitors out but is not a strong secret. Set it as a **Secret** in the dashboard, never in git. |
| `RATE_PER_MIN` | Soft per-IP limit on `/site/` (default 240). |

## YouTube compatibility (iPhone/Safari)

The full YouTube application depends on JavaScript requests, storage and player
services that this minimal HTML proxy does not emulate. Simply adding
`youtube.com` to `TARGET_ORIGINS` caused YouTube to display its misleading
“Connect to the internet” screen even when the device was online.

For **approved** YouTube hostnames, this Worker now responds with its own
transparent compatibility view **before** attempting to fetch the YouTube SPA:

- `/site/www.youtube.com/watch?v=VIDEO_ID`, `/site/m.youtube.com/watch?v=VIDEO_ID`,
  `/site/youtube.com/shorts/VIDEO_ID`, and `/site/youtu.be/VIDEO_ID`
  use YouTube's **official iframe player** for a valid 11-character video ID.
- YouTube home/search/other pages display a clear explanation and an
  **Open on YouTube** link instead of a false network-offline message.
- `/status/` reports an `official-embed` or `external-open` mode, so the
  Saints Service tab does not report a failed upstream HEAD request for a
  page which the Worker itself is serving.

The Saints Service client gives only these Worker-generated, validated video
pages a separate iframe sandbox policy allowing YouTube's official player to
use its origin. All other proxied pages retain their original opaque sandbox.
The official embed can still be blocked by YouTube's embedding rules, iOS
Safari's browser policies, or the host website's CSP. A direct-open
link is always present. This does not circumvent embedding restrictions or
provide a full YouTube proxy. The Worker-generated video page uses
`strict-origin-when-cross-origin` to satisfy YouTube's documented embed
identification requirement. No YouTube account credentials are proxied.

## Routes

| Route | What it does |
|---|---|
| `/health` | `{status, service, targets:[host…], invalid}`; `Access-Control-Allow-Origin: *` (nothing private) |
| `/`, `/preview` | Connection-test page listing the approved sites |
| `/site/<host>/<path>?<query>` | The approved site `<host>`, rebuilt strictly on `https://<host>` |
| `/status/<host>/<path>` | `{outcome, status, host}` for that page (HEAD; **no page content**), so the Proxy tab can say "website down", "HTTP 404", "timed out", "redirect not permitted" |

## Security

- **Exact host allowlist.** `/site/<host>/…` must name an approved host exactly; the target URL is rebuilt on that origin and refused if the path/query would move it anywhere else (`//other.host`, `user@host`, encoded dots, `..`, look-alike hosts). Tests: `tests/proxy-worker.test.mjs`.
- **No private destinations.** IP literals, loopback, private/internal names and metadata hosts are rejected in config and per request. Cloudflare Workers can't see the IP a name resolves to, so DNS rebinding to private addresses can't be checked here. On Cloudflare's network, a Worker's `fetch()` goes out to the public internet and can't reach private networks, and the allowlist names only public sites you control.
- **Redirects** are followed only to an approved origin (rewritten to `/site/<host>/…`); anything else gets a 403 page. 304/300 pass through unchanged.
- **No credentials** go to sites: only `accept`, `accept-language`, `if-none-match`, `if-modified-since` and `range` are forwarded. `Set-Cookie` and `Strict-Transport-Security` are removed from responses. Upstream `Content-Security-Policy` and framing headers are **kept** (not bypassed).
- **Limits:** GET/HEAD only; 12 s upstream timeout (504 page); 12 MB response cap (413 or the stream stops); soft per-IP rate limit (Cache API, best-effort across Cloudflare's isolates).
- **Own pages** (preview, errors) have a no-scripts CSP and HTML-escaped text.
- **In Saints Service** the frame is sandboxed **without `allow-same-origin`**. Every proxied page runs in its own opaque origin, so approved sites can't read each other's (or the Worker's) storage or cookies. It is also sandboxed without top-navigation, so a page can't take over the website around the console. No referrer is sent.

## Compatibility (what works, what doesn't)

Tested with local fixtures in the real Workers runtime (`tests/browser/proxy.mjs`). Live sites were not tested from the build container, which has no internet.

| Works | |
|---|---|
| HTML pages, relative and absolute links on approved sites, query strings and `#fragments` | ✅ rewritten to `/site/<host>/…` by Cloudflare's streaming `HTMLRewriter` |
| `<img src/srcset>`, `<source>`, `<video>/<audio src>`, `poster`, `<link href>` (CSS), `<script src>`, `<iframe src>` | ✅ |
| Clicking links inside the page; links to another approved site | ✅ |
| Redirects within approved sites | ✅ |
| Media seeking (`Range` is forwarded) | ✅ |
| Caching | Upstream `Cache-Control` / `ETag` pass through, so the browser caches static files as the site intends |

| Doesn't work (by design or not safely possible here) | Why |
|---|---|
| Forms that POST, sign-ins, anything needing cookies | GET/HEAD only; cookies are never forwarded or kept |
| `url(...)` inside CSS files, `@import`, fonts referenced from CSS | CSS isn't rewritten. Root-relative URLs (`/x.png`) resolve to the Worker, not the site; same-folder relative ones (`img/x.png`) work |
| JavaScript `fetch()` / XHR, single-page apps, `history.pushState` routing | Scripts aren't rewritten. Calls to the site's own absolute URLs leave the proxy and, from the sandboxed frame, usually fail CORS |
| Sites that use `localStorage`, `sessionStorage`, IndexedDB or cookies in JS | Blocked by the isolation sandbox (each page has an opaque origin) |
| WebSockets | Not implemented |
| Resources on other hosts (CDNs, fonts, analytics) | Loaded directly from those hosts (not proxied) unless you approve them too |
| Sites that forbid framing (`X-Frame-Options`, `frame-ancestors`) | Kept as the site intends, so they show the browser's "refused to connect" page; use **Open in a new tab** |
| The tab's address bar after clicking links inside the page | It shows the last address you opened from the bar (the page is another origin and can't be observed) |

**Compared with full browser-rewriting proxies** (e.g. Scramjet, Ultraviolet): those run a service worker in your browser and rewrite JavaScript, so they can handle SPAs, `fetch`, cookies and WebSockets for many sites. That is a much larger system with its own server, licensing and security model. This Worker deliberately stays small, server-side and allowlist-only. If you adopt one of those projects, check its license and documentation in its own repository first (this build container couldn't reach GitHub to verify them).

## Local checks

```sh
node --check proxy-worker/index.js
npx wrangler deploy --dry-run --config proxy-worker/wrangler.jsonc
node --test tests/proxy-worker.test.mjs     # allowlist, SSRF tricks, redirects, rewriting, /status/, key, limits
node tests/browser/proxy.mjs out/           # the Proxy tab against this Worker run locally, with HTTPS fixture sites
```

`tests/browser/proxy.mjs` runs `tests/browser/fixtures/proxy-sites/setup.sh`, which, **in a disposable test container as root**, makes a throwaway CA, trusts it, and maps `fixture.saints-test.dev` / `docs.saints-test.dev` to 127.0.0.1 (serving them on :443). It runs this Worker locally with `compatibilityDate: 2026-10-01`, because `wrangler.jsonc`'s `2026-10-19` is newer than the repo's local workerd supports (Cloudflare itself accepts it).
