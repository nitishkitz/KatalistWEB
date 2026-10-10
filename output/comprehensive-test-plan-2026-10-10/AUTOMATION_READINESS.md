# Automation and live-verification readiness backlog

Added 10 October 2026: **11 tracked items** — multiple-account login plus the ten identified testing gaps. These are readiness work items linked to the existing 420 cases, not 11 extra executed tests or proof that the application features are absent.

All work items are OPEN and their acceptance verification is NOT_RUN. Mixed states distinguish missing automation from existing implementation that still needs live evidence. Source/test existence is not a pass.

Use READINESS_TRACKER.csv to assign an owner, record builds, dependencies, blockers and sanitized evidence. A is your account; B is CHRI. Credentials stay outside the files.

## Recommended order

Start READY-01, then READY-02/03/04. Add READY-05/06 for realtime and race resilience. Prepare READY-07/08/09 provider/device prerequisites independently. Run READY-10 across supported platforms. READY-11 is a release gate requiring separately authorized migration/deployment work. This documentation update authorizes no deployment or new app implementation.

## READY-01 — Independent A/B phone login (P0)

Current state: **NOT_IMPLEMENTED**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Existing staging harness uses one email/password account; two-account phone/test-code automation is missing.

Linked catalog modules: AUTH, IDENTITY

Prerequisites: Approved isolated target; runtime-only A/B credentials

Required work: Add separate browser contexts, phone verification helpers, identity assertions and secure runtime credential inputs.

Completion criteria: Both accounts sign in concurrently as their own identities; closing or logging out A does not change B; saved auth and test artifacts contain no credentials.

Unblocks: READY-02, READY-03, READY-04, READY-05, READY-06, READY-08

## READY-02 — Both ends of the task lifecycle (P0)

Current state: **LIVE_AUTOMATION_MISSING**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Local/domain tests do not establish persisted two-user workflows.

Linked catalog modules: CAP, ASSIGN, WORK, PACE, DETAIL, ARCHIVE

Prerequisites: READY-01; disposable tasks and approved lifecycle oracle

Required work: Automate A creates/assigns B, B catches/starts work/sorts, and permitted cancellation/reopen. Observe both users before and after refresh.

Completion criteria: Correct owner/assignee, acknowledgment, independent pace/importance and activity; A outgoing task is not incorrectly in personal Now; terminal task remains discoverable.

## READY-03 — Outsider, viewer and removed-member permissions (P0)

Current state: **STAGING_CHECKS_MISSING**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: The current staging RPC smoke does not prove outsider RLS or revocation.

Linked catalog modules: AUTHZ, MEMBER, FILESEC, BRIDGE

Prerequisites: READY-01; approved C/V/X accounts and resource fixtures

Required work: Add server/API/storage/realtime denial checks and role-specific UI assertions using approved test accounts.

Completion criteria: Allowed roles succeed; outsiders and removed users cannot read/mutate protected IDs, sign private files or receive protected events; viewer rights match the contract.

## READY-04 — Account switch and identity isolation (P0)

Current state: **LIVE_VERIFICATION_OUTSTANDING**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Identity-focused tests exist; complete live session switching evidence is outstanding.

Linked catalog modules: IDENTITY, COMMENT, NOTE, READ

Prerequisites: READY-01; delayed requests and account-private fixtures

Required work: Automate A to B switch in one profile during drafts, uploads and delayed reads; compare an independent session.

Completion criteria: No A drafts, private files, responses, unread counts or mutations leak into B; stale completions cannot write under a new identity.

## READY-05 — Realtime disconnect and reconnect (P1)

Current state: **LIVE_VERIFICATION_OUTSTANDING**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Preview/model checks do not establish real cross-account subscription recovery.

Linked catalog modules: READ, CHAT, ASSIGN, RECOVERY

Prerequisites: READY-01; real isolated backend and controlled network interruption

Required work: Disconnect B, mutate fixtures as A, reconnect B and compare live state with refreshed persisted state.

Completion criteria: No lost or duplicated events; accurate task state, comments and unread counts; subscriptions recover without stale unauthorized content.

## READY-06 — Duplicate actions across tabs and devices (P0)

Current state: **LIVE_VERIFICATION_OUTSTANDING**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Cross-tab/unit protections need live multi-session race verification.

Linked catalog modules: RECOVERY, BRIEF, COMMENT, WORK

Prerequisites: READY-01; two A tabs/devices and B observer

Required work: Race capture, comments, Catch/Sort and daily claims; introduce ambiguous server responses and retry.

Completion criteria: Exactly-once effects where required; no duplicate claims/records or lost updates; conflict/retry messages are truthful and persisted state agrees across users.

## READY-07 — Real Google Contacts private sync (P0)

Current state: **IMPLEMENTED_NOT_LIVE_VERIFIED**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Contacts implementation and focused tests exist; real OAuth and deployed migration verification are outstanding.

Linked catalog modules: GCONTACT, CONNECTION

Prerequisites: Configured OAuth; applied contacts migration; consented disposable address books

Required work: Verify migrations/configuration; perform real A/B OAuth, sync, repeat sync, denial/revocation and permitted contact matching.

Completion criteria: Only each user's synced or explicitly permitted contacts appear; no global registered-user import; no duplicates or private address-book cross-account leakage.

## READY-08 — Real calls and media recovery (P1)

Current state: **PARTIAL_TESTS_NOT_DEVICE_VERIFIED**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Call lifecycle tests exist; actual audio/device and failure recovery evidence is outstanding.

Linked catalog modules: CALL, CALLFAIL

Prerequisites: READY-01; configured provider; approved media/device access

Required work: Call A/B, accept, verify audio, mute/end; deny permissions, interrupt network/background and test room membership changes.

Completion criteria: Intended participants only; media works; errors recover clearly; ending releases microphone/media and room state; revocation follows approved D12.

## READY-09 — Actual push delivery (P1)

Current state: **PARTIAL_TESTS_NOT_DEVICE_VERIFIED**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Push registration/model tests do not establish supported-device delivery.

Linked catalog modules: NOTIFY, MENTION, NUDGE

Prerequisites: Configured push provider; consented browser/device subscriptions

Required work: Trigger disposable A/B notifications with foreground/background, permission denial, repeated events, sign-out and identity switch.

Completion criteria: Correct recipient and destination; no duplicate or cross-account delivery; truthful permission/registration state; approved timing and quiet-hour rules.

## READY-10 — Firefox, Safari and physical phone coverage (P1)

Current state: **COVERAGE_NEEDS_ADDING**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Current Playwright projects are Chromium-based; viewport emulation is not a physical-device check.

Linked catalog modules: DEVICE, A11Y, FILE, CALL, NOTIFY

Prerequisites: Supported-platform decision; installed browsers and available approved devices

Required work: Add Firefox/WebKit projects and run core journeys; separately exercise actual Android Chrome/iOS Safari touch, pickers, media and push.

Completion criteria: Recorded supported browser/device variants pass core flows; focus/layout/touch work; unsupported or inaccessible variants remain explicitly blocked.

## READY-11 — Migrations and client compatibility (P0)

Current state: **DEPLOYMENT_VERIFICATION_OUTSTANDING**. Work: OPEN. Verification: NOT_RUN.

Evidence basis: Schema tests do not prove deployment or mixed-version client behavior.

Linked catalog modules: DEPLOY, AUTHZ, GCONTACT, DESIGN, QA

Prerequisites: Approved isolated staging and migration inventory; old/new build fixtures

Required work: Apply migrations only within separately authorized deployment scope; verify schema/policies, fresh install/upgrade and old/new clients.

Completion criteria: No unauthorized exposure, data loss or broken core workflow; client errors are recoverable; migration/backup/rollback evidence is recorded by the operator.

## Closing an item

Move work from OPEN to IN_PROGRESS and then IMPLEMENTED or READY_FOR_VERIFICATION as appropriate. Mark VERIFIED only after acceptance criteria pass on the recorded candidate build with evidence. Existing implementation can move directly to verification once prerequisites are met. Never close an item because its wording appears in the plan. Failed verification reopens the item and links a bug; missing configuration/spec/device remains BLOCKED.

Readiness verification and individual test results are separate: closing one item does not automatically pass its related cases. Track browser/role/device variants in EXECUTION_TRACKER.csv. Required P0/P1 readiness items and related cases must be complete before claiming release readiness.
