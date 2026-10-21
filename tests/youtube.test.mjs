import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../proxy-worker/index.js";
import { youtubeMode, youtubeResponse } from "../proxy-worker/youtube.js";

const ROOT = "https://saints-proxy-test.viztrrx.workers.dev";
const env = { TARGET_ORIGINS: "https://example.com https://youtube.com https://www.youtube.com https://m.youtube.com https://youtu.be" };
const request = (path, options, vars = env) => worker.fetch(new Request(ROOT + path, options), vars);

test("YouTube: URL recognition validates video IDs and known HTTPS hosts", () => {
  const cases = [
    ["https://www.youtube.com/watch?v=M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://m.youtube.com/watch?v=M7lc1UVf-VE&t=4", "M7lc1UVf-VE"],
    ["https://youtube.com/shorts/M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://youtu.be/M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://youtube.com/", ""],
    ["https://www.youtube.com/watch?v=invalid", ""],
  ];
  for (const [url, id] of cases) assert.equal(youtubeMode(new URL(url)).videoId, id, url);
  for (const url of ["https://notyoutube.com/watch?v=M7lc1UVf-VE", "http://youtube.com/", "https://example.com/"]) {
    assert.equal(youtubeMode(new URL(url)), null);
  }
});

test("YouTube: official embed page is script-free and sends an identifying Referer", async () => {
  const mode = youtubeMode(new URL("https://www.youtube.com/watch?v=M7lc1UVf-VE"));
  const response = youtubeResponse(mode);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /www\.youtube\.com\/embed\/M7lc1UVf-VE\?playsinline=1/);
  assert.match(body, /Open on YouTube/);
  assert.ok(!body.includes("<script"));
  assert.match(response.headers.get("content-security-policy"), /frame-src https:\/\/www\.youtube\.com/);
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  const head = youtubeResponse(mode, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("YouTube: home displays an accurate fallback, never a false offline error", async () => {
  const html = await youtubeResponse(youtubeMode(new URL("https://m.youtube.com/"))).text();
  assert.match(html, /full YouTube website/);
  assert.match(html, /Open on YouTube/);
  assert.ok(!html.includes("/embed/"));
  const invalid = youtubeMode(new URL("https://www.youtube.com/watch?v=123%22%3E%3Cscript%3E"));
  const body = await youtubeResponse(invalid).text();
  assert.ok(!body.includes("<script>"));
});

test("YouTube: approved video paths do not invoke the incompatible upstream SPA", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("upstream should not be used"); };
  try {
    let res = await request("/site/www.youtube.com/watch?v=M7lc1UVf-VE");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /\/embed\/M7lc1UVf-VE/);
    res = await request("/site/m.youtube.com/");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Open on YouTube/);
    res = await request("/status/www.youtube.com/watch?v=M7lc1UVf-VE");
    assert.equal((await res.json()).mode, "official-embed");
    res = await request("/status/m.youtube.com/");
    assert.equal((await res.json()).mode, "external-open");
  } finally { globalThis.fetch = original; }
});

test("YouTube: the Worker still enforces its destination allowlist and key", async () => {
  const limited = { TARGET_ORIGINS: "https://example.com" };
  let res = await request("/site/www.youtube.com/watch?v=M7lc1UVf-VE", {}, limited);
  assert.equal(res.status, 403);
  const locked = { ...env, PROXY_KEY: "test-key" };
  res = await request("/site/www.youtube.com/watch?v=M7lc1UVf-VE", {}, locked);
  assert.equal(res.status, 401);
  res = await request("/site/www.youtube.com/watch?v=M7lc1UVf-VE&k=test-key", {}, locked);
  assert.equal(res.status, 200);
  const status = await request("/status/www.youtube.com/watch?v=M7lc1UVf-VE&k=test-key", {}, locked);
  assert.equal(status.status, 200);
});
