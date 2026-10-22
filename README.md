# Saints Service {#agent-console}

A floating AI assistant panel you can drop onto **any web page** — no extension, no install, no build step. It's one self\-contained JavaScript file you paste into the browser console (or run as a bookmarklet), plus an optional Cloudflare Worker that proxies API calls.

The panel reads the page you're on, answers questions about it, explains quiz questions, takes notes, plays music, browses, and — when you need a break — ships with seventeen playable games.

* * *

## Tour {#tour}

Every screenshot below comes from the current build on a demo page, with demo accounts and example AI answers. Click any image for full size.

|  |  |
| --- | --- |
| <img src="docs/screenshots/welcome.png" alt="Welcome" width="420"><br>**Welcome** | <img src="docs/screenshots/page-insights.png" alt="Page Insights" width="420"><br>**Page Insights** |
| <img src="docs/screenshots/ask-ai.png" alt="Ask AI" width="420"><br>**Ask AI** | <img src="docs/screenshots/chat.png" alt="Chat" width="420"><br>**Chat** |
| <img src="docs/screenshots/study.png" alt="Study" width="420"><br>**Study** | <img src="docs/screenshots/notes.png" alt="Notes" width="420"><br>**Notes** |
| <img src="docs/screenshots/humanize.png" alt="Humanize" width="420"><br>**Humanize** | <img src="docs/screenshots/grammar.png" alt="Grammar" width="420"><br>**Grammar** |
| <img src="docs/screenshots/saved.png" alt="Saved" width="420"><br>**Saved** | <img src="docs/screenshots/music.png" alt="Music" width="420"><br>**Music** |
| <img src="docs/screenshots/proxy.png" alt="Proxy" width="420"><br>**Proxy** | <img src="docs/screenshots/games.png" alt="Games" width="420"><br>**Games** |
| <img src="docs/screenshots/eaglercraft.png" alt="Eaglercraft" width="420"><br>**Eaglercraft** |  |
| <img src="docs/screenshots/selection-bubble.png" alt="Selection assistant" width="420"><br>**Selection assistant** | <img src="docs/screenshots/selection-explain.png" alt="Selection answer" width="420"><br>**Selection answer** |
| <img src="docs/screenshots/selection-more.png" alt="Selection tools menu" width="420"><br>**Selection tools menu** | <img src="docs/screenshots/settings-selection.png" alt="Selection assistant settings" width="420"><br>**Selection assistant settings** |
| <img src="docs/screenshots/settings-overview.png" alt="Settings" width="420"><br>**Settings** | <img src="docs/screenshots/settings-theme.png" alt="Themes" width="420"><br>**Themes** |
| <img src="docs/screenshots/settings-memory.png" alt="Memory" width="420"><br>**Memory** | <img src="docs/screenshots/settings-version-history.png" alt="Version history" width="420"><br>**Version history** |
| <img src="docs/screenshots/admin-overview.png" alt="Admin overview" width="420"><br>**Admin overview** | <img src="docs/screenshots/admin-users.png" alt="Admin users" width="420"><br>**Admin users** |
| <img src="docs/screenshots/admin-ai.png" alt="Admin AI & usage" width="420"><br>**Admin AI & usage** | <img src="docs/screenshots/admin-security.png" alt="Admin security" width="420"><br>**Admin security** |
| <img src="docs/screenshots/admin-danger.png" alt="Admin danger zone" width="420"><br>**Admin danger zone** | <img src="docs/screenshots/admin-palette.png" alt="Admin command palette" width="420"><br>**Admin command palette** |
| <img src="docs/screenshots/sign-in.png" alt="Sign in" width="420"><br>**Sign in** | <img src="docs/screenshots/version-history.png" alt="Per-tab version history" width="420"><br>**Per-tab version history** |

* * *

## Quick start {#quick-start}

1. Open any web page.
2. Open DevTools → Console (`F12`, or `Cmd`/`Ctrl` \+ `Shift` \+ `J`).
3. Paste and run:

```js
fetch('https://raw.githubusercontent.com/viztrrx/work-service/main/script.js')
  .then(r => r.text())
  .then(eval)
```

The panel appears in the corner. Drag it anywhere; minimize it and it flies to the bottom\-right as a small button that's still draggable. Running the snippet again toggles the panel instead of injecting a second copy.

The first time you use an AI feature it asks for an API key. Keys live in that site's `localStorage` and never leave your browser except in the request to the provider.

### Make it a bookmarklet {#make-it-a-bookmarklet}

Create a new bookmark and use this as the URL, so it's one click on any page:

```
javascript:fetch('https://raw.githubusercontent.com/viztrrx/work-service/main/script.js').then(r=>r.text()).then(eval)
```

A DevTools **Snippet** (Sources → Snippets) works too, and survives navigation better than retyping the fetch.

### On iPhone and iPad (Eruda) {#on-iphone-and-ipad}

iOS **Smart Punctuation** turns the `'` you type into a curly `‘`, which JavaScript can't read. The console then shows `SyntaxError: Invalid character '\u2018'` before `script.js` is even downloaded. Use this version, whose backticks iOS leaves alone:

```js
fetch(`https://raw.githubusercontent.com/viztrrx/work-service/main/script.js`).then(r=>r.text()).then(eval)
```

Pasting the command also works; the problem only happens when it's typed. You can also turn off **Settings → General → Keyboard → Smart Punctuation**.

* * *

## Music without keys {#music}

The Music tab needs no YouTube key and no sign-in:

- **Search** looks in the shared library and on [Audius](https://audius.co),
  a free music platform whose public API needs no key or account. Results
  play full songs, streamed through your Worker (`/music/...`), so listeners
  only ever talk to your Worker. Audius is mostly independent artists; big
  label releases usually aren't there.
- **Shared** is a library everyone can play. You and your admins add songs
  with **Add songs** (MP3, M4A, AAC, OGG, WAV, FLAC or WebM, up to 25 MB
  each); "Artist - Title.mp3" file names fill in the artist and title. Files
  go to the Worker's R2 bucket under `music/` (about 9.5 GB in total, inside
  R2's free tier). Only upload music you have the rights to share.
- **My music** is each person's own songs. Anyone signed in taps **Upload
  songs** and picks files from their computer (same formats, 25 MB each, up
  to 50 songs / 300 MB per person, 30 uploads a day). They're saved to the
  person's account, so they're there on any device after signing in. Play
  one and tap 💬 on the now-playing bar to share it in chat: everyone in the
  room gets a ▶ Play card that streams it from your Worker. Deleting a song
  removes it for everyone it was shared with. Shared library and personal uploads together stay
  under the same ~9.5 GB R2 limit.
- **Playlists** (everyone signed in, in the app or the console on any website):
  paste a Spotify or Apple Music playlist or album link and get every song's
  official YouTube video, in order, organized by playlist and saved to your
  account. Each song has a **YouTube ↗** link and ▶ to play it in the
  console; **Copy all links** copies the playlist as a numbered list, and
  **Play all on YouTube** opens the first 50 as a YouTube queue. Songs with
  no clear official video get a YouTube search link instead. Nothing is
  downloaded: these are links to YouTube.
  - Finding the videos uses the YouTube Data API with **your key as a
    Cloudflare secret** (never in the code or the browser): Cloudflare →
    Workers & Pages → `donnajbe` → Settings → Variables and Secrets → **Add**
    → Type **Secret**, name `YOUTUBE_API_KEY`, value your key → Deploy. Only
    the Worker uses it, only for Playlists, and it never reaches anyone's
    browser.
  - The key is used only when it has to be: a song is searched once, and the
    answer is kept for everyone (60 days; 7 for "no clear video"), so the same
    song in another playlist or for anyone else costs nothing, and opening
    saved playlists never searches. A free key covers about 100 new songs a
    day for everyone together; the rest are found the next day. So one person
    can't use it all up, each person, **admins included**, gets **10 new
    songs a day** (songs someone already found don't count), and the card
    shows "New songs left today: 7 of 10". Only you have no limit. Change the
    number in **Admin → Moderation → Playlists limit** (0–500; only you can).
    Without the key every song gets a YouTube search link.
  - Spotify playlists are read from Spotify's public embed page, which shows
    the first 100 songs. For longer playlists, add `SPOTIFY_CLIENT_ID` and
    `SPOTIFY_CLIENT_SECRET` (a free app at developer.spotify.com) as Worker
    secrets. Apple Music playlists are read from their public page.
  - Up to 20 playlists per person, 200 songs each; 10 imports a day (30 for
    you and admins).
- **YouTube to MP3** (you only, inside **My music**): turns a video or audio
  file you own into an MP3 on your device with real FFmpeg, with **Download
  MP3** and **Save to My music**. A YouTube link shows the video's details,
  but its audio can't be fetched from the link; see
  [YouTube to MP3](#mp3).
- One **now-playing bar** plays every source with previous/next, seeking and
  iPhone lock-screen controls, and keeps playing on other tabs. **SoundCloud**
  links and **This device** (your own offline files) work as before, and
  YouTube search is still there for anyone who saved a key.
- The allowed-users list applies to music too.

Owners can point at a different Audius gateway with the Worker variable
`AUDIUS_API`. Checks: `node --test tests/music.test.mjs` and
`node tests/browser/music.mjs`.

## YouTube to MP3 (owner only) {#mp3}

In **Music → My music**, you (the verified owner, and nobody else) get a
collapsible **YouTube to MP3** section. It turns a video or audio file you
own into a real MP3, on your device, and can save it to My music.

**What a YouTube link does, and doesn't.** YouTube offers no download API,
and its terms don't allow apps to fetch a video's media, so this tool never
downloads anything from a YouTube link. Paste a link (watch, youtu.be,
Shorts, live, music.youtube.com) and you get the video's title, channel,
length and license from the YouTube Data API (with the Worker's
`YOUTUBE_API_KEY`), plus how to get the audio legitimately: for your own
videos, **YouTube Studio → Content → ⋮ → Download**, then choose that file.
Playlist and channel links are refused with a reason; a video link that also
names a playlist says the playlist part is ignored. The details also fill in
the MP3's title and artist.

**How it converts.**
1. **Choose video or audio**: MP4, MOV, WebM, MKV, M4A, AAC, MP3, WAV,
   FLAC, OGG/Opus and more, up to 200 MB.
2. Pick the quality: 128, 192 (recommended), 256 or 320 kbps. If the source
   audio was lower (say 128 kbps), the result says a higher bitrate can't
   sound better, only bigger.
3. **Convert to MP3**. The first time, the page downloads FFmpeg (the
   official ffmpeg.wasm 0.12.10 build, 31 MB) from jsDelivr (unpkg as a
   fallback), **checks both files against SHA-256 fingerprints pinned in
   `script.js` before running anything**, and keeps them in the browser's
   cache, so later conversions work offline. FFmpeg runs in a Web Worker on
   your device; your media never goes to a server.
4. The bar shows real progress: bytes while FFmpeg downloads, then FFmpeg's
   own position in the file ("Converting: 1:41 of 3:00"). **Cancel** stops
   it immediately and frees the memory; a conversion is stopped after 15
   minutes.
5. Before anything is offered, the MP3 is checked twice: FFmpeg's ffprobe
   must read it back as MP3 audio, and the browser must decode it to the
   same length. Then you get a player, **Download MP3** and **Save to My
   music**.
6. **Save to My music** uploads it like any of your songs (private to you
   unless you share it in chat; never to the shared library), with its
   title, artist and length, so it's on all your devices. It asks first if
   a song with the same title is already there. My music's limits apply: 25
   MB per song (an MP3 bigger than that can still be downloaded), 50 songs,
   300 MB, 30 uploads a day.

It works in the Saints Service app (`/console/`) and on most websites. Some
websites' security rules block it (the section says so); use the app there.
The page must be https.

**Setup: nothing new.** No new Worker, KV namespace, R2 bucket or secret.
`YOUTUBE_API_KEY` (already used by Playlists) only adds the link details;
without it a link is still recognized. Pushing to `main` deploys it like
everything else.

**Worker route** (`web/mp3.js`, `worker.js`): `GET /music/mp3/check?url=…`,
owner only (the owner's session, the admin token, or `X-GPA-Owner`; a typed
name isn't enough). Without `url` it just confirms the owner. It parses the
link (YouTube hosts only), calls `videos.list` (1 unit of the key's 10,000 a
day), caches each video's details 12 hours (`ytmeta:<id>`), and allows 120
lookups an hour (`mp3chk:<hour>`). It never fetches media and never returns
the key.

**FFmpeg's license.** ffmpeg.wasm's core is GPL-2.0-or-later. It isn't in
this repository (it's downloaded at run time); `@ffmpeg/core` is only a dev
dependency so the tests can serve the same files locally.

**Checks:** `node --test tests/mp3.test.mjs` and `node tests/browser/mp3.mjs`
(needs `ffmpeg`/`ffprobe` installed: it makes its own test media and checks
the downloaded MP3 with them).

**If something goes wrong:** "Couldn't download FFmpeg": the network or the
website blocked jsDelivr/unpkg; try the app. "didn't match its
fingerprint": the download was altered and was not run. "FFmpeg couldn't
start here": the website blocks workers; use the app. "ran out of memory":
try a smaller file (phones have less room). "no audio track": the file has
only video.

## Admins and the phone app {#admins}

- **Make someone an admin:** Admin → Users → their name → Role: **admin** →
  **Change role**. They need an account first (made on a computer), and they
  sign in again once for the new role to apply.
- **No admin token for admins.** An admin signs in with their own name and
  PIN; the Admin panel (Command Center) opens and connects from their role,
  on the phone app and on a computer. They get what the admin role allows
  (users, AI, memory, security, moderation, system views); owner-only things
  (Allowed users, subscriptions, settings, keys, danger zone) stay yours.
- **Phone app for you and admins only.** Admin → Security → **Phone app**
  (on by default). With it on, only you and admins can sign in to the
  home-screen app (`/console/`); anyone else is told to use the console on a
  computer, and someone already in the app who isn't an admin is signed out
  of it on their next launch. The console injected into websites is
  unchanged for everyone.
- **Two devices at once.** Admins, like you, can be signed in on their phone
  and a computer at the same time (one sign-in per name still applies to
  everyone else).
- **Their music follows them.** Songs an admin uploads in Music → My music
  on the phone are in My music on the computer when they sign in there, and
  the other way round.
- Owner phone alerts (Settings → Account → Phone notifications) stay
  owner-only; admins can turn on @mention alerts in the app.

## Subscribe page (Stripe) {#subscribe}

A payment-only page you give to people who want access:
**`https://donnajbe.viztrrx.workers.dev/subscribe/`** (it can be added to a
phone's home screen too).

1. They type the username they'll sign in with (names that are taken,
   already approved or already subscribed are refused) and tap **Continue
   to payment**.
2. Stripe's secure checkout opens; they pay with a card, Apple Pay, Google
   Pay, Cash App Pay or Link (whatever you turn on in Stripe).
3. When Stripe confirms the payment, your Worker adds the name to **Allowed
   users** as a subscriber (Admin → Security → Subscribers, with the payment
   in the ledger) and you get a "New subscriber" notification. Their page
   shows a one-time **sign-up code**: they create their account in the
   console with that name, a PIN and the code (so nobody else can register
   the name they paid for).
4. It renews every month by itself (each payment extends their access; the
   console shows "Subscribed · renews monthly"). If a renewal payment fails
   you're notified while Stripe retries; if they cancel or it fails for
   good, their access ends and you're notified.

**Price:** $13.80/month, so you keep $13.00 after Stripe's fees (2.9% + 30¢
per US card payment plus 0.7% for subscriptions; check stripe.com/pricing,
they can change). It's shown as one plain price. Cards from outside the US
cost an extra 1.5%. Best: make the price in Stripe (setup step 3) and put its
ID in `STRIPE_PRICE_ID`; the page shows whatever that price is, and you can
change it in Stripe. Without it the Worker uses `SUB_PRICE_CENTS` (default
`1380`).

**Setup (once):**
1. Make a Stripe account at stripe.com and finish activating it (business
   details, bank account for payouts). Turn on two-step login with an
   authenticator app or passkey.
2. Stay in **test mode** (the "Test mode" switch, top right) for steps 3–7,
   try it, then repeat them in live mode.
3. **Product catalog → Add product**: name "Saints Service subscription",
   price **$13.80**, **Recurring**, **Monthly** → Save. Open the price and
   copy its ID (`price_…`). Cloudflare → Workers & Pages → `donnajbe` →
   Settings → Variables and Secrets → **Add** → Type **Text**, name
   `STRIPE_PRICE_ID`, value the ID.
4. **Developers → API keys → Create restricted key** (safer than the full
   secret key): name "Saints Service Worker"; permissions **Checkout
   Sessions: Write**, **Subscriptions: Read**, **Prices: Read**; everything
   else None → Create, copy the `rk_…` key. Cloudflare → **Add** → Type
   **Secret**, name `STRIPE_SECRET_KEY`.
5. **Developers → Webhooks → Add destination**: Account events, API version
   **2026-08-26.dahlia** (the one the Worker uses), events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`;
   endpoint `https://donnajbe.viztrrx.workers.dev/subscribe/webhook`. Copy
   its **Signing secret** (`whsec_…`) into a Cloudflare **Secret** named
   `STRIPE_WEBHOOK_SECRET`.
6. **Settings → Payment methods**: turn on Apple Pay, Google Pay, Cash App
   Pay and Link if you want them (the page shows whatever is on here).
7. Optional: **Settings → Billing → Customer portal** → turn on the link and
   put it in a Cloudflare **Text** variable `STRIPE_PORTAL_URL`; the page then
   shows "Manage or cancel".

**Sales tax:** if you'll charge US customers, some states tax digital
subscriptions. Stripe Tax can collect it (about 0.5% more per payment), but
only after you register in those states; ask an accountant first. It isn't
turned on.

**Their own PIN:** right after paying, a new subscriber sees **Create your
PIN** on the payment page: they type a PIN twice (4+ characters) and their
account is made, so they just open the console and **Sign in** with their
username and that PIN. Only a scrambled check of the PIN is sent (the same
one the console uses), never the PIN itself. If they'd rather do it in the
app, the page still has the one-time sign-up code tucked under "Rather create
your account in the app?".

**No paying twice:** a name that's already paid up for the month can't buy
the subscription again: the page hides Subscribe and only offers a
contribution ("already subscribed for this month, so it can't be paid for
again"), and the Worker refuses it too. Each name can only have one open
Stripe checkout (it expires after 31 minutes). If two payments ever raced
anyway, the second adds no time; you get "kj paid twice" telling you to
refund it and cancel the extra subscription in Stripe.

**Contributions:** when someone who already pays types
their name on the subscribe page, instead of "already subscribed" they get a
box to add a **one-time contribution** of $6 to $500 (quick buttons $6, $10,
$20, $50, or any amount). It's a separate one-time Stripe payment: it doesn't
change their subscription, the page says it's non-refundable and not
tax-deductible (Saints Service isn't a charity, so it's called a contribution,
not a donation). Under the Subscribe button everyone sees: "Contributions are
only for subscribers. New here? Subscribe first." You get a "kj contributed $20" notification, and Admin →
Security → Subscribers shows a contributions total and "contributed $X" on
their row. Nothing to set up: it uses the same Stripe key and webhook.

**Test it yourself with $1 (owner only).** Type your own name (ivan) on
the subscribe page: it turns into **Test contribution**, from **$1**, with a
**Your PIN (owner)** box. Type your Saints Service PIN, tap **Contribute
$1.00**, and pay on Stripe's page. It's a real charge: it shows in Stripe →
Payments, you get a "Your $1.00 test contribution came through" alert, and it
reaches your bank with your next payout. Without your PIN nobody else can use
it (a wrong PIN is refused and counts toward the same lockout as signing in),
and everyone else still starts at $6.

**Policies (what Stripe's review looks for):** every subscribe page has a
footer with **Terms** (`/subscribe/terms`), **Refunds & cancellation**
(`/subscribe/refunds`), **Privacy** (`/subscribe/privacy`) and the contact
email (`viztrrx@gmail.com`; change it with a Cloudflare **Text** variable
`SUPPORT_EMAIL`). By the pay button the page says the buyer agrees to the
Terms and the Refund policy and will be charged the price today and every
month until they cancel, and Stripe's checkout repeats that above its own
button. The refund policy (owner: "put no refunds"): **no refunds**; cancel
any time and keep access to the end of the paid month; only billing errors
(duplicate, wrong amount, unauthorized, charged after asking to cancel) are
refunded, or where the law requires it. **What you promise there:** answer
emails within 2 business days, cancel within 1 business day, refund billing
errors within 3 business days (in Stripe:
Payments → the payment → Refund, then Subscriptions → Cancel immediately),
and email subscribers 30 days before a price change. In Stripe, **Settings →
Business → Public details**, put the three page addresses in the Terms,
Privacy and Refund policy fields and `viztrrx@gmail.com` as support email.
The pages aren't legal advice; have a lawyer look if the business grows.

Until `STRIPE_SECRET_KEY` is set the page says "Subscriptions aren't open
yet". Try it first with Stripe's test mode keys (`sk_test_…`, test card
4242 4242 4242 4242), then switch to the live keys. Secrets live only in
Cloudflare, never in the code. Checks: `node --test tests/subscribe.test.mjs`
and `node tests/browser/subscribe.mjs`.

## Allowed users {#allowed-users}

**Admin → Security → Allowed users** (owner only) limits the console to the
usernames you list, one per line or comma-separated. With **Only allow listed
users** on:

- Anyone else who tries to create an account or sign in sees **Unable to
  create account**, and no profile or account is created.
- Someone already signed in who isn't on the list is signed out on their next
  status check (within about 15 seconds) and sees the same message.
- The Worker refuses unlisted names for everything it serves: server accounts
  and logins, heartbeats (nothing is recorded for them), chat sending and
  reading, page reading and AI. Each attempt is logged under Security and can
  alert your phone ("Security alerts").
- You (the owner) are always allowed. Names are case-insensitive.

Names match in any capitalization: if you list `josue`, then `Josue`,
`JOSUE` and `jOsue` all get in (and are the same account).

**One sign-in per name.** While the list is on, knowing a listed username is
not enough to get in:

- Signing in checks the PIN **on the Worker** before the console opens. A
  wrong PIN gets "Wrong PIN."; trying to Create an account with a name that
  already has one gets "That name is already taken."
- The Worker no longer accepts a bare username for a listed name. Chat,
  AI, page reading, music and heartbeats need the signed-in session, so
  someone who skips the sign-in screen is signed out on the next status
  check ("Please sign in again with your PIN.").
- Each listed name holds **one session at a time**. A second device is
  refused ("already signed in on another device") while the first was used
  in the last 15 minutes. Signing out frees the name at once; after 15 idle
  minutes a new sign-in replaces the old device, which is then signed out
  with the reason.
- **Same computer, another website.** If the name is signed in on one
  website and you sign in on a different website *on the same computer*
  (same network address and same browser), you get a warning first:
  "“kj” is already signed in on this computer on site-a.com… signing in
  here will sign you out of site-a.com", with **Sign in here** and
  **Cancel**. Cancel changes nothing. Sign in here moves the sign-in: the
  other website is signed out on its next status check and says
  "You were signed out here because “kj” signed in on site-b.com on this
  computer." Still only one sign-in at a time. A *different* computer gets
  no such option; it is refused as before.
- Under the list you see each name's status: **Signed in** (with when, where
  and which device), **Signed out**, or **No PIN yet**. **Sign out** ends
  their session; **Reset PIN** deletes the account so they can create it
  again with a new PIN.
- Wrong PINs and refused second sign-ins are logged under Security and send
  a "Security alerts" phone notification.
- You (the owner) are exempt and can stay signed in on several devices.

**Invite codes.** A name you add to the list now gets an invite code (like
`K7MQ-4X2P`), shown on its row under Allowed users with **Copy code** and
**Remove code**. Only someone with that code can create the account: they
tap the planet icon on the sign-in screen (it used to be ＋), the console asks for the code, a wrong code is
refused (and counts toward the sign-in lockout), and the code is used up once
the account exists. Names that were already on the list before invite codes
existed have no code and work exactly as before; you can give one a code with
**Make invite code**. Removing a code, or the name, opens it again. Approving
an access request doesn't make a code (that flow is unchanged).

Without a code, the first person to create an account for a listed name sets
its PIN, so add a name when that person is ready to sign up, and check that it
shows up as theirs (you also get a "New account" notification). If someone
else got there first, use **Reset PIN**.

**Subscribers (paid access).** **Admin → Security → Subscribers** registers a name as a paying subscriber for a set time: 1 week, 2 weeks, 1 month (default), 3 months, 6 months or 1 year, with an optional note such as "$10 · Cash App". Adding someone puts them on Allowed users and lets them sign in right away. While **Only allow listed users** is on (the card offers to turn it on), a subscriber gets in exactly until their end time; at that moment the Worker refuses them, they're signed out with "Your subscription has ended. Ask the owner to renew it.", and within 5 minutes they're taken off Allowed users. You get a phone alert ("Subscriptions ending") 3 days before and when it ends. **Renew** adds the chosen length (on top of any time left, or from today if it already ended); **End now** cuts them off immediately; **Remove** forgets an ended record. Months are calendar months (Oct 15 → Nov 15; Jan 31 → Feb 28). **Subscribed on** (date and time, default now) sets when the time starts, so someone who paid on Oct 1 and is added on Oct 15 still ends on Nov 1; it can't be in the future, and a start so early that the time is already over is refused. **Change start** on a row moves the start (and the end with it) later. **Paid ($)** records what they paid; the card totals **this month** and **collected in all** (payments stay in the total even if a record is removed). In their last 3 days a subscriber also gets a pop-up once a day ("Your access ends in 2 days (Nov 5, 7:40 PM). Ask the owner to renew it…"). Subscribers see their own countdown under the header on every tab ("Subscription · 21 days left · ends Nov 5 at 7:40 PM"), amber in the last 3 days with "Ask the owner to renew to keep access". An ended subscriber can tap **Ask to renew** on the sign-in screen; approving that request in Access requests lets them in for free (Renew is the paid way back). A subscription decides on its own, so a name left on the Allowed users text box doesn't let an expired subscriber back in.

**Automatic month for Allowed users.** While **Only allow listed users** is on, anyone on Allowed users you haven't made a subscriber gets one automatically: from the 1st of this month at midnight (your time, New York) to the 1st of next month. Their row says **Automatic · N days left** with the note "Automatic: on Allowed users". When it ends they lose access like any subscriber, unless you **Renew** them or they pay on the subscribe page (their paid month starts the day they pay). **Add subscriber** on one of them replaces the automatic month with a real one. Names that already had a subscription (even an ended one) don't get one, admins and moderators stay unlimited, and taking a name off Allowed users removes its automatic month. A name added in the middle of the month gets the rest of that month. Putting a name back on Allowed users after its automatic month ended gives it the current month (a paid subscriber who ended still needs **Renew**). **Recent events** on the same page is folded under its title (with a count); tap it to open, and it stays the way you left it on that device.

**New subscribers' school email.** Right after paying, a new subscriber makes their own PIN. The page warns in red that they **must remember it** (nobody, not even you, can look it up or reset it), asks for something simple only they would know but not easy to guess, refuses obvious PINs (1234, 0000, 9876, a year, their username…), and won't continue until they tick **I'll remember this PIN**. Then they add their **school email**: they type only the 6 numbers, and `@alseducation.onmicrosoft.com` is fixed in the box (letters and a 7th digit can't be typed). You get a phone alert ("New subscriber email"), and so does each admin who turned on alerts in their app. **Admin → Security → New subscribers** (you and admins) lists each one with their email. Paste your instructions **Google Doc link** once and tap **Save link**. The subscriber is told: "Next time you're at school, sign in at docs.google.com with that school account: the instructions for loading Saints Service will be in your Google Docs (shared with you)." So **share your Doc with each one**: **Share the Doc** copies their school email and opens your Doc in a new tab; in Google Docs tap **Share**, paste the email, and tap **Send**. They'll see it under "Shared with me". The row is then marked **Shared** (with who shared it). **Copy email** and **Remove** are there too. The email also shows on their Subscribers row. A subscriber can fix a typo in their email up to twice.

**Guessing a PIN locks the account.** 8 wrong PINs, reset codes or student numbers for one name, from any mix of devices and networks, lock that name until noon New York time (the end of the day session). Even the right PIN is refused while it's locked. You and your admins get an alert, and **Admin → Security → Sign-in help → Locked accounts → Unlock account** opens it early. **The real person can unlock it themselves** with the 6 digits of the school email saved on their account (the sign-in screen offers **Account locked → Unlock my account**). Because classmates can often see each other's school emails, that works **once a day** per account and allows **3 wrong numbers** per lock; after that, and for accounts with no school email saved, only you or an admin can unlock it. You get an alert when someone unlocks their own account. A right PIN resets the count. The per-network limit is 30 wrong tries per 15 minutes, high enough that a whole school sharing one internet connection can't be locked out by a few typos.

**No way around the approved list.** The planet icon (create account) and Sign in go through the same server checks: the approved list, the PIN, the device lock and the attempt limits. If the console can't reach the server (offline, or someone blocks it on purpose), nobody can sign in or create an account ("Can't reach the Saints Service server…"); it never falls back to a local-only account. A saved sign-in comes back after a reload only once the server confirms the name is still allowed and its session is valid, so editing browser storage doesn't get anyone in.

**Opens small and centered.** Injected into a website and signed out, **only the sign-in card** shows, in the middle of the page, with no window around it (the website around it stays usable; a lock screen there is just its card too). Once signed in, the console opens as a centered window (about 60% of the page's width and 72% of its height, at least 360×420) with the website still around it, instead of covering the whole screen, both on the sign-in screen and once signed in. It re-centers when the window is resized and can still be dragged or minimized. **Settings → Size** still has Compact … XL and **Full page**; Full page lasts for that visit, and the next injection opens centered again. The home-screen app is full screen as before.

**Fold the top card.** Every tab's big top card (Ask AI, Music, Chat…) has a small arrow in its top-right corner. Tap it and the card shrinks to a thin bar with just the title and its buttons (on Ask AI: **New chat** and **Study settings**), so the answers get most of the window. Tap the arrow again to open it. Each tab remembers its own choice on that browser, even after a reload.

**Forgot PIN?** On the sign-in screen they type their username, tap **Forgot PIN?**, type their **student number** (the 6 digits before @alseducation.onmicrosoft.com, digits only), pick a new PIN (twice), and tap **Reset my PIN**. If the number matches the one on their account, the new PIN works right away and they're signed in (you and your admins get an alert saying so). A wrong number is refused (and counts toward locking the device). If their account has no number on file yet, the request waits for **you or an admin**: their screen says "Check back every 10 minutes to see if you can sign in again" (and signs them in by itself if it stays open); you both get an alert, and **Admin → Security → Sign-in help** shows the request with the number they gave and their message: **Approve new PIN** (which also saves that number) or **Deny**. Their old PIN works until then; a request lasts 24 hours; 5 requests an hour per network at most.

**Student number required for everyone.** Anyone who signs in without a student number on file (existing accounts too; everyone but you) gets a screen they can't close or skip: they must read a notice (the boxes stay off for 8 seconds), tick "I read this, and the number I'm typing is my own student number", and type their 6 digits twice (only digits, exactly 6; the two must match). It's saved to their account; they can't change it themselves (you or an admin can **Clear** it in Sign-in help, and they're asked again). One account per number. New subscribers' number from the subscribe page is saved the same way.

**Locked devices (unauthorized sign-in).** If a console tries **3 names that aren't approved**, or gets **5 wrong PINs, reset codes or student numbers**, within an hour, that device locks: a screen covers the whole console ("This device is locked … until 12:00 PM, the end of the school day session"), nothing under it works, and reloading doesn't get around it. Each console has its own random device id, so other students on the same school network aren't affected. You and your admins get an alert (computer and app); **Sign-in help** lists the device, the names it tried, and **Approve (unlock)** or **Keep locked until the session ends**. The day session is 7 AM to 12 PM New York time, so a lock lasts until 12 PM today (or 12 PM tomorrow if it's already past noon).

**Sign-in help** (Admin → Security, you and admins) also has **Approved people and their school emails** (everyone on Allowed users, with their email or "Not added yet") and a **Log** of student numbers saved, PIN resets and requests, approvals, denials, locks and unlocks. Allowed users rows show each person's school email too.

**Resetting a forgotten PIN.** **Admin → Security → Allowed users → Reset PIN** on their row (or Admin → Users → their name → **Reset PIN**). You get a one-time **reset code** (like `GJKT-TTW6`) with **Copy code** and **Cancel reset**, and they're signed out everywhere. Tell them: on the sign-in screen type your username and a **new** PIN, tap **Sign in**, then type the reset code when it asks and tap Sign in again. They keep their account, subscription, music and everything else. The code works once, for 7 days; until it's used their old PIN still works. Only you can reset PINs (admins can't see the codes). The old way (deleting the account so the next person to create the name sets the PIN) is gone from the panel because anyone could grab the name first.

**Free access (override).** When you're feeling generous: **Admin → Security → Free access** (right above Subscribers) lets someone in for free, whatever their subscription says. Type the name, pick **No end date** (the default) or 1 week to 1 year, add a note if you like, and tap **Give free access**: they're put on Allowed users and can sign in right away. Their row says **Free · no end** (or **Free until Oct 25**) with who gave it; Subscribers shows them too, with only **End free access**. Admins and moderators can do this as well (moderators find the card under **Moderation**, since they don't have Security), and you get a phone alert whenever one of them does. Free access never shortens time someone already paid for, isn't counted as money, and the subscribe page tells them there's nothing to pay (they can still contribute). Someone billed monthly through Stripe is refused (cancel it in Stripe first, so they aren't charged). **End free access** signs them out and takes them off Allowed users. Admins and moderators never need it: they're always in, and making someone staff removes any automatic month.

**Requesting access.** Under "Unable to create account" the sign-in screen
offers **Request access**: the person can add a short note and send it. You
get an "Access request" phone notification (People → Access requests) and the
request appears in **Admin → Security → Access requests** with the note, when
and where it came from, and **Approve / Deny / Clear**. Approving adds the
name to Allowed users, so they can sign in right away; while it's waiting,
trying again shows that the request was sent. A denied name can ask again
after a day, and one network can send at most 5 requests an hour.

Turning the switch off lets everyone in again and keeps the list for later.
The sign-in screen asks the Worker; if the Worker can't be reached the
console still opens offline, but every server feature stays refused for names
that aren't listed.

## Subscription countdown, Renew and texting (Telnyx) {#texting}

**The countdown.** Under the header, on every panel size, each person sees how
long their access has left, in days and hours ("12d 9h left"), updated every
minute, plus the exact date and time it ends. People paying monthly see
"Renews in 12d 9h". You and admins see "No expiry".

**Renew.** Next to the countdown, a **Renew** button opens:
- **Open the subscribe page** / **Copy link**;
- **Text me the link**: they type their phone number and get one text with the
  subscribe link (only when texting is set up, below);
- **Paying cash?**: "Give $13.80 in person to ivan (owner) or …", and "or
  text CASH to (239) 555-0100".

**Texting CASH.** Anyone who texts **CASH** to your Telnyx number gets a reply
saying who to give the cash to, and you and your admins get an alert ("Paying
cash: kj (239) 555-0123"). When you get the cash, mark them paid in Admin →
Security → Subscribers. **STOP**, **START** and **HELP** work as carriers
require.

**Who takes cash.** Automatically you and everyone with the admin role. To
name specific people instead: Admin → Security → **Cash & texting** → one name
per line → Save (empty = automatic again). The same card shows whether texting
is on and who texted CASH recently.

**Limits** (so nobody can use it to spam people or run up your bill): only a
signed-in person can request a text; 3 a day per person, 2 a day per phone
number, 100 a day in total; a number that texted STOP is never texted again
unless it texts START.

### Setting up Telnyx (about $20 once, then a few dollars a month)

Telnyx is the cheapest good texting service: about $0.004 per text plus about
$1 a month for the number. Every US texting service (Telnyx, Twilio, …) has to
register your business with the phone carriers before your texts are
delivered; that's the one-time cost and takes about 1–3 weeks.

1. Sign up at **telnyx.com** (Portal) and add a little credit ($10–20).
2. **Numbers → Search & Buy**: buy a local number (Florida area code if you
   like).
3. **Messaging → Messaging Profiles → Add**: name it "Saints Service". Under
   **Inbound**, set the webhook URL to
   `https://donnajbe.viztrrx.workers.dev/sms/inbound`. Assign your number to
   this profile.
4. **Messaging → 10DLC** (or **Toll-free verification** if you bought a
   toll-free number): register your brand (Saints Service, sole proprietor) and
   a campaign. Use case: "Account notifications". Sample messages: the two texts
   above. Opt-in: "The person types their own number in the app and taps Send."
   Wait for approval before expecting texts to arrive.
5. **Auth → API Keys → Create**: copy the key. **Keys & Credentials → Public
   Key**: copy it.
6. Cloudflare dashboard → Workers & Pages → **donnajbe** → Settings →
   Variables and Secrets → add:
   - `TELNYX_API_KEY` (type **Secret**): the API key;
   - `TELNYX_PUBLIC_KEY` (Secret): the public key;
   - `TELNYX_FROM` (Text): your number like `+12395550100`.

   Save and deploy. Don't paste the keys anywhere else (not in chat, not in
   GitHub).
7. Check: Admin → Security → Cash & texting says "Texting is **on** from …".
   Tap Renew → Text me the link with your own number; text CASH back.

Until those are set, texting is simply off: the Renew box still shows the link
and who to pay in cash.

## Saints Service as an iPhone app {#iphone-app}

The Worker also serves the whole console as a home-screen web app at
`https://donnajbe.viztrrx.workers.dev/console/`. It's for you and your admins
(see [Admins and the phone app](#admins); Admin → Security → Phone app turns
that off).

1. Open that address in **Safari** on your iPhone.
2. Tap **Share**, then **Add to Home Screen**.
3. Keep **Open as Web App** on and tap **Add**.

Open it from the new icon. It runs the same `script.js` as the bookmarklet in
*app mode*: edge to edge under the status bar and home indicator, no window
corners, no close or collapse button, 44px tap targets, and 16px text fields so
iOS doesn't zoom when you type. Sign in with your usual username and PIN; the
app keeps its own sign-in, separate from Safari and from the pages you inject
the console into. The reload button restarts the app with the latest
`script.js` from `main`.

After the first launch it also opens offline: the service worker keeps only
the app's own files (the page, icons and the console script). Chat, AI answers
and everything else still need a connection. Owners can point the app at a
different build with the Worker variable `CONSOLE_SCRIPT_URL`.

### Phone notifications (owner only)

In the app, open **Settings → Account → Phone notifications** and tap
**Turn on** (iOS 16.4 or later, opened from the Home Screen icon). If you
aren't signed in with the owner code or an owner session, the app asks for
your admin token once to prove you are the owner; it isn't saved. The Worker
then sends standard Web Push notifications straight to your iPhone:

| Group | Alert | What it says | Tapping it opens |
|---|---|---|---|
| Chat | Public chat messages | `kj in #public`: the message (or "Sent a photo") | Chat, in #public |
| Chat | Private room messages | `kj in #Study Group`: the message | Chat, in that room (if this phone joined it) |
| Chat | Mentions of you | `kj mentioned you in #public` when a message says `@yourname`; comes through during quiet hours | Chat, in that room |
| Chat | Chat reports | Who reported whom, in which room, and the message | Admin → Moderation, that report highlighted |
| People | Sign-ins | `kj signed in`: time, place and site (at most once per 10 minutes per user) | kj's profile in Admin → Users |
| People | New users and accounts | First sign-in of a new username, and new server accounts | Their profile |
| People | Waiting for your approval | A new user held by the approval queue | Their profile, at the Approve button |
| People | Access requests | Someone not on your Allowed users list asked to get in, with their note | Admin → Security, their request highlighted |
| People | Who's online (live) | Off by default. One alert, replaced as people come and go ("Joined: kj · Left: dub", who's on now), and the count as the app icon badge | Admin → Users, "Seen today" |
| AI | AI request failures | Who, the error type and status, the reason (API keys are never included) | Their profile, at **API key** (assign or replace their key right there) |
| AI | Rate limits and quotas reached | Who hit a rate limit or quota | Their profile, at **Quota overrides** |
| System | Worker errors | Unexpected Worker errors, with the route | Admin → Developer (diagnostics) |
| System | Security alerts | Wrong PINs, second sign-ins, sign-in lockouts, owner-name and identity spoofing, refused notification sign-ups | Admin → Security at that name's Allowed users row (wrong PIN, second device) or Access requests (unlisted name); the person's profile for spoofing |
| System | Actions by your admins | What a moderator or admin (not you) did, and to whom | Admin → Audit log |
| System | Failed scheduled jobs | The nightly jobs, if one fails | Admin → Automation, that job |
| System | Daily summary | Every day at 12 PM (noon) New York time, in summer and winter: people who used the console in the last 24 hours, new users, AI requests and failures, limits, security events | Admin → Overview |
| — | Test notification | "Notifications are working" | Settings → Account → Phone notifications |

The spot a notification opens is outlined for a moment so it's easy to find.
Admin keeps its token in memory only, so if the app was closed, a tap on an
Admin notification first shows the Admin connect screen; after you connect it
goes straight to the right spot.

**Quiet hours** hold ordinary alerts between the hours you pick; errors,
security alerts and mentions still come through.

iPhones don't let web apps use Live Activities (those need a native App Store
app), so "Who's online" is the closest equivalent: a single notification
that updates as people join and leave, plus the number on the app icon.
The Worker checks at most once a minute while people are active and every 5
minutes by cron (see `triggers` in `wrangler.jsonc`, which also keeps the
daily job at 05:00 UTC), and does nothing unless a phone has it switched on.

Each kind has its own switch. **Send a test notification** checks delivery,
and tapping a notification opens the app on its spot (table above). Your own chats and
AI requests never notify you. Times use `America/New_York` unless the Worker
variable `OWNER_TZ` says otherwise.

No setup is needed in Cloudflare: the Worker creates its push keys (VAPID) on
first use and keeps them in KV. To manage them yourself instead, set the
secrets `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (base64url P-256 keys,
e.g. from `npx web-push generate-vapid-keys`), and optionally `VAPID_SUBJECT`
(`mailto:you@example.com`). Changing the keys means turning notifications
off and on again on your phone.

Icons are drawn by `web/console/make-icons.py`; edit files in
`web/console/public/`, then run `npm run build:web`. Checks:
`node --test tests/console-app.test.mjs` and
`node tests/browser/console-app.mjs` (an emulated iPhone against the Worker
running locally).

## API keys {#api-keys}

| Feature | Key | Where to get it |
| --- | --- | --- |
| AI (OpenAI) | OpenAI key, starts with `sk-` | [https://platform.openai.com/api\-keys](https://platform.openai.com/api-keys) |
| Music search | YouTube Data API v3 key | [https://console.cloud.google.com](https://console.cloud.google.com) → enable *YouTube Data API v3* → Credentials |

The console runs on OpenAI only. The base model is `gpt-4.1-mini` and the smart model for hard tasks is `gpt-5`; both are reset on every load and sign\-in.

Because browsers scope `localStorage` per origin, a key entered on `example.com` isn't visible on `wikipedia.org` — you'll be asked again on each new domain. If that gets tedious, have the owner assign you a key server\-side (Admin → AI & Usage), which the Worker attaches without ever sending it to the browser.

The YouTube free tier covers roughly 100 searches per day.

* * *

## Features {#features}

### Welcome {#welcome}

![The Welcome pane](docs/screenshots/welcome.png)

The landing pane after sign\-in: a typed greeting, the AI status, local time and weather, your activity, local news and quick links to the main tools.

### Page Insights {#page-insights}

![Page Insights summarizing a page](docs/screenshots/page-insights.png)

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

![Ask AI answering a question](docs/screenshots/ask-ai.png)

General\-purpose chat, independent of the page. Voice input via the browser's speech recognition, and optional read\-aloud for responses via speech synthesis — both local, both free, neither needs a key.

### Selection assistant {#selection-assistant}

![The selection toolbar above highlighted text](docs/screenshots/selection-bubble.png)

Select text on any page, or inside an embedded frame from the same site, and a compact toolbar appears next to it. It shows your primary tools, and **More** holds the rest in four groups:

- **AI:** Ask AI, Answer, Explain, Summarize, Simplify, Define, Translate, Humanize, Fix grammar, Debug code.
- **Learning:** Solve quiz, Hint, Practice quiz, Make flashcards.
- **Research:** Search the web, Research, Ask in Page Insights.
- **Productivity:** Save, Add to Notes, Copy clean text.

Answers open in a small popup with Copy, Save and Try again. Everything follows the current theme, including theme previews and custom themes. On phones the toolbar becomes a bottom tray.

![The grouped More menu with keyboard shortcuts](docs/screenshots/selection-more.png)

![An Explain answer next to the selection](docs/screenshots/selection-explain.png)

**Keyboard shortcuts.** They only act while text is selected and you are not typing in a field, so they never take over ordinary typing. The defaults use Alt+Shift (⌥⇧ on a Mac), because Ctrl and ⌘ shortcuts belong to the browser.

| Action | Windows / Linux | Mac |
| --- | --- | --- |
| Ask AI | Alt+Shift+/ | ⌥⇧/ |
| Answer | Alt+Shift+Enter | ⌥⇧↵ |
| Solve quiz | Alt+Shift+Q | ⌥⇧Q |
| Explain | Alt+Shift+E | ⌥⇧E |
| Summarize | Alt+Shift+M | ⌥⇧M |
| Search the web | Alt+Shift+F | ⌥⇧F |
| Save | Alt+Shift+S | ⌥⇧S |
| Repeat last tool | Alt+Shift+R | ⌥⇧R |
| Move focus to the toolbar | Alt+Shift+K | ⌥⇧K |

**Make it yours** in **Settings → Controls → Selection assistant**:

- Choose up to five primary tools, and reorder or remove them.
- Turn single tools or whole groups off, and star favorites.
- Record new shortcuts by pressing them. Browser shortcuts such as Ctrl+C are refused, and a conflict asks before moving a shortcut from another tool.
- Pick a style: Compact, Comfortable, Minimal (one button) or Expanded (a list with shortcuts). You can also set the position, animation and behavior.
- **Smart tool ordering** puts the likeliest tools first for what you selected: a quiz question, a single word, code or a long passage. Turn it off to always use your own order.
- Reset restores the assistant's defaults and nothing else.

Controls also lists every keyboard shortcut in the console.

Settings are saved per account. The owner can turn the whole assistant off, or single tools, with the `selection` and `sel_<tool>` feature switches. Existing switches also apply: turning off `quiz` hides Solve quiz. A tool the owner turned off can't be turned back on in Settings, and Settings says why.

![Settings → Controls → Selection assistant](docs/screenshots/settings-selection.png)

### Chat {#chat}

![Chat room](docs/screenshots/chat.png)

Public and private chat rooms that run through your Worker. Signed\-in users can report a message; reports land in Admin → Moderation.

Each room's messages live in their own Durable Object (`CHAT_ROOMS`, see `chat/room.js`), which takes one message at a time and stamps it in order. Before, a room was a single Workers KV value rewritten on every send; KV can take up to a minute to sync between Cloudflare locations, so two people sending at about the same time from different places could erase each other's message (the push notification still went out). Messages from before the change are carried over the first time a room is opened.

**Staff chat.** Moderators, admins and you get a **Staff chat** item right under **Chat** in the sidebar (with its own unread badge). It opens a built-in `#staff` room; tapping **Chat** goes back to the room you were in. Everyone else never sees the item or the room, and the Worker itself refuses them: reading or posting to `staff` without proof answers "no such room". Proof is a signed-in account whose role is moderator or admin (Admin → Users → a person → Role; it takes effect on their next sign-in), your owner code, or an admin token connected in Admin. Nobody can create or delete a room named "staff"; the nightly chat cleanup empties it like the others.

**Read receipts**, iMessage style: under your newest message (while it's the latest in the room, since a reply says it was seen) a small grey line reads **Delivered** once the room has it, then **Read by kj 3:42 PM**, **Read by kj and dub …** or **Read by kj, dub and 2 others …** once someone has had it on screen. A message only counts as read while that person's Chat tab is open and visible; a notification or another tab doesn't count. Each room keeps everyone's "read up to" point in its Durable Object; hovering the line lists each reader and when.

**Who's typing.** While someone types in the room you're looking at, a grey bubble with three bouncing dots shows under the conversation: **kj is typing…**, **kj and dub are typing…**, or **Several people are typing…**. It appears within a couple of seconds, stays through a short pause, and goes away when they send or empty the box (or after 15 seconds without typing). People who can't post (blocked, muted, banned from the room, or while chat is read-only) never show as typing, and nobody sees themselves.

**Who's here.** Above the messages: faces with a coloured dot and a line like **kj and dub are here · 2 online**. Tap it for the full list: **In this chat** (green: has this room on screen), **Online** (amber: has the console open, Chat not on screen), **Typing…**, or **Last seen 20 min ago** (grey) for anyone who was in the room in the last week.

**Reactions** (iMessage tapbacks ❤️ 👍 👎 😂 ‼️ ❓). Double-click a message (computer), double-tap or press and hold it (phone), or use the ☺ button that shows on hover. One reaction per person per message: picking another replaces it, picking the same one (or tapping your own pill) takes it off. Each shows as a small pill with a count under the message; hover to see who. On phones the bar also has **Copy**.

**Replies.** Pick **↩ Reply** in a message's bar (or the ↩ button on hover on a computer). A banner above the box shows who you're answering (✕ or Esc cancels); the sent message carries a small quote of the original, and tapping the quote jumps to it and highlights it. Replying to one of the owner's messages sends the owner a "mentions" alert.

**Unsend.** Your own messages show **Unsend** in their bar for 2 minutes after sending (the server enforces the 2 minutes and that it's yours). Everyone then sees "kj unsent a message" (you see "You unsent a message"); quotes of it say "Unsent message", its reactions go, and a photo in it is deleted. Push notifications that already went out can't be taken back.

**@mentions.** Type `@` in the message box and a list of names appears (people in the room and recent senders); arrows and Enter/Tab or a tap pick one. A message that mentions you is highlighted for you, with your `@name` in bold, and you get a pop-up if Chat isn't on screen. **Mention alerts** (Settings → Account) puts a phone notification on your device when someone @mentions you in #public or staff chat (each person turns it on for their own device; on iPhone it needs the Home Screen app). Private rooms never send mention alerts, and staff chat only alerts staff.

**Polls.** Type `/poll Pizza or tacos?` (it splits "X or Y" into two options) or `/poll Where to? | Park | Mall | Beach` (2 to 6 options), or tap 📊 for a template. Everyone sees a poll card with bars and counts that update live; tap an option to vote, another to change, the same one again to take your vote back. Hover an option to see who picked it.

**Edit.** Your own message has **Edit** in its bar for 2 minutes after sending: the box takes its text with an "Editing message" banner; Enter saves, ✕ or Esc cancels. Everyone sees the new text marked "edited", and quotes and pins follow it. Polls can't be edited.

**Pinned messages.** Staff (moderators, admins, you) get **📌 Pin** in a message's bar. Up to 3 pins per room; the newest shows above the chat for everyone (tap it to jump there, `1/3 ›` to see the others, ✕ to unpin for staff). Unsending a message removes its pin.

**Voice messages.** Tap the mic next to the message box, talk (up to 30 seconds; a red dot and a timer show), then **Send** (or **Cancel**). Everyone gets a small player. The Worker checks the file really is audio and streams it in pieces so it plays on iPhone. Up to 40 a day per network.

**Quiet hours.** Admin → Moderation → **Chat quiet hours** (off unless you turn it on): between the two hours you pick (your time zone), chat is read-only for everyone but staff. People see "🌙 Quiet hours: chat is read-only until 6 AM" and their message box is off; staff see that they can still post.

**Chat effects.** A message saying "congrats", "congratulations", "gg" or 🎉 sets off confetti on everyone's screen who has the chat open; "happy birthday", "hbd", 🎂 or 🎈 sends up balloons. Each person can turn effects off in Settings → Account → **Chat effects**; they never play for people who have reduced motion turned on.

**Flair and badges.** In Admin → Users → a person → **Flair** you give someone a badge shown next to their name in chat (⭐ VIP, 🎮 Gamer, 💎 Supporter, 🎨 Artist, 📚 Scholar, 🔥 Legend, 🎵 Music, 👑 Royalty; **Remove flair** takes it off). Moderators and admins get a 🛡 automatically. In the "who's here" list people also show their 🔥 day streak (2+ days) and 🧠 trivia points.

**Weekday streaks.** Opening the console on weekdays in a row (Monday to Friday, your time zone) builds a streak, shown as 🔥 on Welcome → Your activity → **Weekday streak**. Using it every day Monday to Friday is a 5-day streak. Weekends don't count and don't break it: someone on 5 on Friday is still on 5 over the weekend and goes to 6 when they open it Monday. A streak can start on any weekday (it doesn't have to be Monday). Missing a weekday starts over.

**Daily trivia.** Every day at 12 PM (your time zone) a question appears in #public as a notice; the first person to type the right answer in chat wins a point ("🎉 kj got it! The answer was Paris. kj has 3 trivia points."). If nobody gets it, the next day's notice gives the answer. The questions come from a built-in list of 60 (no AI key needed, so the answers are always right). Admin → Moderation → **Fun features** turns trivia off or asks a question right now.

**Game leaderboards.** Your personal bests in the scored games (Snake, Tetris, 2048, Reaction Test, Typing Test and 17 more) go to a top 10 per game, one entry per person; open **🏆 Leaderboard** under a game to see it (lower is better for Reaction Test and Guess the Number). A new #1 is announced in #public ("🏆 kj set a new record in Snake: 1,240"), at most once per game every 10 minutes; Fun features can turn those posts off. Scores that aren't humanly possible are refused.

**Share a song.** In Music, the 💬 button on the now-playing bar shares the song to the chat room you're in. Everyone sees a card with the title and artist and a **▶ Play** button that plays it in their console (songs from the shared library, Audius, or someone's **My music** uploads).

**Grouping.** Several messages in a row from the same person (within 5 minutes) show their picture and name once, with the rest as plain lines underneath, like iMessage. Someone else's message, a reply or a 5-minute gap starts a new group. On a computer, hovering a grouped line shows its time and the ↩ / ☺ buttons.

### The owner name {#owner-name}

The owner is **ivan** (it was viztrrx until 2026-10-20). It's set in `wrangler.jsonc` (`"vars": { "OWNER": "ivan" }`), which replaces any `OWNER` variable in the Cloudflare dashboard on each deploy; the Worker's own default is also `ivan`. To change it again, edit both and push. Things saved under the old name (its My music, memory, conversations) stay with that name, which is now an ordinary account.

**First time as ivan** (on the web or in the app): sign up as `ivan` with your PIN. If the server says the name is reserved, connect Admin (Admin tab → your admin token), then Settings → Memory → **Set up your owner PIN**, type the PIN twice. After that, sign in as `ivan` with that PIN anywhere, on several devices at once.

### Resetting your own PIN (owner) {#owner-pin}

If Settings → Memory → **Reconnect** says "Wrong PIN." (or "This name is reserved for the console's owner"), tap **Forgot your PIN? Reset it** there. It shows when Admin is connected (or your owner code is entered) on that device, which proves it's you, so the old PIN isn't needed. Type a new PIN twice and tap **Reset PIN**: it becomes your PIN on that device and on the server (your owner account is created if it didn't exist yet), Memory connects, older sign-ins on other devices are signed out, and you get a security alert. Everyone else uses **Forgot PIN?** on the sign-in screen.

### Messages: direct messages and group chats {#messages}

![Messages](docs/screenshots/13-messages/5-list-unread.png)

**Messages** sits right under **Chat** in the sidebar, with an orange **NEW** label until you've opened it on that device. It needs a signed-in account.

- **New message** opens a direct message with one person (type their name; names you can pick are suggested). Starting a second one with the same person opens the same conversation.
- **New group** makes a group chat: give it a name, add 2 to 19 other people. Anyone in it can **Add people** and **Rename** it; the person who started it can **Remove someone**; anyone can **Leave**. The group shows a notice for each change.
- A conversation works like a chat room: replies, reactions, photos, voice messages, polls, edit and unsend, typing, "who's here" and read receipts.
- Your list shows each conversation's latest message and how many you haven't read; the Messages item in the sidebar has a red badge with the total. Phone alerts (Settings → Account → Mention alerts) also cover new messages, at most one a minute from the same person.
- **Hide** takes a direct message off your list until they message you again.
- Up to 20 new conversations a day per person (the owner isn't limited).

**Safety review (owner and admins).** You and admins get a **Safety review** button there: it lists every conversation, and opening one shows it **read-only** (no message box; the Worker also refuses posts). Your viewing leaves no "Read by" and doesn't show you as "here". Each conversation opened this way is written to Admin → Audit (`/dm/review-open`). Moderators don't have it. You only get push alerts for conversations you're in.

**@everyone, in every chat.** Type `@everyone` (it's in the `@` list) in #public, a private room, staff chat, a group or a direct message. The message is highlighted for everyone in that chat, like a mention, with a pop-up for people who have the console open, and a phone alert for people with Mention alerts on: in #public everyone with alerts, in staff chat the staff, in a group its members, in a private room the people who've been in it. To stop spam it alerts **once every 10 minutes per person**. A second one within 10 minutes still sends, as plain text, and the sender is told it didn't alert anyone. You, admins and moderators aren't limited. At most 60 phone alerts per @everyone.

**Stats on Welcome.** A **Saints Service stats** card on Welcome, the same for everyone: members, online now, messages today and this week (#public and private messages counted together; only counts, never who wrote to whom or what), group chats, and the top three chatters in #public this week, trivia points, weekday streaks and game records. The Worker works it out at most once a minute (`/stats/public`).

**Pop-up notifications on Chrome and Chromebooks.** Saints Service runs injected into websites on Chromebooks, so it shows its own Chrome notifications (on a Chromebook they appear at the bottom right and in the tray by the clock):

- **Turn on:** the 🔔 strip in Chat or Messages, or Settings → Account → **Pop-up notifications**. Chrome asks "Allow notifications?" once for each website Saints Service is opened on; choose **Allow**. The page never asks by surprise.
- **What pops up:** direct and group messages, @mentions and @everyone by default; pick "plus every chat message" for all of #public too. Nothing pops up for a chat that's already on your screen.
- **When:** while Saints Service is open in a Chrome tab (any website, or the app), even when that tab is in the background or another window is in front. Chrome may hold them back up to a minute in a tab that's been in the background a while. With no tab open, nothing in a web page can run; for that, use **Mention alerts** in the Saints Service app (below), which sends push alerts while Chrome is running.
- **Only once:** with Saints Service open in several tabs or on several websites, each message pops up once (the Worker hands each message out once per browser), and not at all where this browser already gets the same alert from the app.
- **Clicking one** brings the tab to the front and opens that conversation or room.
- **Not showing up?** Click the icon left of the address bar → Site settings → Notifications → Allow, then reload. On a Chromebook, also make sure Do Not Disturb is off (click the clock). Settings → Account → **Send a test** checks it.

**Mention alerts (push, also with no tab open):** in the Saints Service app (`/console/` on the Worker, installable in Chrome), Settings → Account → Mention alerts → Turn on. It covers direct messages, @mentions and @everyone. On a website, the card has an **Open the Saints Service app** button.

### AI usage meter {#usage-meter}

Anyone you give a limit to (Admin → Users → a person → **Quota overrides**, or a quota for everyone in AI & Usage) sees a slim meter under the console's header on every tab: **AI requests today** (or **this month**), a progress bar, how many are left, and when it resets. It turns amber at 80% and red at the limit ("Daily limit reached. AI requests are paused until …"). A per\-minute rate shows as a short note instead of a bar. People without a limit, and you, never see it. The numbers come from the same counters the Worker enforces, refreshed on every status check and right after each AI request. Daily quotas reset at midnight UTC (8 PM New York time in summer, 7 PM in winter); monthly ones on the 1st.

### Study {#study}

![A flashcard deck built from the page](docs/screenshots/study.png)

Generates flashcard decks from whatever page you're on, with spaced practice and grading.

### Notes {#notes}

![Organized study notes from a passage](docs/screenshots/notes.png)

Paste a passage; the AI reads it, researches it across the web, and writes organized study notes. It keeps the passage, the notes, and the research in context, so follow\-up questions get answered against the whole thing rather than starting cold.

### Humanize {#humanize}

![Humanize rewriting stiff text](docs/screenshots/humanize.png)

Paste text that reads stiff or machine\-written and get a rewrite that sounds like a person wrote it. Meaning, facts and length stay the same. The same rewrite is in the selection bubble.

### Grammar {#grammar}

![Grammar fixing errors and explaining each fix](docs/screenshots/grammar.png)

Fixes real grammar, spelling and punctuation errors only, and lists each fix with the reason. Style and word choice stay yours.

### Saved {#saved}

![Saved insights, calendar and scratchpad](docs/screenshots/saved.png)

Insights you save get organized into folders and a calendar view, alongside an autosaved scratchpad and a 25/5 Pomodoro timer.

**Context memory.** Each saved insight has a 🧠 toggle. Switch it on and that insight travels with every later AI request as background the assistant already knows — so a worked explanation you saved on question 7 informs the answer to question 9, or notes from one page carry into a different one. It's opt\-in per insight and off by default, on purpose: a blanket "remember everything" turns every unrelated note into a source of confusion and costs tokens on every request. Selected insights go in newest\-first up to a character budget, and the prompt tells the model that when saved context conflicts with the page currently open, the page wins.

### Admin Command Center {#admin-command-center}

![Admin Command Center overview](docs/screenshots/admin-overview.png)

A full admin surface in its own sidebar pane, **Admin**. It appears after the old gesture (click the **Account & sync** heading five times, then enter the PIN `1029`), or automatically for a signed\-in account the owner has made a moderator or admin. Connect with the `ADMIN_TOKEN` (owner) or `COADMIN_TOKEN` (moderator); the token is kept in memory for the session only.

Every number comes from the Worker and every action is authorized there. The UI only hides what your role can't use, based on `/admin/whoami`. Sections:

- **Overview**: users, active now, AI requests, latency, tokens, memory, moderation and security counts, a 7\-day chart, recent admin activity and system health. **When people are online**: a 7 × 24 heatmap of how many people have the console open, by day and hour in your time zone (sampled once an hour, averaged over the last 4 weeks; hover a cell for the number) with the busiest time called out. **Weekly report**: this week so far (people active and new, chat messages with the top three chatters across every room, AI requests, subscription money), with **Send it to my phone now**; it also arrives on its own every Sunday at 6 PM (notification "Weekly report").
- **Users**: search, filter and sort; an inspector with usage history, sessions, security events, audit history, role, per\-user quotas and moderation actions.
- **AI & Usage**: requests, failures, rate limits, latency, tokens and model mix over 7 or 30 days; global quotas; masked assigned keys with a health test; this device's model overrides and playground.
- **Memory**: aggregate memory health. The owner can open one user's memories only with a stated reason, and that view is audited.
- **Security**, **Moderation** (reported chat messages, live users, rooms), **Content & Data** (broadcasts, backups, local data), **System**, **Automation** (scheduled jobs with manual runs), **Developer** (diagnostics that never include secret values), **Audit log** and **Danger zone** (each action needs a typed phrase such as `MAINTENANCE`).
- **Command palette**: Ctrl/⌘ K inside the Admin pane, filtered by your permissions.

Roles are `owner`, `admin`, `moderator` and `user`. Permissions live in one map, `ROLE_PERMS`, in `worker.js`.

|  |  |
| --- | --- |
| ![User inspector](docs/screenshots/admin-users.png)<br>**Users** and the per\-user inspector | ![AI & Usage](docs/screenshots/admin-ai.png)<br>**AI & Usage** |
| ![Security](docs/screenshots/admin-security.png)<br>**Security** | ![Danger zone](docs/screenshots/admin-danger.png)<br>**Danger zone** with typed confirmations |
| ![Command palette](docs/screenshots/admin-palette.png)<br>**Command palette** (Ctrl/⌘ K) |  |

**Two honest limits, because they matter:**

*This is a soft lock, not security.* The PIN lives in the script, which is public — anyone who reads the source sees `1029`. It keeps a casual user out of the dashboard; it does not protect anything. What it no longer exposes is the credential: the `ADMIN_TOKEN` and the owner code are held in memory for the session only and are never written to `localStorage`, so bypassing the PIN gets you an admin panel with no authority — every action it offers is refused by the Worker without the token. You re\-enter the token once per session, which is the point.

*Seeing other people is real now — through your worker.* Because `localStorage` is per\-browser, the local log only shows this browser. To see everyone — including who's active right now — every instance sends a small heartbeat to your Cloudflare Worker's `/track` endpoint, and the Usage tab's Live view reads it back. This is proper analytics: the data lives server\-side in your Worker's KV store, and the Worker only returns it to a request carrying your `ADMIN_TOKEN`, so the logs are genuinely owner\-only and no secret ships in the public script. When telemetry is on, every user sees a one\-time notice that usage is recorded (their profile name, open times, and coarse location — country/region from Cloudflare, never a raw IP or anything they type). That notice is deliberately not removable: logging people who know they're logged is analytics; logging people who don't is spyware, and the second one isn't something this builds. Turn it all off by setting `TELEMETRY_ENABLED = false` near the top of `script.js`.

**Setting up live telemetry.** In the Cloudflare dashboard, on the same Worker you deploy `worker.js` to: (1) create a KV namespace under Storage & Databases → KV; (2) bind it to the Worker as a KV Namespace Binding named exactly `TELEMETRY`; (3) add an environment variable `ADMIN_TOKEN` set to a long random secret (use Encrypt); (4) deploy the updated `worker.js`; (5) in the admin console → Usage → Live, paste that same `ADMIN_TOKEN` into the token field and press Load live users, then turn on Auto\-refresh to watch it live. The token is held in memory for that session only — it is never saved to the browser, and it travels in an `Authorization: Bearer` header, never in the URL — so expect to paste it again after a reload. Until KV and `ADMIN_TOKEN` are set, `/track` no\-ops and the Live view tells you what's missing — the OpenAI proxy keeps working regardless. Cloudflare's free tier covers this comfortably for a personal\-scale user base.

**Moderating users.** Every row in the Live view has Block, Lock, and Kick buttons (Block and Lock flip to Unblock/Unlock once set). Each writes a moderation state to your Worker's KV against that username. Block gives the user a full\-screen "Blocked by the owner" page with your optional message and cuts off their AI features until you unblock. Lock is a lighter overlay that freezes their panel for a temporary pause. Kick forces a one\-time sign\-out; they can sign back in unless also blocked. Every client polls its own status every 15 seconds (and gets it on each heartbeat), so an action lands within about that long.

Be clear\-eyed about enforcement: this is JavaScript running in someone else's browser, so the block page, lock, and kick are client\-side — a technically capable user could edit them out of their own copy. The part that genuinely bites is server\-side: your Worker refuses to proxy AI requests for a blocked user (it checks the `X-GPA-User` the client sends and returns 403), so a blocked user loses the AI features for real. AI requests go through the Worker's `/v1/*` proxy, so blocking, the approval queue, per\-user freezes, quotas and the model allowlist all apply there. The gaps that remain, plainly: someone in direct mode with their own key bypasses the Worker entirely (that's their key to spend), and clients still on the old build only assert a username. Once everyone runs the current build, turn on **Require verified sessions** in Admin → Security so the Worker ignores asserted names entirely. For a personal tool shared with friends this is plenty; it is not a hardened access\-control system, and nothing client\-side ever can be.

### Claude in the admin console {#claude}

**Admin → Claude** (the owner and admins) is a chat with Claude Code about this repository. Ask a question or describe a change; Claude reads the code, edits it, runs the tests and pushes to `main`, which deploys it like any other push. Each chat keeps its history, so follow\-ups ("now make it blue") work. Pick the model (Opus, Sonnet, Haiku, Fable) and effort for each message.

It runs on the owner's **Claude Pro plan**: every message starts [`.github/workflows/claude-chat.yml`](.github/workflows/claude-chat.yml), which runs Claude Code in GitHub Actions with a token from `claude setup-token`. A reply takes a minute or two. Before pushing, the workflow checks the syntax of every changed JavaScript file and runs `npm test`; if a test that passed on `main` now fails, nothing is pushed and the chat says why. The reply, files changed, commit, tokens, time and estimated API\-equivalent cost come back to the Worker ([`web/console/claude.js`](web/console/claude.js)).

Setup, once:

1. On a computer with Claude Code, run `claude setup-token`, sign in with the Pro account and copy the token.
2. GitHub → this repository → Settings → Secrets and variables → Actions: add `CLAUDE_CODE_OAUTH_TOKEN` (that token) and `CLAUDE_CALLBACK_SECRET` (any long random text).
3. GitHub → Settings → Developer settings → Fine\-grained tokens: a token for this repository only, with **Actions: Read and write**.
4. Cloudflare → Workers & Pages → `donnajbe` → Settings → Variables and Secrets: add the secrets `GITHUB_TOKEN` (step 3) and `CLAUDE_CALLBACK_SECRET` (the same text as step 2).

Limits worth knowing:

- Changes go live on `main` without review. If one breaks the console, fix it from GitHub or revert the commit (each reply links it).
- Claude's 5\-hour and weekly plan limits aren't available to other sites, so the tab shows its own usage (messages, tokens, time, estimated cost) and links to [claude.ai/settings/usage](https://claude.ai/settings/usage) for the plan's real numbers.
- Admins can send `CLAUDE_ADMIN_DAILY` messages a day (25 unless set) and see only their own chats; the owner sees everyone's and has no cap. Moderators and users don't see the tab.
- Messages are workflow inputs, so anyone who can see this repository's Actions runs can read them. Don't put secrets in a message.

### Memory {#memory}

![Settings → Memory](docs/screenshots/settings-memory.png)

Ask AI, Notes Q&A and page questions can remember durable facts between conversations: explicit requests ("remember that…"), preferences, profile facts and project context. Memory is stored per account on the Worker (`mem:u:<user>` in KV), is only ever read with that account's signed session, and never crosses users. Passwords, keys, tokens, sensitive categories and instructions aimed at the AI are refused. Inferred facts that matter are confirmed with you first. Manage everything in **Settings → Memory**: search, filter, edit, delete, "why do you remember this", projects, pause and clear.

Memory needs a server account. Signing in or signing up links your local profile to one automatically; the PIN still never leaves the browser, only a derived verifier does.

### Proxy (formerly Browser) {#browser}

![The Proxy tab](docs/screenshots/12-proxy-tab/1-connected.png)

The **Proxy** tab browses through the **Saints proxy Worker**, a separate Cloudflare Worker in this repo (`proxy-worker/`, deployed as `saints-proxy-test` at `https://saints-proxy-test.viztrrx.workers.dev`). It opens **only the sites approved on that Worker**: sites you own or are allowed to proxy. Everything else is refused.

- **Approving sites:** list them in `TARGET_ORIGINS` in `proxy-worker/wrangler.jsonc` (e.g. `"https://example.com https://www.my-site.org"`), then push to `main`. Only plain `https://` sites are accepted; IP addresses, localhost and private or internal names are always refused. Full details are in `proxy-worker/README.md`.
- **Launching:** like Eaglercraft, the proxy only opens while the console is fullscreen: **Launch Proxy Here**, or **Launch in about:blank** (a separate window with its own fullscreen requirement). Leaving fullscreen hides it until fullscreen is back; **Close Proxy** unloads it.
- **First launch:** the Worker's connection test, listing the approved sites as links: "Connected · connection test".
- **No address shown:** the bar has only **Back**, **Forward**, **Reload** and **Home** (the main page of the site you're on), plus Close; the status line says just "Loaded". Sites are opened from the connection test's links, and links, images, styles and scripts inside approved sites stay in the proxy, including links to another approved site. Back and Forward follow links clicked inside the page because the Worker's pages report their address to the tab (`proxy-worker/nav.js`); a site whose own security policy blocks that report can still be browsed, but its in-page clicks aren't added to Back / Forward.
- **Clear errors:** **Website unavailable**, **HTTP 404 / 500…**, **Website timed out**, **Redirect not permitted**, **Can't reach the proxy Worker**, **The proxy Worker answered with an error**, **Blocked by this website** (the site the console is on forbids embedded pages), and **Access key needed**. Each comes with **Retry** and/or **Open in a new tab**; the page you were on stays.
- **Switching tabs** keeps the page, and the last page (including one reached by a link) comes back next time.
- **Safety:** each proxied page runs isolated: approved sites can't read each other's storage, and nothing they store persists. Pages can't take over the website around the console, and they get no camera, microphone or location. No referrer, cookies or Saints session or tokens are ever sent.
- **Doesn't work:** sign-ins and forms, sites that need cookies or storage, single-page apps and JavaScript `fetch`, WebSockets, and sites that forbid embedding (use **Open in a new tab**). For approved YouTube watch/short links the Worker offers YouTube's official embedded player with a direct-open fallback; YouTube's full website is not supported by the lightweight proxy. See `proxy-worker/README.md`.
- **Connection settings:** the **Proxy Worker address** (empty means the Saints proxy; old `localhost:4141` settings move automatically) and an optional **Proxy access key**, if the Worker sets `PROXY_KEY`.

**Research mode** lives here: the AI picks a few authoritative sources, the Worker fetches each one server\-side, and you get back a brief with citations.

### Music {#music}

![The Music tab](docs/screenshots/music.png)

Three ways to play something:

1. **Search** — type a song name or description and it queries the official YouTube Data API, then plays the closest match in YouTube's own embed player.
2. **SoundCloud** — paste a track link, played through SoundCloud's official embeddable player.
3. **Local library** — list `raw.githubusercontent.com` URLs in `PRELOADED_TRACKS` at the top of `script.js` and they appear in the playlist on load, or click **Add audio files** to pick files off your own device for the session. This path is a plain `<audio>` element: no iframe, no network for local files.

Playback keeps running while you switch sections — the player stays in the DOM, just hidden.


**Rename your songs.** In Music → My music, ✎ on a song changes its **name**, **artist** and **file name**; ⬇ downloads it under that file name (the extension always matches the audio). After you upload a single song, its rename form opens filled in from the file name ("Artist - Title.mp3"). Everyone signed in can do this with their own songs; the owner and admins can also rename songs in the Shared library (logged in Audit).
### Eaglercraft {#eaglercraft}

![The Eaglercraft tab before fullscreen](docs/screenshots/eaglercraft.png)

Minecraft 1.8 in the browser ([EaglercraftX 1.8](eaglercraft/README.md)) in its own tab: singleplayer, servers and Shared Worlds with friends.

- **Fullscreen is required.** The launch buttons unlock only once the browser reports the whole console is fullscreen (the same fullscreen as the ⛶ header button). Leaving fullscreen pauses the game and returns to the launcher, and *Resume* needs fullscreen again.
- **Launch Eaglercraft Here** plays it in the tab. **Launch in about:blank** opens an `about:blank` window with the same game frame, styled like the console, with its own fullscreen gate.
- **Everything goes through your Worker:** the game page, its files, and every server and Shared World relay socket. The game frame's security policy refuses any other connection. The one thing a Worker can't carry is WebRTC, so Shared World players connect to each other directly, or through a TURN server. *How it connects* shows each connection's actual path.
- **On the same Wi-Fi:** start a Shared World from the pause menu (**Invite**), and your friend joins with the code under **Multiplayer → Direct Connect → Join Shared World**.

**The game itself is not in this repository.** EaglercraftX is "All Rights Reserved", and a build contains Mojang's code, so neither can be redistributed. You build it yourself and point the Worker's `EAGLER_CLIENT` at it. Setup, the network path, and browser limits are in [eaglercraft/README.md](eaglercraft/README.md).

### Games {#games}

![The Games tab](docs/screenshots/games.png)

Tic\-Tac\-Toe, Rock\-Paper\-Scissors, Memory, Snake, 2048, Whack\-a\-Mole, Guess the Number, Hangman, Wordle, Connect 4, Minesweeper, Flappy, Word Scramble, Reaction Test, Tetris, Checkers, and Sudoku. Per\-game options, high scores, a pause screen with stats, fullscreen, and a match timer you toggle with `T`.

### Settings {#settings}

|  |  |
| --- | --- |
| ![Settings overview](docs/screenshots/settings-overview.png)<br>**Overview** | ![Theme gallery](docs/screenshots/settings-theme.png)<br>**Themes** (hover to preview, click to apply) |

Fourteen built\-in themes plus a fully custom one (hover a theme to preview it, click to apply), ambient particle backgrounds in a few styles with an adjustable play area, four panel size presets, typing speed and response font controls, and a customizable icon for the minimized button.

### Profiles and sync {#profiles-and-sync}

![Sign-in screen](docs/screenshots/sign-in.png)

An optional username \+ PIN profile that snapshots every `gpa_*` key. Move settings between browsers with a portable sync code — pure encode/decode, no server involved — or turn on cloud auto\-sync backed by your own JSONBin credentials.

The PIN is stored as a PBKDF2\-HMAC\-SHA256 hash with a random per\-profile salt and 210,000 iterations, so two people who pick the same PIN get different hashes and each guess against a copied profile costs real work. Profiles created by older builds hold a plain unsalted SHA\-256 hash; they still sign in, and are rewritten to the stronger format the first time their owner does. On a page served over plain HTTP, where browsers withhold `crypto.subtle`, the same PBKDF2 runs in JavaScript at a lower iteration count and re\-stretches itself next time you sign in somewhere secure. It is still a PIN on a device you don't control — it separates profiles and stops casual snooping; it is not a password manager.

* * *

## Versions and version history {#versions}

Every tab, every Settings section and every Admin section shows its own version and when it was last updated, in a small chip under its title. Click the chip to open that part's version history: each change with its version, date and time, what changed, and the commit it shipped in. **Settings → Advanced → Version history** shows every part side by side, plus the full release list.

![Ask AI version history opened from its chip](docs/screenshots/version-history.png)

![Settings → Advanced → Version history](docs/screenshots/settings-version-history.png)

**Where the numbers come from.** One list in `script.js`, `CHANGELOG`, has an entry for each change, taken from this repository's commit history with the commit's own id and time. Each entry names the parts it touched and how. Versions are then computed, never typed by hand:

- **Added** starts a part at `1.0.0`.
- **Redesign** bumps the major version.
- **Feature** bumps the minor version.
- **Fix** bumps the patch version.

To ship a change, add one entry to `CHANGELOG`. Every chip, the Advanced table and the tables below follow from it.

**Current version: Saints Service `v8.2.2`**, updated Oct 6, 2026, 10:30 PM EDT.

| Part | Version | Last updated |
| --- | --- | --- |
| Console shell | `v2.5.1` | Oct 6, 2026, 12:00 PM EDT |
| Selection assistant | `v2.0.2` | Sep 27, 2026, 7:09 AM EDT |
| Welcome | `v2.1.0` | Sep 27, 2026, 2:49 AM EDT |
| Page Insights | `v3.2.0` | Sep 27, 2026, 2:49 AM EDT |
| Ask AI | `v2.2.0` | Sep 27, 2026, 2:49 AM EDT |
| Chat | `v3.2.0` | Sep 27, 2026, 2:49 AM EDT |
| Music | `v2.1.0` | Sep 27, 2026, 2:49 AM EDT |
| Proxy | `v3.1.0` | Sep 27, 2026, 2:49 AM EDT |
| Eaglercraft | `v1.0.2` | Oct 6, 2026, 10:30 PM EDT |
| Games | `v2.1.0` | Sep 27, 2026, 2:49 AM EDT |
| Study | `v2.2.0` | Sep 27, 2026, 5:25 AM EDT |
| Notes | `v2.2.0` | Sep 27, 2026, 2:49 AM EDT |
| Humanize | `v2.1.0` | Sep 27, 2026, 2:49 AM EDT |
| Grammar | `v2.1.0` | Sep 27, 2026, 2:49 AM EDT |
| Saved | `v2.1.0` | Sep 27, 2026, 2:49 AM EDT |
| Settings | `v2.1.0` | Sep 27, 2026, 2:49 AM EDT |
| Admin | `v2.3.1` | Sep 27, 2026, 6:35 AM EDT |

<details>
<summary>Full release history</summary>

| Version | Date | Change | Commit |
| --- | --- | --- | --- |
| `v8.2.2` | Oct 6, 2026, 10:30 PM EDT | Worker deploys from GitHub with Wrangler; game traffic stays binary through the proxy | this release |
| `v8.2.1` | Oct 6, 2026, 6:00 PM EDT | Eaglercraft checks that your client build is reachable before launching | `875426e` |
| `v8.2.0` | Oct 6, 2026, 12:00 PM EDT | Eaglercraft tab: Minecraft 1.8 through your Worker, played in fullscreen, in the tab or an about:blank window | `008a2ea` |
| `v8.1.0` | Sep 27, 2026, 7:09 AM EDT | Console shortcuts work inside embedded frames; option to hide the reopen button | `a0a6611` |
| `v8.0.1` | Sep 27, 2026, 6:35 AM EDT | Shortcuts adapt to your OS and browser and never leak into the page | `e1094de` |
| `v8.0.0` | Sep 27, 2026, 5:25 AM EDT | Selection assistant rebuilt: personal toolbar, grouped tools, shortcuts, iframes and a phone tray | this release |
| `v7.2.0` | Sep 27, 2026, 2:49 AM EDT | Version and version history on every tab and section | this release |
| `v7.1.1` | Sep 27, 2026, 2:49 AM EDT | Selection bubble and answer popup styled and themed again on every page | this release |
| `v7.1.0` | Sep 27, 2026, 2:44 AM EDT | Admin, charts and status colors follow the current theme | this release |
| `v7.0.0` | Sep 27, 2026, 1:35 AM EDT | Admin Command Center, server-side AI memory, ↓↓ no longer touches the page | `f0264ad` |
| `v6.2.0` | Sep 27, 2026, 12:22 AM EDT | Press ↓ twice to show or hide the console; mini button taps fixed | `19ed299` |
| `v6.1.0` | Sep 27, 2026, 12:11 AM EDT | Hover a theme to preview it app-wide; click applies, leaving reverts | `a471090` |
| `v6.0.0` | Sep 26, 2026, 2:14 PM EDT | Every tab redesigned on the Settings design system | `3ee6303` |
| `v5.0.0` | Sep 26, 2026, 11:17 AM EDT | Settings and Theme redesigned into a 3D control center | `871c31b` |
| `v4.1.1` | Sep 26, 2026, 10:44 AM EDT | Add saints.js as a backup copy of script.js | `e1d9d7c` |
| `v4.1.0` | Sep 26, 2026, 10:38 AM EDT | OpenAI only; gpt-4.1-mini and gpt-5 enforced on load and sign-in | `b191afa` |
| `v4.0.3` | Sep 20, 2026, 7:11 PM EDT | Model-list requests no longer count against the daily quota | `22f1713` |
| `v4.0.2` | Sep 20, 2026, 7:06 PM EDT | Admin unlock re-shows hidden tabs immediately | `2545da9` |
| `v4.0.1` | Sep 20, 2026, 6:57 PM EDT | Proxy defaults to https://localhost:4141 | `08a74c2` |
| `v4.0.0` | Sep 20, 2026, 6:31 PM EDT | Browser tab replaced by a Scramjet-powered Proxy tab | `104759e` |
| `v3.5.0` | Sep 20, 2026, 6:15 PM EDT | Opt-in local-proxy routing in the Browser tab | `3c8e3a2` |
| `v3.4.3` | Sep 20, 2026, 5:39 PM EDT | Rename the proxy build to acp.js | `1f8bbdb` |
| `v3.4.2` | Sep 20, 2026, 5:38 PM EDT | Add the proxy build of the console (acp.js) | `7cc3620` |
| `v3.4.1` | Sep 20, 2026, 1:25 PM EDT | AI status check slowed to every 10 minutes | `78dbfe2` |
| `v3.4.0` | Sep 20, 2026, 1:19 PM EDT | Live AI status line on Welcome | `7c67652` |
| `v3.3.0` | Sep 20, 2026, 1:07 PM EDT | Terminal-style typed greeting | `d3a3b55` |
| `v3.2.1` | Sep 20, 2026, 12:00 PM EDT | Welcome news no longer prompts for an API key | `e0da643` |
| `v3.2.0` | Sep 20, 2026, 9:44 AM EDT | Welcome: active users, personal stats, richer 3D, quick actions | `23a3e15` |
| `v3.1.0` | Sep 20, 2026, 9:29 AM EDT | Welcome landing pane after sign-in | `dd3fbc8` |
| `v3.0.1` | Sep 20, 2026, 7:26 AM EDT | Fix Page Insights horizontal overflow | `2f251f6` |
| `v3.0.0` | Sep 20, 2026, 7:00 AM EDT | Page Insights redesigned as a full-width flow with Tone and Explore tools | `69ad9f5` |
| `v2.12.0` | Sep 20, 2026, 6:35 AM EDT | Quick actions and settings in Page Insights; Auto-explain overflow fixed | `baf5c36` |
| `v2.11.0` | Sep 20, 2026, 6:07 AM EDT | Page Snapshot, full-page Translate and an honest empty state | `63ec1a8` |
| `v2.10.1` | Sep 20, 2026, 5:52 AM EDT | Cap and center pane content in full-page and fullscreen | `686e08b` |
| `v2.10.0` | Sep 20, 2026, 5:37 AM EDT | Standalone Grammar tab, full-page layout fix, animated sidebar close | `bbda61c` |
| `v2.9.0` | Sep 20, 2026, 5:13 AM EDT | Grammar action in the selection assistant | `6547e27` |
| `v2.8.0` | Sep 20, 2026, 5:03 AM EDT | Humanize grounded in documented AI-writing patterns | `4dc2c5f` |
| `v2.7.0` | Sep 20, 2026, 4:53 AM EDT | Standalone Humanize tab; selection bubble fixed on hostile pages | `e865e45` |
| `v2.6.0` | Sep 20, 2026, 4:25 AM EDT | Humanize action in the selection assistant | `b1ad842` |
| `v2.5.3` | Sep 20, 2026, 4:00 AM EDT | Stop polling chat with a KV list; never return a CORS-less 500 | `293be97` |
| `v2.5.2` | Sep 20, 2026, 2:32 AM EDT | Fix CORS errors from the worker | `65d7015` |
| `v2.5.1` | Sep 19, 2026, 6:44 PM EDT | Close SSRF filter bypasses and the approval-queue gap | `8885ea0` |
| `v2.5.0` | Sep 19, 2026, 6:39 PM EDT | Security enforcement moved to the worker; no secrets shipped to browsers | `ecb6e42` |
| `v2.4.0` | Sep 19, 2026, 6:06 PM EDT | Ask each account for its language on sign-in | `376156c` |
| `v2.3.3` | Sep 19, 2026, 6:00 PM EDT | Restore script.js after the uploaded replacement | `5c05325` |
| `v2.3.2` | Sep 19, 2026, 5:54 PM EDT | Point self-updates at this repository | `97d13ac` |
| `v2.3.1` | Sep 19, 2026, 5:41 PM EDT | Uploaded replacement of script.js (reverted below) | `332ef35` |
| `v2.3.0` | Sep 18, 2026, 7:53 PM EDT | Crusade and Racer games | `fb29b4b` |
| `v2.2.0` | Sep 18, 2026, 7:41 PM EDT | Original platformer game and a full-console fullscreen toggle | `7f46aee` |
| `v2.1.1` | Sep 18, 2026, 7:26 PM EDT | Fix games going blank in fullscreen | `3464101` |
| `v2.1.0` | Sep 18, 2026, 6:58 PM EDT | Moderation, security and admin features in the worker, wired into the UI | `97d7441` |
| `v2.0.0` | Sep 18, 2026, 6:21 PM EDT | Bug fixes, collapsible sidebar, chat redesign, remote key push, admin expansion | `d0a354a` |
| `v1.0.0` | Sep 18, 2026, 5:15 PM EDT | First release of Saints Service (Saints edition) | `313bfeb` |

</details>

* * *

## The Worker (`worker.js`) {#the-worker-workerjs}

An optional Cloudflare Worker that does two small things the browser can't do on its own:

- **`/v1/*`** — forwards to `api.openai.com` and adds the CORS header. Direct browser → OpenAI calls are frequently blocked by ad blockers, antivirus shields, and network filters, which surface as confusing CORS errors. It also answers `OPTIONS` preflights itself, because forwarding those upstream returns a response that doesn't allow the `Authorization` header, which makes the browser block the real request.
- **`/read?url=…`** — fetches a page server\-side and returns its HTML, so research mode can read sources the browser isn't allowed to fetch cross\-origin. HTML and plain text only, capped at 3MB.
- **`/eagler/*`** — the Eaglercraft tab: the game's frame page and loader, your own client build (passed through from `EAGLER_CLIENT`), and a WebSocket proxy for game servers and Shared World relays. Optional; see [eaglercraft/README.md](eaglercraft/README.md) for its variables.

### Deploying it {#deploying-it}

Deploys are automatic. Cloudflare **Workers Builds** is connected to this repository: every push to `main` runs `npx wrangler deploy`, which deploys `worker.js` as the `donnajbe` Worker at `https://donnajbe.viztrrx.workers.dev`. The settings are in [`wrangler.jsonc`](wrangler.jsonc):

- **KV:** the `TELEMETRY` namespace, which holds accounts, memory, chat, moderation and admin data.
- **Variables:** `keep_vars`, so the plain variables you set in the dashboard (`OWNER`, `EAGLER_*`) survive each deploy.
- **Cron:** no cron triggers, so the daily one stays managed in the dashboard.

Secrets (`ADMIN_TOKEN`, `COADMIN_TOKEN`, `OWNER_CODE`) live only in the dashboard and are kept on every deploy.

Don't edit the code in the dashboard any more: the next push to `main` replaces it. To deploy by hand, run `npm install`, then `npx wrangler deploy` (it asks you to log in to Cloudflare).

Then point the script at it by setting `OPENAI_PROXY` near the top of `script.js` to your Worker URL. Set it to `''` to call OpenAI directly instead.

The Worker either uses a key you assigned to that user server\-side (admin console → Control → Assign API key, stored in KV and attached to the upstream call by the Worker — it is never sent to the browser) or passes through whatever the browser sends. For a browser\-supplied key it looks in the `Authorization` header, then the `X-GPA-Key` header, then a `_gpa_key` field in the request body. The extra channels exist because some pages wrap `fetch` and `XMLHttpRequest` and strip headers in transit; the body is used rather than the URL because **a key in a URL ends up in browser history, `Referer` headers, proxy and CDN logs, and any screenshot of the network tab.**

`?key=` in the query string is no longer accepted at all, for exactly that reason. If you were running a build that sent one, rotate that key — assume it is in logs you don't control.

If you deploy the Worker publicly, anyone who knows the URL can route their own OpenAI requests through it using their own key.

> **Deploy `worker.js` first, or together with `script.js`.** The Command Center, server accounts and memory need the new Worker routes; with an older Worker the console keeps working and those features say the Worker needs updating. No new bindings or secrets are required: sessions are signed with a key derived from `ADMIN_TOKEN`, and everything is stored in the existing `TELEMETRY` KV namespace.
>
> **`script.js` and `worker.js` ship together from `main`.** The bookmarklet loads `script.js` from `main`, and every push to `main` deploys `worker.js`, so the two stay in step. If a Worker build fails, the old Worker keeps running while `script.js` is already new. Check the build under **Workers & Pages → donnajbe → Deployments**: if the two drift apart, the key channel they agree on can change and every request comes back `401`.

* * *

## Troubleshooting {#troubleshooting}

**`Failed to execute 'fetch' on 'Window': Invalid value`** — the saved API key contains a character that can't go in an HTTP header, almost always an invisible one picked up by copying the key out of a styled web page or a document: a zero\-width space, a non\-breaking space, a soft hyphen, a stray newline. The error is thrown by the browser before any request is sent, so it looks identical whether the key is valid or not. Keys are now scrubbed to printable ASCII on save and on read, so this repairs itself; if you still see it, clear the key in Settings and paste it again.

**`401` with "You didn't provide an API key"** — the key never arrived, which is not the same as the key being rejected. Two usual causes: the page is stripping headers (the script falls through several transports to work around this), or `worker.js` on Cloudflare is older than `script.js` and is looking for the key somewhere the script no longer puts it. Redeploy the Worker.

**`401` with "Incorrect API key provided"** — that one really is the key. Check it at [https://platform.openai.com/api\-keys](https://platform.openai.com/api-keys).

**Everything fails only on one site** — some pages wrap `fetch` and `XMLHttpRequest`, and strict CSP can block the blob\-worker transport the script uses to get a clean one. The console log names each transport as it's tried, so it's visible which ones the page is interfering with.

**`SyntaxError: Invalid character '\u2018'` on iPhone or iPad** — the loader command was typed with iOS Smart Punctuation on, which turned its `'` quotes into curly ones. `script.js` itself parses fine in Safari. Use the backtick version under [On iPhone and iPad](#on-iphone-and-ipad).

**Keys are per\-origin.** A key entered on one domain isn't visible on another; that's browser security, not a bug.

## Notes and limits {#notes-and-limits}

This is injected JavaScript, not an extension, so it disappears on reload or navigation — re\-run the snippet, or use the bookmarklet. Page text is truncated and screenshots downscaled to keep requests fast and within token limits. AI calls go through your Worker's `/v1/*` route when one is configured, so the same moderation and quota rules apply and an owner\-assigned key never reaches the browser.

The panel renders inside a Shadow DOM, so the host page's CSS can't bleed into it and vice versa.

* * *

## Files {#files}

```
script.js          The entire assistant: UI, AI calls, games, everything
worker.js          Cloudflare Worker: OpenAI proxy, accounts, memory, admin API,
                   and the Eaglercraft routes (/eagler/*)
eaglercraft/       The Eaglercraft tab's game frame and loader (no game code)
scripts/           build-eaglercraft.sh: builds the real EaglercraftX client into build/
                   (git-ignored) with the official build tool
saints.js          Backup copy of an earlier script.js
acp.js             Proxy build of the console
web/               Worker modules: music.js (My music, shared library), playlists.js,
                   mp3.js (YouTube to MP3 link checks), subscribe.js, policies.js,
                   and the /app and /console/ web apps
tests/             Worker unit tests (npm test); tests/browser/ holds the
                   Playwright checks for the Eaglercraft tab and screenshots
docs/screenshots/  The screenshots used in this README
```

No build step and no runtime dependencies. Wrangler is a dev dependency, used to deploy `worker.js` and to run it for the browser checks in `tests/browser/` (which also need Playwright). `@ffmpeg/core` is a dev dependency only so `tests/browser/mp3.mjs` can serve FFmpeg locally; the console downloads the same files from a CDN at run time.

* * *

## Credits {#credits}

OpenAI Codex provided AI-assisted development for the Chromebox Lite 8×8 texture pack, its automatic Eaglercraft preload integration, and the accompanying tests and documentation.

## License {#license}

MIT — see [LICENSE](LICENSE).

## Pair Saints Command on your iPhone

In the desktop Admin Command Center, connect with an owner credential, then open
**System → iPhone & Home Screen devices**. Select the device role and choose
**Create pairing code**, then **Copy pairing code**. Only owners can create codes.

Open https://donnajbe.viztrrx.workers.dev/app/ in Safari and add it to your Home
Screen. Open that icon, enter a device name, paste the full code and tap
**Pair device**. Codes expire after five minutes and work once. The resulting
device session expires after seven days and can be revoked from the same System
card. The console PIN alone does not authenticate an owner. Do not share tokens
or pairing codes in chat or commit them to Git.

The native app is maintained separately at https://github.com/viztrrx/saints-command.
This repository includes the deployed web app and backend helpers so its
Cloudflare Builds deployment retains `/app/` and the ADMIN_MOBILE binding.
Edit `web/public/`, run `npm run build:web`, then verify `npm test` and
`npm run test:runtime` before deployment. See [web app documentation](web/README.md).
