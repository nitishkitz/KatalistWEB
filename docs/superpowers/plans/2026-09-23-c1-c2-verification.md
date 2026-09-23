# C1/C2 Verification Log

Date started: 2026-09-23
Baseline: `f9754233ec271f58494e67d019cc58f4df0f815d` on `katalist-plan/batch-a-baseline`

Recorded per the plan's verification matrix (§14). Each row is filled in as the corresponding step lands — a blank/`not run` entry is a verification limitation, not a claim of success. Automated evidence is only recorded after the test file is created and independently rerun; browser/staging evidence is only recorded after an actual manual/browser session, never inferred from mocked timings.

| Scenario | Automated evidence | Browser/staging evidence |
|---|---|---|
| Filter-preserving List detail | Not run | Not run |
| Required read failures | `fetch-buckets-error-propagation.test.mjs`, `map-list-rows-error-propagation.test.mjs`, `fetch-court-error-propagation.test.mjs` — all pass, all independently verified to fail against pre-fix source | Not run |
| Actor cache | Not run | Not run |
| 20-event burst | Not run | Not run |
| Route changes (controller mount/dispose) | Not run | Not run |
| Account A→B | Not run | Not run |
| Work→home | Not run | Not run |
| Reconnect | Not run | Not run |
| Membership removal | Not run | Not run |
| Chat duplication | Not run | Not run |
| Batch B compatibility (optimistic/claim/rollback) | 243/243 full suite passing at `f975423` (includes pre-existing Batch B tests) | Not run |
| Large datasets (request/payload counts, pagination merge) | Not run | Not run |

## Per-checkpoint command log

Run at every implementation checkpoint (plan §14):

```sh
npm run typecheck
npm test
npm run lint
npm run build:app
git diff --check
```

| Date | Commit | typecheck | test | lint | build | diff --check | Notes |
|---|---|---|---|---|---|---|---|
| 2026-09-23 | `f975423` | pass | 243/243 | 0 errors, 80 warnings | pass | not run this pass | Baseline for P0; no code changed in P0 itself |

## Deferrals accepted so far

- Actor caching lifecycle (P4) — deferred pending P3 design review, not implemented.
- Route-level request-count/latency/scaling measurement — deferred pending a safe staging/browser environment.
- Summary/detail separation, bounded attachments/activity, pagination (P5) — not started.
- `use-trophy.ts` decorative-stat error swallowing — deferred as out of the bucket/Thing/List/Court scope.
