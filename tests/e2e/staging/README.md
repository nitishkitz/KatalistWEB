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

This directory intentionally has no specs yet. Per the D-H plan's own H04
section, the live checklist it covers --  two genuine accounts switching,
real RLS and revoked membership, duplicate daily claim across devices,
actual realtime disconnect/reconnect, media calls, staging migrations,
old/new client compatibility -- needs a real staging deployment and a
disposable test account to write against safely. Do not point
`KATALIST_TEST_ACCOUNT_*` at a real user's credentials or run these against
production data.
