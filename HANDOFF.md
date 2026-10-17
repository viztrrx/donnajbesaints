# Handoff: Agent Console (donnajbesaints)

Everything the next Claude session needs: who the owner is and how they
work, what the project is, how it's built, every feature and where it lives,
how to test, and what's open. Read this first, then `README.md` (the
user-facing docs). Last updated 2026-10-17 after the three-round feature
list (rounds 1–3) was finished and pushed.

---

## 0. Read this first

### Status right now
- **Nothing is half-done.** All work from this session is on `main` and
  deployed (pushing to `main` deploys; see below). The last commit:
  **Playlists → YouTube links** (owner: "a tool that identifies the songs
  in the playlist links either from apple music or spotify and gives me all
  the youtube links to those original songs organized by the playlist").
  Before that: **admins in the phone app** (owner's words: "make it so admins i have
  listed can also add the console agent to their phone with the same exact
  features as me just as admin… they dont have to put the ADMIN_TOKEN…
  only the admin no other user will have access to the app… their music
  they uploaded from their phone should be there as well on the computer").
  Before that: **weekday streaks + My music** (the owner's request: "make day streaks
  last only thru out the weekdays… weekends dont count so the streak will
  still be active when they log back in on monday, also… if a user uploads
  their music via their computer… they can also share that to others and
  have them be able to stream it as well and save in their account").
- **Nothing is pending from the owner.** Earlier requests were built in
  three rounds; see §4 for each piece. Good next ideas are in §8, but
  **don't start new features unless the owner asks**; offer them.

### How the owner works (follow this exactly)
- **The owner:** username `viztrrx` (the Worker's `OWNER`), Lehigh Acres,
  FL; time zone `America/New_York`. They're non-technical-ish, run the
  console as the **iPhone home-screen app** (`/console/`), get phone
  notifications from it (including "Worker error" alerts, which they
  sometimes paste in as screenshots), and often reply just "push to main".
- **Plain-language reports.** Every report: what changed (a table helps),
  how it works, what was **and wasn't** tested, and **screenshots of the
  real app** (Playwright + headless Chromium against local workerd).
  Label anything that isn't real (sample data, mock-ups) as such. Use
  step-by-step instructions for anything they have to do (iPhone steps).
- **Don't affect people already approved.** Their words: "make sure it
  doesn't affect the current users approved right now". New features are
  **off or opt-in by default**, or only apply to things created after the
  feature shipped (e.g. invite codes only for names added later). Anything
  that posts into chat for everyone gets an owner on/off switch.
- **Work in rounds, one tested push each.** For a list of features: build a
  round, run the whole test routine (§6), **update this HANDOFF.md** with
  what was built, the context and what's next, **then push to `main`**, then
  start the next round. Their words: "after every round update the
  handoff.md file every time with your next task and your context and
  planning and when a task is completed push to main branch then start on
  the other task".
- **Pushing to `main` deploys.** Cloudflare Workers Builds runs
  `npx wrangler deploy` on every push. Never push untested or half-done
  code; keep work in progress uncommitted until its round passes. (Earlier
  replies wrongly said "it needs the usual deploy"; it doesn't.)
- **Honesty over polish.** Say what couldn't be verified (the live Worker,
  real iPhones, real Audius, real push delivery can't be reached from the
  dev container). Never claim Eaglercraft works without the real build.

### Git rules
- **Push to `main` only, fast-forward only:**
  `git fetch origin main && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main`.
  Work on a local `main`. Don't push to, rebase or touch any `claude/*`
  branch (the session's assigned branch included); if a stop hook complains
  about unpushed commits on a `claude/*` branch, keep the checkout on
  `main`. Don't open PRs unless asked.
- Commit messages: clear subject, plain body; end with the attribution
  lines the session's system prompt gives. Never put a model name in a
  commit, PR or code comment.
- **No secrets in Git**: `ADMIN_TOKEN`, `COADMIN_TOKEN`, `OWNER_CODE`, VAPID
  private keys, APNs keys, API keys live in Cloudflare (secrets or KV). The
  KV namespace id in `wrangler.jsonc` isn't a secret.
- **Extend, don't replace**: don't remove or replace the `TELEMETRY` KV
  binding (`cebe1a618cba45278f6784bd53f0d59f`), don't create new KV
  namespaces or Workers, don't replace `worker.js` or build a "second
  implementation" of anything. (Durable Object classes inside the same
  Worker, like `ChatRoom`, were fine.)
- **No Mojang/Minecraft files** in the repo (no real `classes.js`,
  `assets.epk`, client jars).

---

## 1. What this project is

**Agent Console**: one injectable web interface (`script.js`, ~24k lines)
that runs inside a Shadow DOM on any page (bookmarklet / DevTools snippet
`fetch(raw script.js).then(r=>r.text()).then(eval)`), plus its backend, a
Cloudflare Worker (`worker.js`, ~5k lines).

- Worker **`donnajbe`** at `https://donnajbe.viztrrx.workers.dev`.
- **Home-screen app** at `/console/` (iPhone: Safari → Share → Add to Home
  Screen → "Open as Web App"); it loads the same `script.js` (proxied from
  GitHub `main`, or `CONSOLE_SCRIPT_URL`) in *app mode*
  (`window.__agentConsoleApp`).
- **Saints Command** at `/app/`: a separate owner admin web app (another
  contributor's; `web/handler.js`, `mobile/backend/*`).
- Deploys: Cloudflare **Workers Builds** on every push to `main`
  (`wrangler.jsonc`, `keep_vars: true`).

**Tabs** (sidebar, grouped): Welcome · *Assistant:* Page Insights, Ask AI,
Chat (+ Staff chat for staff) · *Play:* Music, Proxy, Eaglercraft, Games ·
*Study & write:* Study, Notes, Humanize, Grammar · *Library:* Saved,
Settings (+ hidden Admin "Command Center"). Eaglercraft must stay right
after Proxy, before Games.

---

## 2. Architecture

| Area | Files |
|---|---|
| Console UI (all client code, styles, markup) | `script.js` |
| Worker: every server route | `worker.js` |
| Chat rooms (one Durable Object per room) | `chat/room.js` (`ChatRoom`, `chatRoomCall`, `triviaMatches`) |
| Daily trivia questions (60) | `chat/trivia.js` |
| Web Push (owner alerts + everyone's mention alerts) | `web/console/push.js` |
| Music (Audius + shared library, `audioKind`) | `web/music.js` |
| Home-screen app shell (`/console/`) | `web/console/public/*`, `web/console/handler.js` → `web/console/assets.generated.js` (`npm run build:web`) |
| Saints Command (`/app/`) | `web/handler.js`, `web/public/*`, `mobile/backend/*`, `mobile/apns-relay/*` |
| Eaglercraft loader | `eaglercraft/loader/*`, `resource-packs/chromebox-lite/*`, `scripts/build-eaglercraft.sh` |
| Wrangler config | `wrangler.jsonc` |
| Tests | `tests/*.test.mjs` (node --test), `tests/browser/*.mjs` (Playwright vs local workerd) |

### Bindings (`wrangler.jsonc`)
- `TELEMETRY` (KV): accounts, sessions, config, moderation, audit, push
  subscriptions, dismissals, access requests, invites, usage, leaderboards…
- `donnajbe_eaglercraft_client` (R2): Eaglercraft files, chat photos and
  voice messages under `chat-media/`, shared music under `music/`.
- `CHAT_ROOMS` (Durable Object `ChatRoom`, migration `chat-rooms-v1`, SQLite):
  every chat room's log and live state. `ADMIN_MOBILE` (`AdminMobileState`):
  Saints Command.
- `previews.kv_namespaces` points at the same KV (known, accepted).
- **Crons:** `"0 5 * * *"` (daily jobs: chat cleanup, memory maintenance)
  and `"*/5 * * * *"`: presence check, daily summary at 12 PM, weekly report
  Sun 6 PM, subscription sweep, hourly activity sample, daily trivia at
  12 PM (all owner time). Listing crons in wrangler replaces dashboard ones.

### Worker vars/secrets (Cloudflare only)
`ADMIN_TOKEN`, `COADMIN_TOKEN`, `OWNER_CODE`, `OWNER` (default `viztrrx`),
`OWNER_TZ` (default New York), `EAGLER_*`, `ALLOW_QUERY_TOKEN`, optional
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (else generated into
KV `push:vapid`), `CONSOLE_SCRIPT_URL`, `AUDIUS_API`,
`APNS_RELAY_URL`/`APNS_RELAY_SECRET`, optional `YOUTUBE_API_KEY`,
`SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` (Playlists).

### KV keys (TELEMETRY)
`config` (allowlist, subscriptions, subLedger, chatQuiet, fun, flair,
quotas, maintenance…) · `acct:<name>` (PIN verifier, role, sessions) ·
`session:<sid>` (presence, expires) · `user:<name>` (rollup: opens,
firstSeen, lastSeen, streak) · `mod:<name>` · `usage:<day>:<name>`,
`usagem:<month>:<name>` · `sec:<day>` · `audit` · `invite:<name>` ·
`accessreq:u:<name>` · `room:<id>` (private room code hash) · `push:subs`
(owner devices), `push:user:<name>` (mention alerts), `push:vapid`,
`push:rl:*`, `push:mrl:*` (throttles), `push:digest:last`,
`push:weekly:last`, `push:presence:*` · `heat:<week start>` · `streaks` ·
`trivia:day`, `trivia:points` · `lb:<game>`, `lb:shout:<game>` ·
`dismiss:<name>` · `key:openai:<name|*>` · `mem:u:<name>` · `fail:*`
(lockouts) · `chat-photo-rate:*`, `chat-voice-rate:*` · `mylib:<name>`
(a person's My music list), `mylib:total` (bytes of everyone's uploads),
`mylib-rate:<day>:<name>` · `ytlists:<name>` (Playlists → YouTube links),
`ytlists-rate:<day>:<name>`.

### Inside the ChatRoom Durable Object (per room)
Storage: `log` (newest 120 messages, a week), `reads` (read cursors),
`seen` (last-seen times), `pins` (≤3), `counts` (messages per person per
day, 14 days; not system notices), `trivia` (#public only). Memory only:
`live` (who's here / typing). Actions: `read`, `append`, `react`, `edit`,
`pin`, `vote`, `unsend`, `delete`, `clear`, `stats`, `trivia_open`.

---

## 3. Gotchas (each of these bit once)

- **`worker.js` may export only handlers and classes.** Exporting a plain
  value (e.g. a number) makes workerd refuse to start the Worker with
  "Incorrect type for map entry". `npm test` (Node) can't see this; the
  browser suites (real workerd) do. Put shared data in its own module
  (that's why `chat/trivia.js` exists).
- **Start-up order in `script.js`:** it's one big IIFE; `let`/`const`
  declared further down (e.g. `currentUser`, `serverSession`) can't be read
  while earlier code runs at start-up (TDZ crash = blank console). Anything
  that reads the user/session during init must be deferred
  (`setTimeout(…, 0)`) or guarded with try/catch.
- **Edit `script.js` with exact anchors**, assert each anchor appears once,
  never write a shorter file by accident (a bad slice once truncated it to
  721 lines), and run `node --check script.js` after every edit.
- **Don't edit `script.js`/`worker.js` while browser suites run**: the
  tests load the live files on each run.
- **KV is eventually consistent and the free plan has small write limits**
  (~1,000 writes/day). Keep writes rare (per day, per hour, or only on
  change). Anything that must be exact or ordered (chat, votes, trivia
  winner) goes in the room Durable Object.
- **128 MB per Worker instance, shared by all its requests.** One heavy
  request breaks everyone's on that instance (that's what "Worker exceeded
  memory limit" on `/chat/poll` was). Cap bodies, stream big responses,
  shrink images client-side (§4.7).
- Admin routes must be listed in `ADMIN_ROUTES` (path → method + perm) or
  they 404; the gate runs before the handler.
- Owner proof server-side: `Authorization: Bearer ADMIN_TOKEN`, an owner
  session (`X-GPA-Session`), or `X-GPA-Owner: OWNER_CODE`. Client-side the
  admin token lives only in memory (`admGet(ADMIN_KEYS.TELE_TOKEN)`).
- Styles go in the `GPR_CSS` layer with theme tokens (`--gpa-accent`,
  `--gpa-text`, `--gpa-sub`, `--gpa-panel`, `--gpa-field`, `--gpa-border`,
  `--gpa-success`, `--gpa-warning`, `--gpa-danger`…). Icons:
  `GPS_ICONS.<name>`; `gpxLbl(icon, text)`.
- **Changelog:** add an entry to `const CHANGELOG = [...]` near the top of
  `script.js` for every feature (`parts: { tab: [kind, note] }`, kinds
  `fix|feature|added|redesign`); it drives the per-tab version chips.
- After editing `web/console/public/` or `web/public/`, run
  `npm run build:web` (a test checks the generated file is current).
- Shell: `pkill -f "<pattern>"` can match its own command line and kill the
  shell you're in; prefer killing by PID.

---

## 4. Features (by area): what, where, tests

### 4.1 Access, accounts and sign-in
- **Allowed users** (Admin → Security): switch + list; enforced server-side
  (`allowedUser`, `resolveState`) on register/login/track/poll/AI/music/read.
  Signed-in people taken off the list are signed out with a message.
  Test: `allowlist.mjs`.
- **Access requests**: unlisted people can ask (`/access/request`, 5/h per
  network); owner approves/denies in Security. Test: `access-requests.mjs`.
- **One sign-in per name** (list on): listed names need a PIN-checked
  server session (`effectiveUser` → `sessionRequired`); only the newest
  session counts; a second device is refused while the first was used in
  the last 15 min. **Same computer, another website**: warns and offers
  "Sign in here" (takeover) via `ipH`/`uaH`/`site` on the session. Owner
  exempt. Tests: `one-session.mjs`, `same-computer.mjs`.
- **Admins and the phone app** (`appStaffOnly`, on unless the owner turns
  it off in Admin → Security → Phone app): the home-screen app only lets the
  owner and `admin`-role accounts in. Detected server-side by the request
  coming from the Worker's own origin (`fromApp()`: Origin = url.origin or
  Referer under `/console/`); `/access` adds `appStaffOnly` (not for the
  owner's name, who may use the app without a server account), so the app
  always does a server sign-in; `/auth/login` and `/auth/register` refuse
  non-admins from the app, and `/auth/me` makes the app sign them out on the
  next launch. Admins are exempt from one-device (`oneDevice()`): phone and
  computer at once. Admin panel: a session with role ≥ moderator already
  connects without a token (`creds()` sends `X-GPA-Session`); the bug that
  hid it right after a server-first sign-in (emitSession ran before
  `currentUser` was set) is fixed in `serverFirstSignIn`. A role change
  revokes the person's sessions (they sign in again). Owner phone alerts
  stay owner-only. Tests: `admin-app.test.mjs`, `admin-app.mjs` (browser
  suites use `startEnv({ appGate: true })` to keep the gate; it's off by
  default in `tests/browser/env.mjs` because most suites sign regular users
  into the app).
- **Invite codes** (round 1): names added to the list *after* this shipped
  get a one-time code (`invite:<name>`, `/admin/invites`); registering that
  name needs it (`body.invite`; wrong code counts toward the lockout).
  Already-approved names and access-request approvals are untouched. UI:
  Allowed users rows (Copy code / Remove code / Make invite code); sign-up
  shows the code box only when the Worker asks. Tests:
  `owner-tools.test.mjs`, `owner-tools.mjs`.
- **Subscribers** (paid access for a set time): `config.subscriptions`,
  `/admin/subscriptions` (add/renew/setstart/end/delete, amounts in
  `subLedger`), `sweepSubscriptions()` every 5 min, owner alerts 3 days
  before/at the end, subscriber countdown strip `#gpa-substrip`, and (round
  1) a once-a-day "your access ends in N days" pop-up in the last 3 days
  (`remindSubscriber`, removed on sign-out). Tests: `subscribers.mjs`.

### 4.2 Chat
All rooms live in `ChatRoom` DOs. The console polls every 3 s while Chat is
on screen (1.5 s while someone types, 15 s in the background).
- **Rooms**: #public, private rooms by code (`/admin/rooms`), **staff chat**
  (`staff`, moderators/admins/owner only; `isStaffCaller()`).
  Tests: `chat-rooms.test.mjs`, `staff-chat.mjs`, `chat-burst.mjs` (50
  simultaneous messages, none lost; the old KV log lost 49).
- **Read receipts** (iMessage style "Delivered / Read by"), **typing**,
  **who's here** (here / online / last seen), **reactions** (6 tapbacks).
  Tests: `read-receipts.mjs`, `chat-live.mjs`.
- **Replies** (quote built by the DO from `replyTo`), **unsend** within
  2 min (placeholder, photo/voice deleted), **grouping** of runs from one
  person. Test: `chat-replies.mjs`.
- **Round 2**: **@mentions** (autocomplete, highlight, phone alerts for
  everyone via Settings → Account → Mention alerts; #public and staff only;
  `/push/me/*`, `notifyUser`), **polls** (`/poll Q | A | B` or "X or Y?",
  `/chat/vote`), **edit** within 2 min (`/chat/edit`), **pins** (staff, ≤3,
  `/chat/pin`), **voice messages** (≤30 s, `audioKind`, Range streaming,
  40/day), **quiet hours** (`cfg.chatQuiet`, Admin → Moderation, off by
  default; staff exempt). Tests: `chat-round2.test.mjs`, `chat-round2.mjs`.
- **Round 3**: **chat effects** (confetti/balloons, client-only, Settings
  switch, never with reduced motion), **flair** (owner picks in Admin →
  Users; 🛡 for staff from `m.staff`), **daily trivia** (12 PM, first right
  answer wins, `trivia:points`, owner switch + "Ask a question now"),
  **system notices** (`m.sys`), **song sharing** from Music (track cards with
  ▶ Play). `/chat/extras` (flair, streaks, trivia points) every 5 min.
  Tests: `fun.test.mjs`, `fun.mjs`.
- **Moderation** stays as before: block, mute, shadow-mute (invisible to
  the person: their reactions "work" but aren't stored), bans, slow mode,
  read-only, reports → delete.

### 4.3 Owner notifications and tools
- **Phone notifications** (owner): Web Push implemented with WebCrypto
  (RFC 8291/8292), 18 categories in `PUSH_CATEGORIES` (incl. `subs`,
  `digest` daily at 12 PM, `weekly` Sundays 6 PM), quiet hours, live "who's
  online". Every alert deep-links to its exact spot (`appLink`/`adminLink`
  → `openTabFromUrl`/`goToLink`). Tests: `push.test.mjs`,
  `notifications.mjs`, `notification-links.mjs`.
- **Weekly report** (round 1): people active/new, chat messages + top three
  chatters (from room DO counts), AI requests, subscription money;
  Admin → Overview card with "Send it to my phone now"; `/admin/weekly`.
- **Activity heatmap** (round 1): hourly sample of who's online into
  `heat:<week>`, averaged over 4 weeks, 7×24 grid in Admin → Overview.
- **Admin Command Center**: Overview, Users (inspector with API key, flair,
  quotas, role), AI & Usage, Security (policy, allowed users, invites,
  access requests, subscribers), Moderation (reports, quiet hours, fun
  features), and more. Sections render via `RENDER.<section>()`.

### 4.4 Games
30+ built-in games. **Leaderboards** (round 3): new personal bests go to
`/games/score` (`setBestIfHigher` + reaction/guess), top 10 per game in
`lb:<game>`, shown under the game (🏆 Leaderboard); a new #1 is announced
in #public (owner switch). `GAME_RULES` refuses impossible scores.

### 4.5 Welcome
Your activity: sessions opened, member since, and the **weekday streak**
(`user:<name>.streak` `{n, day}`, owner time zone). Mon–Fri only: weekends
neither add nor break it (`nextStreak`, `streakAlive`, `prevWeekday` in
worker.js; Friday → Monday continues). On a weekend the box says "safe this
weekend" / "start it any weekday" (`yourStats.weekend`). A streak starts
on whichever weekday someone first opens the console (not only Monday). Same rule for the 🔥 in
chat (`/chat/extras`). Tests: `fun.test.mjs`, `my-music.mjs`.

### 4.6 Music
Keyless: Audius search + a shared library in R2 (owner/admins upload).
One now-playing bar with lock-screen controls; 💬 shares the song to chat.
**My music** (source button `data-src="mine"`): any signed-in person
uploads their own songs (`POST /music/mine/upload`, list `GET /music/mine`,
`POST /music/mine/delete`; a real session is required, a typed name isn't
enough). Stored in R2 `music/<id>` (same prefix, streamed by the same
`/music/file/<id>`) and listed in KV `mylib:<name>`, so they follow the
account to any device. Caps in `web/music.js`: 50 songs / 300 MB each,
30 uploads a day, all music ≤ `MUSIC_MAX_BYTES`. Chat track source
`'mine'` is accepted by `/chat/send`. The owner/admins can delete anyone's
upload by id (API only, no button). **Not verified against real Audius** (blocked from the dev
container). Tests: `music.test.mjs`, `music.mjs`, `my-music.mjs`.
**Playlists → YouTube links** (owner + admins; `web/playlists.js`, routes
`/music/lists*` gated by `staff()`, KV `ytlists:<who>`): paste a Spotify /
Apple Music playlist or album link → the Worker reads the song list
(Spotify Web API if `SPOTIFY_CLIENT_ID/SECRET`, else the public embed page's
`__NEXT_DATA__`, first 100 songs; Apple: the page's `serialized-server-data`
and JSON-LD) → `/music/lists/find` looks up 8 songs per call with the
YouTube Data API (`YOUTUBE_API_KEY` or the console's saved key in
`X-GPA-YT-Key`, never stored) and `pickVideo` prefers the artist's Topic /
VEVO / official channel and rejects covers, sped-up, live etc. **Links only,
nothing downloaded** — the owner first asked to rip the songs to MP3; that
was declined (copyright) and this was the agreed alternative; don't add a
download/convert step. **Never verified against the real Spotify, Apple
Music or YouTube** (all blocked from the dev container); tests use
stand-ins via `SPOTIFY_WEB`/`APPLE_MUSIC_WEB`/`YOUTUBE_API`. If the owner
says a link "found no songs", the page format probably changed: start in
`readSpotifyEmbed` / `readApple`. Tests: `playlists.test.mjs`,
`playlists.mjs`.

### 4.7 AI and memory limits
Ask AI goes through `/v1/*` (assigned keys stay server-side). Photos are
shrunk to 1600 px JPEG in the console; the Worker refuses bodies over 24 MB
and drops its copies before awaiting OpenAI; `/read` stops at 3 MB. AI
usage meter for people with quotas (`#gpa-usage`). Tests:
`memory-limits.test.mjs`, `ask-photo-size.mjs`, `usage-meter*.mjs`.

### 4.8 Other
Home-screen app (`console-app.mjs`), banners/announcements with sticky
dismissals (`announcements.mjs`), Eaglercraft (`eaglercraft.e2e.mjs`; the
real client build is separate, see `eaglercraft/README.md`), Saints Command.

---

## 5. Session history (newest first)

| Commit | What |
|---|---|
| (this) | Playlists → YouTube links (owner + admins) |
| `c073296` | Admins: phone app for owner + admins, no admin token, two devices |
| `ef627f0` | Streaks: start on any weekday |
| `ee82ee3` | Weekday streaks; My music (personal uploads, shareable) |
| `d3fd527` | HANDOFF rewrite |
| `5f2b5ac` | Fun: effects, flair, streaks, leaderboards, trivia, song sharing |
| `31b2322` | Chat round 2: @mentions, polls, edit, pins, voice, quiet hours |
| `3492b84` | HANDOFF: status, the owner's way of working, round plans |
| `04ed68b` | Invite codes, weekly report, activity heatmap, subscriber reminders |
| `8428005` | Fix "Worker exceeded memory limit" |
| `e61778e` | Chat: replies, unsend, grouping |
| `8b76f60` | Chat: typing, who's here, reactions |
| `3195143` | One sign-in: move between websites on the same computer |
| `8d814ca` | Staff chat |
| `5f83c4b`, `ad74109` | Subscribers (+ start dates, amounts, countdown) |
| `60b4d62` | Read receipts |
| `3321fb5`, `83a5896` | Header on one line; usage meter at every size |
| `a899452` | Fix lost chat messages (rooms → Durable Objects); AI usage meter |
| `e8aa4d5` | Daily summary at 12 PM |
| `2a460ce` | Notifications open their exact spot |
| `b62f2e0` | One sign-in per name |
| `bf4b7f5` | Music without keys |
| `2446815`, `fbf6ed7` | Access requests; Allowed users |
| `1ee77cb`, `451d288` | Owner push notifications |
| `6e6d961` | iPhone home-screen app |

---

## 6. Testing

```bash
npm test                                   # node --test tests/*.test.mjs (107 tests)
npx wrangler deploy --dry-run --outdir /tmp/x   # bundle/config check, deploys nothing
# Browser suites (Playwright vs local workerd), each takes an output dir for screenshots:
node tests/browser/eaglercraft.e2e.mjs     # 83
node tests/browser/console-app.mjs         # 20
node tests/browser/announcements.mjs       # 15
node tests/browser/notifications.mjs       # 15
node tests/browser/notification-links.mjs  # 15
node tests/browser/allowlist.mjs           # 6
node tests/browser/access-requests.mjs     # 12
node tests/browser/one-session.mjs         # 15
node tests/browser/same-computer.mjs       # 12
node tests/browser/subscribers.mjs         # 16
node tests/browser/owner-tools.mjs         # 15
node tests/browser/staff-chat.mjs          # 19
node tests/browser/chat-burst.mjs          # 4
node tests/browser/read-receipts.mjs       # 13
node tests/browser/chat-live.mjs           # 23
node tests/browser/chat-replies.mjs        # 20
node tests/browser/chat-round2.mjs         # 26 (fake microphone)
node tests/browser/fun.mjs                 # 18
node tests/browser/music.mjs               # 15
node tests/browser/my-music.mjs            # 15
node tests/browser/admin-app.mjs           # 20
node tests/browser/playlists.mjs           # 17
node tests/browser/usage-meter.mjs         # 16
node tests/browser/usage-meter-sizes.mjs   # 25
node tests/browser/ask-photo-size.mjs      # 6
```

**The routine before every push:** `npm test`; then every browser suite one
at a time from a clean state (`rm -rf .wrangler/state`, ~5 min timeout
each, ~25 min total, so run the loop in the background and wait for a
"done" marker); the dry run; look at the screenshots; then commit and push.

- The local workerd keeps KV/R2/DO state in `.wrangler/` between runs
  (git-ignored), and suites in one loop share it: tests use unique names
  per run, must not assume they're alone in #public (people from the
  previous suite count as "online" for 45 s; trivia/record notices
  (`.gpa-chat-msg.sys`, no avatar) and other users' messages may be in the
  log), and should type enough of a name to be unique.
- Headless Chromium has no push service: browser tests fake `PushManager`;
  real encryption/VAPID is proven in `push.test.mjs`.
- Audius is mocked; test songs are synthesized tones in
  `tests/browser/fixtures/music/`.
- The heatmap screenshot in `owner-tools.mjs` uses sample data the test
  supplies (weeks of hourly samples can't be faked in workerd); the math is
  unit-tested.

---

## 7. Environment (the cloud dev container)

- Outbound network is restricted: `*.workers.dev`, `api.audius.co`,
  OpenAI and Mojang hosts are blocked. You can't reach the live Worker or
  Cloudflare; verify with local workerd + dry runs and tell the owner
  what couldn't be checked live.
- Playwright Chromium at `/opt/pw-browsers` (don't run `playwright install`).
- Python 3 (with PIL) and `ffmpeg` are available (handy for contact sheets
  of screenshots and test media).

---

## 8. Known limits and ideas

- Never verified live from here: real Audius, real push delivery to an
  iPhone (mention alerts included), the live Cloudflare deploy. If the
  owner reports a problem with one, start there.
- "Same computer" detection is a best guess (same network + same browser).
- Eaglercraft can't launch on iPhone (fullscreen + keyboard needed).
- The allowlist sign-in check fails open if the Worker is unreachable
  (server features still refuse unlisted names).
- Saints Command needs Admin reconnected each launch (token in memory).
- Push notifications already sent can't be unsent; an unsent photo may stay
  in a browser cache for up to 5 minutes.
- When Allowed users is off, names aren't PIN-verified (anyone can type a
  name), so per-name protections (unsend, mention alerts) only really hold
  with the list on.
- My music needs a real sign-in (session). With Allowed users off, a
  profile only exists on the device that created it, so "my songs on any
  device" only works with the list on (how the owner runs it). Deleting a
  shared song makes its chat card stop playing. The Worker lets the
  owner/admins delete anyone's upload by id, but there's no button or admin
  list of everyone's uploads yet.
- Ideas the owner may like (offer, don't build unasked): a colorful default
  theme for new users; an admin view of everyone's My music uploads;
  @everyone for staff; weekly trivia leaderboard; per-room quiet hours.

---

## 9. Owner how-tos (already explained to them)

- **Install the app:** Safari → `https://donnajbe.viztrrx.workers.dev/console/`
  → Share → Add to Home Screen → keep "Open as Web App" on → Add.
- **Phone notifications:** app → Settings → Account → Phone notifications →
  Turn on (admin token asked once) → Send a test. Weekly report and daily
  summary are categories there.
- **Allowed users, invite codes, access requests, subscribers:** Admin →
  Security. A newly added name shows its invite code with Copy code.
- **Quiet hours, fun features (trivia, record posts), "Ask a trivia
  question now":** Admin → Moderation.
- **Flair:** Admin → Users → the person → Flair.
- **Heatmap and weekly report:** Admin → Overview.
- **Mention alerts (anyone), chat effects on/off:** Settings → Account.
- **Shared music:** Music → Shared → Add songs (owner/admins).
- **Check a deploy:** Cloudflare dashboard → Workers & Pages → `donnajbe`
  → Deployments; errors: Logs.
