# Katalist UAT runbook

UAT is a **separate** deployment and a **separate** Supabase project. It must not point at production data.

## Environment gates

A deployment is UAT only when **both** flags equal `uat`:

```dotenv
VITE_KATALIST_ENV=uat
KATALIST_ENV=uat
```

Server-only UAT secrets (never `VITE_`, never committed):

```dotenv
KATALIST_UAT_FIXED_OTP=111111
KATALIST_UAT_AUTH_PEPPER=
SUPABASE_SERVICE_ROLE_KEY=
```

Outside UAT, `/api/uat-auth/request` and `/api/uat-auth/verify` return `404` and create no user.

**Production must not contain** `KATALIST_ENV=uat` or `KATALIST_UAT_FIXED_OTP`.

## Supabase dashboard

- Use a dedicated UAT project (not production).
- Disable public sign-up. The UAT broker is the only account-creation path.
- Apply repo migrations with the usual operator workflow. Do not auto-apply from the app.
- Confirm `profiles.age`, `profiles.occupation`, and `consume_uat_auth_rate_limit` exist after the UAT profile migration.

## Authentication smoke

Any valid phone plus OTP `111111` is accepted in UAT. A new phone does not create Auth/profile/actor rows until Full name, Age (1–120), and Occupation are valid.

```bash
UAT_BASE_URL="https://uat.example.test" UAT_TEST_PHONE="+9198XXXXXXX0" node scripts/uat-auth-smoke.mjs
```

Expected: `UAT auth smoke: PASS`. The script never prints tokens.

## Firebase web push (UAT)

Public client values (safe in the UAT browser bundle):

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```

Server-only:

```dotenv
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
PUSH_DRAIN_SECRET=
```

Configure the one-minute drain Cron after the push outbox migration:

```bash
psql "$SUPABASE_DB_URL" \
  -v push_drain_url="$PUSH_DRAIN_URL" \
  -v push_drain_secret="$PUSH_DRAIN_SECRET" \
  -f supabase/uat/configure-push-cron.sql
```

Push smoke (never prints tokens, Admin credentials, or the drain secret):

```bash
node scripts/firebase-push-smoke.mjs
```

Required names if the script exits before requests: `UAT_BASE_URL`, `UAT_ACCESS_TOKEN`, `UAT_FCM_TOKEN`, `PUSH_DRAIN_URL`, `PUSH_DRAIN_SECRET`, plus the UAT Supabase service-role connection used to inspect delivery rows.

## Magic Box attachments (UAT)

The attachment saga SQL does **not** create the Storage bucket. Before applying
`supabase/migrations/20260824122123_magic_box_attachment_saga.sql` to UAT:

1. In the **UAT** Supabase project only, create or update the private bucket
   `thing-attachments` through the **Storage API or Dashboard** (not SQL):
   - **public:** `false`
   - **file size limit:** 20 MiB (`20971520` bytes)
2. Confirm both attachment flags are still `false` in Netlify until the
   migrations below succeed:
   - `VITE_MAGIC_BOX_ATTACHMENTS_ENABLED=false`
   - `MAGIC_BOX_ATTACHMENTS_ENABLED=false`
3. Apply these two unapplied files to UAT only, never production, never from
   a Netlify build:
   - `supabase/migrations/20260824124500_magic_box_ai_rate_limits.sql`
   - `supabase/migrations/20260824122123_magic_box_attachment_saga.sql`
4. Flip the two attachment flags to `true` in the Netlify dashboard only after
   both migrations succeed. Leave Coey (`MAGIC_BOX_AI_COEY_ENABLED`) off unless
   product asks otherwise.

Do not `INSERT`/`UPDATE`/`DELETE` `storage.buckets` or `storage.objects` from
SQL. Bytes move only through the Storage API; SQL may read `storage.objects`
metadata and may attach RLS policies on `storage.objects`.

## Safety

- Service-role keys, the auth pepper, derived passwords, access tokens, refresh tokens, Firebase Admin private keys, and `PUSH_DRAIN_SECRET` must never enter logs or client bundles.
- Do not enable the UAT broker in production, preview, or a mislabeled environment.
