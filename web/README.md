# Saints Command Home Screen app

This is the web counterpart of the native app. It is served by the existing
Worker at `/app/`, uses the same 54-operation catalog, permission model and
ADMIN_MOBILE Durable Object, and needs neither Apple signing nor App Store access.

## iPhone installation

The user-approved release is live. Open
`https://donnajbe.viztrrx.workers.dev/app/` in Safari. Tap Share → Add to Home
Screen, keep **Open as Web App** enabled, and tap Add. Open the new icon before
signing in, since Safari and a Home Screen app may have separate session storage.

Pair with an owner-issued five-minute code. If the original web console's pairing
UI has not been published, **Owner setup** accepts the existing Worker owner
credential once to create and redeem a scoped device pairing. It is not the local
console PIN. Do not send credentials through chat. Neither master nor device
tokens are exposed to JavaScript storage. The device token is an HttpOnly, Secure,
SameSite=Strict cookie and expires after at most seven days. Every privileged
request still passes through the existing Worker route guard. Sign out revokes
that device, then expires its cookie; server revocation is reported accurately.

## Behavior

Overview, user details/search, AI usage, memory, security, moderation, server
configuration, features, room actions, automation, diagnostics, audit, backups,
restore, danger actions and event inbox use actual backend data. Forms use the shared action catalog in `web/public/operations.json`; updates are partial and destructive
operations require a review dialog plus the backend's existing typed phrases.
Mutations carry UUID operation IDs. Unknown outcomes block further writes until
Settings can verify completion. No writes are queued offline or retried blindly.

Only the static interface is cached by the service worker; no admin data,
credentials, backups or API responses are cached. Offline access shows the
interface and a connection message; administration needs a network connection.
Theme and refresh preferences and nonsecret pending-operation metadata live in
local storage. Push notifications are not included. iOS Keychain integration,
native Face ID, and native background tasks are not provided by this web app.

## Development

Edit `web/public/` and `web/handler.js`. Run `npm run build:web` whenever assets or
the action catalog change; the generated module is bundled into Wrangler,
so no additional asset-storage binding or deployment service is required.

```
npm run build:web
npm test
npm run test:runtime
```

Run the local browser integration test with Playwright available and a local
Chrome executable (`CHROMIUM` can override):

```
SAINTS_PWA_TEST=1 npm run test:runtime
```

The harness only uses isolated local KV and SQLite DO data, refusing production
hostnames. Real iPhone standalone mode and user authentication must still be
verified on the device. Production deployment and repository push require the
user's explicit authorization under the original task instructions.
