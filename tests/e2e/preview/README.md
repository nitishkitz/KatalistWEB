# Preview E2E specs

Every spec in this directory is read-only and unauthenticated by contract:
no sign-in, no Thing/List/Bucket creation, no writes. That is what makes
them safe to run in CI with no real Supabase project at all -- only
syntactically-valid `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`
values are required so the client constructs without throwing (confirmed
directly: fixture values like `https://ci-fixture.supabase.co` /
`ci-fixture-anon-key`, an unreachable host, are sufficient; the app never
needs those calls to actually succeed for these specs to pass). Locally,
these specs run against whatever real project `.env.local` points at.

Write-safety here comes from each spec's own read-only contract, not
network-level request blocking -- a blanket same-origin request blocker was
tried and reverted (see smoke.spec.ts's own comment) because it also broke
Vite's dev-server inspector/HMR requests, failing the "no console errors"
assertion. A future spec that needs stronger isolation should scope any
blocking to specific third-party hosts, not every non-baseURL request.

A new spec belongs here only if it stays true to the read-only contract.
Anything that needs a real signed-in session, real data, or performs a
write belongs in `tests/e2e/staging/` instead, gated on
`KATALIST_STAGING_BASE_URL` / `KATALIST_TEST_ACCOUNT_EMAIL` /
`KATALIST_TEST_ACCOUNT_PASSWORD` per `playwright.config.ts`.
