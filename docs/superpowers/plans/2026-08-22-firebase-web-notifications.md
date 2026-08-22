# Firebase Web Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver every durable Supabase in-app notification to each active web/PWA device through Firebase Cloud Messaging with secure registration, per-device retries, foreground updates, background display, and trusted deep links.

**Architecture:** `public.notifications` stays canonical. A private Supabase outbox fans each new row into one delivery per active FCM token. Authenticated server routes own token registration, and a secret-protected worker claims leased deliveries and sends data-only messages through Firebase Admin. The browser uses the Firebase client SDK for permission/token acquisition and a dedicated service worker for background display and click navigation.

**Tech Stack:** Firebase JS SDK 12.18.0, Firebase Admin SDK 14.3.0, React 19, TanStack Query/Router/Start, Supabase JS/Postgres/Realtime/Cron, web service workers, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-22-uat-auth-firebase-notifications-design.md`

**Execution order:** Start after `docs/superpowers/plans/2026-08-22-uat-authentication.md` is complete and its real Supabase session smoke test passes.

## Global Constraints

- Firebase is push transport only; Supabase Auth remains the identity provider.
- Every `public.notifications` row remains available in-app even if push is denied, unsupported, misconfigured, or temporarily failing.
- Push is web/PWA-only in this release.
- Firebase client config and VAPID key may be public; Firebase Admin credentials, Supabase service role, and `PUSH_DRAIN_SECRET` are server-only.
- Permission must be requested only from an explicit user gesture.
- One outbox row represents one notification/device pair; successful devices must not be resent because another device failed.
- Push payloads are data-only and contain only string values derived from trusted database columns.
- No open redirects: destinations are `/`, `/?thing=<uuid>`, or `/lists/<uuid>`.
- Invalid FCM tokens are revoked; transient errors retry up to 8 total attempts.
- Existing notification producers and RLS rules remain canonical and must continue working.

---

### Task 1: Pin Firebase dependencies and validate public configuration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `docs/uat-runbook.md`
- Create: `src/features/notifications/firebase-config.ts`
- Create: `scripts/firebase-config.test.mjs`

**Interfaces:**
- Produces: `getFirebaseClientSettings(env: ImportMetaEnv): FirebaseClientSettings | null`.
- Produces: `getFirebaseServiceWorkerUrl(config: FirebaseWebConfig): string`.
- Consumes: Vite environment values only; no Admin credentials.

- [ ] **Step 1: Install exact SDK versions**

Run:

```bash
npm install --save-exact firebase@12.18.0 firebase-admin@14.3.0
```

Confirm `package-lock.json` changes and Node remains 22-compatible.

- [ ] **Step 2: Write failing configuration tests**

Cover complete, incomplete, and URL-encoding behavior:

```js
test("returns null when any required Firebase web field is absent", () => {
  assert.equal(getFirebaseClientSettings({ VITE_FIREBASE_API_KEY: "key" }), null);
});

test("builds a service-worker URL from public config only", () => {
  const url = new URL(getFirebaseServiceWorkerUrl(completeConfig), "https://uat.example.test");
  assert.equal(url.pathname, "/firebase-messaging-sw.js");
  assert.equal(url.searchParams.get("projectId"), "katalist-d2f9e");
  assert.equal(url.searchParams.has("vapidKey"), false);
});
```

- [ ] **Step 3: Run the test and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/firebase-config.test.mjs`

Expected: FAIL because the config module does not exist.

- [ ] **Step 4: Implement configuration parsing**

Use this client shape:

```ts
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};
export type FirebaseClientSettings = {
  config: FirebaseWebConfig;
  vapidKey: string;
};
```

Trim all values. Return `null` if any field or `VITE_FIREBASE_VAPID_KEY` is missing. Build a service-worker URL from `settings.config` whose query contains only the six Firebase web values; `settings.vapidKey` stays in the page call to `getToken`.

- [ ] **Step 5: Add environment documentation and commit**

Add the supplied UAT public values to the UAT deployment instructions, while keeping `.env.example` value-free:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
PUSH_DRAIN_SECRET=
```

Run the focused test; expect PASS.

```bash
git add package.json package-lock.json .env.example docs/uat-runbook.md src/features/notifications/firebase-config.ts scripts/firebase-config.test.mjs
git commit -m "build: add pinned Firebase messaging SDKs"
```

### Task 2: Private subscription and delivery outbox schema

**Files:**
- Create via Supabase CLI: `supabase/migrations/*_firebase_push_outbox.sql`
- Create: `supabase/tests/database/firebase_push_outbox.test.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces: private `katalist_priv.push_subscriptions` and `katalist_priv.notification_deliveries`.
- Produces service-role RPCs: `register_push_subscription`, `revoke_push_subscription`, `claim_notification_deliveries`, `finish_notification_delivery`.
- Consumes: existing `public.notifications`, `public.profiles`, and `public.set_updated_at()`.

- [ ] **Step 1: Create the migration through the CLI**

Run `npx supabase migration --help`, then:

```bash
npx supabase migration new firebase_push_outbox
```

Use the exact generated filename in edits and commits.

- [ ] **Step 2: Write failing pgTAP coverage**

Test table existence, private grants, unique notification/subscription fan-out, revoked-token exclusion, concurrent claims, and lease recovery. Minimum grant assertions:

```sql
select has_table('katalist_priv', 'push_subscriptions');
select has_table('katalist_priv', 'notification_deliveries');
select table_privs_are('katalist_priv', 'push_subscriptions', 'anon', array[]::text[]);
select table_privs_are('katalist_priv', 'push_subscriptions', 'authenticated', array[]::text[]);
select function_privs_are(
  'public', 'claim_notification_deliveries',
  array['integer','integer'], 'authenticated', array[]::text[]
);
```

Insert two active subscriptions and one revoked subscription for a profile, insert one notification, and assert exactly two pending deliveries.

- [ ] **Step 3: Run the database test and confirm RED**

Run: `npx supabase test db supabase/tests/database/firebase_push_outbox.test.sql`

Expected: FAIL because the private tables/functions do not exist.

- [ ] **Step 4: Implement private tables and notification fan-out**

Create both tables exactly as the spec describes. Add indexes for:

```sql
create index push_subscriptions_profile_active_idx
  on katalist_priv.push_subscriptions(profile_id, updated_at desc)
  where revoked_at is null;
create index notification_deliveries_claim_idx
  on katalist_priv.notification_deliveries(next_attempt_at, created_at)
  where status in ('pending', 'retry', 'processing');
```

Enable RLS on both private tables, add no client policies, revoke all privileges from `PUBLIC`, `anon`, and `authenticated`, and grant table access only to `service_role`.

Create an `AFTER INSERT` trigger on `public.notifications` that inserts one pending row per active subscription with `ON CONFLICT (notification_id, subscription_id) DO NOTHING`.

- [ ] **Step 5: Implement service-role-only RPCs**

Use public RPC wrappers because the private schema is not exposed by PostgREST. Every function must set a fixed search path, revoke from `PUBLIC`/`anon`/`authenticated`, and grant only to `service_role`.

`claim_notification_deliveries(p_limit, p_lease_seconds)` must use a CTE with `FOR UPDATE SKIP LOCKED`, claim eligible pending/retry rows plus expired processing rows, increment attempts, and return:

```ts
type ClaimedPushDelivery = {
  delivery_id: string;
  subscription_id: string;
  notification_id: string;
  fcm_token: string;
  attempt_count: number;
  kind: string;
  title: string;
  body: string | null;
  thing_id: string | null;
  list_id: string | null;
};
```

`finish_notification_delivery` accepts only the claimed delivery ID plus a constrained result (`sent`, `retry`, `dead`), message ID, sanitized error fields, next-attempt timestamp, and revoke flag. When revoking, update only the joined subscription.

- [ ] **Step 6: Regenerate types, run advisors, and commit**

Run:

```bash
npx supabase test db supabase/tests/database/firebase_push_outbox.test.sql
npx supabase db advisors --local
npx supabase migration list --local
```

Regenerate `src/integrations/supabase/types.ts` and verify the four public RPC signatures exist.

```bash
git add supabase/migrations supabase/tests/database/firebase_push_outbox.test.sql src/integrations/supabase/types.ts
git commit -m "feat: add durable Firebase notification outbox"
```

### Task 3: Authenticated push-subscription API

**Files:**
- Create: `src/lib/supabase-user.server.ts`
- Create: `src/features/notifications/push-subscriptions.server.ts`
- Create: `src/routes/api/push/subscriptions.ts`
- Create: `scripts/push-subscriptions.test.mjs`

**Interfaces:**
- Produces: `requireSupabaseUser(request: Request): Promise<{id: string}>`.
- Produces: `registerPushSubscription(profileId, token, userAgent)` and `revokePushSubscription(profileId, token)`.
- Produces: authenticated `POST`/`DELETE /api/push/subscriptions`.

- [ ] **Step 1: Write failing authentication and ownership tests**

Use injected `getUser` and RPC dependencies. Assert missing/malformed bearer returns 401, an invalid JWT performs no service-role RPC, and caller-supplied profile IDs are ignored:

```js
const request = jsonRequest({ token: "fcm-token", profileId: "attacker-choice" }, "Bearer valid-jwt");
await handler(request);
assert.deepEqual(rpc.calls[0].args, {
  p_profile_id: "verified-user-id",
  p_fcm_token: "fcm-token",
  p_user_agent: "test-agent",
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/push-subscriptions.test.mjs`

Expected: FAIL because the server helpers and route do not exist.

- [ ] **Step 3: Implement verified-user extraction**

Parse only `Authorization: Bearer <token>`, reject oversized tokens, and call `supabaseAdmin.auth.getUser(token)`. Return only the verified user ID. Use `cache-control: no-store` and generic 401 responses.

- [ ] **Step 4: Implement subscription registration/revocation**

Validate FCM tokens as trimmed strings from 20 through 4096 characters. POST calls `register_push_subscription`; DELETE calls `revoke_push_subscription`. The RPC upsert must reassign a token to the verified profile, clear revocation, and refresh `last_seen_at`, making shared-browser account changes safe.

- [ ] **Step 5: Run tests and commit**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/push-subscriptions.test.mjs`

Expected: PASS.

```bash
git add src/lib/supabase-user.server.ts src/features/notifications/push-subscriptions.server.ts src/routes/api/push/subscriptions.ts scripts/push-subscriptions.test.mjs
git commit -m "feat: register authenticated push devices"
```

### Task 4: Firebase Admin delivery worker

**Files:**
- Create: `src/features/notifications/firebase-admin.server.ts`
- Create: `src/features/notifications/push-delivery.ts`
- Create: `src/features/notifications/push-worker.server.ts`
- Create: `src/routes/api/internal/notifications/drain.ts`
- Create: `scripts/push-delivery.test.mjs`
- Create: `scripts/push-worker.test.mjs`

**Interfaces:**
- Produces: `notificationPath({thingId, listId}): string`.
- Produces: `retryDelayMs(attempt: number, random?: () => number): number`.
- Produces: `classifyFirebaseError(code: string): "retry" | "dead-token" | "dead"`.
- Produces: `drainPushDeliveries(deps, limit): Promise<DrainSummary>`.
- Produces: `POST /api/internal/notifications/drain` guarded by `PUSH_DRAIN_SECRET`.

- [ ] **Step 1: Write failing pure delivery tests**

Cover paths, retry schedule, and Firebase error classification:

```js
assert.equal(notificationPath({ thingId: "11111111-1111-4111-8111-111111111111", listId: null }), "/?thing=11111111-1111-4111-8111-111111111111");
assert.equal(notificationPath({ thingId: null, listId: "22222222-2222-4222-8222-222222222222" }), "/lists/22222222-2222-4222-8222-222222222222");
assert.equal(notificationPath({ thingId: null, listId: null }), "/");
assert.equal(classifyFirebaseError("messaging/registration-token-not-registered"), "dead-token");
assert.equal(classifyFirebaseError("messaging/server-unavailable"), "retry");
assert.equal(classifyFirebaseError("messaging/invalid-payload"), "dead");
```

With deterministic `random=() => 0.5`, assert retry delays equal 1, 2, 5, 10, 30, 60, 180, and 360 minutes.

- [ ] **Step 2: Run pure tests and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/push-delivery.test.mjs`

Expected: FAIL because delivery helpers do not exist.

- [ ] **Step 3: Implement Firebase Admin initialization**

Initialize once per server process with:

```ts
initializeApp({
  credential: cert({
    projectId: required("FIREBASE_ADMIN_PROJECT_ID"),
    clientEmail: required("FIREBASE_ADMIN_CLIENT_EMAIL"),
    privateKey: required("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
  }),
});
```

Keep this module `*.server.ts`. Do not import it from client code. Missing config throws a safe configuration error without echoing values.

- [ ] **Step 4: Write failing worker orchestration tests**

Inject claim, Firebase send, finish, clock, and random dependencies. Assert:

```js
assert.deepEqual(send.calls[0].message.data, {
  notificationId: "notification-id",
  kind: "thing_assigned",
  path: "/?thing=11111111-1111-4111-8111-111111111111",
  title: "A Thing is waiting for your Catch",
  body: "Prepare launch notes",
});
assert.equal(finish.calls[0].result, "sent");
```

Add cases for retry, dead token/revocation, permanent error, max-attempt dead state, and one failure not preventing the next claimed delivery.

- [ ] **Step 5: Implement the worker and drain route**

Send each claimed device independently using Firebase Admin `send` and a data-only message:

```ts
await messaging.send({
  token: delivery.fcm_token,
  data: {
    notificationId: delivery.notification_id,
    kind: delivery.kind,
    path: notificationPath({ thingId: delivery.thing_id, listId: delivery.list_id }),
    title: delivery.title,
    body: delivery.body ?? "",
  },
  webpush: { headers: { Urgency: "high" } },
});
```

The route accepts only exact bearer authorization. Compare the supplied and expected drain secrets with `timingSafeEqual`; return 404 when the secret is not configured and 401 for a mismatch. Return `{claimed, sent, retry, dead}` without tokens or payload bodies.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/push-delivery.test.mjs scripts/push-worker.test.mjs
npx eslint src/features/notifications/firebase-admin.server.ts src/features/notifications/push-delivery.ts src/features/notifications/push-worker.server.ts src/routes/api/internal/notifications/drain.ts
```

Expected: PASS with no ESLint errors.

```bash
git add src/features/notifications/firebase-admin.server.ts src/features/notifications/push-delivery.ts src/features/notifications/push-worker.server.ts src/routes/api/internal/notifications/drain.ts scripts/push-delivery.test.mjs scripts/push-worker.test.mjs
git commit -m "feat: deliver Firebase notifications from the outbox"
```

### Task 5: Browser token lifecycle and background service worker

**Files:**
- Create: `src/features/notifications/push-client.ts`
- Create: `src/features/notifications/use-push-notifications.ts`
- Create: `public/firebase-messaging-sw.js`
- Create: `scripts/push-client.test.mjs`
- Create: `scripts/firebase-service-worker.test.mjs`

**Interfaces:**
- Produces: `enablePush(session): Promise<PushState>` and `disablePush(session): Promise<PushState>`.
- Produces: `usePushNotifications()` with `state`, `enable`, and `disable`.
- Consumes: Firebase web config, VAPID key, Supabase access token, `/api/push/subscriptions`.

- [ ] **Step 1: Write failing browser lifecycle tests**

Inject browser/Firebase dependencies and assert no permission request occurs during construction or hook mount. The request must happen only inside `enablePush`. Cover unsupported, missing config, denied, registration failure, enabled, and disable/revoke states.

```js
const controller = createPushController(deps);
assert.equal(deps.requestPermission.calls.length, 0);
await controller.enable(session);
assert.equal(deps.requestPermission.calls.length, 1);
assert.equal(deps.getToken.calls[0].vapidKey, "public-vapid-key");
```

- [ ] **Step 2: Write failing service-worker contract tests**

Read the service-worker source and assert it:

- imports Firebase compat app and messaging version `12.18.0`;
- accepts only the six known config query keys;
- registers `onBackgroundMessage` exactly once;
- calls `showNotification` with payload title/body and `data.path`;
- handles `notificationclick`, closes the notification, focuses a same-origin client, and falls back to `clients.openWindow`;
- rejects non-relative or non-allowlisted paths by using `/`.

- [ ] **Step 3: Run both tests and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/push-client.test.mjs scripts/firebase-service-worker.test.mjs`

Expected: FAIL because client and worker files do not exist.

- [ ] **Step 4: Implement the page-side controller**

Lazy-import `firebase/app` and `firebase/messaging` only in supported browsers. Register the service worker from `getFirebaseServiceWorkerUrl(settings.config)`, then:

```ts
const permission = await Notification.requestPermission();
if (permission !== "granted") return { kind: "denied" };
const token = await getToken(messaging, {
  vapidKey: settings.vapidKey,
  serviceWorkerRegistration,
});
await fetch("/api/push/subscriptions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
  body: JSON.stringify({ token }),
});
```

Store the current token in `sessionStorage` for revocation during explicit disable/sign-out. On `onMessage`, invalidate both notification queries and show one Sonner toast; do not call the browser Notification constructor in the foreground.

- [ ] **Step 5: Implement the service worker**

Use pinned official compat scripts:

```js
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js");
```

Read config from `new URL(self.location.href).searchParams`, initialize Firebase, and register `firebase.messaging().onBackgroundMessage`. Validate UUID-shaped Thing/List paths and same-origin relative navigation before displaying or opening them. The worker must never accept an absolute URL from a payload.

- [ ] **Step 6: Run tests and commit**

Run the two focused tests and `npm run build:dev`; expect PASS.

```bash
git add src/features/notifications/push-client.ts src/features/notifications/use-push-notifications.ts public/firebase-messaging-sw.js scripts/push-client.test.mjs scripts/firebase-service-worker.test.mjs
git commit -m "feat: receive Firebase web push notifications"
```

### Task 6: Notification controls, inbox navigation, and sign-out cleanup

**Files:**
- Create: `src/features/notifications/PushNotificationControl.tsx`
- Modify: `src/routes/me.tsx`
- Modify: `src/features/notifications/use-notifications.ts`
- Modify: `src/features/notifications/NotificationPanel.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/hooks/useSession.ts`
- Create: `scripts/notification-navigation.test.mjs`
- Modify: `scripts/katalist-multipersona.test.mjs`

**Interfaces:**
- Consumes: `usePushNotifications`, `notificationPath`, notification `thing_id`/`list_id`.
- Produces: explicit Enable/Disable browser notifications controls.
- Produces: notification click navigation and `/?thing=<uuid>` sheet opening.

- [ ] **Step 1: Write failing navigation and UI contract tests**

Assert notification mapping preserves targets:

```js
assert.deepEqual(mapNotificationRow({
  id: "n1", title: "Assigned", body: "Prepare notes", read_at: null,
  created_at: "2026-08-22T00:00:00Z", thing_id: thingId, list_id: null,
}), {
  id: "n1", title: "Assigned", body: "Prepare notes", read: false,
  createdAt: "2026-08-22T00:00:00Z", path: `/?thing=${thingId}`,
});
```

Source assertions must verify the Notifications settings panel renders `PushNotificationControl`, the enable action is a button click, and sign-out attempts token revocation before `supabase.auth.signOut()`.

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/notification-navigation.test.mjs scripts/katalist-multipersona.test.mjs`

Expected: FAIL because target fields and push controls are missing.

- [ ] **Step 3: Add inbox targets and navigation**

Extend the query selection to `thing_id, list_id`, export a pure `mapNotificationRow`, and add `path` to `NotificationItem`. On bell item click, await `markOne` when unread, close the panel, and navigate to the trusted path.

For the Court route, add a validated optional `thing` search field. Initialize/synchronize `selectedId` from search, and remove the search key when the detail sheet closes. Invalid UUID search values become `undefined`.

- [ ] **Step 4: Add explicit notification settings**

Render state-specific controls in the Me Notifications panel:

- `Enable browser notifications` for available/default.
- `Browser notifications enabled` plus `Disable` for enabled.
- `Notifications are blocked in this browser` for denied.
- `Browser notifications aren’t supported here` for unsupported.
- `Notification setup is unavailable` for missing configuration.

Do not request permission when the panel opens; only the enable button calls `enable()`.

- [ ] **Step 5: Revoke on sign-out**

Before Supabase sign-out, best-effort DELETE the current token using the still-valid access token. Bound the request with a short timeout. Clear the local token in `finally`; proceed with sign-out even if revocation fails because registration reassignment on next login is the safety net.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test
npm run build:dev
npx eslint src/features/notifications src/routes/me.tsx src/routes/index.tsx src/hooks/useSession.ts
```

Expected: all tests/build pass and touched files have no ESLint errors.

```bash
git add src/features/notifications src/routes/me.tsx src/routes/index.tsx src/hooks/useSession.ts scripts/notification-navigation.test.mjs scripts/katalist-multipersona.test.mjs
git commit -m "feat: connect push settings and notification navigation"
```

### Task 7: Cron configuration and complete notification verification

**Files:**
- Create: `supabase/uat/configure-push-cron.sql`
- Create: `scripts/firebase-push-smoke.mjs`
- Modify: `docs/uat-runbook.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `PUSH_DRAIN_URL`, `PUSH_DRAIN_SECRET`, configured UAT Supabase/Firebase credentials.
- Produces: one-minute Supabase Cron invocation and a redacted end-to-end smoke report.

- [ ] **Step 1: Create exact Cron configuration SQL**

The script accepts psql variables `push_drain_url` and `push_drain_secret`, enables `pg_cron`, `pg_net`, and Vault, stores both values in Vault, removes an existing job named `katalist-push-drain`, and schedules this statement every minute:

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'katalist_push_drain_url'),
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'katalist_push_drain_secret')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 10000
);
```

Document the exact invocation using shell environment values without printing them:

```bash
psql "$SUPABASE_DB_URL" \
  -v push_drain_url="$PUSH_DRAIN_URL" \
  -v push_drain_secret="$PUSH_DRAIN_SECRET" \
  -f supabase/uat/configure-push-cron.sql
```

- [ ] **Step 2: Write the smoke script**

Using a test user access token supplied through the environment, register an FCM token, create a notification through a test-safe existing producer or service-role fixture, call the drain route, and query delivery status. Assert:

```js
assert.equal(notificationCount, 1);
assert.equal(deliveryCount, 1);
assert.equal(drain.status, 200);
assert.equal(drainBody.sent, 1);
assert.equal(delivery.status, "sent");
assert.ok(delivery.fcm_message_id);
```

Never print access tokens, refresh tokens, Admin credentials, drain secret, or full FCM tokens. The script exits with an exact list of absent environment names before making requests.

- [ ] **Step 3: Verify fallback states locally**

Run browser/component tests with Firebase config absent and Notification permission denied. Confirm the app and in-app bell still operate and no Firebase import crashes SSR/build.

- [ ] **Step 4: Run the full local verification suite**

Run:

```bash
npm test
npm run build:dev
npm run typecheck
npx supabase test db
npx supabase db advisors --local
git diff --check
```

Expected: all tests/build/database checks pass. Record the existing unrelated `server/middleware/grok-pwa.ts` TS2559 separately if still present; no new notification-related type errors are allowed.

- [ ] **Step 5: Run the configured live UAT smoke test**

Run: `node scripts/firebase-push-smoke.mjs`

Expected: `Firebase push smoke: PASS`, followed by manual confirmation that a background browser notification appears and opens/focuses the intended Thing/List. If VAPID/Admin/Cron credentials are absent, report the exact missing names and do not claim live delivery.

- [ ] **Step 6: Commit rollout assets**

```bash
git add supabase/uat/configure-push-cron.sql scripts/firebase-push-smoke.mjs docs/uat-runbook.md .env.example
git commit -m "ops: configure UAT push delivery verification"
```
