# UAT Authentication and Firebase Notifications Design

**Date:** 2026-08-22

**Status:** Approved in chat; awaiting written-spec review
**Scope:** Separate UAT authentication, required first-time profile setup, and reliable Firebase Cloud Messaging for the existing web/PWA notification system

## Goal

Create a separate UAT deployment where any valid phone number can authenticate with the fixed OTP `111111` and receive a real Supabase session with the same database features and RLS-governed permissions as every other authenticated user. A new user must not exist in Supabase Auth or `public.profiles` until Full name, Age, and Occupation have been validated. Profile photo remains selectable and its UI must not display the word “optional.”

Add Firebase Cloud Messaging (FCM) to the web/PWA so every durable row created in `public.notifications` remains visible in the in-app inbox and is also queued for push delivery to every active browser registration belonging to that profile.

## Non-goals

- The universal OTP must never work in production, preview, or an incorrectly configured deployment.
- UAT authentication does not bypass ownership checks, RLS, role checks, or domain rules after sign-in.
- Firebase Authentication does not replace Supabase Auth. Firebase is used only for web push transport.
- Native Android and iOS notification clients are not part of this release.
- Email, WhatsApp, and SMS notification delivery are not part of this release.
- Analytics initialization is not required for notifications and will not be added as part of this work.

## Environment Isolation

UAT uses a separate Supabase project and database. It must not point at production data. The deployment is considered UAT only when both the public build flag and the server flag equal `uat`:

- `VITE_KATALIST_ENV=uat`
- `KATALIST_ENV=uat`

The server must additionally have `KATALIST_UAT_FIXED_OTP=111111` and `KATALIST_UAT_AUTH_PEPPER`. The fixed-OTP endpoints return `404` when `KATALIST_ENV` is not exactly `uat`; this fail-closed behavior prevents route discovery and accidental production activation. They return a configuration error without creating or signing in a user when any required UAT server secret is absent.

The UAT deployment uses its own values for:

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_VAPID_KEY`
- `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, and `FIREBASE_ADMIN_PRIVATE_KEY`
- `PUSH_DRAIN_SECRET`

The Firebase web values supplied by the user belong in the UAT environment. They are public client configuration. The VAPID key is also public. The Supabase service-role key, UAT auth pepper, Firebase Admin private key, and drain secret are server-only and must never use a `VITE_` prefix or enter browser bundles, logs, API responses, or committed environment files.

## UAT Authentication Flow

### Phone normalization

The client sends a country code plus subscriber number. The server normalizes it to E.164-like `+` followed by 6–15 digits and rejects anything else. The normalized phone is the only identity key used by this flow.

### Request step

`POST /api/uat-auth/request` accepts `{ phone }`. In UAT it validates the phone and returns `{ ok: true }` without sending SMS. The UI advances to the OTP screen and uses the existing six-digit input. Outside UAT the endpoint returns `404`.

### Verify step

`POST /api/uat-auth/verify` accepts:

```ts
type UatVerifyRequest = {
  phone: string;
  otp: string;
  profile?: {
    fullName: string;
    age: string;
    occupation: string;
  };
};
```

The endpoint performs these steps in order:

1. Confirm server environment gating and normalize the phone.
2. Compare the submitted OTP to `KATALIST_UAT_FIXED_OTP` using a timing-safe comparison.
3. Query `public.profiles` with the server-only Supabase client by `phone_e164`.
4. If a matching profile exists, sign in the corresponding UAT Auth identity and return a real Supabase session.
5. If no profile exists and `profile` is absent, return `{ status: "needs_profile" }` without writing any row to `auth.users`, `public.profiles`, `public.actors`, or Storage.
6. If `profile` is present, validate all required values before calling any create API.
7. Create the Supabase Auth user with confirmed phone data and complete metadata, allow the existing Auth trigger to atomically create the profile and actor, then sign in and return the real session.

Validation is identical on client and server, but the server is authoritative:

- Full name: trimmed, internal whitespace collapsed, 1–100 characters.
- Age: base-10 integer from 1 through 120.
- Occupation: trimmed, internal whitespace collapsed, 1–100 characters.

The UAT broker uses a deterministic high-entropy password derived from `HMAC-SHA-256(KATALIST_UAT_AUTH_PEPPER, normalizedPhone)`. It creates the Auth identity with the normalized phone and signs in server-side with Supabase's phone-and-password form of `signInWithPassword`. The password is never shown to the user or returned to the browser. Determinism lets the server sign in an existing UAT identity without storing a password outside Supabase Auth.

The endpoint must handle a concurrent first-sign-in race: if user creation reports that the identity already exists, it re-reads the profile and signs in only when that profile matches the normalized phone. It must never overwrite another user's profile.

The successful response contains only the Supabase access token, refresh token, expiry information, and the minimum user data required by `supabase.auth.setSession`. The browser calls `setSession`, after which all existing hooks use the normal Supabase session and no live capability is blocked as “demo.”

Rate limiting applies per normalized phone and per source IP to request and verification attempts. Repeated invalid OTP attempts receive a generic error and never disclose whether the phone already has an account.

### First-time profile UI

After valid OTP verification returns `needs_profile`, the Auth page displays:

1. Full name — required
2. Age — required
3. Occupation — required
4. Profile photo — selectable, with no “optional” text shown

The Create account action remains disabled or returns inline field errors until all required values pass validation. Selecting a photo does not create a user. The browser keeps the selected file in memory. After successful account creation and `setSession`, it uploads the image to the existing `avatars` bucket and updates `profiles.avatar_url`. An upload failure does not roll back the account because the photo is not required; it shows a retryable message and enters the app with the completed required profile.

The shared profile schema gains nullable `age smallint` and `occupation text` columns with checks matching the validation rules. They remain nullable for backward compatibility with existing production profiles, but the UAT broker always supplies both. UAT disables direct public sign-up, making the broker the only UAT account-creation path. The Auth user trigger reads the broker's validated metadata and writes Full name, Age, and Occupation into the new profile in the same Auth-user transaction; it does not use `Katalist user` for broker-created accounts.

### Demo and production behavior

The explicit preview/demo persona flow remains available only behind its existing demo flag. The current browser-local fixed-OTP session path is removed from non-demo authentication. Production phone/email OTP continues to use Supabase's native `signInWithOtp` and `verifyOtp`; it does not call the UAT broker.

## Notification Architecture

### Canonical event

`public.notifications` remains the single source of truth for user-visible notifications. Existing Thing activity, comments, list messages, nudges, and future producers continue to insert this row through the current database notification functions. The in-app bell reads these rows under the existing ownership RLS.

Each inserted notification has two outcomes:

- In-app: immediately available through Supabase Realtime/query invalidation.
- Push: one durable delivery is queued for each active browser subscription owned by the recipient at insertion time.

Push permission or transport failure must never suppress, delete, or mark the in-app notification as read.

### Private persistence

Two tables live in the unexposed `katalist_priv` schema and grant no access to `anon` or `authenticated`:

`push_subscriptions`

- `id uuid primary key`
- `profile_id uuid not null references public.profiles(id) on delete cascade`
- `fcm_token text not null unique`
- `platform text not null check (platform = 'web')`
- `user_agent text`
- `created_at`, `updated_at`, `last_seen_at`
- `revoked_at timestamptz`

`notification_deliveries`

- `id uuid primary key`
- `notification_id uuid not null references public.notifications(id) on delete cascade`
- `subscription_id uuid not null references katalist_priv.push_subscriptions(id) on delete cascade`
- `status text not null` constrained to `pending`, `processing`, `sent`, `retry`, or `dead`
- `attempt_count integer not null default 0`
- `next_attempt_at timestamptz not null default now()`
- `lease_until timestamptz`
- `fcm_message_id text`
- `last_error_code text`, `last_error_detail text`
- `created_at`, `updated_at`, `sent_at`
- unique `(notification_id, subscription_id)`

An `AFTER INSERT` trigger on `public.notifications` inserts one `pending` delivery for each subscription where `profile_id = NEW.profile_id` and `revoked_at is null`. Per-device rows allow partial batch failures to retry only failed devices.

### Subscription API

The browser initializes Firebase only when it is running on a supported HTTPS origin, a real Supabase session exists, and `firebase/messaging` reports support. Permission is requested only after a user gesture from a Notifications control; it is not requested automatically during page load.

After permission is granted, the client registers the service worker, calls FCM `getToken` with `VITE_FIREBASE_VAPID_KEY`, and sends the token to `POST /api/push/subscriptions`. `DELETE /api/push/subscriptions` revokes the current token during explicit sign-out or when the user disables browser notifications.

Both endpoints require the caller's Supabase access token. The server validates it with Supabase Auth, derives `profile_id` from the verified user, and uses the service-role client only after that verification. A registration upsert reassigns the presented FCM token to the currently verified profile, clears `revoked_at`, and updates `last_seen_at`. This prevents a shared browser's old account from continuing to receive a new account's notifications.

If notification permission is denied, Firebase is unsupported, or token registration fails, the UI reports the state without blocking the app or its in-app inbox.

### Durable delivery worker

`POST /api/internal/notifications/drain` is server-only and requires an exact bearer match to `PUSH_DRAIN_SECRET`. A Supabase Cron job invokes it every minute. An optional database webhook can invoke the same endpoint after outbox inserts for lower latency; correctness does not depend on the webhook because Cron is the recovery path.

The worker claims a bounded batch through service-role-only SQL functions. Claiming changes eligible `pending`/`retry` rows to `processing`, increments `attempt_count`, and sets a short lease using `FOR UPDATE SKIP LOCKED`. Multiple worker invocations therefore cannot own the same delivery concurrently. Expired processing leases become retryable.

The worker loads each notification and subscription, sends through the Firebase Admin SDK, and records the result per delivery:

- Success: `sent`, FCM message ID, and `sent_at`.
- Transient FCM/network/rate-limit error: `retry` with exponential backoff and bounded jitter.
- Invalid or unregistered FCM token: mark the subscription revoked and mark the delivery `dead`.
- Permanent payload or credential error: `dead` with a sanitized error code; secrets and full tokens are never logged.
- Maximum attempts: `dead` after 8 failed attempts.

Retries occur at approximately 1, 2, 5, 10, 30, 60, 180, and 360 minutes. Operational logs include delivery ID, notification ID, attempt number, result code, and duration, but redact phone numbers, access/refresh tokens, Firebase private keys, and full FCM tokens.

### Payloads, display, and navigation

The server derives navigation from trusted database columns rather than accepting an arbitrary URL from notification payload JSON:

- `thing_id` present: `/things/{thing_id}` or the application's canonical Thing route/sheet target.
- Else `list_id` present: `/lists/{list_id}`.
- Otherwise: `/`.

The worker sends a data-only FCM payload containing string values for `notificationId`, `kind`, `path`, `title`, and `body`. Using one data-only handling path prevents Firebase's automatic background display from duplicating the service worker's notification. Title and body come from `public.notifications`. No private task description beyond the existing notification title/body is added.

Foreground messages use Firebase `onMessage` to invalidate notification queries and show an in-app toast; they do not create a second browser notification while the app is focused. Background messages are handled by `firebase-messaging-sw.js`, which displays the browser notification. On click, the service worker focuses an existing Katalist window when possible, navigates it to the trusted relative path, or opens a new window.

Clicking an item in the existing notification bell marks it read and navigates to the same resolved target. Receiving or clicking an FCM push does not mark the database row read until the app handles the corresponding notification action.

## Error Handling and Recovery

- All UAT auth failures return stable, generic user-facing messages and structured server logs without credentials.
- No Auth user is created on invalid OTP, invalid phone, incomplete profile, or photo selection.
- A profile-trigger failure makes Auth user creation fail as one transaction; the broker reports account creation failure without returning a session.
- Failed avatar upload is retryable after sign-in.
- A missing Firebase client setting disables the push controls with a configuration state; it does not break application startup.
- A missing Firebase Admin setting makes the drain endpoint fail closed. Deliveries stay retryable in the outbox.
- A worker crash after claiming rows is recovered when leases expire.
- The outbox is idempotent through its notification/subscription unique constraint and claim lease.

## Security Requirements

- Service-role and Firebase Admin credentials stay server-only.
- UAT fixed OTP is guarded on the server; a client build flag alone can never enable it.
- The broker never accepts a caller-supplied user ID, role, app metadata, email alias, password, or authorization claim.
- Authorization remains based on Supabase user ID and row ownership. User-editable metadata is used only to initialize profile fields, never for RLS or permission decisions.
- All public schema tables retain RLS. Private push tables are not exposed through the Data API.
- Service-role-only database functions revoke execution from `PUBLIC`, `anon`, and `authenticated`, and grant only to `service_role`.
- Push subscription routes validate the Supabase user before performing service-role writes.
- Push click destinations are server-derived relative paths, preventing open redirects.

## Testing and Acceptance Criteria

### Authentication

- Outside UAT, both fixed-OTP endpoints return `404` and create no user.
- In UAT, any valid phone plus any code other than `111111` fails and creates no user.
- A fresh phone plus `111111` returns `needs_profile` and creates no Auth user, profile, actor, or Storage object.
- Missing Full name, Age, or Occupation prevents creation.
- Ages outside 1–120 or non-integer ages prevent creation.
- A valid required profile creates exactly one Auth user, one profile, and one user actor, then returns a working Supabase session.
- A selected photo uploads only after session establishment; no “optional” label appears.
- Reusing the same phone plus `111111` returns the same Supabase identity and data.
- Concurrent creation attempts cannot produce duplicate profiles or actors.
- A UAT user's existing Thing/List/Bridge/notification operations run as a normal authenticated Supabase user under RLS.

### Notifications

- Every existing notification producer still creates one canonical `public.notifications` row for each intended recipient.
- Each new row creates exactly one delivery per active browser subscription and none for revoked subscriptions.
- In-app notifications work when browser permission is denied or Firebase is unavailable.
- Foreground FCM refreshes the inbox and shows one toast.
- Background FCM shows one browser notification and clicking it opens/focuses the correct Thing, List, or home route.
- Successful delivery is not retried.
- Transient failure retries only the failed device.
- Invalid token revokes the subscription and stops future delivery attempts.
- Concurrent drains cannot send the same claimed delivery concurrently.
- Expired leases recover after a simulated worker crash.
- Sign-out revokes the current browser token before clearing the Supabase session when possible; token reassignment on the next login remains the safety net.

### Verification

Automated tests cover pure validation, environment gates, route contracts, session establishment, notification path resolution, worker result classification, retry schedule, and database invariants. Migration tests exercise RLS/private grants, trigger fan-out, uniqueness, claiming, lease recovery, and state transitions. Browser tests cover fresh and returning UAT sign-in plus foreground/background notification behavior with Firebase calls mocked. A UAT smoke test with real configured Supabase and Firebase credentials confirms a notification row, an outbox delivery, an FCM send result, and click navigation.

## Rollout

1. Provision a separate Supabase UAT project and apply the current schema.
2. Configure the UAT Auth, profile, and private notification migrations.
3. Configure the supplied Firebase web project values, generate a Web Push VAPID key, and store Firebase Admin credentials in UAT server secrets.
4. Deploy the UAT app with both environment gates set to `uat`.
5. Configure Supabase Cron and, optionally, the low-latency webhook.
6. Run automated migration/API/browser tests and the real UAT push smoke test.
7. Verify production has neither UAT server gate nor fixed-OTP secret before any shared deployment configuration is promoted.

## References

- Supabase Phone Login: https://supabase.com/docs/guides/auth/phone-login
- Supabase changelog: https://supabase.com/changelog.md
- Firebase web messaging setup: https://firebase.google.com/docs/cloud-messaging/js/client
- Firebase receive messages: https://firebase.google.com/docs/cloud-messaging/js/receive
- Firebase send messages: https://firebase.google.com/docs/cloud-messaging/send-message
