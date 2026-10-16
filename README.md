# Agent Console {#agent-console}

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

### On iPhone and iPad (Eruda) {#on-iphone-and-ipad}

iOS **Smart Punctuation** turns the `'` you type into a curly `‘`, which JavaScript can't read. The console then shows `SyntaxError: Invalid character '\u2018'` before `script.js` is even downloaded. Use this version, whose backticks iOS leaves alone:

```js
fetch(`https://raw.githubusercontent.com/viztrrx/donnajbesaints/main/script.js`).then(r=>r.text()).then(eval)
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
- One **now-playing bar** plays either source with previous/next, seeking and
  iPhone lock-screen controls, and keeps playing on other tabs. **SoundCloud**
  links and **This device** (your own offline files) work as before, and
  YouTube search is still there for anyone who saved a key.
- The allowed-users list applies to music too.

Owners can point at a different Audius gateway with the Worker variable
`AUDIUS_API`. Checks: `node --test tests/music.test.mjs` and
`node tests/browser/music.mjs`.

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
tap ＋ on the sign-in screen, the console asks for the code, a wrong code is
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

## Agent Console as an iPhone app {#iphone-app}

The Worker also serves the whole console as a home-screen web app at
`https://donnajbe.viztrrx.workers.dev/console/`.

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

**Grouping.** Several messages in a row from the same person (within 5 minutes) show their picture and name once, with the rest as plain lines underneath, like iMessage. Someone else's message, a reply or a 5-minute gap starts a new group. On a computer, hovering a grouped line shows its time and the ↩ / ☺ buttons.

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

### Memory {#memory}

![Settings → Memory](docs/screenshots/settings-memory.png)

Ask AI, Notes Q&A and page questions can remember durable facts between conversations: explicit requests ("remember that…"), preferences, profile facts and project context. Memory is stored per account on the Worker (`mem:u:<user>` in KV), is only ever read with that account's signed session, and never crosses users. Passwords, keys, tokens, sensitive categories and instructions aimed at the AI are refused. Inferred facts that matter are confirmed with you first. Manage everything in **Settings → Memory**: search, filter, edit, delete, "why do you remember this", projects, pause and clear.

Memory needs a server account. Signing in or signing up links your local profile to one automatically; the PIN still never leaves the browser, only a derived verifier does.

### Proxy (formerly Browser) {#browser}

![The Proxy tab](docs/screenshots/proxy.png)

The Browser tab is now the **Proxy** tab. It loads pages through [Scramjet](https://github.com/MercuryWorkshop/scramjet), a proxy engine you run on your own device, so sites that block plain iframe embedding can still be reached. The server address is a setting that defaults to this device's own `https://localhost:4141` and is saved only in your browser. With no proxy server running, the tab shows an honest "couldn't load" state and does nothing else.

**Research mode** lives here: the AI picks a few authoritative sources, the Worker fetches each one server\-side, and you get back a brief with citations.

### Music {#music}

![The Music tab](docs/screenshots/music.png)

Three ways to play something:

1. **Search** — type a song name or description and it queries the official YouTube Data API, then plays the closest match in YouTube's own embed player.
2. **SoundCloud** — paste a track link, played through SoundCloud's official embeddable player.
3. **Local library** — list `raw.githubusercontent.com` URLs in `PRELOADED_TRACKS` at the top of `script.js` and they appear in the playlist on load, or click **Add audio files** to pick files off your own device for the session. This path is a plain `<audio>` element: no iframe, no network for local files.

Playback keeps running while you switch sections — the player stays in the DOM, just hidden.

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

**Current version: Agent Console `v8.2.2`**, updated Oct 6, 2026, 10:30 PM EDT.

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
| `v1.0.0` | Sep 18, 2026, 5:15 PM EDT | First release of Agent Console (Saints edition) | `313bfeb` |

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
tests/             Worker unit tests (npm test); tests/browser/ holds the
                   Playwright checks for the Eaglercraft tab and screenshots
docs/screenshots/  The screenshots used in this README
```

No build step and no runtime dependencies. Wrangler is a dev dependency, used to deploy `worker.js` and to run it for the browser checks in `tests/browser/` (which also need Playwright).

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
