# Handoff: Saints Service (work-service)

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
  **Owner renamed to `ivan`** (owner: "locked out my owner acc… make it so
  'ivan' is the new owner instead of viztrrx and allow it to be used in the
  web as well"). worker.js `DEFAULT_OWNER = 'ivan'` (all 5 `env.OWNER ||`
  fallbacks) and root wrangler.jsonc `"vars": { "OWNER": "ivan" }` (owner-
  approved: config vars override the dashboard's on deploy; bindings
  unchanged). `/auth/register` for the owner name also accepts the owner
  admin token (client sends it when Admin is connected); Memory gate button
  says "Set up your owner PIN" when the server said "reserved". All browser
  tests sign in as `ivan` now. viztrrx is an ordinary name; its data
  (mylib/mem/convs) stays under it. Test: browser new-owner.mjs (11: web
  sign-up → Admin → set owner PIN; app sign-in with it at the same time).
  Before that:
  **Owner PIN reset** (owner: Memory → Reconnect said "Wrong PIN."; that is
  the LOCAL profile check in `reconnectWithPin`; under it the server said
  "name reserved": the owner account was never created on the server, which
  needs OWNER_CODE). New POST `/auth/owner-pin` {user, verifier, site}: owner
  name only, proven by the owner admin token or X-GPA-Owner (else 403 +
  `noteFailure(admin)` + sec event); sets salt/verifier (creates the account
  with ownerVerified if missing), epoch+1 (old sessions die), clears
  acctlock/acctfail, `issue()`s a session, audits, alerts the owner.
  Client: `resetOwnerPin()` (also rewrites the local profile's pinHash) and
  the Memory gate's "Forgot your PIN? Reset it" (`#gmem-reset-row`, form
  `#gmem-reset`; shown when an admin token / owner code is in memory;
  others see "Sign out, then Forgot PIN?"). Tests: owner-pin.test.mjs (3),
  browser owner-pin.mjs (10).
  Before that:
  **Messages for the owner without a server sign-in** (owner's iPhone said
  "Sign in to send and get messages"): the owner name only gets a server
  session when OWNER_CODE is proven at account creation, so the owner's
  devices usually have none. `chatIdentity()` (worker.js, next to
  `inboxCall`) = session user, else the owner via the owner admin token or
  a valid X-GPA-Owner; used by the conversation branch of
  `checkRoomAccess`, `/dm/*` and `/notify/claim`. Client: `dmSignedIn()`
  also accepts an owner code / admin token in memory; `dmFetch` and
  `staffProofHeaders(convRoom)` send the admin token (and code) when there
  is no session. Tests: messages.test.mjs (+1), browser
  owner-messages.mjs (9).
  Before that:
  **Rename songs; owner upload fix; Chromebook pop-ups** (owner: "rename the
  music file and change the artist and name… everyone"; owner's upload said
  "Sign in to keep your own music"; "dm and chat notifications for chrome
  … chromebook… make no mistakes"). Upload bug: the owner with Admin
  connected sends `Authorization: Bearer <admin token>`; `resolvePrincipal()`
  returns the TOKEN principal first, so `effectiveUser()` saw no session →
  unverified → 401 on /music/mine. Fix: session checking split into
  `resolveSession()` (own memo `sessionMemo`); `effectiveUser` uses the
  session even when a token is the principal, and treats the owner token or
  a valid owner code (X-GPA-Owner) as the verified owner for OWNER's own
  name. Songs: web/music.js `cleanFileName` (no / \ : * ? " < > |, ext from
  the audio type), tracks get `file` (default "Artist - Title.ext"),
  `editMine` / `editLibrary` (`applyEdit`: title required, artist, file),
  routes POST `/music/mine/edit` (own) and `/music/edit` (staff, audited);
  `serveLibraryFile` `?dl=<name>` → Content-Disposition attachment. Client:
  `renderTracks` opts `editable`/`downloadable`/`onEdit`, `openTrackEdit()`
  form (opens by itself after a single upload), `saveTrackEdit()`.
  Pop-ups: `deskN` state (next to the Messages state), module "Pop-up
  notifications (Chrome, Chromebooks)" after Messages: `gpa_desk_notify`
  dm|all|off (default dm, needs Chrome permission), sources = DM list diff
  (`deskFromDmList`, 20 s), `chatPoll` messages while not on screen and
  `staffBackgroundPoll` (`deskFromChat`), plus `deskWatchPublic` (#public
  every 20 s when another room/conversation is the current one). Keys
  `msg:<room>:<ts>`; `deskFlush` → POST `/notify/claim` (inbox DO action
  `inbox_claim`, per browser = uaH + ipH prefix, 1 day) returns the fresh
  keys and `push:{mention,chat}` (`pushOnDevice`: this browser's UA hash on
  the user's Mention-alert subscription or the owner's) → dm/mention skipped
  where push covers them. Permission: only from a click (bell strip
  `#gpa-dn-chip`, Settings card `#gpa-desk-notify`); `deskPermission()`
  prefers Chrome's answer / navigator.permissions state (Notification.
  permission can stay stale). Push subscriptions now store `ua` (set on
  subscribe; `/push/me/status` fills it in for older ones). sw.js
  `renotify: !!m.tag`. Tests: music.test.mjs (+2), messages.test.mjs (+1),
  browser my-music-edit.mjs (11), chromebook-notify.mjs (17, real Chrome
  Notification API with a Chromebook user agent, injected on 2 sites).
  NOT testable here: a real Chromebook / ChromeOS tray, Chrome's own
  permission prompt (headless dismisses it), push delivery to Chrome.
  Before that:
  **Messages (DMs + group chats), @everyone, Welcome stats** (owner: "add a
  direct message between people feature tab like the chat tab in the same
  area make it labeled NEW… allow me and the admins to view the chats
  between others to prevent any safety risks… group chats… @everyone… public
  stats"). A conversation is an ordinary ChatRoom DO whose id is
  `dm-<sha256(pair) 24 hex>` or `g-<24 random hex>` (`CONV_RE`), so every
  chat feature works in it. KV `conv:<id>` = { id, kind dm|group, name,
  members[lower], names{lower: shown}, by, at } (memo 30 s per instance:
  `convMemo`). `checkRoomAccess` branch: member with a verified SESSION, or
  `canMonitorChats()` (role admin/owner or owner code) → `access.monitor`
  (read-only: send/react/unsend/edit/vote/pin/media upload refuse it; poll
  records no read cursor or presence for it). Inbox per person = ChatRoom DO
  named `inbox-<name>` (hash if > 34 chars), actions `inbox_put/bump/read/
  remove/list` (chat/room.js `inbox()`), plus `inbox-@all` (every conv +
  private messages per UTC day for stats). `/chat/send` in a conv bumps all
  members' inboxes + @all (waitUntil), alerts members with Mention alerts
  (`push:mrl` 60 s); owner gets alerts only for convs they're in. Room `read`
  returns `advanced` when a cursor moved → poll calls `inbox_read` (clears
  unread). Routes `/dm/list|people` (GET), `/dm/start|group|manage` (POST:
  rename/add/remove(creator or owner)/leave/hide), `/dm/review` (GET) and
  `/dm/review-open` (POST, logAudit) for owner/admins; all need a session.
  Limits: `MSG_GROUP_MAX` 20, `MSG_NEW_PER_DAY` 20 (`msgnew:<day>:<u>`).
  **@everyone** in any room: `m.ev` + phone alerts (`EVERYONE_MAX_ALERTS`
  60) once per `EVERYONE_COOLDOWN_SEC` 600 per person (KV `everyone:<u>`;
  staff/owner exempt); over it the message sends without ev and the reply
  says `everyone: 'cooldown'`. Recipients: conv members / `push:user:*`
  list (#public, staff filtered to staff) / private room's DO people.
  Private rooms can't be named `dm-`/`g-`/`inbox-`. **/stats/public**
  (allowedUser, Cache API 60 s): people, online (#public DO people),
  public/private messages today+week, groups/dms counts, top chatters,
  trivia, streaks, record holders. Client: sidebar `data-tab="dms"
  data-pane="chat"` (NEW pill `gpa_dm_new_seen`, badge `#gpa-dm-badge`);
  Messages state (`dmMode`, `dmConv`, `isConvId`) declared next to
  `renderRoomOptions`, module after it; pane classes `is-dm`, `dm-listing`,
  `dm-monitor`; `/dm/list` every 20 s (5 s while the list is on screen);
  Welcome card `#gpa-pubstats` (`fetchPublicStats`). Tests:
  messages.test.mjs (7) and browser/messages.mjs (35).
  Before that:
  **Proxy: several approved sites** (owner: "configure multiple websites
  that I own or am authorized to proxy… not an unrestricted public relay").
  proxy-worker/index.js rewritten: `TARGET_ORIGINS` (space/comma list;
  `TARGET_ORIGIN` still merged), validated by `allowedOrigins()` (https,
  no port/path/creds, `hostnameBlocked()`: IP literals incl. decimal/hex,
  localhost, .local/.internal/.lan/.home.arpa/.intranet, metadata names,
  dot-less). Routes: `/site/<host>/…` and `/status/<host>/…` share
  `resolveSite()` (exact host match, target rebuilt on the origin, origin
  re-checked); `/status/` = HEAD → `{outcome, status}` (ok/http-error/
  redirect/redirect-blocked/unreachable/timeout/not-permitted/key-required/
  rate-limited), CORS *, no content. Redirects only to approved origins
  (`proxify()`); 12 s timeout (504), 12 MB cap (413 / stream error),
  Cache-API soft rate limit (`RATE_PER_MIN`, default 240), optional
  `PROXY_KEY` (?k=, soft gate). Rewriter covers a/area/img(+srcset)/source/
  script/link/form/iframe/video/audio/poster; CSS url() and JS are NOT
  rewritten. script.js: `proxy.targets` (from /health), `proxyRoute()`
  multi-host, "/path" → current host (`currentProxyHost`), datalist
  `#gpa-proxy-sites`, `proxySiteStatus()` after each /site/ load → named
  errors, optional key (`gpa_proxy_key`, `withKey()`), frame sandbox WITHOUT
  allow-same-origin (opaque origin per page: isolation; proxied sites get no
  storage), iOS: 16px fields (no focus zoom), URL keyboard, overscroll
  contain; last page restored after /health. Tests: proxy-worker.test.mjs
  (6) and browser/proxy.mjs (50) with real HTTPS fixture sites
  (fixtures/proxy-sites/setup.sh: throwaway CA + /etc/hosts, test containers
  only). WebKit isn't installed here: Chromium + iPhone emulation only.
  Before that:
  **Proxy tab → the Saints proxy Worker** (owner: integrate
  `https://saints-proxy-test.viztrrx.workers.dev` into the Proxy tab; keep the
  UI; restricted to its one origin; don't touch the root Worker). Two Workers
  in this repo: `donnajbe` (root wrangler.jsonc/worker.js, `npx wrangler
  deploy`, UNCHANGED) and `saints-proxy-test` (proxy-worker/, `npx wrangler
  deploy --config proxy-worker/wrangler.jsonc`, its own Cloudflare Build).
  script.js Proxy block (search "Proxy tab (Saints proxy Worker"):
  `DEFAULT_PROXY_SERVER` = the Worker; old `https://localhost:4141` setting
  is ignored (migrates); `proxyRoute()` maps only `proxy.target` (from
  `/health`, default https://example.com) to `<worker>/site/…`, else an
  explanation; `proxyLoad()` reuses the one iframe, 15 s timeout, parallel
  `proxyHealth()` (unreachable vs HTTP error vs CSP-blocked connect),
  `securitypolicyviolation` listener from each load until 4 s after it
  (Chromium fires load BEFORE the frame-src report, origin only) →
  "Blocked by this website" + Open in a new tab. Frame: sandbox without
  allow-top-navigation, allow="fullscreen; clipboard-write", no referrer.
  proxy-worker/index.js: `/health` CORS + `target`; only 301/302/303/307/308
  followed (304/300 used to throw → 502); readable HTML error pages with a
  no-scripts CSP; `/site` → `/site/`. Tests: tests/proxy-worker.test.mjs
  (Node, stubbed upstream; FakeRewriter stands in for HTMLRewriter) and
  tests/browser/proxy.mjs (the REAL proxy Worker via unstable_dev with
  compatibilityDate 2026-10-01: its wrangler.jsonc 2026-10-19 is newer than
  local workerd 2026-10-13). This container can't reach workers.dev or
  example.com (egress 403), so the live deployment wasn't checked from here.
  Before that:
  **Countdown, Renew, Telnyx texting; self-unlock by school email**
  (owner: "shows how much longer until their subscription expires… enter
  their phone number… text message with the subscribe link… paying cash…
  give the cash to the owner or the admins… find me a cheap one but good" →
  chose Telnyx, cash = owner + admins auto; and "confirmed… with the users
  school email… if they don't have a school email… only me and the admins can
  approve the account unlock"). Strip (`renderSubStrip`): `fmtTimeLeft`
  "12d 9h left", re-renders every 60 s; autoRenew "Renews in …"; owner/admin
  (sessionRole) "No expiry" (`.is-staff`); `#gpa-substrip-renew` opens
  `#gpa-renew` (link, `/sms/subscribe-link`, cash text from `/sms/info`).
  web/sms.js: `normPhone` (US), `sendSms` (Telnyx v2 /messages, TELNYX_API
  override for tests), `telnyxSignatureOk` (Ed25519 over `ts|body`, 5 min),
  `smsKeyword`. Worker `/sms/info` (public), `/sms/subscribe-link` (session;
  3/user, 2/phone, 100/all per day; `smsoptout:`; `smsphone:` → user, 90 d),
  `/sms/inbound` (signed; dedupe `smsevt:`; STOP/START/HELP/CASH; CASH →
  reply + notifyStaff + `smscash` log), `/admin/sms` (system.manage),
  `config.cashNames` (empty = OWNER + adminNames). Self-unlock:
  `/auth/unlock-account` {user, studentId}: needs `acct.studentId`, once per
  day (`acctselfunlock:<u>:<day>`), 3 wrong per lock (`lock.selfWrong`), else
  `staffOnly`; lock responses carry `selfUnlock`; console `showAccountUnlock`
  (`#gpa-acctunlock`). Tests: sms.test.mjs, worker.test.mjs, browser
  renew.mjs (new), signin-help.mjs 4c. Secrets to add: TELNYX_API_KEY,
  TELNYX_PUBLIC_KEY, TELNYX_FROM (README → Texting). Before that:
  **Security review: per-account brute-force lock** (owner ran
  /security-review: "try to brute force your way past the signin page even
  with approved names"). Proven with a harness against worker.js (in-memory
  KV): every limit keyed on attacker-controlled ids (client `device`, IP), so
  rotating them allowed 300+ wrong PINs then a takeover, and unlimited
  student-number guesses on `/auth/pin-request` (match = instant new PIN).
  Fix: `accountFailure()`/`accountLock()` (`acctfail:<u>` counter, 2 h
  window; `acctlock:<u>` until `sessionEnd`) on wrong PIN, wrong reset code,
  wrong student number and the owner's $1-test PIN; 8 → 423
  `accountLocked`, staff alert; Sign-in help lists `accountLocks` with
  `acctunlock`; owner Reset PIN clears it; a good login clears the count.
  `FAIL_LIMITS.login` 10 → 30 (one school = one IP; per-account lock now
  does the PIN protection). Checked and fine: no API answers an approved name
  without a session (`effectiveUser`); unlock/invite/reset codes are 8 chars
  of 31. OPEN (owner to decide): an approved name with no account yet can be
  registered by whoever types it first; and student numbers are visible in
  school emails, so Forgot PIN by student number lets a classmate who knows
  it set a new PIN. Proof: docs/screenshots/10-security-review. Before that:
  **Playlists: 10 new songs a day** (owner: "admins also have access… everyone
  has access to it but set a limited quota by default of 10 songs per user so
  it doesn't run up my youtube api key"): admins already had access; now
  `LISTS_DAILY_SONGS = 10` new lookups a day per person, admins included
  (`unlimited` = only the owner: staff() returning OWNER). Owner-set
  `config.listsDailySongs` (0–500, `/admin/config`, system.manage = owner)
  via Admin → Moderation → Playlists limit (`#gac-lists-card`; value from
  `/admin/reports`). `/music/lists` and `/find` return `songs: {perDay,
  left}` (null for the owner); the card shows "New songs left today: X of
  N" (`#gpa-lists-quota`). Imports stay 10 playlists/day (staff 30). Tests:
  playlists.test.mjs, playlists.mjs (27), fun.mjs (20). Before that:
  **Owner $1 test contribution** (owner: "only me the owner (viztrrx) can
  contribute $1 so i can test out the subscribe page"): `nameStatus` returns
  `ownerTest: true` for OWNER (still never a subscription); the page shows
  "Test contribution", $1 minimum and a `#owner-pin` box, and sends the
  PBKDF2 verifier (`verifierFor`, never the PIN). `/subscribe/contribute`
  checks it against the ownerVerified owner account with the `login`
  lockout (10 wrong / 15 min per IP) before `contribCents(c,
  OWNER_CONTRIB_MIN_CENTS=100)`; members stay at $6. Owner alert: "Your $X
  test contribution came through". Also fixed: a refused contribution's
  error was overwritten by `syncAmt()` and never shown. Tests: unit
  (subscribe.test.mjs) + browser subscribe.mjs 7b (65/65). Before that:
  **Fold the top card** (owner, with a screenshot of Ask AI: "make it so
  it is collapsible because on computer it covers the interface not letting
  me see a good view of the answers"): every tab's hero (`gpxHero()` and the
  welcome hero) gets a `.gpx-fold` arrow button (top-right). Folded
  (`.gpx-hero.is-folded`) hides `.gpx-visual`, `.gpx-desc`, `.gpx-meta`,
  `.gvh` and `.gpx-status` and keeps the title and its action buttons
  inline (Ask AI: New chat, Study settings); 397 → 71 px in the test. One
  delegated click handler on `panel`; state per room in localStorage
  `gpa_hero_folded` (`{room: true}`), so it survives re-renders and reloads.
  Test: signin-help.mjs (fold, reload, unfold). Screenshots:
  docs/screenshots/9-fold-top-card. Same commit: chat-live.mjs's "dub
  double-taps" check failed every run (also without this change): it tapped
  the instant the message appeared, while the log was still redrawing, so the
  two taps hit two different elements. It now waits 600 ms first (23/23
  twice). Before that:
  **Fail closed** (owner: "make sure the planet icon replacing the plus
  doesn't bypass the approved users so no one brute forces their way in or
  finds a way in"): the icon calls `doSignUp` like ＋ did (server register:
  allowlist, device lock, attempt limits). Two client gaps closed:
  `accessAllowed()` used to return true when `/access` failed (offline or
  blocked) or answered oddly, letting a local-only profile open the
  console; now it returns false with `SERVER_UNREACHABLE_MSG`.
  `restoreSession()` used to enter the app from localStorage alone; when
  server-backed (`telemetryOn()`) it now shows the sign-in screen until
  `/access` allows the name and, if sessions are required, `/auth/me`
  accepts the stored token. Tests: signin-help.mjs step 5 (icon with an
  unapproved name, server blocked for create and sign-in, faked storage
  for unapproved and approved names, a real reload still signed in).
  **For tests:** a console that signs in must point at the test Worker
  (localStorage `gpa_admin_tele_endpoint` = env.workerUrl, or the script
  patched to it). Several suites used to pass by accident because the
  fail-open check let them in when the default production address was
  unreachable; console-app, eaglercraft ("worker unreachable" now signs in
  first, then blocks `/eagler/`), one-session (the hand-made profile never
  gets in) and usage-meter-sizes (6 presets) were updated.
  Before that:
  **Renamed to Saints Service + planet icon** (owner: "change it from Agent
  Console to Saints Service… instead of the plus change the plus for this
  image icon… same features"): every visible "Agent Console" in the repo is
  now "Saints Service" (UI, AI prompts, notifications, docs, tests, the
  backup copies saints.js/acp.js/backup.js; `web/console/assets.generated.js`
  regenerated with `npm run build:web`). Not changed: internal ids and
  storage keys (`__agentConsoleApp`, `agent-console-*` in eaglercraft) so
  saved data survives, and `donnajbe-fixes.patch` (a diff for the other
  repo; editing it would break it). The sign-in card's `#gpa-signup-btn`
  shows the owner's planet image (`SAINTS_LOGO`, a 112 px PNG inlined as a
  data URI) and still calls `doSignUp`; texts that said "tap ＋" say "the
  planet icon". Before that:
  **Opens centered** (owner: "make it so it doesn't take up the whole
  screen on injection… a decent size and centered in the middle of the
  website so it's not obvious"): new size key `'center'` (`centeredSize()`:
  60% × 72% of the viewport, capped 920 × 680, at least 360 × 420), the
  default whenever the console is injected (`panelSizeKey` ignores a stored
  `'full'`; Compact…XL are kept); centered by `applyPanelSize`, on window
  resize and when un-minimizing; draggable; the sign-in preference restore
  uses the same rule. APP_MODE stays full. Settings → Size has a Centered
  button. Signed out on a website (owner, with a marked-up screenshot: only
  the sign-in card, not the dark window around it): `.gpa-panel.gpa-injected
  .gpa-locked` makes the panel transparent (no background, border, shadow,
  backdrop blur), hides everything but `.gpa-login`/`.gpa-gate`/`.gpa-mini`,
  and lets clicks through (`pointer-events: none`, card `auto`;
  `syncHostHit()` sets the host's too, off while minimized); gates there are
  card-only, and the sign-in card hides under a device lock (`:has`). Before that:
  **Student number required + Forgot PIN by student number + locked
  devices + Sign-in help** (owner: "if their email isn't logged and saved
  to their account… they have to enter their student number… don't let them
  ignore it… force them to read it… when they reset their pin it will ask
  for the 6 digits… if they match… that allows them to reset their pin"
  — then "it doesn't have to match their usual device just as long as the
  school email the 6 digits match"; "if a unauthorized user… tries to
  signin or brute force… their screen locks… notifications… approve it or
  just have it lock until the end of the day session (day session starts at
  7am EST and ends 12pm EST)"; "prompt them to check back every 10 mins").
  Read "12pm" literally as noon (`SESSION_END_HOUR = 12` in worker.js; say
  so if the owner meant midnight). Before that:
  **Forgot PIN? from the sign-in screen** (owner: "what if i'm not able to
  communicate with them at all… what's the best fix") + **instructions via
  Google Docs** (owner: "make it say that they will have to login and check
  their google docs when they log in at school at docs.google.com"), and a
  fix: a console signed out from elsewhere showed "Blocked by the owner"
  over the sign-in form on the next status poll. Before that:
  **PIN reset with a one-time code** + themed checkbox on the subscribe page
  (owner: "make it so i can reset their pin incase any of them… forget it";
  "style the check box button to make it match the theme"). Before that:
  **New subscribers' school email** (owner: "prompt them that it is mandatory
  they remember this pin… after they create their own pin… add their email…
  only allowed to type the 6 digit… sent to the admins via app (and
  notifications)… send the instructions… thru the google docs"). Before
  that: **Free access** override in Security (owner, admins, moderators), **Playlists
  for everyone** signed in, and contributions from **$6** (owner: "add a
  override button… owner/staff only", "don't make it owner only make it so
  everyone has access to it", "lower the price from $8 minimum to $6").
  Before that: **automatic month for Allowed users** + **Recent events folds** (owner:
  "if i didn't put them as a subscriber but they are on the allowed list
  their subscription starts on the beginning of the month and only lasts a
  month… make the recent events collapsible"; chosen: at month end they
  lose access like any subscriber; everyone listed except admins/moderators.
  This deliberately changed things for people already on the list: from the
  first sweep they're on a 1st-to-1st month). Before that:
  **YouTube to MP3** in Music → My music (owner only; owner's brief: a
  real, tested FFmpeg converter that respects YouTube's rules). Before that:
  the subscribe page lets a **new subscriber pick their own PIN**, a paid-up
  name can **only contribute, never pay twice**, and a note says
  contributions are only for subscribers (owner: "make it clear and make no
  mistakes"). Before that: **contributions** on the subscribe page (owner: "if they already have an
  account and paid the $14 subscription… they should have an option to
  contribute/donate anything from $8 or higher"). Before that: the
  subscribe page's **Terms, Refund & Cancellation and Privacy pages** and
  contact email (owner: "the email is viztrrx@gmail.com and build the
  refund/cancellation policy properly so stripe approves it… make everything
  professional"). The owner is in the middle of activating their live Stripe
  account (business type: unregistered/sole proprietor, no EIN; website =
  the subscribe page). Before that: the **Subscribe page** (owner: "a payment only app…
  they select their payment method and… put the username… approved once the
  payment of $13 is received… automatically approved on the allowed users";
  Stripe, monthly, fees passed on so the owner nets $13). Before that:
  Playlists made **app only with the Worker's own YouTube
  key** (owner: "make it so i can add a server youtube api key so it
  doesn't live in the code… only available thru the web app to me as the
  owner and the admins… only be used when it has to be used").
  Before that: **Playlists → YouTube links** (owner: "a tool that identifies the songs
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
- **The owner:** username `ivan` (was `viztrrx` until 2026-10-20; the Worker's `OWNER`, set in wrangler.jsonc vars and `DEFAULT_OWNER` in worker.js), Lehigh Acres,
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
  round, run the test routine (§6: unit tests + only the affected browser
  suites), **update this HANDOFF.md** with
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

**Saints Service**: one injectable web interface (`script.js`, ~24k lines)
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
Chat (+ Staff chat for staff, + Messages) · *Play:* Music, Proxy, Eaglercraft, Games ·
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
`ADMIN_TOKEN`, `COADMIN_TOKEN`, `OWNER_CODE`, `OWNER` (`ivan`, set in wrangler.jsonc vars; default `DEFAULT_OWNER`),
`OWNER_TZ` (default New York), `EAGLER_*`, `ALLOW_QUERY_TOKEN`, optional
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (else generated into
KV `push:vapid`), `CONSOLE_SCRIPT_URL`, `AUDIUS_API`,
`APNS_RELAY_URL`/`APNS_RELAY_SECRET`, optional `YOUTUBE_API_KEY`,
`SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` (Playlists), `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, optional `STRIPE_PRICE_ID`, `STRIPE_PORTAL_URL`,
`SUB_PRICE_CENTS`, `SUPPORT_EMAIL` (default `viztrrx@gmail.com`) (Subscribe page),
`TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_FROM`, optional
`TELNYX_PROFILE_ID` (texting; README → Texting).

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
`ytlists-rate:<day>:<name>`, `conv:<id>` (a DM or group: members), `msgnew:<day>:<name>`, `everyone:<name>` (10-min @everyone cooldown), `ytm:<hash>` (one song's YouTube answer, shared) · `ytmeta:<video id>`, `mp3chk:<hour>` (YouTube to MP3 link details, owner only) · `subhold:<name>`, `subpay:<session>`, `substripe:<sub id>`, `stripe:evt:<id>`, `subco:*` (Subscribe page).

### Inside the ChatRoom Durable Object (per room)
Storage: `log` (newest 120 messages, a week), `reads` (read cursors),
`seen` (last-seen times), `pins` (≤3), `counts` (messages per person per
day, 14 days; not system notices), `trivia` (#public only). Memory only:
`live` (who's here / typing). Actions: `read`, `append`, `react`, `edit`,
`pin`, `vote`, `unsend`, `delete`, `clear`, `stats`, `trivia_open`.
Inbox objects (`inbox-<name>`, `inbox-@all`; Messages) use the same class
but only `inbox` (conversations: meta, last message, unread n) and `days`
(private messages per UTC day, @all only), via `inbox_*` actions.

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
- **Subscribe page** (`/subscribe/`, `web/subscribe.js` + the
  `/subscribe/*` block in worker.js): payment-only page; Stripe Checkout in
  subscription mode, $13.80/month by default (`SUB_PRICE_CENTS`; the owner
  wanted to net $13 after fees: 2.9% + 30¢ + 0.7% Billing). Secrets
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (optional `STRIPE_PORTAL_URL`,
  `STRIPE_API` for tests). Flow: `/subscribe/check` (name rules: not the
  owner, not already listed/subscribed, not held by another checkout:
  `subhold:<name>` 30 min) → `/subscribe/checkout` (10/h per network) →
  Stripe → `/subscribe/webhook` (signature checked, events deduped
  `stripe:evt:<id>`) or `/subscribe/status` asking Stripe directly →
  `approveSub()`: `config.subscriptions[name]` with `autoRenew: true`,
  `stripe: {customer, subscription}`, ledger entry (`via: 'stripe'`, `ref`
  = session/invoice id, deduped), name on Allowed users, owner notified, and
  a sign-up code (`invite:<name>`, only if no account) shown only on the
  buyer's page (`subpay:<session>`). Renewals: `invoice.paid`
  (`subscription_cycle`; `substripe:<sub id>` → name) extend to the period
  end + 1 day. `customer.subscription.updated` (cancel at period end) →
  `autoRenew: false`; `.deleted` → expires now, the 5-minute sweep ends it.
  Auto-renewing subscribers get no "ending soon" reminders; their console
  strip says "Subscribed · renews monthly". **Never tested against real
  Stripe** (blocked from the dev container): tests use a stand-in that signs
  webhooks like Stripe. Tests: `subscribe.test.mjs`, `subscribe.mjs`.
  Own PIN: after payment `/subscribe/status` gives the buyer's page the
  sign-up code; the page shows **Create your PIN**, derives the console's
  server verifier (PBKDF2-SHA256 210k, `gpa-server|<lower user>|<pin>`, salt
  `gpa-server-salt|<lower user>`; must stay identical to `serverVerifier()` in
  script.js) and POSTs `{session, verifier}` to `/subscribe/account`, which
  needs `subpay:<session>` approved (not a contribution or duplicate), no
  account yet, and the unused `invite:<name>` matching the record; it creates
  the account like `/auth/register` (salted verifier hash), deletes the
  invite, sets the record to `{code:'', account:true}` (10/h per network,
  prefix `subacct`). The console then signs in with Sign in (with Allowed
  users on, a device without a local profile is fine). The code stays as a
  fallback under "Rather create your account in the app?".
  No paying twice: `nameStatus` refuses any active subscriber ("already
  subscribed for this month, so it can't be paid for again"), so checkout is
  409 and the page shows only the contribution box (`#form-title` →
  Contribute). Checkout Sessions expire after `CHECKOUT_TTL_S` (31 min); the
  hold `subhold:<name>` stores `{attempt, session, url, until: expiry+2min}`,
  so the same visit gets its open checkout URL back without calling Stripe
  and another visit can't open a second one; the Idempotency-Key includes the
  minute (double taps). If two payments still race, `fromSession` sees an
  active name and records `action: 'duplicate'` (no time added, no sign-up),
  tells the owner to refund and cancel the extra subscription, and the page
  says it'll be refunded.
  Contributions: `/subscribe/check` adds `canContribute` (and `hasAccount`)
  for every active subscriber; the page then shows `#contrib` ($6–$500 since the owner lowered it from $8,
  `CONTRIB_MIN_CENTS`/`CONTRIB_MAX_CENTS`) instead of Subscribe.
  `/subscribe/contribute` (same 10/h-per-network limit as checkout,
  `checkoutLimited`) makes a Checkout Session in **payment** mode with
  `metadata.kind = 'contribution'` (`contributionParams`); success URL
  `?thanks=<session>`. `recordContribution()` (webhook or `/status`) adds a
  ledger entry `action: 'contribution'` (deduped by `ref`) and notifies the
  owner; it never touches the subscription. `fromSession()` now refuses
  anything but `mode: 'subscription'`, and `/status` sends contribution
  sessions to `recordContribution`, so a one-time payment can never approve
  a name. The owner card adds a "contributions" tile and "contributed $X".
  Policies (`web/policies.js`): `/subscribe/terms`, `/subscribe/refunds`,
  `/subscribe/privacy` (also with a trailing slash; open even before
  Stripe keys are set; same security headers, no scripts). Footer on every
  page (`policyFooter` in subscribe.js) with the contact email
  (`supportEmail(env)`); the auto-renewal sentence by the pay button; Checkout
  `custom_text.submit.message` repeats it on Stripe's page. Refund window
  **no refunds** (owner: "put no refunds"), only billing errors or where the
  law requires; effective date `POLICY_EFFECTIVE`
  (policies.js) — change it when the wording changes. The privacy page
  describes what the app really stores (salted PIN verifier hash, hashed
  IP/UA, country, sessions, content; Stripe/Cloudflare/push services as
  processors; 30–180-day security logs) — keep it true when that changes.
  Hardening (owner said yes to it, following the Stripe plugin's
  best-practices skill): every call sends `Stripe-Version:
  2026-08-26.dahlia` (`STRIPE_API_VERSION`); sessions carry
  `integration_identifier` (`INTEGRATION_ID`); `STRIPE_PRICE_ID` (a Dashboard
  Price) replaces inline `price_data` when set, and the page shows its amount
  (`displayCents`, cached 1 h in `stripe:price:<id>`); checkout POSTs send an
  `Idempotency-Key` from the page's per-visit `attempt` id, and the name hold
  (`subhold`) belongs to that attempt, so a double tap or a retry after
  backing out isn't blocked; `invoice.payment_failed` notifies the owner and
  records `paymentFailedAt`. Recommended key: a restricted `rk_` key
  (Checkout Sessions: Write, Subscriptions: Read, Prices: Read). Stripe Tax
  is not on (needs registrations; owner to decide). The Stripe plugin is
  installed in this environment but its MCP server (mcp.stripe.com) and
  api.stripe.com are blocked by the network policy.
  Branding (owner's request): the page is "Saints Service" (the Stripe
  product's name too), shows the console's planet icon
  (`/console/icon-180.png`) and uses the icon's colors: dark #14171d
  background, teal #28b3a2 → violet #7250cb for the button, checks, focus and
  the sign-up code. The owner's live price is $14.00/month (STRIPE_PRICE_ID).
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
  **Automatic month**: `autoSubscribeListed()` (runs first in the sweep, on
  `/admin/subscriptions` and after `/admin/config` saves) gives every name on
  Allowed users with no subscription record, not the owner and not staff
  (`isStaffName`: role rank ≥ 1), `{auto: true, period: '1m'}` from
  `monthBounds()` (1st 00:00 to next 1st 00:00 in `OWNER_TZ`, default
  America/New_York, DST-safe via `zonedMonthStart`). Only while
  `allowlist.on`. No ledger entry. Ends like any subscription (taken off the
  list); a name made staff during the month has the record dropped at the
  end instead. Taking a name off the list deletes its auto record; putting a name back on
  the list (`/admin/config`, newly added names only) clears an ended auto
  record so it gets the current month (ended paid records still need Renew);
  `allowedUser` also refuses an auto record whose name isn't listed. Add
  replaces it; `/subscribe/check` lets an auto name pay ("has free access
  until …"), and `approveSub` treats it as not active (paid month from now).
  Alerts: `notifySubs` batches (more than 3 → one notification). The
  Security page's **Recent events** is a `foldCard` (`wireFold`, closed by
  default, remembered in `gac_sec_events_open`; the `focus=events` deep link
  opens it). Making someone staff (`setrole` moderator/admin) deletes their
  auto record at once. Tests: worker.test.mjs "automatic month",
  subscribers.mjs step 7.
  **Free access** (owner: "add a override button if i wanna give access to
  them incase im feeling nice or generous make it owner/staff only… same
  area"): `/admin/free-access` (`coadmin`: owner, admins, moderators,
  co-admin token) list/give/end. A subscription record with `free: true`,
  `freeBy`, `period: 'free'` and `expiresAt = FREE_FOREVER` (year 9999) for
  "no end", or `addSubPeriod` for a set time; never shortens a live record
  (max of the two); refused for the owner, staff, and Stripe-billed
  `autoRenew`; no ledger entry; settles a pending access request; staff
  grants alert the owner (`notifyOwner`, `focus: 'free'` deep link); audit
  `free_give`/`free_end`. Subscribers view adds `forever`; Add/Renew refuse a
  live free record; `nameStatus` says "already has free access" (can
  contribute); `mySubscription` hides a no-end free record (limited free:
  strip says "Free access, a gift: ends …"). UI: `freeCard()` +
  `wireFreeAccess()` in Security (above Subscribers) and, for roles without
  `security.view` (moderators), in Moderation. Tests: worker.test.mjs "free
  access", subscribers.mjs step 8 (owner, admin, moderator).
  **School email** (web/subscribe.js `#email-form`, `SCHOOL_DOMAIN`):
  after `/subscribe/account`, the page asks for 6 digits →
  `/subscribe/email {session, studentId}` (same proof as the PIN step;
  needs `rec.account`; `SCHOOL_ID_RE`; 3 sends max; `checkoutLimited
  ('subemail')`) stores `email` on the `subpay:` record, on
  `config.subscriptions[name].email` and in `config.subEmails` (newest
  first, 300), then `notifyOwner` (cat `newuser`, deep link `focus:
  'emails'`) and `notifyUser` for each admin (`adminNames()` scans `acct:`;
  admins only get it if they turned on their own alerts). `/subscribe/
  status` returns `email`, so a reload goes back to the email step if it's
  missing. The PIN step: red `#pin-warn`, required `#pin-ok` checkbox,
  `weakPin()` in the page (the server only sees the verifier). Admin:
  `/admin/sub-emails` (`users.manage`: owner + admins, not moderators)
  list/setdoc (docs.google.com only, `config.instructionsDoc`)/sent/remove;
  card `emailsCard()` + `wireSubEmails()` in Security above Free access;
  Email instructions is a `mailto:` (no email service on the Worker) and
  marks `sentAt`/`sentBy`. Tests: subscribe.test.mjs "school email",
  subscribe.mjs step 2 and the owner card.
  **PIN reset** (owner only): `/admin/user/action` `resetpin` →
  `pinreset:<name>` `{code, until (7 days), by}` (KV TTL), bumps `epoch` and
  clears sessions (signed out), returns the code; `resetcancel` deletes it.
  `/auth/login`: a wrong verifier with a live reset → 403 `{inviteRequired,
  pinReset}` until `body.invite` matches (timing-safe, wrong code counts
  toward the login lockout), then the typed PIN's verifier replaces the old
  one (new salt), the key is deleted, owner alert (cat `security`), normal
  sign-in continues. The old PIN keeps working until then. The code only
  reaches the owner (`authedLevel === 'owner'` in `allowAccounts` and
  `/admin/user`). UI: Allowed users rows (Reset PIN → code, Copy code,
  Cancel reset), Users → Actions; the sign-in code box relabels to "Reset
  code (from the owner)". `release` (delete the account record) still
  exists server-side but no button uses it. Tests: worker.test.mjs "PIN
  reset", subscribe.mjs end.
  **Forgot PIN?** (sign-in screen, `#gpa-forgot`): `POST /auth/pin-request
  {user, verifier, note}` stores `pinreq:<name>` `{salt, verifier (salted),
  ticketH, until 24 h, status, sameDevice, sameBrowser, ua, country, note}`
  (5/h per network, `pinreq-rate:`), owner alert (cat `security`, urgent).
  "Usual device" = the request's ipH+uaH matches `acct.known` (last 6
  devices, recorded in `issue()`) or a session; same uaH only = "same kind of
  browser". The page polls `GET /auth/pin-request?user&ticket` (5 s, then
  15 s) and on `approved` calls `serverFirstSignIn` with the PIN it kept in
  memory. Owner: `/admin/user/action` `pinapprove` (copies the stored salt/
  verifier, bumps epoch, clears sessions, clears any reset code) /
  `pindeny`; shown on Allowed users rows (`pinRequest`, owner only).
  Instructions wording: subscribers are told to check Google Docs at
  docs.google.com at school; the New subscribers card's **Share the Doc**
  (`data-em="share"`) copies the email and opens the Doc, marks `sentAt`.
  Status fix: `applyStatus` returns early (no overlay) when `notAllowed`
  and nobody is signed in. Tests: worker.test.mjs "Forgot PIN",
  subscribe.mjs end.
  **Now (2026-10-19 later):** `/auth/pin-request` needs `studentId`; it
  must equal `acct.studentId` (timing-safe) → the new PIN is set at once
  (`approved: true`, log `pinauto`); wrong → 403 `wrongStudent`, counts as a
  wrong try; no number on file → `pending` for the owner **or admins**
  (`pinapprove`/`pindeny` need `users.manage`; approving also saves the
  number given). Alerts go to the owner and admins (`notifyStaff`: owner
  push + `notifyUser` for each admin with alerts on).
  **Student number:** `acct.studentId` (6 digits) + index `sid:<digits>` →
  name (one account per number). Set by `/subscribe/email`, by
  `POST /auth/student-id {studentId, confirm}` (session; once; 409 after),
  or by approving a request; cleared by `clearsid` (owner/admin). `view()`
  and `/status` return `needsStudentId` (everyone but the owner) unless
  `env.STUDENT_ID_OPTIONAL === '1'`, which **only the browser test env sets**
  (tests/browser/env.mjs; suites testing it pass '0'). Client:
  `showStudentGate()` (no close, Escape eaten, rest inert, 8 s read timer +
  tick box, digits only, typed twice) from `applyModeration` and right
  after sign-in (`pollStatus`).
  **Locked devices:** client `consoleDeviceId()` (random, localStorage
  `gpa_device_id`) sent as `device` on `/access`, `/auth/login`,
  `/auth/register`, `/auth/pin-request`. Worker `deviceFail()` counts per
  device per hour in `devfail:<id>:<hour>` (not allowed ≥ 3, wrong ≥ 5) →
  `devlock:<id>` `{until: sessionEnd() (next 12:00 PM New York), names,
  ua, country}`, alert to owner + admins, log `lock`; locked requests get
  423 `deviceLocked` (or `/access` `{deviceLocked}`). Client
  `showDeviceLock()` covers the panel, makes everything inert and disables
  the sign-in fields, survives reloads (`gpa_device_locked`), polls
  `GET /auth/device` every 30 s. **Sign-in help:** `/admin/signin-help`
  (`users.manage`) list/unlock/keep → people + emails, pending requests,
  locks, `signinlog` (300). Card `helpCard()`/`wireSigninHelp()` in
  Security for owner + admins; deep link `focus=signinhelp`. Tests:
  worker.test.mjs "Forgot PIN", "Locked devices", "day session end";
  browser `signin-help.mjs` (new, 28 checks). It and other suites share the local data in one loop, so tests must use unique student numbers (one account per number).

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
**YouTube to MP3** (owner only; `#gpa-mp3`, a `.gpx-details` inside the My
music panel; script.js "YouTube to MP3"; Worker part `web/mp3.js`):
real FFmpeg in the browser, on a file the owner provides. **No YouTube
download, by design**: YouTube has no download API and its terms forbid it,
so a link only gets details from `GET /music/mp3/check?url=` (owner only:
session role owner, admin token or `X-GPA-Owner`; `parseYouTubeLink`
accepts watch/youtu.be/shorts/embed/live/music hosts, refuses playlist and
channel links; `videos.list` with `YOUTUBE_API_KEY` only, cached
`ytmeta:<id>` 12 h, 120/h `mp3chk:<hour>`) and the honest "get it from
YouTube Studio" note (`rightsNote`). Conversion: `mp3LoadCore()` downloads
`@ffmpeg/core@0.12.10` UMD (`ffmpeg-core.js` + `.wasm`, 31 MB) from jsDelivr
then unpkg (`gpa_ffmpeg_base` in localStorage puts another copy first;
tests use it), **refuses anything whose SHA-256 isn't `MP3_CORE`**, caches
verified bytes in Cache Storage (`gpa-ffmpeg-0.12.10`), then
`mp3Start()` runs `mp3WorkerMain` (stringified) in a blob Web Worker:
`createFFmpegCore({ wasmBinary })`, ffprobe the input (no audio → error),
`-map 0:a:0 -c:a libmp3lame -b:a <k>k` (+ `-ar 48000` above 48 kHz, `-ac 2`
above stereo, ID3 title/artist), ffprobe the output. Progress = FFmpeg's
`time` ÷ probed duration; Cancel/timeout (15 min; `gpa_mp3_timeout_ms`
overrides for tests) terminate the worker. `mp3VerifyHere()` then checks the
MP3 frame and decodes it with Web Audio (length must match) before Download
/ Save are shown. Save = the normal `POST /music/mine/upload` (title, artist,
duration; 25 MB cap → bigger MP3s are download-only; asks before a
same-title duplicate); never the shared library. Owner check on the client:
`sessionRole()==='owner'` or a stored admin token/owner code, confirmed by
`/music/mp3/check` (403 hides it). Cleanup in `gpaCleanups`. ffmpeg.wasm is
GPL-2.0-or-later, fetched at run time, not vendored; `@ffmpeg/core` is a
devDependency only for the tests. Tests: `mp3.test.mjs` (stand-in YouTube
API), `mp3.mjs` (real conversions; needs system `ffmpeg`/`ffprobe`; the
real-YouTube case is reported NOT RUN on purpose). Possible next steps if
asked: nothing server-side is needed; a Cloudflare Container would only be
worth it for files too big for a phone's memory.
**Playlists → YouTube links** (everyone signed in since 2026-10-19, owner:
"don't make it owner only make it so everyone has access to it"; was owner +
admins in the app only; `web/playlists.js`, routes `/music/lists*`: a
verified session, or `staff()` for the owner token/code; KV `ytlists:<who>`): paste a Spotify /
Apple Music playlist or album link → the Worker reads the song list
(Spotify Web API if `SPOTIFY_CLIENT_ID/SECRET`, else the public embed page's
`__NEXT_DATA__`, first 100 songs; Apple: the page's `serialized-server-data`
and JSON-LD) → `/music/lists/find` looks up 8 songs per call with the
YouTube Data API with **only** the Worker secret `YOUTUBE_API_KEY` (the
owner's wish: key in Cloudflare, not the code or the browser; a key sent by
a browser is ignored), caching every answer in KV `ytm:<sha256 artist|title>`
(60 days, 7 for no match) so each song is searched once across everyone;
no longer app only (the button shows for any signed-in session, website or
app). Quota guard: regular users get `LISTS_USER_SEARCHES` (40) new YouTube
lookups a day (`ytlists-search:<day>:<name>`; cached songs are free;
`capped` answer stops the client loop) and `LISTS_USER_IMPORTS` (10) imports
a day; the owner and admins keep 30 imports and no lookup cap; `pickVideo` prefers the artist's Topic /
VEVO / official channel and rejects covers, sped-up, live etc. **Links only,
nothing downloaded** — the owner first asked to rip the songs to MP3; that
was declined (copyright) and this was the agreed alternative; don't add a
download/convert step (YouTube to MP3, below, is separate: it converts the
owner's own files and never downloads from YouTube/Spotify). **Never verified against the real Spotify, Apple
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
| (this) | Owner renamed to ivan (wrangler vars OWNER, DEFAULT_OWNER) |
| `5a93642` | Owner PIN reset (Settings → Memory, /auth/owner-pin) |
| `df5f46d` | Messages for the owner with no server sign-in (admin token / owner code = owner: `chatIdentity()`) |
| `bac7267` | Rename songs; owner upload fix (admin token hid the session); Chromebook pop-ups |
| `ec28acb` | Messages (DMs + group chats, safety review), @everyone, Welcome stats |
| `bfd4068` | Proxy: several approved sites (allowlist, /status/, isolation) |
| `31214c0` | Proxy tab on the Saints proxy Worker (proxy-worker/) |
| `28202ba` | Countdown + Renew + Telnyx texting; self-unlock with school email |
| `0203341` | Security: per-account brute-force lock (PIN, reset code, student number) |
| `697270e` | Playlists: 10 new songs a day per person (admins too), owner-set |
| `f11590c` | Owner-only $1 test contribution on the subscribe page |
| `ccd4577` | Fold the top card (Ask AI and every tab) |
| (earlier) | YouTube to MP3 (owner): real FFmpeg in the browser, verified MP3, Save to My music |
| `5098fca`, `f748097` | Subscribe page: own PIN after paying, no paying twice, contributions note |
| `4944c8b` | Subscribe page: one-time contributions ($8+) from members |
| `c9d49b1` | Refund policy: no refunds (billing errors only) |
| `c9465ac` | Subscribe page: Terms, Refund & Cancellation, Privacy pages; contact email; renewal disclosure |
| `c196301` | Subscribe page: "Saints Service", the planet icon and its colors |
| `81430fa` | Subscribe page hardening: API version, price ID, idempotency, failed payments |
| `96545d4` | Subscribe page: pay monthly with Stripe, approved automatically |
| `b7a3eba` | Playlists: app only, Worker YouTube key, shared lookup cache |
| `a11eeaa` | Playlists → YouTube links (owner + admins) |
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
npm test                                   # node --test tests/*.test.mjs (151 tests)
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
node tests/browser/subscribers.mjs         # 39
node tests/browser/owner-tools.mjs         # 15
node tests/browser/staff-chat.mjs          # 19
node tests/browser/chat-burst.mjs          # 4
node tests/browser/read-receipts.mjs       # 13
node tests/browser/chat-live.mjs           # 23
node tests/browser/chat-replies.mjs        # 20
node tests/browser/chat-round2.mjs         # 26 (fake microphone)
node tests/browser/messages.mjs            # 35 (DMs, groups, safety review, @everyone, Welcome stats)
node tests/browser/new-owner.mjs           # 11 (owner ivan on the web and the app)
node tests/browser/owner-pin.mjs           # 10 (owner resets their own PIN)
node tests/browser/owner-messages.mjs      # 9 (owner with no server sign-in, Admin connected)
node tests/browser/my-music-edit.mjs       # 11 (rename songs; owner upload with Admin connected)
node tests/browser/chromebook-notify.mjs   # 17 (pop-ups, Chromebook UA, injected on 2 sites; ~4 min)
node tests/browser/fun.mjs                 # 18
node tests/browser/music.mjs               # 15
node tests/browser/my-music.mjs            # 15
node tests/browser/admin-app.mjs           # 20
node tests/browser/playlists.mjs           # 23
node tests/browser/mp3.mjs                 # 51 (+1 NOT RUN: real YouTube download; needs ffmpeg/ffprobe)
node tests/browser/subscribe.mjs           # 65
node tests/browser/signin-help.mjs         # 52
node tests/browser/renew.mjs               # 22
node tests/browser/proxy.mjs               # 50 (real proxy Worker + HTTPS fixture sites; root, test containers)
node tests/browser/usage-meter.mjs         # 16
node tests/browser/usage-meter-sizes.mjs   # 25
node tests/browser/ask-photo-size.mjs      # 6
```

**The routine before every push (owner's rule since 2026-10-19, to save
usage):** "don't test the suites that weren't coded or changed at all, only
those that are related or affected to the files you changed or the
files/suites you think would be affected". So:
1. `npm test` (all unit tests: fast and cheap, always).
2. **Only the browser suites the change can affect**, one at a time from a
   clean state (`rm -rf .wrangler/state`, ~5 min timeout each; run in the
   background and wait for a "done" marker). Pick them from what you
   touched: a suite you edited; suites that exercise the screens, routes or
   shared helpers you changed (e.g. Admin → Security cards → `subscribers`,
   `admin-app`, `notification-links`, `owner-tools`, `one-session`;
   subscribe page → `subscribe`; Music → `music`, `my-music`, `playlists`,
   `mp3`; chat → the `chat-*`, `staff-chat`, `read-receipts`, `messages`; sign-in /
   sessions → `one-session`, `same-computer`, `allowlist`,
   `access-requests`, `console-app`). When unsure whether something shared
   (e.g. a selector class, the login flow, `allowedUser`) reaches a suite,
   include it. Don't run unrelated suites (e.g. `eaglercraft.e2e`,
   `usage-meter*`, `ask-photo-size` for a subscriptions change).
3. **Screenshots for the owner go in `docs/screenshots/`** (owner: "add the
   images to a special dedicated file in github where i can see them… it
   won't let me see it here"): copy the relevant ones from the test output
   into a numbered folder per feature with plain names, shrink them
   (≤1200 px wide, 256-color PNG via Pillow), and add each to
   `docs/screenshots/README.md` with a one-line caption. Link that page in
   the report. Never include real keys, SSNs or bank details.
4. Look at the screenshots, say in the report which suites ran and which
   were skipped as unaffected, then commit and push.
The whole list of 27 suites is still the right call only for a change that
touches everything (e.g. script.js start-up, the Worker's request
pipeline, shared CSS tokens).

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
