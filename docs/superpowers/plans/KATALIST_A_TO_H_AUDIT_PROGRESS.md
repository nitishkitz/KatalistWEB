# Katalist A–H Audit Progress Ledger

Tracks `docs/superpowers/plans/KATALIST_A_TO_H_CODE_AUDIT_AND_COMPLETION_REPORT.md`, executed in the
order specified in that report's §14. One row per audit item ID (these are the report's own IDs —
`F-01`, `H-05`, etc. — distinct from the earlier `KATALIST_D_TO_H_PROGRESS.md`'s `F01`/`H02`-style IDs).

Statuses: `not-started`, `in-progress`, `implemented-local-pass`, `implemented-deployment-pending`,
`live-acceptance-pending`, `external-gate` (needs credentials/deployment/device access this session
does not have), `verified-already-correct` (audit item found no defect on closer inspection),
`scope-decision-needed` (a real product/architecture choice, not inferred).

Baseline at start of audit execution: SHA `22b9bc3` (end of the D–H implementation pass), the exact
checkout the audit itself reviewed. `npm test`: 447/447. `npx tsc --noEmit`: 0 errors. `npm run lint`:
0 errors, 80 warnings. `npm run build:app`: clean. `npx playwright test`: 15/15.

| Audit ID | Status | Files | Commit | Verification | Remaining |
|---|---|---|---|---|---|
| F-01 | implemented-local-pass | `supabase/migrations/20260923100000_morning_brief_receipts.sql` (`claim_morning_brief`): `RETURNS TABLE` declares implicit PL/pgSQL OUT variables named `local_date`/`timezone` that collide with the table's own columns of the same name -- a bare `local_date` reference, including inside the `ON CONFLICT (...)` target list (not only WHERE/SELECT), was ambiguous and failed at **execution** time (reproduced against a real Postgres-compatible engine, PGlite, with the exact error the audit itself reported: `column reference "local_date" is ambiguous`). Fixed by targeting the unique constraint by name (`ON CONFLICT ON CONSTRAINT morning_brief_presentations_profile_id_context_local_date_key`) and qualifying every table-column reference with an `m` alias. Verified `dismiss_morning_brief` has no equivalent bug -- its local variables are `v_`-prefixed and it has no `RETURNS TABLE` OUT-parameter collision at all; confirmed via the same PGlite harness, not assumed. | (pending) | **New:** `scripts/morning-brief-receipts-sql.test.mjs` (9 tests, executing the real migration file's SQL verbatim against PGlite -- not a source-string check, not a mocked adapter: migration applies cleanly; first claim true; duplicate claim false with exactly one row; a different context claims independently; two different profiles never collide; dismiss is a safe no-op without a prior claim and sets `dismissed_at` after one; invalid context rejected by both RPCs; EXECUTE granted to authenticated/service_role only, never anon; the SELECT policy exists and scopes to `profile_id = auth.uid()`). 456/456 total tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | This PGlite harness stubs `auth.uid()` and roles -- it proves the SQL itself is correct, not deployed Supabase/RLS behavior (real `auth.uid()` integration, actual Postgres role inheritance, concurrent-transaction claim races). Live acceptance against a real deployed Supabase project is still an external gate, same as before this fix -- this closes the "the SQL is wrong" defect, not the "deploy and live-verify" gate (see F-02 onward, and the D-H ledger's F02 row). Migration was NOT applied to any database by this fix -- still prepared-only, flag still off by default. |
