// YouTube compatibility view. We do not attempt to rewrite YouTube's
// full single-page application or bypass its embed/access restrictions.
// Called only after the proxy's exact approved-origin checks.
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const ID = /^[A-Za-z0-9_-]{11}$/;
const htmlEscape = (s) => String(s).replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));

export function youtubeMode(target) {
  if (!(target instanceof URL) || target.protocol !== "https:" || !YOUTUBE_HOSTS.has(target.hostname.toLowerCase())) return null;
  let videoId = "";
  if (target.hostname === "youtu.be") {
    videoId = target.pathname.split("/")[1] || "";
  } else if (target.pathname === "/watch") {
    videoId = target.searchParams.get("v") || "";
  } else {
    const parts = target.pathname.split("/");
    if (["shorts", "live", "embed"].includes(parts[1])) videoId = parts[2] || "";
  }
  if (!ID.test(videoId)) videoId = "";
  return { videoId, externalUrl: target.href };
}

export function youtubeResponse(mode, method = "GET") {
  // All attacker-controlled strings are either escaped or reduced to a
  // strict 11-character YouTube ID. No arbitrary iframe sources or scripts.
  const url = htmlEscape(mode.externalUrl);
  const playerUrl = mode.videoId
    ? "https://www.youtube.com/embed/" + mode.videoId + "?playsinline=1"
    : "";
  const player = mode.videoId
    ? `<div class="player"><iframe title="YouTube video player" loading="eager"
         src="${htmlEscape(playerUrl)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
         allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
       <p>Playback depends on YouTube allowing this video to be embedded and on your browser's frame settings.</p>`
    : `<p>The full YouTube website uses features that this lightweight proxy cannot reproduce. The old “Connect to the internet” message was misleading; your Wi-Fi may be working normally.</p>
       <p>For an individual public video, paste its YouTube watch link into the Saints Service Proxy address bar to try YouTube's official embedded player.</p>`;
  const html = `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>YouTube — Saints Service</title>
    <style>
      :root {color-scheme:dark;font-family:system-ui,-apple-system,sans-serif}
      body {margin:0;background:#10131b;color:#f4f6ff;min-height:100vh;padding:18px;box-sizing:border-box}
      main {max-width:760px;margin:0 auto;background:#181e2b;border:1px solid #343b50;border-radius:18px;padding:20px}
      h1 {font-size:1.3rem;margin:0 0 10px} p {color:#bdc9dc;line-height:1.55}
      .player {position:relative;aspect-ratio:16/9;min-height:200px;margin:16px 0;background:#090b11;border-radius:12px;overflow:hidden}
      .player iframe {width:100%;height:100%;border:0;position:absolute;inset:0}
      a {display:inline-block;background:#343d55;color:#f4f6ff;text-decoration:none;border-radius:10px;padding:12px 16px;margin-top:8px}
      a:focus {outline:2px solid #a9c4ff}
    </style></head><body><main>
      <h1>${mode.videoId ? "Watch with YouTube's official player" : "Open YouTube normally"}</h1>
      ${player}
      <p>If the video cannot play inside Saints Service, open it in Safari instead. Some videos disallow embedding.</p>
      <a href="${url}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>
    </main></body></html>`;
  return new Response(method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      // YouTube requires an identifying Referer for its official embeds.
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.youtube.com; base-uri 'none'; form-action 'none'; img-src 'self' data:",
    },
  });
}
