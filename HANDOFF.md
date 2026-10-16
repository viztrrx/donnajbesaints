# Handoff: Agent Console (donnajbesaints)

Context for the next Claude session working on this repository. Read this
first, then `README.md` for user-facing docs. Last updated 2026-10-15, at
commit `bf4b7f5` on `main`.

---

## 1. Ground rules from the owner (follow these)

- **Push new commits to `main` only.** Do not push to, rebase or otherwise
  touch the `claude/ecstatic-gates-h0viik` branch (or any `claude/*` branch).
  Don't open PRs unless asked. Fast-forward pushes only
  (`git fetch origin main && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main`).
  If a stop hook complains about unpushed commits on a `claude/*` branch, keep
  the local checkout on `main` instead of pushing there.
- **No secrets in Git.** `ADMIN_TOKEN`, `COADMIN_TOKEN`, `OWNER_CODE`, VAPID
  private keys, APNs keys, etc. live in Cloudflare (dashboard secrets or KV),
  never in the repo. The KV namespace id in `wrangler.jsonc` is not a secret.
- **Don't remove or replace the `TELEMETRY` KV binding**
  (`cebe1a618cba45278f6784bd53f0d59f`), don't create new KV namespaces or
  Workers, don't replace `worker.js` or make a "second implementation" of
  anything. Extend what exists.
- **No Mojang/Minecraft game files in the repo** (no real `classes.js`,
  `assets.epk`, client jars). Never fake a client or claim Eaglercraft works
  without the real build.
- **Be honest about what was and wasn't tested.** The owner values
  screenshots: when building UI, show screenshots of the real app (Playwright
  + headless Chromium are available). Label mock-ups as mock-ups.
- The owner is non-technical-ish and prefers plain-language summaries,
  tables of what changed, and step-by-step instructions (e.g. iPhone steps).
- The owner's username in the console is `viztrrx` (Worker `OWNER` default).
  Time zone for notifications: `America/New_York` (owner is in Lehigh Acres, FL).

## 2. What this project is

A single injectable web interface, **"Agent Console"** (`script.js`, ~21.9k
lines), that runs inside a Shadow DOM on any page (bookmarklet / DevTools
snippet: `fetch(raw script.js).then(r=>r.text()).then(eval)`), plus a
Cloudflare Worker (`worker.js`) that is its backend.

- Worker: **`donnajbe`** at `https://donnajbe.viztrrx.workers.dev`.
- Deploys: Cloudflare **Workers Builds** runs `npx wrangler deploy` on every
  push to `main` (config in `wrangler.jsonc`, `keep_vars: true`).
- The console is also a **home-screen web app** at `/console/` (iPhone
  "Add to Home Screen → Open as Web App"), and there is a separate owner
  admin web app "Saints Command" at `/app/` (added by another contributor).

### Tabs (sidebar, grouped)
Welcome · **Assistant:** Page Insights, Ask AI, Chat · **Play:** Music, Proxy,
Eaglercraft, Games · **Study & write:** Study, Notes, Humanize, Grammar ·
**Library:** Saved, Settings (+ hidden Admin "Command Center").
Order matters: Eaglercraft must stay right after Proxy, before Games.

## 3. Architecture map

| Area | Files |
|---|---|
| Console UI (everything client-side) | `script.js` |
| Worker (all server routes) | `worker.js` |
| Wrangler config (bindings, crons) | `wrangler.jsonc` |
| Home-screen app shell (`/console/`) | `web/console/public/*` (index.html, app.js, app.css, sw.js, manifest, icons), `web/console/handler.js`, bundled into `web/console/assets.generated.js` |
| App icons generator | `web/console/make-icons.py` (pure Python PNG renderer) |
| Web Push (owner notifications) | `web/console/push.js` |
| Music (Audius + shared library) | `web/music.js` |
| Saints Command admin web app (`/app/`) | `web/handler.js`, `web/public/*`, `web/assets.generated.js`, `mobile/backend/*` (ADMIN_MOBILE Durable Object), `mobile/apns-relay/*` |
| Eaglercraft loader | `eaglercraft/loader/*` (frame.html, bridge.js, resource-packs.js, performance.js, pack-config.js, chromebox-lite.json), `eaglercraft/README.md`, `resource-packs/chromebox-lite/*` |
| Real Eaglercraft build script | `scripts/build-eaglercraft.sh` (needs Mojang inputs + mcp918.zip; output goes to git-ignored `build/`) |
| Tests | `tests/*.test.mjs` (node --test), `tests/browser/*.mjs` (Playwright vs workerd) |

### Bindings (`wrangler.jsonc`)
- `TELEMETRY` (KV): accounts, sessions, chat, config, moderation, audit,
  push subscriptions, dismissals, access requests, music metadata…
- `donnajbe_eaglercraft_client` (R2, bucket `donnajbe-eaglercraft-client`):
  Eaglercraft client files, chat photos under `chat-media/`, shared music
  under `music/`.
- `ADMIN_MOBILE` (Durable Object `AdminMobileState`, migration
  `admin-mobile-v1`): Saints Command pairing/push state.
- `previews.kv_namespaces` points at the same KV (preview builds share
  production data; known risk, owner said fine).
- **Crons:** `"0 5 * * *"` (daily jobs) and `"*/5 * * * *"` (who's-online
  presence check, no-op unless enabled; also sends the owner's daily summary
  once at 12 PM `OWNER_TZ` via `maybeSendDailyDigest`, KV `push:digest:last`).
  Listing crons in wrangler replaces dashboard crons.

### Worker vars/secrets (set in Cloudflare, never in Git)
`ADMIN_TOKEN`, `COADMIN_TOKEN`, `OWNER_CODE`, `OWNER` (default `viztrrx`),
`EAGLER_CLIENT`, `EAGLER_*`, `ALLOW_QUERY_TOKEN`, optional:
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (else auto-generated
into KV `push:vapid`), `OWNER_TZ`, `CONSOLE_SCRIPT_URL`, `AUDIUS_API`,
`APNS_RELAY_URL`/`APNS_RELAY_SECRET` (Saints Command).

## 4. Features built in this session (newest first)

All on `main`. Each has tests; see section 6.

0. **Staff chat**: built-in room `staff`; `checkRoomAccess` lets it through
   only when `isStaffCaller()` (session role ≥ moderator, X-GPA-Owner code,
   or an admin/co-admin bearer token), else "no such room". Client: nav item
   `data-tab="staffchat" data-pane="chat"` (the tab handler honors
   `data-pane`), `chatNavPicked`/`syncChatNav`, `isStaffClient()` (guarded:
   it runs during start-up before `currentUser` exists), background poll for
   `#gpa-staff-badge`. Tests: chat-rooms.test.mjs, `tests/browser/staff-chat.mjs`.
0. **Subscribers**: `config.subscriptions[name] = { user, startedAt,
   expiresAt, period, note, ended, reminded, history }`. `allowedUser()`:
   with the list on, a name that has a subscription is allowed exactly while
   `expiresAt > now` (list membership ignored for them). Owner route
   `POST /admin/subscriptions` (list/add/renew/end/delete); calendar months
   via `addSubPeriod`. `sweepSubscriptions()` on the 5-minute cron removes
   ended names from the list and pushes `subs` alerts (3 days before, at
   the end). `startedAt` (owner-chosen, ≤ now) starts the period; action
   `setstart` moves it; `amount` goes in `config.subLedger` (kept after a
   record is removed) for the card's totals. `/status` and `/track` carry the
   caller's own `subscription` for the `#gpa-substrip` countdown. UI: Admin → Security → Subscribers (`#gac-subs`, rows
   `.gac-subscr`). Tests: worker.test.mjs (simulated clock), push.test.mjs,
   `tests/browser/subscribers.mjs`.
0. **Chat rooms in Durable Objects + AI usage meter**: the lost-message bug
   was the KV read-modify-write room log (`roomlog:<id>`) racing across
   locations; rooms now live in `ChatRoom` (`chat/room.js`, binding
   `CHAT_ROOMS`, migration `chat-rooms-v1`, SQLite class) which appends one
   message at a time and assigns strictly increasing `ts`. Unit tests fall
   back to the KV path (no binding). Proof: `tests/chat-rooms.test.mjs`,
   `tests/browser/chat-burst.mjs` (old code kept 1/50). Usage meter:
   `usageMeter()` in worker.js adds `usage` to `/status` and `/track` for
   people with a daily/monthly quota or rpm; `renderUsageMeter()` draws
   `#gpa-usage` under the header. Test: `tests/browser/usage-meter.mjs`.
   Read receipts: `/chat/poll?read=<ts>` (sent only while Chat is visible)
   moves the caller's cursor in the room DO (`reads`), every poll returns
   `reads`; `renderChatReceipt()` draws "Delivered"/"Read by …" under your
   newest message when it is the last in the room. Test:
   `tests/browser/read-receipts.mjs`.
   **Typing, who's here, reactions** (all in the room DO, `chat/room.js`):
   polls while Chat is visible add `here=1&typing=1|0`; the DO keeps that
   in memory (`this.live`; typing lasts 6 s after the last report, "here"
   10 s, "online" 45 s) plus a saved last-seen per person (written at most
   once a minute, `seen`), and every poll returns `typing` (names) and
   `people` (`{u, state: here|online|away, ago}`). `mayPostInChat()` keeps
   blocked/shadow-muted/banned people (and read-only chat) from showing as
   typing; `mayActInChatAs()` makes the owner's name need proof. Reactions:
   `POST /chat/react {room, code, user, ts, emoji}` (6 tapbacks, one per
   person per message, same again = off), stored as `m.r`, and every poll
   returns `reactions` (`ts → {emoji: [names]}`) for the whole room log.
   Client: `#gpa-chat-people`, `#gpa-chat-typing`, `renderTapbacks()`, the
   picker opens on double-click/double-tap/long-press or the ☺ button; a
   250 ms guard stops the tap that opened it from picking. Opening Chat
   now polls at once (`startChatPolling` restarts the loop). Tests:
   `tests/chat-rooms.test.mjs`, `tests/browser/chat-live.mjs`.
0. **Notification deep links**: every `notify()` carries a link built by
   `appLink(tab, params)` / `adminLink(sec, params)` in `worker.js`, e.g.
   `/console/#tab=admin&sec=users&user=renzo&focus=key`. In `script.js`,
   `openTabFromUrl` parses it; Admin links go to `adminDeepLink` → `goToLink`
   (opens the profile/section, waits for the target with `whenEl`, outlines
   it with `flashEl`; if Admin isn't connected it opens the connect screen
   and continues after `connect()`). The user inspector has an **API key**
   card (`#gac-insp-key`, uses `/admin/assignkey`). Test:
   `tests/browser/notification-links.mjs`.
0. **One sign-in per name** (Allowed users on): listed non-owner names are
   only usable through a PIN-checked server session (`effectiveUser` refuses
   bare names with `sessionRequired`), only the newest session is honored
   (`acct.sessions[0]`, else `sessionProblem = 'signed_in_elsewhere'`), and
   `/auth/login` answers 409 `inUse` while that session was used in the last
   15 min (`ONE_SESSION_IDLE_MS`; `lastSeen` rewritten at most every 5 min).
   GET routes accept the session as `?s=` (music `<audio>`, chat poll). The
   console does the server sign-in *before* `enterApp` when `/access` says
   `sessionRequired` (`serverFirstSignIn`), and session calls go to
   `AUTH_BASE()` (the telemetry Worker). Admin → Security → Allowed users
   lists each name's status with Sign out / Reset PIN. Owner exempt.
   Known gap: the first person to register a listed name sets its PIN.
   **Same computer, another website:** each session stores `ipH`/`uaH`
   (hashes of the caller's IP and User-Agent, `deviceHashes()`) and `site`
   (the host the console runs on, sent as `site` in the login body,
   `cleanSite`). When the live session matches the caller's hashes,
   `/auth/login` answers 409 `{ inUse, sameComputer, site }`; the console
   shows `#gpa-login-move` ("Sign in here" / "Cancel") and on Yes repeats
   the login with `takeover: true`, which issues a new session (logged as
   `signin_moved`). The old site gets `signed_in_elsewhere` plus
   `elsewhereSite` from /status or /track and shows where. A different
   device is still refused with no takeover. "Same computer" is a best
   guess (same network + same browser): two identical browsers behind one
   home router look the same. Test: `tests/browser/same-computer.mjs`.
1. **Music without keys** (`bf4b7f5`): Music tab searches **Audius** (free,
   keyless public API, streamed through the Worker) + a **shared library**
   in R2 that owner/admins upload to. Routes: `GET /music/search`,
   `/music/library`, `/music/file/:id` (Range), `/music/audius/stream/:id`
   (Range passthrough), `POST /music/upload`, `/music/delete` (rank ≥ admin
   or OWNER_CODE). Segments: Search · Shared · SoundCloud · This device.
   One now-playing bar (`#gpa-np`, Media Session lock-screen controls).
   YouTube search kept only for users with a saved key.
   **Not verified against real Audius** (blocked from the dev container);
   first real search happens on the owner's device. Copyright caveat for
   the shared library was explained to the owner.
2. **Access requests** (`2446815`): unlisted users see "Unable to create
   account" + a Request access form (`POST /access/request`, 5/hour per
   network, denied → wait a day). Owner reviews in Admin → Security →
   Access requests (Approve adds to allowlist / Deny / Clear;
   `/admin/access-requests`, `/admin/access-requests/decide`), push alert
   category `access`, notification deep-links `/console/#tab=admin&sec=security`.
3. **Allowed users** (`fbf6ed7`): Admin → Security → Allowed users (switch +
   list, case-insensitive, owner always allowed). Enforced server-side in
   `resolveState` (status, chat send, AI, uploads), `/auth/register`,
   `/auth/login`, `/track` (records nothing), `/chat/poll`, `/read`,
   `/music/*`. `GET /access?user=` for the sign-in screen. Signed-in users
   removed from the list are signed out with the message.
4. **Owner push notifications** (`451d288`, `1ee77cb`): standard Web Push
   (RFC 8291 aes128gcm + RFC 8292 VAPID, implemented with WebCrypto, no
   npm deps). Owner-only subscribe (`/push/subscribe` needs owner token,
   owner session or OWNER_CODE), per-device manage key (`/push/update`,
   `/push/status`, `/push/test`, `/push/unsubscribe`). 17 categories in
   `PUSH_CATEGORIES` (chat, chatrooms, mentions, reports, signin, newuser,
   approval, access, subs, presence, aierror, limits, error, security, admin, jobs,
   digest), quiet hours (urgent ones bypass), "Who's online" live alert with
   app-icon badge (closest thing to iOS Live Activities, which web apps
   can't use). UI: Settings → Account → Phone notifications (app mode).
5. **Dismissals stick** (`8a3ca48`): owner banner/popup dismissals stored per
   account (`POST /status/dismiss`, KV `dismiss:<user>`), returned by
   `/status` and `/track`; banner moved below the header (was under the iOS
   status bar, untappable).
6. **iPhone home-screen app** (`6e6d961`): `/console/` shell loads the same
   `script.js` (proxied from GitHub main, or `CONSOLE_SCRIPT_URL`) in **app
   mode** (`window.__agentConsoleApp`): edge-to-edge, safe areas, no
   close/collapse, 16px inputs (no iOS zoom), offline shell via service
   worker, install instructions on first Safari visit.
7. **UI/UX passes** (`842ff75`, `e410849`): sidebar sections, SVG icons
   instead of emoji, refinement CSS layer `GPR_CSS`, drawer sidebar on narrow
   panels, 44px touch targets, labels, min text sizes. Audited with the
   ui-ux-pro-max plugin's rules (installed in the container only).
8. Earlier (before this session's later work): Eaglercraft tab + Worker
   `/eagler/*` routes + loader, Wrangler/Workers Builds setup, binary
   WebSocket fix. Other contributors added the Chromebox Lite resource pack,
   performance preset, Saints Command, chat photos.

## 5. Conventions and gotchas in the code

- **`script.js` is huge; edit carefully.** Prefer exact-anchor replacements
  (assert the anchor appears exactly once) and refuse to write if the result
  is shorter than the original. A bad slice once truncated the file to 721
  lines (recovered via `git checkout -- script.js`). Always run
  `node --check script.js` after edits.
- Styling layers concatenate at the end of the base stylesheet:
  `... + GPS_CSS + GPX_CSS + GPR_CSS`. Put new styles in `GPR_CSS` using theme
  tokens (`--gpa-accent`, `--gpa-text`, `--gpa-sub`, `--gpa-field`,
  `--gpa-border`, `--gpa-card-bg`, `--gpa-shade`, …) so every theme works.
- Icons: `GPS_ICONS.<name>` (SVG). Buttons with icon + label use
  `gpxLbl(icon, text)` in markup and `gpxSetLbl(btn, icon, text)` at runtime.
  Don't add emoji as UI icons (game content/status text can keep them).
- **Changelog:** `const CHANGELOG = [...]` near the top of `script.js` drives
  per-tab version chips. Add an entry per feature (`parts: { tab: [kind, note] }`,
  kinds `fix|feature|added|redesign`).
- Translations: `I18N.es` + `NAV_LABELS_EN` (nav, login only).
- Admin "Command Center" sections render via `RENDER.<section>()`;
  `api(path, {method, body})`, `card(title, html, icon)`, `isOwner()`.
- Worker: big `handleRequest`; helpers like `json`, `getConfig`, `resolve`,
  `allowedUser`, `effectiveUser`, `resolvePrincipal`, `noteSec`, `logAudit`,
  `notify(ev)` (owner push) are closures inside it. Admin routes must be
  listed in `ADMIN_ROUTES` (path → method + perm) or they 404.
- After editing anything in `web/console/public/` or `web/public/`, run
  `npm run build:web` (regenerates `assets.generated.js`; a test checks this).
- Owner proof options server-side: `Authorization: Bearer ADMIN_TOKEN`,
  owner session (`X-GPA-Session`), or `X-GPA-Owner: OWNER_CODE`.
  Client-side the admin token lives only in memory
  (`admGet(ADMIN_KEYS.TELE_TOKEN)` after connecting Admin).

## 6. Testing

```bash
npm test                                   # node --test tests/*.test.mjs (77 tests)
node tests/browser/eaglercraft.e2e.mjs     # 83 checks (workerd via wrangler unstable_dev)
node tests/browser/console-app.mjs         # 20 (iPhone app)
node tests/browser/announcements.mjs       # 15
node tests/browser/notifications.mjs       # 15
node tests/browser/allowlist.mjs           # 6
node tests/browser/access-requests.mjs     # 12 (+ screenshots of every step)
node tests/browser/music.mjs               # 15 (+ screenshots)
node tests/browser/one-session.mjs         # 15 (impostor scenarios + screenshots)
node tests/browser/notification-links.mjs  # 15 (every notification tap lands on its spot)
node tests/browser/usage-meter.mjs         # 16 (meter states, Ask AI refresh, screenshots)
node tests/browser/usage-meter-sizes.mjs   # 25 (meter + one-line header at every panel size preset)
node tests/browser/chat-burst.mjs          # 4 (50 simultaneous messages, none lost)
node tests/browser/read-receipts.mjs       # 13 (three phones: Delivered → Read by …)
node tests/browser/subscribers.mjs         # 16 (add, start date, countdown, ended, renew)
node tests/browser/staff-chat.mjs          # 19 (moderator, owner, regular user can't see it)
node tests/browser/same-computer.mjs       # 12 (two websites, one computer: warn, move, cancel)
node tests/browser/chat-live.mjs           # 23 (typing, who's here, reactions; 3 phones + laptop)
npx wrangler deploy --dry-run --outdir /tmp/x   # bundling/config check, deploys nothing
```

- Browser tests take an output dir argument (screenshots); default dirs are
  git-ignored. They use `tests/browser/env.mjs` (`startEnv({ extraEnv })`)
  and `harness.mjs`.
- **The local workerd KV/R2 persist between runs** (`.wrangler/`). Tests use
  unique usernames per run and clean up what they create (banners, requests,
  music) so suites don't leak into each other.
- Headless Chromium has no push service: the notifications browser test fakes
  `PushManager`; real encryption/VAPID is proven in `tests/push.test.mjs` by
  decrypting payloads like a phone.
- Audius is mocked (unit: stubbed fetch; browser: local stand-in server via
  `AUDIUS_API`); test songs are synthesized tones in
  `tests/browser/fixtures/music/`.

## 7. Environment notes (the cloud dev container)

- Outbound network is restricted: `*.workers.dev`, `api.audius.co`, Mojang
  hosts are **blocked** from the container. You can't hit the live Worker or
  Cloudflare; verify with local workerd + dry runs, and tell the owner what
  couldn't be verified live.
- Playwright Chromium at `/opt/pw-browsers` (don't run `playwright install`).
- `ffmpeg` and Python 3 (no PIL) are available.
- The ui-ux-pro-max plugin was installed into this container only; its rules
  were applied by hand.

## 8. Known limits and open ideas

- Real Audius search/stream never exercised from here; if the owner reports
  problems, check the response shape and whether `app_name` alone is still
  accepted, or set `AUDIUS_API` to a specific discovery node.
- Eaglercraft can't launch on iPhone (requires fullscreen API + keyboard).
- The allowlist sign-in check fails open if the Worker is unreachable
  (server features still refuse unlisted names).
- Saints Command (`/app/`) approve flow requires reconnecting Admin each app
  launch (token kept in memory only).
- `previews` KV shares production data.
- Ideas the owner may like next: a colorful default theme for new users
  (offered, not done); more Admin views for music (upload approvals from
  non-admins); presence check frequency tuning if iOS shows each update as a
  separate notification.

## 9. Owner-facing how-tos (already given)

- Install the app: Safari → `https://donnajbe.viztrrx.workers.dev/console/`
  → Share → Add to Home Screen → keep "Open as Web App" on → Add.
- Notifications: app → Settings → Account → Phone notifications → Turn on
  (admin token asked once if not proven owner) → Send a test.
- Allowed users / access requests: Admin → Security.
- Shared music: Music → Shared → Add songs (owner/admins; Admin connected or
  owner code set).
