# Katalist comprehensive testing plan

Authored 10 October 2026 from the application domain, routes, source and existing test inventory. **420 authored cases in 42 areas: 100 P0, 293 P1, 27 P2. All are NOT_RUN.** These counts describe a catalog, not executed coverage. This deliverable adds no app implementation and makes no claim that every possible bug has been found.

The objective is to uncover fundamental failures across complete user journeys, beyond the reported issues, with repeatable evidence on both ends of a collaboration. A finite plan reduces risk; it cannot guarantee nobody will ever encounter a bug.

## Files and starting point

- BEGINNER_START_HERE.md: two-account setup and first 30 practical checks.
- TEST_CASES.md / TEST_CASES.csv: detailed actions, expected results, prerequisites and source candidates for 420 cases.
- EXECUTION_TRACKER.csv: one initial NOT_RUN row per case. Add separate rows for each build/device/role/attempt; retain earlier failures.
- QA_IMPORT.csv: 420 cases in the app's QA importer column format. It contains definitions, not execution results. Platform is initially web; extend cases for supported native/platform-specific builds after approval.
- EMERGENT_AUTOMATION_PROMPT.md: reusable agent instructions independent of vendor-specific features.
- COVERAGE.json / catalog.txt: authored counts and editable catalog.

A is your confirmed account; B is CHRI's confirmed account. Supply credentials privately at runtime. Do not put phone numbers, OTPs, session tokens or provider secrets into files, screenshots, recordings, commit history or test output. Verify identity through Me and trusted test-session metadata before a mutation. The earlier name Narayana is not an additional account in this plan.

## Preconditions and safe fixtures

Use a known build with its exact commit, backend project, migrations, feature flags, timezone and providers recorded. Prefer isolated staging. Live checks are limited to approved A/B accounts and labelled disposable QA records. Use a run prefix `QA-YYYYMMDD-runNN-` and a fixture ledger containing entity IDs, creator, permitted participants, context and planned cleanup. Preserve all unrelated data.

Create fixtures: A owner; B collaborator/assignee; C unrelated outsider; V view-only member; X previously allowed then removed. These extra accounts require approved test credentials. Do not substitute real uninvolved people. A/B prove collaboration flows; they do not prove outsider denial, first-time onboarding or all List role combinations.

Prepare private and shared Lists, Work and Home tasks, one Bucket/note per permitted context, direct and List/group conversations, and Things in waiting, caught, in-progress, sorted and cancelled states. Include empty, one-item, 25-item, 250-item and 2,500-item datasets for volume checks in staging. Use harmless image/PDF/DOCX/video and malformed files, files exactly at and above configured byte limits, Unicode text, long titles, URL/reference fixtures and expired/revoked Bridge tokens. Keep destructive cleanup confined to fixture IDs.

Use controlled clocks for parser, reminders, expiry and cooldown unit/integration tests. Exercise real saved scheduling on staging as well. Freeze a stated instant and timezone; do not bake today's date into tomorrow assertions. Test Asia/Kolkata and America/New_York, including daylight-saving transitions. Enable interception for deliberate delay, disconnect, 4xx, 5xx and ambiguous mutation responses; remove it before live provider verification.

Google Contacts requires configured OAuth client/secret/origin and the contacts migration. Use separate disposable Google address books and explicit account consent. Missing configuration is BLOCKED for real sync, not a passing mock. Calls/push need configured providers, browser/device permissions and actual supported devices. CODE and QA are feature gated; document which release enables them. Test disabled-state gating; mark disabled execution cases N/A only with explicit scope approval. If enabled for release, successful mocks cannot replace actual provider checks.

## Product oracle and decisions

Use approved requirements as the expected result. Source code is evidence of current behavior, not authority that a known defect is correct. For each open decision, record owner, chosen rule, examples, approval date and affected IDs; revise the case version before execution. Cases affected by unresolved rules are BLOCKED/SPEC_REQUIRED.

| Decision | Rule to resolve before asserting a pass |
|---|---|
| D01 | AM/PM interpretation of “6 o'clock”; whether to clarify; untimed due-date default (current parser tests use 22:00); weekday/end-period precedence; skipped/repeated DST times. Explicit 6 PM must save 18:00. |
| D02 | Description create/edit visibility, permitted editors, persistence and empty state. |
| D03 | Approved external status copy and styling: user requested “In Progress” in orange, even though internal enum remains `under_progress`. Color must not be the only status cue. |
| D04 | Sorted destination and recovery; cancellation reopen; List/Bucket archive/restore and destructive retention. Current reopen endpoint is owner-only for cancelled Things; it does not establish Sorted restoration. |
| D05 | Exact snooze rules for due time, personal pace, wake-up and notifications. |
| D06 | Shred versus personal hide, audience, recoverability and terminal-state behavior. |
| D07 | Plain typed `@name` versus selected structured mention; supported surfaces, audience and delivery deduplication. |
| D08 | Expiry/revocation policy for already issued signed file URLs. Do not assume access is instantly revoked without this policy. |
| D09 | Ownership transfer and removal rules, including last owner and dependent work. |
| D10 | Bucket progress denominator: sorted/cancelled items, duplicates and associations. |
| D11 | Rich note simultaneous-edit/conflict behavior and unsaved navigation handling. |
| D12 | Call room removal, leave, reconnect and participant authorization lifetime. |
| D13 | Nudge cooldown, escalation windows, notification and quiet-hour behavior. |
| D14 | Which composers permit reference-only submissions and reference limits. |
| D15 | Supported hardware/browser versions, network profile and approved performance/delivery SLOs. |

Known reported defects are regression targets, not the entire scope: 6 o'clock becoming 10 PM; missing description; status copy/color; mention selection/delivery; outgoing assignments incorrectly staying in personal Now or hiding the assignee; discoverability/recovery of Sorted Things; and visible Work/Home separation. Contacts must come from a user's own sync or explicit permitted connection, not all registered Katalist users.

## Workflow and authorization matrix

The application separates ownership, assignment, acknowledgment, work status, owner importance and personal pace. Test each dimension independently, then combine them in journeys. Confirm server authorization through permitted test APIs/database policies as well as visible controls.

| State or transition | A owner side | B assignee side | Persistence/negative check |
|---|---|---|---|
| A creates and assigns B | Outgoing/With Others; visible B assignee | Incoming waiting for Catch | Exactly one record; not A's personal lane merely because A created it |
| B catches | A sees caught acknowledgment | Catch completes and permitted work controls appear | Refresh/realtime match; outsider cannot Catch |
| B chooses personal Now/Next/Later | A's owner importance remains separate | B's lane reflects personal pace | Reassignment and retry preserve documented settings |
| A changes due/importance | Owner control succeeds | Updated owner metadata appears | B cannot gain owner-only edit powers |
| B starts work | Visible In Progress/orange | Same state and actor activity | Internal enum and display copy remain consistent |
| B marks Sorted | No active outgoing work | No active personal work | Discoverable history; terminal controls and D04 recovery |
| A cancels | Owner cancellation | Terminal state reflects on B | Non-owner denial; comments/files follow retention rule |
| A reopens cancelled | Current endpoint allows owner | Expected waiting acknowledgment | Deny non-owner and Sorted requests unless contract changes |
| A/B reassign eligible active task | Owner or caught assignee capability as defined | New assignee receives appropriate acknowledgment | Former assignee visibility/actions follow contract; stale controls rejected |

| Role | Baseline to verify |
|---|---|
| Thing owner | Due/importance/assign, cancel and cancelled reopen where active/terminal rules allow |
| Waiting assignee | Catch; cannot skip required acknowledgment through hidden API controls |
| Caught assignee | Personal pace, permitted work status/Sort and reassignment |
| Creator only | No owner/assignee workflow rights merely from creating the record |
| List owner | Administer members/roles and permitted resource actions |
| List collaborator | Permitted chat and workflow actions; no owner administration |
| List view-only | Permitted read/comments; no collaborator chat/workflow rights |
| Outsider / removed member | No protected content/actions, including direct IDs, references, files, realtime and exports |

Access can depend on shared List membership, not just assignment. Evaluate each fixture's explicit visibility contract before calling post-reassignment access a leak. Frontend capability flags alone do not prove server authorization. Reject spoofed actor IDs and unauthorized resource IDs; test stale sessions after permission changes.

## Test layers and current gaps

1. Domain/unit: natural-language parsing, state transitions, capabilities, due dates/timezones, unread and notification models, references, retry/rollback and QA import/export. Assert behavior at boundaries, not just copied implementation details.
2. API/database integration on isolated staging: session-derived actors, row-level visibility, cross-account writes, constraints, retries, transactional consistency, private storage/signing and revoked membership. Use approved credentials; do not run intrusive unauthorised scans.
3. Browser journeys: independent A/B contexts, actual forms, saved details, realtime observation before refresh, refresh consistency, keyboard and responsive layouts.
4. Provider/device: real Google OAuth/address book, pushes, call audio/video and media lifecycle, GitHub consent/integration when enabled. Distinguish fixture/unit checks from provider success.
5. Human exploration: ambiguous wording, onboarding comprehension, descriptions/Sorted recovery, touch behavior, screen reader, audio quality and realistic interruptions.

Repository entry points: `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. Before running commands, inspect package/config/env to confirm isolation; do not treat existing local env as safe staging. Use demo mode and an unreachable fixture backend for local preview where configured. Preview mutations are local demo writes, not proof of live persistence.

Current Playwright configuration has Chromium-based desktop/tablet/large-screen previews and optional phone viewport (`KATALIST_INCLUDE_PHONE_VIEWPORT=true`). Firefox and WebKit need explicit new projects for the proposed browser matrix. Emulated phone viewport is not physical iOS/Android verification.

Existing isolated staging configuration is gated by `KATALIST_STAGING_ISOLATED`, base URL, Supabase URL/publishable key and email/password test-account variables. It is a single-account email/password harness. Add a secure two-account phone/OTP harness for this plan; do not claim the existing configuration already tests A/B phone login. If staging variables are absent, the project may not register at all: that is missing execution, not success.

Candidate source/test filenames in the catalog are traceability leads. Confirm they exist, exercise the same requirement and have meaningful assertions before crediting coverage. Previous limited Contacts checks or partial test logs do not establish current build coverage. This plan reuses no earlier pass results as current execution evidence.

## Browser, device and data matrix

Core A/B journeys should run desktop Chromium, Firefox and WebKit in isolation. Test desktop widths 1280/1440, full HD 1920, tablet 768×1024 and 1024×768, phone 390×844 and a smaller supported width. Add actual Android Chrome and iOS Safari for touch, file pickers, calls, permission prompts and background/push behavior. Record exact browser/OS versions. Include portrait/landscape, zoom 200%, keyboard-only, screen reader, reduced motion, denied permissions and slow/intermittent connection.

For each core action vary: Work/Home, self/other assignee, private/shared resource, owner/collaborator/viewer/outsider/removed member, waiting/caught/progress/terminal, zero/one/many records, empty/long/Unicode input, online/offline/retry, same tab/second tab/refresh/new session. Use pairwise combinations for ordinary axes, exhaustive targeted combinations for permission and state boundaries. The 420 cases are base scenarios; every browser/role/timezone combination is a separate execution row, not a fabricated extra authored case.

## Execution stages and stopping rules

| Stage | Work | Exit evidence |
|---|---|---|
| 0: Inventory | Confirm build, routes, flags, schema, safe data and open decisions | Versioned fixture ledger; known enabled scope; no hidden dependencies |
| 1: Smoke | Beginner checks 1–14, capture/login/assignment/core details | Basic A/B flow works; failure evidence captured immediately |
| 2: Foundations | AUTH, CTX, CAP, NLP, TIME, ASSIGN, WORK, PACE, DETAIL, COMMENT, MENTION | Persisted behavior matches both users; no critical data/permission defect |
| 3: Collaboration | FILE/FILESEC, LIST/MEMBER, BUCKET/NOTE, CHAT/READ, NOTIFY/NUDGE/BRIEF | Role boundaries, notification delivery, no duplicate/lost data |
| 4: Integrations | GCONTACT/CONNECTION, CALL/CALLFAIL, REF, DESIGN, enabled CODE/QA, BRIDGE | Actual configured provider checks and documented disabled-scope decisions |
| 5: Resilience | AUTHZ, IDENTITY, RECOVERY, ARCHIVE, PROFILE | Isolation under switch/revocation/retry and clear recovery |
| 6: Quality | A11Y, DEVICE, PERF, DEPLOY and exploratory charters | Supported-platform evidence; approved performance budget and release validation |
| 7: Fix verification | Reproduce defect, fix with authorization, targeted test then affected journeys | Original reproducer passes on new build; no linked regression |

Stop dependent mutations if login identity, backend isolation or permission validation fails. Continue independent read-only checks and unaffected modules. Batch execution in groups of about 20 cases with durable reporting; a failed check must not abort all unrelated coverage. Snapshot created IDs before cleanup. Preserve failure attempts and rerun affected cases after changes instead of overwriting history.

## Results, bug reports and release gates

Statuses: NOT_RUN (never executed on this target), PASS (observed all expected assertions), FAIL (observed deviation), BLOCKED (cannot execute or oracle undecided), N/A (documented approved scope exclusion). Never convert a timeout or missing element to PASS by catching the exception. If mocks pass and live verification is blocked, record both separately. Do not infer a PASS from a successful HTTP response without checking saved state and participant visibility.

Each execution row needs case/version, build/commit, environment/backend, role/account alias, context, browser/device, attempt, timestamp, actual result and sanitized evidence. For live A/B changes, record before/after observation in both profiles and post-refresh state. Evidence can include screenshots, recording, sanitized request/response, console error and approved persistence verification. Redact authorization headers, tokens, private data and credential-bearing URLs.

Bug template: ID; severity; affected requirement/cases; build/env; reproducible fixture IDs; prerequisites; exact steps; expected; actual; frequency; A-side/B-side screenshots; console/network/persistence evidence; workaround; suspected scope; assignee; retest build/status. Group duplicates by root cause while retaining each affected case. P0 is critical data loss, access/identity leak or inability to complete fundamental flows; P1 blocks major supported behavior; P2 is a smaller supported defect. Case priority is risk-based, while observed defect severity is assigned from impact.

Suggested release gate: all enabled-scope P0 and P1 cases executed; no open P0/P1 failure; no unexplained NOT_RUN, BLOCKED or N/A in required critical journeys. Product owner must explicitly accept residual P2 risk and approved exclusions. Require passed auth/permissions, cross-account assignment/comment/persistence, context isolation, core files and recovery on the candidate build. Enabled integrations need real-provider evidence. Typecheck/build and relevant automated suites must pass or have an explicitly accepted existing blocker recorded; a stale successful build is insufficient. Performance cannot pass against D15 until budgets are approved. QA UI allowing a run to close with blocked cases does not override this stricter release gate.

Report denominator honestly: authored, applicable, attempted, passed, failed, blocked, not run and excluded; calculate pass rate against applicable and attempted separately. No “100% tested” while required role/device/provider variants or cases are missing.

## Exploratory sessions beyond scripted cases

Run focused 30–45 minute charters: a new user trying to find Sorted history; an owner delegating and then changing their mind; an assignee working from phone with poor signal; a person switching Work/Home during an upload; a removed member using an old deep link; two tabs editing or sorting the same task; simultaneous note editing; a call interrupted by permissions or backgrounding; Google sync after deleting/revoking a contact; long conversations with attachments and references. Record observations, confusion and newly discovered requirements. Add each reproducible new bug as a versioned regression case instead of claiming the initial catalog exhausted all behaviors.

## Catalog inventory

| Code | Area | Cases |
|---|---|---:|
| AUTH | Phone sign-in and session | 10 |
| ONB | Welcome and onboarding | 10 |
| NAV | Navigation and global capture | 10 |
| CTX | Work and Home separation | 10 |
| CAP | Magic Box task capture | 10 |
| NLP | Natural-language date and text interpretation | 10 |
| TIME | Timezones and scheduled boundaries | 10 |
| ASSIGN | Assignment and reassignment | 10 |
| WORK | Catch and work-status lifecycle | 10 |
| PACE | Owner importance and personal pace | 10 |
| DETAIL | Thing details and descriptions | 10 |
| COMMENT | Thing comments and drafts | 10 |
| MENTION | People mentions and delivery | 10 |
| FILE | Attachment upload and previews | 10 |
| FILESEC | Private file authorization and unsafe content | 10 |
| LIST | Lists and resource details | 10 |
| MEMBER | List membership and role controls | 10 |
| BUCKET | Buckets and task organization | 10 |
| NOTE | Bucket notes and rich-text editing | 10 |
| GCONTACT | Google Contacts sync and discovery | 10 |
| CONNECTION | Contact requests and invitations | 10 |
| CHAT | Direct and group conversations | 10 |
| READ | Unread counts and reading behavior | 10 |
| CALL | Two-account call basics | 10 |
| CALLFAIL | Call permission and recovery failures | 10 |
| NOTIFY | In-app and push notifications | 10 |
| NUDGE | Nudges and escalation | 10 |
| BRIEF | Morning Brief and Catch Up | 10 |
| PROFILE | Me page and preferences | 10 |
| ARCHIVE | Sorted, cancelled and personal hiding recovery | 10 |
| REF | Thing references and permalinks | 10 |
| DESIGN | Design library and covers | 10 |
| CODE | Code Activity and Coey optional workflow | 10 |
| QA | Manual QA cases, runs and evidence | 10 |
| BRIDGE | External Bridge access tokens | 10 |
| AUTHZ | Application-wide permission matrix | 10 |
| IDENTITY | Account switching and realtime isolation | 10 |
| RECOVERY | Network errors, retries and data integrity | 10 |
| A11Y | Keyboard and assistive access | 10 |
| DEVICE | Responsive and cross-browser behavior | 10 |
| PERF | Large-data performance and lifecycle | 10 |
| DEPLOY | Build, migrations and release validation | 10 |

## Added automation and live-verification work

See [AUTOMATION_READINESS.md](AUTOMATION_READINESS.md) and [READINESS_TRACKER.csv](READINESS_TRACKER.csv). They track 11 open readiness items: independent A/B phone login plus the ten identified gaps. These are linked prerequisites and acceptance gates for the existing 420 cases; the case count and NOT_RUN statuses are unchanged. Missing automation, existing but unverified integrations, and missing platform coverage are tracked separately.
