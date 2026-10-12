# Coey / Magic Box test evidence

Branch: `manus/phase1-magic-box-assistant-20261011`
Base commit: `1b6b23fb` (the assistant work is uncommitted on top of it)
Recorded: 2026-10-12
Environment: unit tests with mocks, a local production build, and a live run against the local app on Katalist_uat (`jrdsmmiggezrhiakncwc`) signed in as the approved operator (profile "Nithesh", timezone Asia/Kolkata).

## Automated results

| Gate | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Exit 0 |
| `npm run build` | Pass; no Sarvam key name or `ASSISTANT_ACTION_SECRET` in `dist/` |
| Assistant tests (`scripts/assistant-*.test.mjs`) | 47 of 47 pass |
| Full `npm test` | 1,435 of 1,471 pass; 36 failures, none in assistant code and none new compared with the earlier run (Code Activity, Court detail source checks, thing-detail comment drafts, Magic Box destination race, repo-wide style rules). One earlier failure passed on rerun, so it looks timing-dependent. Not compared with a clean checkout of the base commit. |

## Plan coverage

Status key: **Auto** = covered by an automated test that passes. **UAT** = needs the approved account and a running app, not yet run. **Gap** = not covered.

| Plan section | Status | Notes |
|---|---|---|
| 4.1 Intent classification | Auto | Defect found and fixed: "reminder" was classed unsupported. |
| 4.2 Facts builder counts and edge cases | Auto | Exactly 100 and 99 Things, empty scope, missing and invalid timezone, invalid due dates, and live count match. |
| 4.3 Scope facts, RLS, cross-context | UAT | Scope resolution logic is Auto. RLS needs a second real user. |
| 4.4 Answer generation, fallbacks, injection, citations | Auto | 429, HTML reply, bad JSON, network failure, abort, fabricated ids, instruction-like titles. |
| 4.5 Nudge eligibility | Partial | RPC-eligibility and cooldown paths Auto. Self-nudge and owner-versus-assignee cases need UAT. |
| 4.6 Phase 1 UI | UAT | Not run in a browser. |
| 5.1 to 5.5 Conversation | Partial | Prompt history bound (six turns) Auto. Server-side discarding of invalid history turns, context-switch isolation and the failure scenarios are Gap or UAT. |
| 6.1 to 6.5 Scope intelligence | Partial | Matching, ambiguity, archived, other-context and missing names are Auto. Lifecycle changes mid-request and UI are UAT. |
| 7.1 to 7.5 Action engine | Partial | Preview, confirm, stale rejection, tamper, idempotent replay, partial success and cooldown are Auto. Expiry, logout and permission-change cases are Gap. |
| 8.1 to 8.4 Activity and collaboration | Partial | Window parsing by timezone, summaries, bounded reads and answer footer are Auto. Real restricted or deleted records need UAT. |
| 9.1 Performance | UAT | Not measured. |
| 9.2 Payload limits | Auto | Question length, citation cap, answer length. |
| 9.3 Security | Partial | Bundle scan and 401 handling Auto. Cross-user and RLS checks need UAT. |
| 9.4 API robustness | Auto | Invalid JSON and empty body return 400, bad auth returns 401, bad UUIDs and action types are rejected, database failure returns JSON, oversize bodies return 413, history sanitizing is unit-tested. Wrong HTTP method is P3 D9. Verified live as well. |
| 9.5 Resilience | Partial | Offline then recovery and rapid asks verified live (defect D5 fixed). Sleep/wake, slow network, session expiry mid-request and Work/Home switching mid-request not run. |
| 10.1 to 10.4 Browser matrix, visual, accessibility, golden paths A to F | Partial | Chromium desktop and mobile, axe, keyboard flow, golden paths A, B, E, F (read-only) and D (stale action, via API) run live. Path C (real nudge Confirm) not run. Safari, tablet and wide viewports not run. |

## Live UAT run (operator account, Katalist_uat)

Fixtures: the operator's existing data (3 Work Lists including two named "Nithesh", 1 Bucket "TOP20", 23 Things, no Home data) plus disposable Things named `QA-COEY-UAT-<timestamp>-n`, all cancelled afterwards. Scripts are kept outside the repository.

| Area | Result |
|---|---|
| Counts vs database (active 21, overdue 7) | Pass |
| Work/Home isolation (Home facts empty, no Work Thing ids) | Pass |
| Named List, named Bucket (direct-items note), duplicate names (selection card with detail), unknown name, foreign id (404), cross-context id (404) | Pass |
| Follow-ups, activity windows stated in Asia/Kolkata, nudge list only offers eligible people | Pass |
| No secrets in responses; 401 without auth; 400 invalid JSON; 413 oversize; 400 over-length question; 429 rate limit | Pass |
| Actions: Cancel changes nothing; concurrent and repeated Confirm apply once (1 activity event); re-preview reports already up to date; stale change rejected with 409; partial success reported per Thing; add-to-Bucket and duplicate; forged token 400 | Pass (13 of 13 after fix D4) |
| Browser, desktop 1440x900 and mobile 390x844: Ask mode, answer, follow-up, rapid asks end on the last answer, scope card by keyboard, scope kept for follow-ups, offline error then recovery, close, no page errors, axe | Pass (32 of 32 after fixes D5 to D8) |

Not run live: a real nudge Confirm (the Court shows nudgeable teammates, and sending would notify them), expired confirmation (covered by unit test), permission loss and cross-user checks (need a second account), Safari, other viewports, performance measurements, reduced motion.

## Defects found

| ID | Severity | Finding | Status |
|---|---|---|---|
| D1 | P2 | "Who needs a reminder?" fell back to unsupported instead of the nudge intent. | Fixed |
| D2 | P2 | Invalid JSON or a null body returned 502 or a server error instead of a 400. | Fixed (all four assistant routes) |
| D3 | P2 | `MagicBoxAssistant.tsx` used sub-12px text and a shadow that the repo style tests reject. | Fixed |
| D4 | P1 | Action preview showed "Ready" for status changes the database would refuse: `set_work_status` allows only not started and in progress, only for the current assignee, and only after a Catch. Confirm then failed. | Fixed: preview rejects uncaught Things and non-assignees; "sorted" removed from assistant statuses |
| D5 | P1 | Offline, the Ask panel stayed on "Checking your Things…" because the query paused instead of failing. | Fixed (`networkMode: "always"`); verified live |
| D6 | P2 | The "Checked …" footer failed color contrast (2.63:1). | Fixed; axe clean |
| D7 | P2 | In Ask mode, the Toss "Yes, assign to <name>" suggestion appeared when the question contained a name. | Fixed: shown only in Toss mode (`MagicBox.tsx`) |
| D8 | P3 | Scope-selection and not-found answers showed a meaningless "Checked … UTC" footer. | Fixed |
| D9 | P3 | A GET to `/api/assistant/query` returns the app page with 200 instead of 405. | Open; framework fallback, the app only sends POST |

## Known limits

- Rate limits and the facts cache are per server instance, not global.
- Idempotency for confirmed actions is held in memory per instance. The state re-check and nudge cooldown are the backstop across instances.
- No feature flag or telemetry exists for the assistant.
- The 36 unrelated full-suite failures have not been triaged or compared with a clean checkout.
- The auth page now shows an "Open Katalist" step after sign-in; automated sign-in must click it.

## Hybrid conversation and voice work (2026-10-12)

Details, exact results, limits and the unverified items (live text turns, authenticated voice, Sarvam STT/TTS, latency) are in `output/coey-acceptance/results.md`, with the deployed WebSocket transport record in `output/coey-acceptance/transport.md`. Test counts at that point: assistant tests 154 of 154, Playwright (mocked server, Chromium desktop and mobile) 22 of 22, full suite 1,542 of 1,578 with the same 36 failures as the baseline above.
