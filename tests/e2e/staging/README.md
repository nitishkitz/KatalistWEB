# Staging E2E specs

Specs in this directory run against a real deployed environment with a real,
authenticated test account -- never production defaults. They are only
registered as a Playwright project (see `playwright.config.ts`) when all
three of these are set:

- `KATALIST_STAGING_BASE_URL`
- `KATALIST_TEST_ACCOUNT_EMAIL`
- `KATALIST_TEST_ACCOUNT_PASSWORD`

Without them, `npx playwright test` still runs the `preview-*` projects
normally; the `staging` project simply does not exist for that run (not a
failure).

`t06-rpc-readonly.spec.ts` is a read-only T06 schema/RPC and count smoke. It
also requires `KATALIST_STAGING_SUPABASE_URL` and
`KATALIST_STAGING_SUPABASE_PUBLISHABLE_KEY`, pointing to the *same isolated*
Supabase project as `KATALIST_STAGING_BASE_URL`. It signs in the configured
disposable account with `signInWithPassword` without persistent auth storage;
the account must have at least one disposable Thing. This test never deploys
migrations, changes records, or tests outsider RLS. Keep all credentials in
local environment configuration, not this repository or chat.

One disposable account is enough for this read-only RPC availability/count
check. It is **not** enough to prove cross-account RLS, membership revocation,
or account-switch isolation. Those remain explicit two-account staging gates;
do not substitute a production or customer account for the missing fixture.

The broader live checklist -- two genuine accounts switching, real unrelated
user RLS/revoked membership, duplicate daily claim across devices, actual
realtime disconnect/reconnect, media calls, migration deployment and old/new
client compatibility -- remains unimplemented or unexecuted here. Those
checks need isolated staging, disposable test users and explicit operator
deployment. Never use a real customer's account or production data.
