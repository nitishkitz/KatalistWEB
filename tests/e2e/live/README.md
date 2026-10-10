# Live two-account harness (READY-01 / READY-02 subset)

Independent browser contexts for Account A (operator) and Account B (CHRI),
signed in by phone and the supplied test code. Registered as the Playwright
project `live` only when every variable below is set. Nothing is stored in the
repository; storage state is never written to disk.

| Variable | Purpose |
| --- | --- |
| `KATALIST_LIVE_TARGET_APPROVED=true` | Explicit acknowledgement that the target is approved for QA writes |
| `KATALIST_LIVE_BASE_URL` | Deployment under test (no trailing slash) |
| `KATALIST_A_PHONE`, `KATALIST_B_PHONE` | National numbers, supplied privately. `KATALIST_A_DIAL` / `KATALIST_B_DIAL` default to `+91` |
| `KATALIST_LIVE_OTP` | The supplied test code |
| `KATALIST_A_NAME`, `KATALIST_B_NAME` | **Required.** Expected Me-page names; a mismatch aborts before any write. Traces, screenshots and video are disabled for this project |
| `KATALIST_B_HANDLE` | B's name as shown in the `@` picker (needed for assignment and mention checks) |
| `KATALIST_LIVE_BUILD`, `KATALIST_LIVE_TIMEZONE`, `KATALIST_LIVE_RUN_ID` | Recorded in every observation; run id feeds the `QA-YYYYMMDD-runNN-` prefix |

Run: `npx playwright test --project=live`

Phone sign-in exists only when the target sets `VITE_KATALIST_FIXED_OTP`. If it
does not, the specs skip as BLOCKED. Never enable a fixed code on production
to make testing easier.

Outputs (git-ignore or review before sharing): `test-results/live/observations.jsonl`
(one record per check, PASS/FAIL/BLOCKED, no credentials) and
`test-results/live/fixture-ledger.csv` (every QA record created, for cleanup).

Covered: checks 1, 2, 4, 6, 8, 9, 10, 13, 14, 17, 20. Not automated: 3, 5, 7,
11, 12, 15, 16, 18, 19, 21-30 (several need product decisions D01, D04 or
extra fixtures C/V/X). Check 14 asserts delivery of the mention, not push
or notification delivery.
