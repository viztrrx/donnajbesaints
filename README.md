# Agent Console {#agent-console}

A floating AI assistant panel you can drop onto **any web page** — no extension, no install, no build step. It's one self\-contained JavaScript file you paste into the browser console (or run as a bookmarklet), plus an optional Cloudflare Worker that proxies API calls.

The panel reads the page you're on, answers questions about it, explains quiz questions, takes notes, plays music, browses, and — when you need a break — ships with seventeen playable games.

* * *

## Quick start {#quick-start}

1. Open any web page.
2. Open DevTools → Console (`F12`, or `Cmd`/`Ctrl` \+ `Shift` \+ `J`).
3. Paste and run:

```js
fetch('https://raw.githubusercontent.com/viztrrx/donnajbesaints/main/script.js')
  .then(r => r.text())
  .then(eval)
```

The panel appears in the corner. Drag it anywhere; minimize it and it flies to the bottom\-right as a small button that's still draggable. Running the snippet again toggles the panel instead of injecting a second copy.

The first time you use an AI feature it asks for an API key. Keys live in that site's `localStorage` and never leave your browser except in the request to the provider.

### Make it a bookmarklet {#make-it-a-bookmarklet}

Create a new bookmark and use this as the URL, so it's one click on any page:

```
javascript:fetch('https://raw.githubusercontent.com/viztrrx/donnajbesaints/main/script.js').then(r=>r.text()).then(eval)
```

A DevTools **Snippet** (Sources → Snippets) works too, and survives navigation better than retyping the fetch.

* * *

## API keys {#api-keys}

| Feature | Key | Where to get it |
| --- | --- | --- |
| AI (Google) | Gemini API key | [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| AI (OpenAI) | OpenAI key, starts with `sk-` | [https://platform.openai.com/api\-keys](https://platform.openai.com/api-keys) |
| Music search | YouTube Data API v3 key | [https://console.cloud.google.com](https://console.cloud.google.com) → enable *YouTube Data API v3* → Credentials |

Pick your provider under **Settings → AI provider**. Each key is stored separately, so you can switch back and forth without re\-entering anything.

Because browsers scope `localStorage` per origin, a key entered on `example.com` isn't visible on `wikipedia.org` — you'll be asked again on each new domain. If that gets tedious, host your own copy of `script.js` and paste your Gemini key into `API_KEY_DEFAULT` near the top of the file. Only do that for a private copy; anything in a public repo is public.

The YouTube free tier covers roughly 100 searches per day.

* * *

## Features {#features}

### Page Insights {#page-insights}

Scans the current page's visible text (`document.body.innerText`, capped at 18,000 characters) and optionally a screenshot, then summarizes, analyzes, or answers questions about it. Answers come back with a confidence score, and the supporting phrases get highlighted directly on the page so you can see where an answer came from.

The screenshot path uses the browser's native `getDisplayMedia` prompt — Chrome asks *you* to pick a tab, window, or screen, grabs one frame, and immediately stops sharing. There's no silent capture; that permission dialog is a browser\-level protection. You can also upload an image file or just paste one with `Ctrl`\+`V` anywhere in the panel. Images are downscaled to 1280px wide before sending.

Alongside that tab: a table extractor that pulls every `<table>` on the page to CSV, a page watcher that re\-reads the page every 30 seconds and notifies you when a condition you described in plain English is met, natural\-language page commands ("click the third link"), and a form auto\-filler that generates mock values. The auto\-filler previews everything it intends to type and fills only after you confirm — it never submits anything.

### Quiz solver and Tutor mode {#quiz-solver-and-tutor-mode}

Both read the page including the parts plain text misses: closed `<select>` dropdowns only render their selected option, and radio/checkbox labels aren't always adjacent to their question, so those are extracted separately and handed to the model.

**Quiz solver** returns one answer per question — including multi\-part items like *2a* / *2b* — as an animated answer grid with per\-answer confidence, then double\-checks its own draft in a second pass before showing it.

**Tutor mode** reads the same content but gives you the *why*. Each question comes back with the concept being tested, the reasoning that reaches the answer including why each tempting wrong option is wrong, a fully worked solution with the actual arithmetic shown step by step, the mistake people usually make on that question, and the rule or theorem it all rests on. You still enter and submit every answer yourself — the tutor explains, it doesn't take the quiz for you.

**Sources** are cited per question. The model is told never to invent a URL: when it isn't certain a page exists at an exact address it names the rule without linking, because a named theorem beats a link that 404s. Citations that aren't real `http(s)` links are dropped rather than rendered.

**Auto\-explain** (on by default) removes the need to press "Show on page" for every question. It watches which question is actually on screen and floats that explanation beside it, following along as you go — press Next on a stepped quiz and question 8's explanation is already there. It never scrolls the page on you. Drag the popup by its header to park it wherever you like and it stays there as the questions change; close it with ✕ and it won't reopen for that question. Toggle it from the Page Insights tab or from the popup itself.

Any answer grid can be turned into flashcards with one click, and 💾 saves an explanation as an insight — see below.

### Ask AI {#ask-ai}

General\-purpose chat, independent of the page. Voice input via the browser's speech recognition, and optional read\-aloud for responses via speech synthesis — both local, both free, neither needs a key.

### Selection assistant {#selection-assistant}

Select any text on the page and a small bubble appears: **Explain**, **Simplify**, **Translate**, **Define**, copy\-as\-clean\-text, or save to your insights.

### Study {#study}

Generates flashcard decks from whatever page you're on, with spaced practice and grading.

### Notes {#notes}

Paste a passage; the AI reads it, researches it across the web, and writes organized study notes. It keeps the passage, the notes, and the research in context, so follow\-up questions get answered against the whole thing rather than starting cold.

### Saved {#saved}

Insights you save get organized into folders and a calendar view, alongside an autosaved scratchpad and a 25/5 Pomodoro timer.

**Context memory.** Each saved insight has a 🧠 toggle. Switch it on and that insight travels with every later AI request as background the assistant already knows — so a worked explanation you saved on question 7 informs the answer to question 9, or notes from one page carry into a different one. It's opt\-in per insight and off by default, on purpose: a blanket "remember everything" turns every unrelated note into a source of confusion and costs tokens on every request. Selected insights go in newest\-first up to a character budget, and the prompt tells the model that when saved context conflicts with the page currently open, the page wins.

### Admin console {#admin-console}

A hidden owner dashboard in Settings. To open it: click the **Account & sync** heading five times quickly, then enter the PIN (`1029`). It re\-locks every time the script is re\-injected, so the PIN is asked for each session. It has three tabs:

Usage — a log of every time the tool was opened on this browser, with the profile name, timestamp, page, and host. Stat cards for total opens, unique users, opens today; a per\-user list with counts and last\-seen; and recent activity. Export the log to JSON or clear it.

Power tools — override the AI model for either provider, prepend a standing system\-prompt to every request, change how much page text is sent, set the OpenAI temperature, and a raw prompt playground that talks straight to the model.

Data — an inline editor for every `gpa_*` value in this browser, export\-everything, and a wipe\-all.

**Two honest limits, because they matter:**

*This is a soft lock, not security.* The PIN lives in the script, which is public — anyone who reads the source sees `1029` — and every "admin\-only" value sits in the same `localStorage` any visitor can open in DevTools. It keeps a casual user out of the dashboard; it does not protect anything. Don't put anything genuinely sensitive behind it.

*Seeing other people is real now — through your worker.* Because `localStorage` is per\-browser, the local log only shows this browser. To see everyone — including who's active right now — every instance sends a small heartbeat to your Cloudflare Worker's `/track` endpoint, and the Usage tab's Live view reads it back. This is proper analytics: the data lives server\-side in your Worker's KV store, and the Worker only returns it to a request carrying your `ADMIN_TOKEN`, so the logs are genuinely owner\-only and no secret ships in the public script. When telemetry is on, every user sees a one\-time notice that usage is recorded (their profile name, open times, and coarse location — country/region from Cloudflare, never a raw IP or anything they type). That notice is deliberately not removable: logging people who know they're logged is analytics; logging people who don't is spyware, and the second one isn't something this builds. Turn it all off by setting `TELEMETRY_ENABLED = false` near the top of `script.js`.

**Setting up live telemetry.** In the Cloudflare dashboard, on the same Worker you deploy `worker.js` to: (1) create a KV namespace under Storage & Databases → KV; (2) bind it to the Worker as a KV Namespace Binding named exactly `TELEMETRY`; (3) add an environment variable `ADMIN_TOKEN` set to a long random secret (use Encrypt); (4) deploy the updated `worker.js`; (5) in the admin console → Usage → Live, paste that same `ADMIN_TOKEN` into the token field and press Load live users, then turn on Auto\-refresh to watch it live. Until KV and `ADMIN_TOKEN` are set, `/track` no\-ops and the Live view tells you what's missing — the OpenAI proxy keeps working regardless. Cloudflare's free tier covers this comfortably for a personal\-scale user base.

**Moderating users.** Every row in the Live view has Block, Lock, and Kick buttons (Block and Lock flip to Unblock/Unlock once set). Each writes a moderation state to your Worker's KV against that username. Block gives the user a full\-screen "Blocked by the owner" page with your optional message and cuts off their AI features until you unblock. Lock is a lighter overlay that freezes their panel for a temporary pause. Kick forces a one\-time sign\-out; they can sign back in unless also blocked. Every client polls its own status every 15 seconds (and gets it on each heartbeat), so an action lands within about that long.

Be clear\-eyed about enforcement: this is JavaScript running in someone else's browser, so the block page, lock, and kick are client\-side — a technically capable user could edit them out of their own copy. The part that genuinely bites is server\-side: your Worker refuses to proxy OpenAI requests for a blocked user (it checks the `X-GPA-User` the client sends and returns 403), so a blocked user loses the OpenAI features for real. The gaps, plainly: it can't stop Gemini (the browser calls Google directly, not through your Worker) or someone in direct mode with their own key, and a spoofed username sidesteps the proxy check. For a personal tool shared with friends this is plenty; it is not a hardened access\-control system, and nothing client\-side ever can be.

### Browser {#browser}

A plain iframe with a URL bar. It only loads sites that allow being embedded — banks, most social apps, and SoundCloud's own site set `X-Frame-Options` or CSP `frame-ancestors` to prevent it. That's a protection those sites deliberately set, and this script makes no attempt to circumvent it.

**Research mode** lives here: the AI picks a few authoritative sources, the Worker fetches each one server\-side, and you get back a brief with citations.

### Music {#music}

Three ways to play something:

1. **Search** — type a song name or description and it queries the official YouTube Data API, then plays the closest match in YouTube's own embed player.
2. **SoundCloud** — paste a track link, played through SoundCloud's official embeddable player.
3. **Local library** — list `raw.githubusercontent.com` URLs in `PRELOADED_TRACKS` at the top of `script.js` and they appear in the playlist on load, or click **Add audio files** to pick files off your own device for the session. This path is a plain `<audio>` element: no iframe, no network for local files.

Playback keeps running while you switch sections — the player stays in the DOM, just hidden.

### Games {#games}

Tic\-Tac\-Toe, Rock\-Paper\-Scissors, Memory, Snake, 2048, Whack\-a\-Mole, Guess the Number, Hangman, Wordle, Connect 4, Minesweeper, Flappy, Word Scramble, Reaction Test, Tetris, Checkers, and Sudoku. Per\-game options, high scores, a pause screen with stats, fullscreen, and a match timer you toggle with `T`.

### Settings {#settings}

Several color themes plus a custom accent, ambient particle backgrounds in a few styles with an adjustable play area, four panel size presets, typing speed and response font controls, and a customizable icon for the minimized button.

### Profiles and sync {#profiles-and-sync}

An optional username \+ PIN profile (the PIN is hashed, not stored in the clear) that snapshots every `gpa_*` key. Move settings between browsers with a portable sync code — pure encode/decode, no server involved — or turn on cloud auto\-sync backed by your own JSONBin credentials.

* * *

## The Worker (`worker.js`) {#the-worker-workerjs}

An optional Cloudflare Worker that does two small things the browser can't do on its own:

- **`/v1/*`** — forwards to `api.openai.com` and adds the CORS header. Direct browser → OpenAI calls are frequently blocked by ad blockers, antivirus shields, and network filters, which surface as confusing CORS errors. It also answers `OPTIONS` preflights itself, because forwarding those upstream returns a response that doesn't allow the `Authorization` header, which makes the browser block the real request.
- **`/read?url=…`** — fetches a page server\-side and returns its HTML, so research mode can read sources the browser isn't allowed to fetch cross\-origin. HTML and plain text only, capped at 3MB.

### Deploying it {#deploying-it}

Cloudflare dashboard → **Workers & Pages** → your worker → **Edit code** → replace everything with `worker.js` → **Deploy**.

Then point the script at it by setting `OPENAI_PROXY` near the top of `script.js` to your Worker URL. Set it to `''` to call OpenAI directly instead.

The Worker holds no key of its own — it passes through whatever the browser sends. It looks for the key in the `Authorization` header, then the `X-GPA-Key` header, then a `_gpa_key` field in the request body, then a legacy `?key=` query parameter. The extra channels exist because some pages wrap `fetch` and `XMLHttpRequest` and strip headers in transit; the body is used rather than the URL because **a key in a URL ends up in browser history, `Referer` headers, proxy and CDN logs, and any screenshot of the network tab.** If you're still using a build that sends `?key=`, treat that key as compromised and rotate it.

If you deploy the Worker publicly, anyone who knows the URL can route their own OpenAI requests through it using their own key.

> **`script.js` and `worker.js` have to be deployed together.** The Worker isn't pulled from this repo at runtime — you paste it into the Cloudflare dashboard by hand. If you update one and not the other, the key channel they agree on can drift apart and every request comes back `401`.

* * *

## Troubleshooting {#troubleshooting}

**`Failed to execute 'fetch' on 'Window': Invalid value`** — the saved API key contains a character that can't go in an HTTP header, almost always an invisible one picked up by copying the key out of a styled web page or a document: a zero\-width space, a non\-breaking space, a soft hyphen, a stray newline. The error is thrown by the browser before any request is sent, so it looks identical whether the key is valid or not. Keys are now scrubbed to printable ASCII on save and on read, so this repairs itself; if you still see it, clear the key in Settings and paste it again.

**`401` with "You didn't provide an API key"** — the key never arrived, which is not the same as the key being rejected. Two usual causes: the page is stripping headers (the script falls through several transports to work around this), or `worker.js` on Cloudflare is older than `script.js` and is looking for the key somewhere the script no longer puts it. Redeploy the Worker.

**`401` with "Incorrect API key provided"** — that one really is the key. Check it at [https://platform.openai.com/api\-keys](https://platform.openai.com/api-keys).

**Everything fails only on one site** — some pages wrap `fetch` and `XMLHttpRequest`, and strict CSP can block the blob\-worker transport the script uses to get a clean one. The console log names each transport as it's tried, so it's visible which ones the page is interfering with.

**Keys are per\-origin.** A key entered on one domain isn't visible on another; that's browser security, not a bug.

## Notes and limits {#notes-and-limits}

This is injected JavaScript, not an extension, so it disappears on reload or navigation — re\-run the snippet, or use the bookmarklet. Page text is truncated and screenshots downscaled to keep requests fast and within token limits. Gemini calls go to the public Generative Language REST API with the key as a query parameter, which is how Google's own docs show client\-side usage — it does mean the key is visible in network requests from your own browser session.

The panel renders inside a Shadow DOM, so the host page's CSS can't bleed into it and vice versa.

* * *

## Files {#files}

```
script.js   The entire assistant — UI, AI calls, games, everything
worker.js   Optional Cloudflare Worker: OpenAI CORS proxy + page reader
```

No build step, no dependencies, no bundler.

* * *

## License {#license}

MIT — see [LICENSE](LICENSE).
