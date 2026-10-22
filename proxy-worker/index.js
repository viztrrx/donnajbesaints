/**
 * Saints Service — restricted multi-site proxy (Cloudflare Workers).
 *
 * This is NOT an unrestricted web proxy / Scramjet replacement. It fetches
 * ONLY the HTTPS origins the operator explicitly approved in configuration
 * (TARGET_ORIGINS), and only GET/HEAD. Everything else is refused. It is
 * meant for sites you own or are authorized to proxy.
 *
 * Config (Cloudflare → the Worker → Settings → Variables):
 *   TARGET_ORIGINS  Approved HTTPS origins, comma / space / newline
 *                   separated, e.g. "https://example.com https://www.iana.org".
 *   TARGET_ORIGIN   Back-compat: a single origin (folded into the list).
 *   PROXY_KEY       Optional. If set, /site/ requests must carry ?k=<key>
 *                   (a soft gate; the key rides in the URL, so it is not a
 *                   real secret — the allowlist is the actual control).
 *   RATE_PER_MIN    Optional soft per-IP limit for /site/ (default 240).
 *
 * Routing:
 *   /health            JSON {status, service, targets:[host…]} (CORS-readable)
 *   / , /preview       the Worker's own connection-test page
 *   /site/<host>/<...> the approved site <host>, rebuilt path/query/fragment
 *
 * Security summary: exact-match host allowlist (crafted paths/queries can't
 * change the host); IP-literal, loopback, private-range and metadata hosts
 * are rejected at config time and per request; redirects must land on an
 * approved origin; response size and upstream time are capped; cookies and
 * request credentials are never forwarded; the Worker's own pages carry a
 * CSP that allows no scripts but the one-line address report (nav.js).
 */
import { youtubeMode, youtubeResponse } from "./youtube.js";
import { NAV_REPORT, NAV_REPORT_HASH } from "./nav.js";

const DEFAULT_ORIGINS = "https://example.com";
const MAX_BYTES = 12 * 1024 * 1024;      // cap on a proxied response body
const UPSTREAM_TIMEOUT_MS = 12000;
const DEFAULT_RATE_PER_MIN = 240;

// Hostnames that must never be fetched, even if someone lists them: loopback,
// link-local, cloud metadata, and private / internal names. IP literals are
// rejected wholesale (an approved destination is a real public hostname).
const BLOCKED_EXACT = new Set([
  "localhost", "ip6-localhost", "ip6-loopback",
  "metadata", "metadata.google.internal", "metadata.goog",
  "instance-data", "instance-data.ec2.internal",
]);
const BLOCKED_SUFFIX = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa"];

function isIpLiteral(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;          // IPv4
  if (hostname.includes(":")) return true;                            // IPv6
  if (/^\[.*\]$/.test(hostname)) return true;                         // bracketed IPv6
  if (/^0x[0-9a-f]+$/i.test(hostname) || /^\d+$/.test(hostname)) return true; // decimal/hex IPv4
  return false;
}
function hostnameBlocked(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h || isIpLiteral(h)) return true;
  if (BLOCKED_EXACT.has(h)) return true;
  if (BLOCKED_SUFFIX.some((s) => h.endsWith(s))) return true;
  if (!h.includes(".")) return true;                                  // bare host (no public TLD)
  return false;
}

// Parse TARGET_ORIGINS / TARGET_ORIGIN into a validated host→origin Map.
function allowedOrigins(env) {
  const raw = [(env && env.TARGET_ORIGINS) || "", (env && env.TARGET_ORIGIN) || ""].join(" ");
  const parts = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const list = parts.length ? parts : [DEFAULT_ORIGINS];
  const map = new Map();
  const bad = [];
  for (const item of list) {
    let u;
    try { u = new URL(item); } catch { bad.push(item); continue; }
    if (u.protocol !== "https:" || u.username || u.password ||
        (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash ||
        u.port || !u.hostname || hostnameBlocked(u.hostname)) { bad.push(item); continue; }
    map.set(u.hostname.toLowerCase(), u.origin);
  }
  return { map, bad };
}

// No scripts, except the one-line address report (by hash; see nav.js).
const OWN_PAGE_CSP = "default-src 'none'; script-src " + NAV_REPORT_HASH + "; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'";

function page(html, status = 200, extraHeaders = {}) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": OWN_PAGE_CSP,
      ...extraHeaders,
    },
  });
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function shell(title, bodyHtml, status = 200, extraHeaders = {}) {
  return page(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Saints Proxy — ${esc(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui,-apple-system,sans-serif; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#10131b; color:#f4f6ff; }
    main { box-sizing:border-box; width:min(90vw,520px); border:1px solid #343b50; border-radius:18px; padding:28px; background:#181e2b; }
    .ok { color:#93e6b1; font-weight:700; } .bad { color:#ff9a9a; font-weight:700; }
    h1 { font-size:20px; } p { color:#bdc9dc; line-height:1.6; }
    a { color:#a9c4ff; } ul { padding-left:18px; } li { margin:4px 0; }
  </style>
</head>
<body><main>${bodyHtml}</main>${NAV_REPORT}</body>
</html>`, status, extraHeaders);
}

function preview(hosts) {
  const list = hosts.length
    ? `<p>Approved sites:</p><ul>${hosts.map((h) => `<li><a href="/site/${esc(h)}/">${esc(h)}</a></li>`).join("")}</ul>`
    : `<p>No sites are approved yet. Set <code>TARGET_ORIGINS</code> on the Worker.</p>`;
  return shell("connection test", `<div class="ok">● Cloudflare Worker connected</div>
    <h1>Saints Proxy Test</h1>
    <p>This restricted proxy opens only the sites approved on the Worker, through the Saints Service Proxy tab.</p>
    ${list}`);
}
function errorPage(status, title, detail) {
  return shell(title, `<div class="bad">● ${esc(title)}</div><p>${esc(detail)}</p><p><a href="/preview">Back to the connection test</a></p>`, status);
}

const REWRITE_ATTRS = [["a[href]", "href"], ["area[href]", "href"], ["img[src]", "src"],
  ["img[srcset]", "srcset"], ["source[src]", "src"], ["source[srcset]", "srcset"],
  ["script[src]", "src"], ["link[href]", "href"], ["form[action]", "action"],
  ["iframe[src]", "src"], ["video[src]", "src"], ["audio[src]", "src"], ["video[poster]", "poster"]];

// Map an upstream absolute URL to this Worker's /site/<host>/… when it points
// at one of the approved origins; otherwise leave it (it opens directly).
function proxify(workerOrigin, allowed, absUrl, key) {
  const host = absUrl.hostname.toLowerCase();
  if (absUrl.protocol !== "https:" || !allowed.has(host)) return null;
  const q = key ? (absUrl.search ? absUrl.search + "&k=" + encodeURIComponent(key) : "?k=" + encodeURIComponent(key)) : absUrl.search;
  return workerOrigin + "/site/" + host + absUrl.pathname + q + absUrl.hash;
}
function rewriteDocument(response, workerUrl, target, allowed, key) {
  if (typeof HTMLRewriter !== "function") return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const rw = new HTMLRewriter();
  const one = (input) => {
    if (!input) return null;
    const t = input.trim();
    if (!t || t.startsWith("#") || /^(data|mailto|tel|javascript|blob|about):/i.test(t)) return null;
    try { return proxify(workerUrl.origin, allowed, new URL(t, target), key); } catch { return null; }
  };
  for (const [selector, attr] of REWRITE_ATTRS) {
    rw.on(selector, {
      element(el) {
        const input = el.getAttribute(attr);
        if (!input) return;
        if (attr === "srcset") {
          // "url 1x, url 2x" — rewrite each candidate's URL part.
          const out = input.split(",").map((part) => {
            const seg = part.trim(); if (!seg) return part;
            const sp = seg.split(/\s+/); const mapped = one(sp[0]);
            if (mapped) sp[0] = mapped; return sp.join(" ");
          }).join(", ");
          el.setAttribute(attr, out);
          return;
        }
        const mapped = one(input);
        if (mapped) el.setAttribute(attr, mapped);
      },
    });
  }
  rw.onDocument({ end(end) { end.append(NAV_REPORT, { html: true }); } });
  return rw.transform(new Response(response.body, { status: response.status, headers }));
}

// Cap a body to MAX_BYTES; abort the stream if the upstream exceeds it.
function capBody(body) {
  if (!body || typeof TransformStream !== "function") return body;
  let total = 0;
  const ts = new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength || chunk.length || 0;
      if (total > MAX_BYTES) { controller.error(new Error("too large")); return; }
      controller.enqueue(chunk);
    },
  });
  return body.pipeThrough(ts);
}

// Best-effort soft per-IP rate limit via the Cache API. Racy across isolates,
// so it is a soft cap, not a guarantee; the allowlist is the real control.
async function rateLimited(request, env, ip) {
  const perMin = Math.max(0, parseInt((env && env.RATE_PER_MIN) || "", 10) || DEFAULT_RATE_PER_MIN);
  if (!perMin || !ip || typeof caches === "undefined" || !caches.default) return false;
  const minute = Math.floor(Date.now() / 60000);
  const key = new Request("https://rate.invalid/" + encodeURIComponent(ip) + "/" + minute);
  try {
    const hit = await caches.default.match(key);
    const n = hit ? (parseInt(await hit.text(), 10) || 0) : 0;
    if (n >= perMin) return true;
    const res = new Response(String(n + 1), { headers: { "cache-control": "max-age=60" } });
    await caches.default.put(key, res);
    return false;
  } catch { return false; }
}

function timingSafeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Shared by /site/ and /status/: "<host>/<rest>" → a target URL that is
// guaranteed to be on that approved origin, or a refusal page.
function resolveSite(rest, url, env, allowed, hosts) {
  const slash = rest.indexOf("/");
  const hostPart = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  const afterHost = slash === -1 ? "/" : rest.slice(slash);
  const origin = allowed.get(hostPart);
  if (!origin) {
    return { refuse: errorPage(403, "Destination not permitted", hosts.length
      ? "This proxy opens only: " + hosts.join(", ") + "."
      : "No sites are approved on the Worker yet."), outcome: "not-permitted", hostPart };
  }
  let target;
  try {
    let qs = url.search;
    if (qs && env && env.PROXY_KEY) {
      const p = new URLSearchParams(qs); p.delete("k"); qs = p.toString() ? "?" + p.toString() : "";
    }
    target = new URL(afterHost + qs, origin);
  } catch { return { refuse: errorPage(400, "Bad address", "That path isn't valid for " + hostPart + "."), outcome: "not-permitted", hostPart }; }
  if (target.origin !== origin || target.hostname.toLowerCase() !== hostPart || hostnameBlocked(target.hostname)) {
    return { refuse: errorPage(403, "Destination not permitted", "This proxy only opens " + hostPart + ", and that address points somewhere else."), outcome: "not-permitted", hostPart };
  }
  return { target, hostPart, origin };
}

const statusJson = (obj, status = 200) => Response.json(obj, { status, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const { map: allowed, bad } = allowedOrigins(env);
    const hosts = [...allowed.keys()];

    if (path === "/health") {
      return Response.json(
        { status: hosts.length ? "ok" : "misconfigured", service: "saints-proxy-test", targets: hosts, invalid: bad.length },
        { status: hosts.length ? 200 : 500, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } }
      );
    }
    if (path === "/" || path === "/preview") return preview(hosts);
    // /status/<host>/<rest>: what the Proxy tab can't see inside the frame —
    // only the HTTP status and a one-word outcome, never the page itself.
    if (path.startsWith("/status/")) {
      if (env && env.PROXY_KEY && !timingSafeEqual(url.searchParams.get("k"), env.PROXY_KEY)) return statusJson({ outcome: "key-required" }, 401);
      const r = resolveSite(path.slice("/status/".length), url, env, allowed, hosts);
      if (r.refuse) return statusJson({ outcome: r.outcome, host: r.hostPart }, 403);
      if (await rateLimited(request, env, request.headers.get("cf-connecting-ip") || "")) return statusJson({ outcome: "rate-limited" }, 429);
      // For approved YouTube destinations, the page uses the official player
      // or an honest open-in-browser explanation instead of the broken SPA.
      const youtube = youtubeMode(r.target);
      if (youtube) return statusJson({ outcome: "ok", status: 200, host: r.hostPart, mode: youtube.videoId ? "official-embed" : "external-open" });
      try {
        const res = await fetch(r.target.href, { method: "HEAD", redirect: "manual",
          signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : undefined });
        const st = res.status;
        let outcome = st >= 200 && st < 300 ? "ok" : st >= 300 && st < 400 ? "redirect" : "http-error";
        if (outcome === "redirect") {
          let dest = null;
          try { dest = new URL(res.headers.get("location") || "", r.target); } catch { /* unreadable */ }
          if (!dest || !proxify(url.origin, allowed, dest, "")) outcome = "redirect-blocked";
        }
        return statusJson({ outcome, status: st, host: r.hostPart });
      } catch (err) {
        const aborted = err && (err.name === "TimeoutError" || err.name === "AbortError");
        return statusJson({ outcome: aborted ? "timeout" : "unreachable", host: r.hostPart });
      }
    }
    if (path === "/site" || path === "/site/") {
      return hosts.length ? Response.redirect(url.origin + "/site/" + hosts[0] + "/", 302) : errorPage(503, "No sites approved", "Set TARGET_ORIGINS on the Worker.");
    }
    if (!path.startsWith("/site/")) {
      return errorPage(404, "Not found", "This proxy only has a connection test (/preview) and the approved sites (/site/<host>/…).");
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorPage(405, "Not supported", "Only opening pages (GET and HEAD) is supported. Forms and sign-ins don't work through this proxy.");
    }
    if (env && env.PROXY_KEY && !timingSafeEqual(url.searchParams.get("k"), env.PROXY_KEY)) {
      return errorPage(401, "Access key required", "This proxy needs the access key set in the Saints Service Proxy tab's Connection settings.");
    }

    // /site/<host>/<rest> — the host must be an exact allowlist member, and
    // the target is rebuilt strictly on that approved origin.
    const site = resolveSite(path.slice("/site/".length), url, env, allowed, hosts);
    if (site.refuse) return site.refuse;
    const { target, hostPart } = site;

    const ip = request.headers.get("cf-connecting-ip") || "";
    if (await rateLimited(request, env, ip)) {
      return errorPage(429, "Too many requests", "This proxy is busy. Wait a minute and try again.");
    }

    // YouTube's client app relies on APIs this simple proxy does not rewrite.
    // Use the official embed where possible; otherwise explain the limitation.
    const youtube = youtubeMode(target);
    if (youtube) return youtubeResponse(youtube, request.method);

    try {
      const headers = new Headers();
      for (const name of ["accept", "accept-language", "if-none-match", "if-modified-since", "range"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      // No cookies, authorization, or client identity are ever forwarded.
      const response = await fetch(target.href, {
        method: request.method, headers, redirect: "manual",
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : undefined,
      });
      const status = response.status;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.get("location");
        if (!location) return new Response(null, { status });
        let dest;
        try { dest = new URL(location, target); } catch { return errorPage(502, "Bad redirect", "The site redirected to an address we couldn't read."); }
        const mapped = proxify(url.origin, allowed, dest, env && env.PROXY_KEY);
        if (!mapped) return errorPage(403, "Redirect not permitted", "That page redirects to a site this proxy isn't approved to open.");
        return Response.redirect(mapped, status);
      }
      const len = parseInt(response.headers.get("content-length") || "", 10);
      if (Number.isFinite(len) && len > MAX_BYTES) {
        return errorPage(413, "Page too large", "That page is larger than this proxy will fetch.");
      }
      const replyHeaders = new Headers(response.headers);
      for (const name of ["set-cookie", "content-length", "content-encoding", "transfer-encoding", "connection", "strict-transport-security"]) {
        replyHeaders.delete(name);
      }
      const contentType = replyHeaders.get("content-type") || "";
      if (request.method === "GET" && contentType.includes("text/html")) {
        const reply = new Response(response.body, { status, headers: replyHeaders });
        return rewriteDocument(reply, url, target, allowed, env && env.PROXY_KEY);
      }
      const body = request.method === "HEAD" ? null : capBody(response.body);
      return new Response(body, { status, headers: replyHeaders });
    } catch (err) {
      const aborted = err && (err.name === "TimeoutError" || err.name === "AbortError");
      return errorPage(aborted ? 504 : 502,
        aborted ? "The site took too long" : "Couldn't reach the destination",
        aborted ? hostPart + " didn't answer within " + Math.round(UPSTREAM_TIMEOUT_MS / 1000) + " seconds."
                : "The proxy Worker is running, but " + hostPart + " didn't answer. Try again in a moment.");
    }
  },
};
