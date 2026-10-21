# Screenshots

Pictures of the newest features, taken from the real app during the
automated tests on Oct 18, 2026 (local test server, made-up test names like
`gifta28a` and `NewKidc8y`). Phone shots are an iPhone 15 size; the wide
ones are the console on a computer. Folders are numbered in the order a
new subscriber and then the owner would see things.

| Folder | What's in it |
|---|---|
| [0-subscriber-walkthrough](#0-what-a-new-subscriber-sees-step-by-step) | **Start here:** every screen a new subscriber sees after paying, in order |
| [1-new-subscriber](#1-a-new-subscriber-after-paying-close-ups) | Making the PIN, the school email box, the confirmation, signed in |
| [2-admin-security](#2-admin--security-owner-admins-moderators) | New subscribers card, automatic month, Recent events folding, Free access |
| [3-playlists](#3-playlists-everyone-signed-in) | Spotify / Apple Music playlist → YouTube links, for everyone; **new:** 10 new songs a day each, your limit card |
| [4-youtube-to-mp3](#4-youtube-to-mp3-owner) | The MP3 converter in Music → My music |
| [5-subscribe-page](#5-subscribe-page) | The payment page, the $6 contribution box, and **new:** your $1 test (owner only) |
| [15-owner-pin-reset](#15-resetting-your-own-pin-owner) | **New:** reset your own PIN in Settings → Memory with Admin connected |
| [14-music-rename-and-popups](#14-renaming-songs-and-chromebook-pop-ups) | **New:** rename a song (name, artist, file name) and download it; pop-up notifications on a Chromebook |
| [13-messages](#13-messages-everyone-and-stats) | **New:** Messages (direct messages and group chats) with its NEW label, unread badges, @everyone, your Safety review, and the stats card on Welcome |
| [12-proxy-tab](#12-proxy-tab-saints-proxy-worker) | The Proxy tab with several approved sites: a site loading through the proxy, HTTP 404, website down, other sites explained, blocked by a website, light theme |
| [11-countdown-renew-texting](#11-countdown-renew-and-texting) | **New:** time left at the top for everyone, the Renew box (link, text me the link, paying cash), your Cash & texting card |
| [10-security-review](#10-security-review-brute-force-proof-and-fix) | **New:** proof that PINs and student numbers could be brute-forced, and the fix |
| [9-fold-top-card](#9-fold-the-top-card) | **New:** the Ask AI card (and every tab's top card) folds to a thin bar |
| [8-opens-centered](#8-opens-small-and-centered) | **New:** injected into a website: only the sign-in card shows; signed in, a centered window |
| [7-student-number-and-locks](#7-student-numbers-forgot-pin-and-locked-devices) | **New:** the required student-number screen, Forgot PIN by student number, locked devices, your Sign-in help card |
| [6-pin-reset](#6-resetting-a-forgotten-pin-owner) | Forgotten PINs: **Forgot PIN?** request + your Approve (no contact needed), or a reset code |

---

## 0. What a new subscriber sees, step by step

The whole page on a phone, from coming back from Stripe to done.

**Step 1: right after paying.** "You're in, NewKid…! Payment received. Your
username is approved." Then **Create your PIN** with the red "You must
remember this PIN" box and the "I'll remember this PIN" checkbox.

<img src="0-subscriber-walkthrough/step-1-after-paying.png" width="320" alt="Step 1: back from paying, Create your PIN">

**Step 2: PIN typed twice and the checkbox ticked**, ready for **Create my
account**. (Easy PINs like 1234 are refused at this point.)

<img src="0-subscriber-walkthrough/step-2-pin-filled-in.png" width="320" alt="Step 2: PIN filled in and checkbox ticked">

**Step 3: the account is made. "One last step: add your school email."**
The box shows `@alseducation.onmicrosoft.com`; **Send my email** stays off
until 6 numbers are typed.

<img src="0-subscriber-walkthrough/step-3-email-step.png" width="320" alt="Step 3: Add your school email, empty">

**Step 4: the 6 numbers typed** ("Your email: 223929@alseducation.onmicrosoft.com").
Letters and a 7th digit can't be typed.

<img src="0-subscriber-walkthrough/step-4-email-typed.png" width="320" alt="Step 4: 223929 typed">

**Step 5: done.** "Sent: 223929@alseducation.onmicrosoft.com. Next time you're
at school, sign in at docs.google.com with that school account: the
instructions for loading Saints Service will be in your Google Docs (shared
with you)." and how to sign in. At the
same moment you (and your admins) get the alert and it appears in
Admin → Security → New subscribers.

<img src="0-subscriber-walkthrough/step-5-all-done.png" width="320" alt="Step 5: email sent, account ready, sign-in steps">

---

## 1. A new subscriber after paying (close-ups)

**The checkbox** (styled like the rest of the page: teal-to-violet when ticked).

<img src="1-new-subscriber/0-checkbox-close-up.png" width="420" alt="Ticked checkbox with the site's teal-to-violet gradient">

**Create your PIN.** The red box says they must remember it, nobody can look
it up, and if they forget it they're locked out until the owner resets it. Easy PINs (1234, 0000, 9876, a year…) are refused, and the
checkbox must be ticked.

<img src="1-new-subscriber/1-create-pin-warning.png" width="320" alt="Create your PIN with the must-remember warning and checkbox">

**Add your school email.** Only the 6 numbers are typed;
`@alseducation.onmicrosoft.com` is fixed in the box.

<img src="1-new-subscriber/2-school-email.png" width="420" alt="School email box with 223929 typed and the fixed domain">

**Done.** "Sent: 223929@alseducation.onmicrosoft.com" and how to sign in.

<img src="1-new-subscriber/3-all-done.png" width="320" alt="Account ready, email sent, sign-in steps">

**Signed in to the console** with the PIN they made ("Subscribed · renews monthly").

<img src="1-new-subscriber/4-signed-in-console.png" width="640" alt="Console signed in with the subscription strip">

---

## 2. Admin → Security (owner, admins, moderators)

**New subscribers** (owner and admins): each new subscriber's school email,
your instructions Google Doc link, **Share the Doc** (copies their email and
opens your Doc; in Google Docs: Share → paste → Send; then it's marked
Shared), Copy email, Remove.

<img src="2-admin-security/1-new-subscribers-card.png" width="640" alt="New subscribers card with an email and the Google Doc link">

**Automatic month:** someone on Allowed users who isn't a subscriber gets
"Automatic · 14 days left", Oct 1 → Nov 1.

<img src="2-admin-security/2-automatic-month.png" width="320" alt="Subscribers row with the automatic month">

**Recent events** folded (just the title and a count) and opened.

<img src="2-admin-security/3-recent-events-folded.png" width="320" alt="Recent events folded"> <img src="2-admin-security/4-recent-events-open.png" width="320" alt="Recent events open">

**Free access** given by the owner (no end date), by an admin (1 week), and
the card as a moderator sees it (under Moderation).

<img src="2-admin-security/5-free-access-owner.png" width="320" alt="Free access given by the owner"> <img src="2-admin-security/6-free-access-admin.png" width="320" alt="Free access given by an admin">

<img src="2-admin-security/7-free-access-moderator.png" width="640" alt="Free access card in Moderation for a moderator">

---

## 3. Playlists (everyone signed in)

A regular user pastes an Apple Music link; a Spotify playlist with every
song's YouTube link; and Playlists in the console on a website.

<img src="3-playlists/1-regular-user.png" width="320" alt="Regular user's Playlists"> <img src="3-playlists/2-links-found.png" width="320" alt="Spotify playlist with YouTube links">

<img src="3-playlists/3-on-a-website.png" width="640" alt="Playlists in the console on a website">

**New: 10 new songs a day per person** (admins too; only you have no limit).
The card shows how many are left ("New songs left today: 8 of 10", in the
first picture above). Songs someone already looked up are free. You change
the number in **Admin → Moderation → Playlists limit** (shown set to 15):

<img src="3-playlists/4-owner-limit-card.png" width="640" alt="Playlists limit card: new songs per person a day, Save">

---

## 4. YouTube to MP3 (owner)

In Music → My music: the converter, converting (real progress), done
(Download MP3 / Save to My music), and on an iPhone.

<img src="4-youtube-to-mp3/1-converter.png" width="640" alt="MP3 converter">

<img src="4-youtube-to-mp3/2-converting.png" width="640" alt="Converting with progress">

<img src="4-youtube-to-mp3/3-done.png" width="640" alt="Conversion finished">

<img src="4-youtube-to-mp3/4-iphone.png" width="320" alt="Converter on an iPhone">

---

## 5. Subscribe page

The payment page, and the contribution box for people who already
subscribe (from $6).

<img src="5-subscribe-page/1-subscribe.png" width="320" alt="Subscribe page"> <img src="5-subscribe-page/2-contribute-6-dollars.png" width="320" alt="Contribute box starting at $6">

**Your $1 test (owner only):** type your own name and the box becomes
**Test contribution** from $1 with a **Your PIN** box. Without your PIN it
won't start; everyone else still starts at $6.

<img src="5-subscribe-page/3-owner-test-contribution.png" width="320" alt="Test contribution from $1 with the owner PIN box">

---

## 6. Resetting a forgotten PIN (owner)

**Admin → Security → Allowed users → Reset PIN** on their row (or **Reset
PIN** in Admin → Users → their name → Actions). You get a one-time code and
the exact words to tell them; **Copy code** or **Cancel reset**. They're
signed out right away and keep their account, subscription and everything in it.

<img src="6-pin-reset/1-owner-gets-reset-code.png" width="420" alt="Allowed users row with the reset code and Copy code / Cancel reset">

**What they do:** on the sign-in screen, type their username and a **new**
PIN and tap Sign in. The console asks for the **Reset code (from the owner)**.
They type it, tap Sign in again, and they're back in with the new PIN. The
code works once, for 7 days; their old PIN works until then.

<img src="6-pin-reset/2-user-types-new-pin-and-code.png" width="640" alt="Sign-in screen asking for the reset code">

**When you can't reach them at all: "Forgot PIN?"** They type their username,
tap **Forgot PIN?**, pick a new PIN, add a message, and tap **Send to the
owner**.

<img src="6-pin-reset/3-forgot-pin-request.png" width="640" alt="Forgot your PIN? form on the sign-in screen">

Their screen waits for you, and signs them in by itself once you approve.

<img src="6-pin-reset/4-forgot-pin-waiting.png" width="640" alt="Waiting for the owner to approve">

**Your side** (Admin → Security → Allowed users, plus a phone alert): the
request, whether it came from **the device they usually use**, their message,
and **Approve new PIN** / **Deny**.

<img src="6-pin-reset/5-owner-approves.png" width="420" alt="Allowed users row: Forgot PIN, from the device they usually use, Approve new PIN / Deny">

---

## 7. Student numbers, Forgot PIN and locked devices

**Required student number.** Anyone signed in without one on file gets this
screen. It can't be closed or skipped, the boxes stay off for 8 seconds so
they read it, they tick the box, and they type the 6 digits twice (digits
only).

<img src="7-student-number-and-locks/1-student-number-required.png" width="640" alt="Add your school student number: read first, boxes off">

<img src="7-student-number-and-locks/2-student-number-filled.png" width="640" alt="Student number typed twice, Save turns on">

**Forgot PIN asks for the student number.** A wrong number is refused (shown
here); the right one sets the new PIN at once and signs them in.

<img src="7-student-number-and-locks/3-forgot-pin-wrong-number.png" width="640" alt="Forgot PIN with a student number; wrong number refused">

**No number on file:** it goes to you and your admins, and they're told to
check back every 10 minutes.

<img src="7-student-number-and-locks/4-waiting-check-back-10-min.png" width="640" alt="Sent to the owner and admins, check back every 10 minutes">

**Your Sign-in help card** (Admin → Security, you and admins): the request
with the number they gave, **Approve new PIN** / **Deny**.

<img src="7-student-number-and-locks/5-owner-request.png" width="420" alt="Sign-in help: Forgot PIN request">

**Unauthorized attempts lock the device** (3 names that aren't approved, or 5
wrong PINs/codes/numbers in an hour) until the end of the day session (12 PM
New York time; this test computer shows its own time zone). Nothing under it
works, and reloading doesn't help.

<img src="7-student-number-and-locks/6-device-locked.png" width="640" alt="This device is locked">

**You and your admins** get an alert, and Sign-in help shows the device and
the names it tried: **Approve (unlock)** or **Keep locked until the session
ends**.

<img src="7-student-number-and-locks/7-owner-locked-device.png" width="420" alt="Sign-in help: locked device with Approve (unlock) / Keep locked">

**Everyone's school email and the log.**

<img src="7-student-number-and-locks/8-owner-emails-and-log.png" width="420" alt="Approved people with school emails, and the Sign-in help log">

---

## 8. Opens small and centered

Injected into a website and signed out, **only the sign-in card** shows, in
the middle of the page (no dark window around it; the page stays usable).

<img src="8-opens-centered/1-signed-out-card-only.png" width="640" alt="Only the sign-in card, centered on the website">

The same for Forgot PIN and a locked device.

<img src="8-opens-centered/2-forgot-pin-card-only.png" width="420" alt="Forgot PIN card only"> <img src="8-opens-centered/3-locked-card-only.png" width="420" alt="Locked device card only">

Signed in, the console is a **centered window** (about 60% of the page),
not the whole screen. (Here the required student-number screen is on top.)

<img src="8-opens-centered/4-signed-in-centered.png" width="640" alt="Signed-in console as a centered window">

---

## 9. Fold the top card

Every tab's top card has a small arrow in its top-right corner. **Open**
(Ask AI takes about half the window):

<img src="9-fold-top-card/1-ask-card-open.png" width="640" alt="Ask AI card open">

**Folded:** a thin bar with the title, **New chat** and **Study settings**;
the answers get the rest of the window. Tap the arrow to open it again. Each
tab remembers its choice after a reload.

<img src="9-fold-top-card/2-ask-card-folded.png" width="640" alt="Ask AI card folded to a thin bar">

---

## 10. Security review: brute-force proof and fix

Attacks run against the real Worker code with throwaway storage (no real
accounts). The attacker changes their device id and network on every try,
which got around the old device lock and per-network limit.

**Attack 1: guessing an approved person's PIN.** Before: 300 wrong PINs, no
lock, then the right one signed in as them. After: the account locks at 8
wrong tries, and even the right PIN is refused until it's unlocked.

<img src="10-security-review/1-pin-brute-force.png" width="760" alt="Before: 300 guesses then takeover. After: locked at 8">

**Attack 2: taking an account over through Forgot PIN** by guessing the
6-digit student number. Before: no limit, so a guesser eventually gets the new
PIN. After: locked at 8 wrong numbers.

<img src="10-security-review/2-student-number-brute-force.png" width="760" alt="Before: unlimited student-number guesses. After: locked at 8">

**What the person sees** after too many wrong tries (any mix of devices and
networks), and **your side**: Sign-in help lists the locked account with
**Unlock account** (you also get an alert). It unlocks itself at noon New
York time (this test computer shows UTC).

<img src="10-security-review/3-locked-account-signin.png" width="640" alt="This account is locked after too many wrong sign-in attempts">

<img src="10-security-review/4-owner-unlock.png" width="560" alt="Sign-in help: Locked accounts, Unlock account">

**The real person can unlock it themselves** with the 6 digits of the school
email saved on their account (once a day, 3 tries; accounts with no school
email saved can only be unlocked by you or an admin).

<img src="10-security-review/5-unlock-with-school-email.png" width="640" alt="Account locked: unlock with your school email">

---

## 11. Countdown, Renew and texting

**Time left, at the top, for everyone**: days and hours ("12d 9h left"),
updated every minute, with the exact end date and time, and a **Renew** button.

<img src="11-countdown-renew-texting/1-countdown.png" width="640" alt="12d 9h left under the header, with Renew">

At the smallest size (Compact) too:

<img src="11-countdown-renew-texting/2-compact-size.png" width="300" alt="Countdown at Compact size">

**Renew** opens: the subscribe page / copy link, **Text me the link** (their
phone number; one text with the link), and **Paying cash?** (who to give it
to, and "text CASH to" your number). This test shows "the monthly price"
because Stripe isn't set up on the test computer; yours shows the real price.

<img src="11-countdown-renew-texting/3-renew-box.png" width="640" alt="Renew box: link, text me the link, paying cash">

Admins (and you) see **No expiry**:

<img src="11-countdown-renew-texting/4-admin-no-expiry.png" width="640" alt="Admin: No expiry">

**Your card** (Admin → Security → Cash & texting): whether texting is on, who
takes cash (empty = you and the admins automatically), and who texted CASH.

<img src="11-countdown-renew-texting/5-owner-cash-texting.png" width="640" alt="Cash & texting card">

---

## 12. Proxy tab (Saints proxy Worker)

Taken in the automated test with the **real** proxy Worker code running
locally. The approved sites here are two **test sites** made for the test
(`fixture.saints-test.dev`, `docs.saints-test.dev`) plus one that's
deliberately down. On your deployment, the tab shows the sites in your
`TARGET_ORIGINS`.

**Connected:** the Worker's connection test, listing the approved sites.

<img src="12-proxy-tab/1-connected.png" width="640" alt="Proxy tab: Connected, connection test">

**An approved site, through the proxy:** its own styles (black background),
image (red square) and script ("JS ran") all load through the Worker, and its
links stay in the proxy. "storage: blocked" shows each proxied page is
isolated.

<img src="12-proxy-tab/2-approved-site.png" width="640" alt="An approved site loaded through /site/">

**Errors say what went wrong:** a page that doesn't exist (HTTP 404), and an
approved site that's down.

<img src="12-proxy-tab/3-http-404.png" width="640" alt="HTTP 404 named"> <img src="12-proxy-tab/4-website-down.png" width="640" alt="Website unavailable">

**Any other site is explained**, with buttons for the approved ones, and the
page stays:

<img src="12-proxy-tab/5-other-site-explained.png" width="640" alt="google.com isn't supported; approved sites offered">

**A website that forbids embedded pages:** Open in a new tab.

<img src="12-proxy-tab/6-blocked-by-website.png" width="640" alt="Blocked by this website">

**Light theme:**

<img src="12-proxy-tab/7-light-theme.png" width="640" alt="Proxy tab in the white theme">

## 13. Messages, @everyone and stats

Taken in the automated test (`tests/browser/messages.mjs`) on iPhone 15
size phones and one computer, with made-up names (`ana…`, `ben…`, `cy…`,
and an admin `adm…`).

**The sidebar:** Messages sits right under Chat with an orange **NEW**
label. The label goes away on that device once the person has opened
Messages.

<img src="13-messages/1-sidebar-new.png" width="320" alt="Messages in the sidebar with a NEW label">

**Messages, empty:** New message and New group. (This picture still shows
a line about the owner and admins reading messages; that line has since
been removed.)

<img src="13-messages/2-messages-empty.png" width="320" alt="Messages with no conversations yet">

**A direct message:** Ana messages Ben.

<img src="13-messages/3-direct-message.png" width="320" alt="A direct message">

**Ben gets a badge** on Messages without opening anything, and the
conversation shows as unread in his list:

<img src="13-messages/4-unread-badge.png" width="320" alt="Unread badge on Messages"> <img src="13-messages/5-list-unread.png" width="320" alt="Unread conversation in the list">

**A group chat with @everyone:** the group's name and members, Add people,
Rename and Leave, the "started" notice, and an @everyone message
highlighted for everyone in the group.

<img src="13-messages/6-group-everyone.png" width="320" alt="Group chat with an @everyone message highlighted">

**Your Safety review** (you and admins only): every conversation, then one
opened read-only with no message box. It's marked "Safety review ·
read-only", it leaves no "Read by", and each one you open is written to
the audit log.

<img src="13-messages/7-safety-review-list.png" width="640" alt="Safety review list"> <img src="13-messages/8-safety-review-open.png" width="640" alt="A conversation open in Safety review, read-only">

**Stats on Welcome**, for everyone: members, online now, messages today
and this week (chat and private messages counted together, never their
contents), group chats, and top chatters, trivia points, streaks and game
records when there are any.

<img src="13-messages/9-welcome-stats-desktop.png" width="640" alt="Saints Service stats on Welcome (computer)"> <img src="13-messages/10-welcome-stats-phone.png" width="320" alt="Saints Service stats on Welcome (phone)">

**Dark mode on a phone:**

<img src="13-messages/11-messages-dark.png" width="320" alt="Messages list, dark">

## 14. Renaming songs and Chromebook pop-ups

Taken in the automated tests (`tests/browser/my-music-edit.mjs` on iPhone
size; `tests/browser/chromebook-notify.mjs` with a Chromebook's Chrome,
Saints Service injected into two made-up websites, "Class notes" and
"Homework site").

**After uploading one song, its rename form opens**, filled in from the
file name. This upload is the owner's with Admin connected, the case that
used to say "Sign in to keep your own music."

<img src="14-music-rename-and-popups/1-rename-after-upload.png" width="320" alt="Rename form after uploading a song">

**Saved:** the new name and artist, with ⬇ Download (saved under the new
file name) and ✎ to edit again. A regular user can do the same with their
own songs.

<img src="14-music-rename-and-popups/2-renamed.png" width="320" alt="Renamed song"> <img src="14-music-rename-and-popups/3-regular-user.png" width="320" alt="A regular user's renamed song">

**On a Chromebook:** a bell strip in Chat turns pop-ups on (Chrome asks
once per website). Settings → Account shows them on, with "Messages,
mentions and @everyone" or "every chat message", and Send a test.

<img src="14-music-rename-and-popups/4-chromebook-bell-strip.png" width="640" alt="Bell strip in Chat"> <img src="14-music-rename-and-popups/5-chromebook-settings.png" width="640" alt="Pop-up notifications in Settings">

**Clicking a pop-up** opens that conversation:

<img src="14-music-rename-and-popups/6-chromebook-popup-opens-dm.png" width="640" alt="The conversation opened from a pop-up">

## 15. Resetting your own PIN (owner)

Taken in `tests/browser/owner-pin.mjs` on iPhone size: the owner name with
no server sign-in and Admin connected, as on your phone. Settings → Memory →
Reconnect said "Wrong PIN."; **Forgot your PIN? Reset it** asks for a new
PIN twice, then Memory connects.

<img src="15-owner-pin-reset/1-forgot-your-pin.png" width="320" alt="Forgot your PIN? Reset it"> <img src="15-owner-pin-reset/2-new-pin.png" width="320" alt="New PIN form"> <img src="15-owner-pin-reset/3-memory-connected.png" width="320" alt="Memory connected">
