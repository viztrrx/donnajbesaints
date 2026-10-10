# Eaglercraft tab

The console's **Eaglercraft** tab (between Proxy and Games) runs
[EaglercraftX 1.8](#which-eaglercraft), Minecraft 1.8 compiled to JavaScript,
inside the console. It supports singleplayer, servers and Shared Worlds. It is
played only while the console is fullscreen, and every file and socket the
game uses goes through your Worker (`worker.js`). The one exception is WebRTC
between players, described [below](#the-network-path).

**This repository does not include the game.** You build it yourself and tell
the Worker where it is. See [Licensing](#licensing) for why.

```
eaglercraft/
  loader/frame.html   the page the game runs in (served by the Worker at /eagler/)
  loader/bridge.js    starts the client, routes its sockets through the Worker,
                      reports state to the console, takes pause/focus commands
  client/             your own build, if you keep it here (git-ignored)
```

The tab's code lives in `script.js` (search for `Eaglercraft tab`), and the
Worker side lives in `worker.js` (`handleEagler`).

---

## Which Eaglercraft

| | |
| --- | --- |
| Project | EaglercraftX 1.8 by lax1dude and ayunami2000 |
| Source inspected | `github.com/3kh0/eaglercraft-1.8`, a mirror of the upstream `git.eaglercraft.rip` repository, commit `4cb71c5` (2024-06-17), client version `u35` |
| Build used | The **JavaScript (TeaVM) web build**: `classes.js`, `assets.epk` and `lang/` |
| Not supported here | The later WASM-GC builds (`assets.epw` / different bootstrap) |

Why this one: it is the browser Minecraft with singleplayer (an integrated
server in a Web Worker, worlds in IndexedDB), servers (WebSocket to
EaglerXBungee/EaglerXVelocity), and Shared Worlds (WebRTC with relay
signaling). Its page contract is documented and stable: `window.eaglercraftXOpts`,
a container element, and `main()`. It also builds from source with its own
`CompileLatestClient` tool.

What the loader relies on, all checked against the source:

- `ClientMain` finds the container with `document.getElementById` and reads
  `window.eaglercraftXOpts`. That's why the game runs in its own page and not
  inside the console's shadow root.
- `ClientPlatformSingleplayer` starts the integrated server as a `Worker` from
  a `blob:` copy of `classes.js`. The loader sets
  `window.eaglercraftXClientScriptURL` to say where that file is.
- `PlatformRuntime` requires **WebGL 2.0**, plus pointer lock.
- `PlatformNetworking` opens servers with `new WebSocket(uri)`.
- `PlatformWebRTC` and `sp/relay/*`: Shared Worlds connect to a relay over a
  WebSocket, receive STUN/TURN servers, swap offer, answer and ICE candidates
  through it, then talk over an `RTCPeerConnection` data channel named `lan`.
- Patched `Minecraft.java`: with no screen open, losing the mouse grab calls
  `displayInGameMenu()`. The console's pause uses this.
- `PlatformInput`: F11 toggles the game's own fullscreen and Keyboard Lock.

## Licensing

- The EaglercraftX sources are **"Copyright (c) 2022-2024 lax1dude,
  ayunami2000. All Rights Reserved."**, with no open-source license. They hold
  patches and a browser runtime, not Minecraft itself.
- A compiled client contains **decompiled Minecraft 1.8 code and Mojang's
  assets**, which belong to Mojang/Microsoft. The build tool needs a Minecraft
  1.8.8 jar to make one.
- Repositories of the source have been taken down. For example,
  `github.com/eaglerarchive/eaglercraftx-1.8` answers **HTTP 451 (Unavailable
  For Legal Reasons)**.

So there is no version of Eaglercraft this repository can legally
redistribute. It ships the **integration only**: the tab, the loader, the
Worker routes and the tests. It contains no Eaglercraft or Minecraft code, and
`eaglercraft/client/` is git-ignored so a local build can't be committed by
accident. Whether you may build and host a client for yourself is between you
and those licenses. Don't put a build in a public repository.

## What the build must contain

`CompileLatestClient` (JavaScript build) writes these into the output folder
you pick. They come from `buildtools/.../CompileLatestClientGUI.java`:

| File | Needed? | Used for |
| --- | --- | --- |
| `classes.js` | **Required** | The client (TeaVM). The loader loads it and starts `main()`. Singleplayer also re-reads it to start the integrated server as a Worker. |
| `assets.epk` | **Required** | Game resources. The loader sets `assetsURI` to it. |
| `lang/` | Recommended | One `<code>.lang` per language (e.g. `lang/de_DE.lang`), fetched only when a language other than English is picked. English is inside `assets.epk`. |
| `classes.js.map` | Optional | Source map for debugging. Served as `application/json`. |
| `index.html`, `favicon.png` | Not used | The official launch page. `eaglercraft/loader/frame.html` replaces it and sets the same options. Harmless to leave in. |
| `EaglercraftX_1.8_Offline_*.html` | **Not supported** | Single-file builds with everything inlined. Use the folder files above instead. |

What the loader sets in `window.eaglercraftXOpts`, the same as the build's own
`index.html`:

| Option | Value |
| --- | --- |
| `container` | `"game_frame"` (a `<div id="game_frame">` in `frame.html`) |
| `assetsURI` | `https://<worker>/eagler/client/assets.epk` |
| `localesURI` | `https://<worker>/eagler/client/lang/` |
| `worldsDB` | `"worlds"` (IndexedDB, under the Worker's origin) |
| `servers` | from `EAGLER_SERVERS` |
| `relays` | from `EAGLER_RELAYS` (default: the official three) |

It also sets `window.eaglercraftXClientScriptURL` to
`https://<worker>/eagler/client/classes.js`, so singleplayer finds the
client. Every `ws://` or `wss://` address the game opens is rewritten to
`wss://<worker>/eagler/ws?url=<address>`.

The Worker serves the folder file by file at `/eagler/client/<path>`, and
sets the type from the extension: `.js` text/javascript, `.epk`
application/octet-stream, `.lang` text/plain, `.map` application/json.

## Setting it up

1. **Build the client** with `npm run build:eaglercraft`
   (`scripts/build-eaglercraft.sh`). It runs EaglercraftX's own headless
   `CompileLatestClient` on the pinned source (u35) and writes the client to
   `build/eaglercraft-client/`, which is git-ignored. You need Java 11+
   (17+ recommended), git, curl, node, ffmpeg and network access to Mojang
   and Maven Central, plus three inputs in `build/eaglercraft-inputs/`:
   - `1.8.8.jar` (the Minecraft 1.8.8 client) and `1.8.json` (its asset
     index). The script downloads both from Mojang's official version
     manifest and checks their SHA-1.
   - `mcp918.zip` (Mod Coder Pack 9.18), which **you supply**. The build
     uses it to decompile the jar and map the names the patches refer to,
     and it has no official download host any more.

   The build also fetches the game's sounds from
   `resources.download.minecraft.net` and TeaVM 0.9.2 from Maven Central.
   Building by hand with the GUI (`CompileLatestClient.sh` / `.bat` in the
   EaglercraftX source) works too.
2. **Upload that folder, as is, to a static host the Worker can fetch over
   HTTPS**, for example a Cloudflare R2 bucket with a public URL, or any
   static web host you control. Keep the file names and the `lang/`
   subfolder. Don't put it in a public GitHub repository: the build contains
   Mojang's code.
3. **Configure the Worker** (Cloudflare dashboard → your Worker → Settings →
   Variables). Only `EAGLER_CLIENT` is required:

   | Variable | Meaning |
   | --- | --- |
   | `EAGLER_CLIENT` | URL of the **folder** from step 2, e.g. `https://example.com/eaglercraft-client/`. `<that URL>classes.js` must download the file. A trailing `index.html` or `classes.js` is stripped, so the folder is still used. |
   | `EAGLER_LOADER` | Where `eaglercraft/loader/` is served from. Default: this repository on `raw.githubusercontent.com`. |
   | `EAGLER_RELAYS` | Comma-separated Shared World relays. Default: the three public relays the official client ships with. |
   | `EAGLER_SERVERS` | Comma-separated `Name\|wss://host/` entries for the Multiplayer screen. |
   | `EAGLER_WS_ALLOW` | Extra hosts (`host` or `host:port`) the WebSocket proxy may reach, e.g. a server a friend runs. |
   | `EAGLER_WS_OPEN` | `1` lets the proxy reach **any public** host, so Direct Connect works for any server. Off by default: when on, your Worker is a WebSocket relay for anyone who knows its address. Private addresses stay blocked either way. |
   | `EAGLER_REAL_IP` | `1` sends the player's IP to relays as `X-Real-IP`. Only for a relay you run with `enable-real-ip-header: true` (see [same Wi-Fi](#same-wi-fi-shared-worlds)). |
   | `EAGLER_VOICE` | `1` enables the game's WebRTC voice chat (off by default because it exposes IP addresses to other players). |

4. **Deploy** by pushing to `main`: Cloudflare Workers Builds runs
   `npx wrangler deploy` (see `wrangler.jsonc` and the main README).
   `EAGLER_*` variables set in the dashboard are kept on every deploy.
   `script.js` uses the same Worker as everything else (`OPENAI_PROXY`).
   With an older Worker, the tab says the routes are missing.
5. **Optional:** the owner can turn the tab off for everyone with the
   `eaglercraft` switch in Admin. The Worker enforces that switch too.

To check the setup, open `https://<your-worker>/eagler/status`. Read it like
this:

| You see | Meaning |
| --- | --- |
| The page doesn't load | The Worker isn't deployed or the URL is wrong. |
| `{"error":"not found"}` | The Worker is older than the Eaglercraft routes. Check the latest build under Workers & Pages → donnajbe → Deployments. |
| `"enabled": false` | The owner switched Eaglercraft off in Admin. |
| `"clientConfigured": false` | `EAGLER_CLIENT` isn't set. |
| `"clientReachable": false` | It's set, but the Worker can't download the files. `client.files` shows each file's HTTP status: `404` means a wrong folder URL, `403` means the host refuses, `0` means the host can't be reached. |
| `"clientReachable": true` | Ready. |
| `"websocket": { "available": true }` | The Worker can proxy WebSockets. `allowedHosts` lists where it will connect. |

The tab runs the same check before launching, and shows the same reasons.

## Playing

- **Enter Fullscreen** uses the console's existing fullscreen (the whole
  panel, the same as the ⛶ header button). The launch buttons stay disabled
  until the browser reports the console is fullscreen.
- **Launch Eaglercraft Here** runs the game in the tab, under the console's
  header.
- **Launch in about:blank** opens a new `about:blank` window. The window has
  the console's look and its own fullscreen gate: the game loads only once
  that window is fullscreen.
- **Leaving fullscreen** (Esc, the browser's exit control, anything else)
  pauses the game. The frame lets go of the mouse, the game opens its pause
  menu (which pauses a singleplayer world), and the console goes back to the
  launcher with *Resume*. Switching tabs or minimizing the console also
  pauses.
- **Stop Eaglercraft** removes the game frame. That ends its document, so its
  integrated-server Worker, sockets, peer connections and pointer lock go with
  it. Use *Save and Quit to Title* in the game first to keep the last few
  seconds of changes.
- While you play in fullscreen, the console asks for **Keyboard Lock**
  (Chromium), so Esc, Ctrl+W and similar keys reach the game. Hold Esc to
  leave fullscreen.

## The network path

```
Your browser                     Cloudflare                      Elsewhere
────────────                     ──────────                      ─────────
console (script.js)
  └─ iframe  https://<worker>/eagler/ ─────► worker.js
       frame.html, bridge.js  ◄─ GET /eagler/loader/* ─────────► EAGLER_LOADER
       classes.js, assets.epk ◄─ GET /eagler/client/* ─────────► EAGLER_CLIENT
       new WebSocket(server)  ─► /eagler/ws?url=wss://server ──► Eaglercraft server
       new WebSocket(relay)   ─► /eagler/ws?url=wss://relay ───► Shared World relay
       RTCPeerConnection ◄═══════ WebRTC (UDP), not through the Worker ═══► the other player
```

- The frame page's CSP is `connect-src 'self' blob: data:`. Any fetch or
  socket that didn't go through the Worker is **refused by the browser**, not
  sent directly. The tab lists such attempts under *How it connects* as
  "Blocked".
- **WebRTC cannot go through a Worker.** Cloudflare Workers handle HTTP and
  WebSockets, not ICE/UDP. The relay handshake goes through the Worker. After
  that, players' game traffic goes **directly between their browsers** (or
  through a TURN server the relay names). The tab shows which way each peer
  connection went, from `RTCPeerConnection.getStats()`.
- The `about:blank` window adds no network path. It holds the same frame from
  the Worker.

## Same Wi-Fi Shared Worlds

EaglercraftX has no Java-Edition LAN discovery (browsers can't broadcast). Its
equivalent is **Shared Worlds**:

1. Player A: open a singleplayer world → pause → **Invite** → **Start Shared
   World**. The game shows a join code.
2. Player B: **Multiplayer → Direct Connect → Join Shared World**, enter the
   code.
3. The two browsers connect over WebRTC. On the same Wi-Fi, that's normally a
   direct connection between the two devices on your network.

The "hidden: off" listing (worlds showing up automatically on the Multiplayer
screen) works by the relay grouping players who come from the **same public
IP**. Through the Worker, a relay sees Cloudflare's address instead of yours,
so on the public relays that listing doesn't work. **Join codes always work.**
If you want the listing too, run your own relay (the JAR is downloadable from
the game's Network Settings), set `enable-real-ip-header: true` in its
`relayConfig.ini`, put it in `EAGLER_RELAYS`, and set `EAGLER_REAL_IP=1`.

Some networks (guest Wi-Fi, "AP isolation") block devices from reaching each
other. Then WebRTC needs a TURN server, which the public relays no longer
provide for free.

## Browser limits

- **iPhone Safari** has no fullscreen for page elements, so the fullscreen
  requirement can't be met and the tab says so. iPad Safari 16.4+ and
  desktop browsers are fine.
- **WebGL 2.0** is required. Without it the tab shows an error.
- **Storage is per site.** Browsers partition third-party storage, so worlds
  saved while the console runs on site A aren't visible on site B. The
  about:blank window shares the partition of the site that opened it. Use the
  game's world export to move worlds.
- **The host page's CSP** can forbid frames from your Worker (`frame-src`).
  That applies to the about:blank window too, which inherits it. The tab
  detects the violation and says so.
- **Keyboard Lock** works only in Chromium-based browsers, and only in
  fullscreen.
- Cloudflare limits WebSocket messages to 1 MiB, which is not verified against
  real Eaglercraft server traffic.

## Tests

- `npm test` covers the `/eagler/*` routes in Node: validation, allowlists,
  the SSRF guard, the CSP and the kill switch.
- `tests/browser/eaglercraft.e2e.mjs` runs Chromium against `worker.js` in
  workerd, started by Wrangler from `wrangler.jsonc`. It uses a **stand-in client**
  (`tests/browser/fixtures/stub-client`, no Minecraft code) that follows the
  same page contract and the real relay protocol. It covers the fullscreen
  gate, both launch modes, pause and resume, input and pointer lock, cleanup,
  storage, CSP enforcement, error states and a two-browser Shared World over
  the real relay JAR. The header of that file explains how to run it.

- `tests/browser/real-client.mjs` checks **your real build**:
  `EAGLER_CLIENT_DIR=/path/to/build node tests/browser/real-client.mjs` (after `npm install`).
  It serves that folder through `worker.js` (in workerd), opens the tab in
  fullscreen, launches the game and confirms it started and drew without
  crashing. It also saves a screenshot of the title screen. It refuses the
  stand-in client.

These tests have never run against a real EaglercraftX build: none can be
fetched or built where they were written, since Mojang's download servers
were unreachable. Real gameplay (menus, world generation, saves inside the
real client, a real server) still needs checking with your own build.

## Bundled Chromebox Lite resource pack

The loader automatically installs the original Chromebox Lite 8x artwork into
Eaglercraft's native resource-pack list **before `main()` starts**. Users select
it in **Options → Resource Packs**; it is available but not forced on. Their
selected packs and video settings are not changed. Both launcher modes use the
same frame and installer. Installation happens on game launch, not account
creation, and follows the game's existing per-browser/per-site storage model.
It is not account-cloud synchronization.

This adapter targets the actual R2 JavaScript client, EaglercraftX 1.8 u35
(`classes.js` SHA-256
`9eda96f469d7e7365b73905e3642b2c1b38ca2f4b36034de3fad12aa319aa234`).
Its native IndexedDB is
`_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_resourcePacks`,
version 1, store `filesystem`, compound key path `["path"]`, rows containing
`path` and an ArrayBuffer `data`. The adapter merges
`resourcepacks/manifest.json` using the folder/name/timestamp/domains schema
read by `EaglerFolderResourcePack`. It neither accesses the worlds database nor
writes the game's selected-resource-packs options.

- `loader/chromebox-lite.js`: generated, unpacked original artwork with a
  content revision. Loaded through `/eagler/loader/`, like the existing bridge.
- `loader/resource-packs.js`: atomic installation, revision checks, preservation
  of other manifest entries, bounded storage wait, and graceful failure.
- A repeat launch does not duplicate or rewrite a current installation. Pack
  updates keep its folder identity, so the user's selection persists. Removing
  the bundled pack makes it available again on the next launch; deselect it to
  stop using it. Clearing browser storage reinstalls it on the next launch.
- Malformed manifests and unknown storage schemas are left untouched. Storage
  failure does not prevent gameplay; the launcher reports the optional pack as
  unavailable. The existing ZIP remains available for manual import.

Rebuild the ZIP and loader bundle with
`python3 resource-packs/chromebox-lite/build.py`. The generated loader file must
be committed/deployed with `frame.html`, `bridge.js`, `resource-packs.js`, and
`script.js`. With the default EAGLER_LOADER, publishing those files to the
repository's main branch makes them available through the existing Worker
route. No R2 upload, new Worker route, variable, or client rebuild is required.
If EAGLER_LOADER points elsewhere, publish the loader files there instead.
Existing game sessions must be stopped and relaunched; upstream caches may
briefly retain older loader files.

Validation commands:

- `npm test`
- `node tests/browser/resource-packs.mjs` (Chromium IndexedDB regression checks)
- `node tests/browser/resource-packs-integration.mjs` (both launch modes and
  storage-denied fallback, using the stand-in client)
- `EAGLER_CLIENT_DIR=build/eaglercraft-client node tests/browser/real-client.mjs`

These checks do not measure FPS on a Chromebox.

The exact u35 build above was also opened in Chromium: Chromebox Lite appeared
under Available Resource Packs without importing a ZIP, could be selected, and
completed its resource reload with a rebuilt texture atlas. See
`docs/screenshots/eaglercraft-bundled-pack.png` for the native available-pack
screen. This verifies menu availability and activation, not world gameplay or
hardware performance.

## Automatic Chromebox performance preset

`loader/performance.js` applies a conservative Chromebox Micro (Celeron N4500,
8 GB RAM) preset before the game starts, in both launch modes. It applies on
**every launch for all users of this loader**. In-session video changes work,
but the listed values reset next launch:

| Setting | Value |
| --- | --- |
| Render distance | 2 chunks |
| Maximum FPS | 60 |
| Graphics | Fast |
| Smooth lighting, clouds, shaders, dynamic lights, entity shadows | Off |
| Particles | Minimal |
| Mipmap levels | 0 |
| FXAA, anaglyph, VSync | Off |

This targets consistent performance; it does not guarantee 40+ FPS. The loader
cannot change ChromeOS display resolution. Use 1280×720 in the OS display
settings if available and needed.

The u35 settings record is `_eaglercraftX.g` in localStorage: base64-encoded gzip
text. The adapter preserves all other settings lines, including selected packs,
key bindings, language and audio. It keeps the first existing record at
`_eaglercraftX.agent-console.performance-original` as a backup. It does not
access worlds, account credentials, or profile data. A corrupt record, blocked
storage, unsupported browser compression API or timeout leaves settings intact
and reports a nonfatal preset failure in the launcher. A concurrent save from
another game window is not overwritten.

Run `node tests/browser/performance.mjs` for preset/merge/failure checks and
`node tests/browser/resource-packs-integration.mjs` for both launch modes and
storage-denied startup. Publish `performance.js`, `frame.html`, `bridge.js` and
`script.js` together, using the same GitHub loader deployment as the pack.
