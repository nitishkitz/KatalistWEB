# G03 draft: connection schema and security tests

**Status: DRAFT for review. NOT a migration, NOT in `supabase/migrations/`, NOT applied to any database, NOT reviewed.** Written 7 October 2026 after the reviewer said schema drafting need not wait for hosting or App setup. G03 is **not** complete: its gate requires review, a disposable-database run, and explicit approval before any application.

| File | Purpose |
|---|---|
| `DRAFT_code_activity_connection_schema.sql` | Five tables, flag helpers, five user functions, five server-only functions, explicit grants |
| `g03-security.test.mjs` | 16 tests on an in-memory PGlite database. Not part of `npm test` |

Run: `node --test output/code-activity-execution/g03/g03-security.test.mjs`

## Change during G04 (7 October 2026)

Added `code_activity_is_enabled(p_list_id) returns boolean` (authenticated). The capabilities route cannot tell "feature off" from "no connection" with the status function alone. One new test. Unreviewed addition; reviewers should treat it like the rest.

## Result

16 of 16 tests pass (15 before the change above). To check that the tests can fail, I broke the draft eight ways in scratch copies (nonce comparison removed from connect; verified-proof requirement removed; table revokes narrowed; server functions granted to `authenticated`; profile binding removed from list, connect and get-proof). Every mutation is caught. The first version of the suite missed the three profile-binding mutations; a test was added for them.

## What this does and does not prove

- Proves: the SQL executes; default-deny holds for `anon`, `authenticated` and `service_role` under Supabase-style default privileges (which the harness reproduces); column-limited reads; the read matrix for owner, collaborator, view_only, outsider, removed member, another owner; fail-closed flags; replay, expiry and wrong-nonce rejection; identical connect failures; the unique-index rule; the function execute matrix.
- Does **not** prove: hosted Supabase behavior (`auth.uid()`, roles and default privileges are stubbed; the real `pg_default_acl` must be inspected); PostgREST handling of column-level grants and RPC argument logging; true concurrent transactions (the "concurrent" test uses one PGlite connection and only shows the unique index and proof consumption); performance; the real GitHub flow; any route or UI.
- The helper functions (`is_list_owner`, `is_list_member`, `can_view_list`) are copied from `20260818144945_*.sql`. If they have changed since in the real database, the results do not carry over.

## Design points added in the draft for the reviewers to challenge

1. `installation_verified_at` on proofs, set only by a server-only function, required by `code_activity_connect`. This closes the gap where the narrowed-token check was route-only and a direct RPC call could skip it.
2. `service_role` has no table privilege on these tables. All server work uses server-only functions that re-check ownership, archive state and flags, because they have no `auth.uid()`.
3. Wrong nonce hash on consume does not burn the state, so a stray request cannot deny the owner. A mismatch on `connect` raises the same error as every other failure.
4. `code_activity_enabled_for` includes membership, so it cannot be used to probe the allowlist.
5. Disconnect requires the flags to be on (v3 rule). That means an owner cannot disconnect while the feature is switched off. Should a kill switch still let owners disconnect?
6. Start refuses when a live connection exists, and is limited to 5 per 10 minutes per profile.
7. No settings rows are seeded, so a fresh database is off.

## Not in this draft

Consent table and the View Only boolean (G14), changes and checks (G07), deliveries (G11), budget and leases (G12), confirmations (G15), retention jobs, and any seed or operator procedure for flags.
