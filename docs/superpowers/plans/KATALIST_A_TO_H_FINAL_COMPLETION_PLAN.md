# Katalist A–H final completion plan

Prepared: 24 September 2026. Inspected checkout: `34e69bd`, branch `katalist-plan/batch-a-baseline`.

Repository: `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev`.

**Outcome:** finish the remaining A–H implementation through the fixed checklist below, run one integrated acceptance pass, fix failures against that checklist, and hand over a working local build plus a short, executable release checklist. This document is the next execution instruction. It replaces repeated planning checkpoints; it does not restart the application.

The checklist is finite. A plan cannot guarantee that software will never have another bug. It can make the finish line explicit and require the implementing agent to fix the bugs it discovers before handoff. New visual preferences and unrelated features do not become additional completion requirements during this run.

All source paths below are relative to the repository. Paths marked **new** are proposed destinations; reuse an equivalent existing module if it already owns that responsibility. Verify current symbols when editing because extraction will move line numbers.

## 1. Read this first: what is already accepted

The codebase has working A–H foundations: identity epochs and the identity boundary, shared mutation claims and rollback chains, actor caching, realtime ownership and batching, loading-state primitives, Court/detail workflows, Morning Brief scheduling/receipts, notes, chat, calls, files, and Bridge. Preserve these.

At `34e69bd`, the four most recent review findings were independently accepted locally:

- Comment sends, rollback, and invalidation use the submitted Thing ID.
- Late comment-file draft writes carry the initiating identity epoch.
- Creating a note while continuing to edit migrates the draft away from the new-note slot.
- A delayed Morning Brief claim checks the receipt date before opening.

Earlier reviewed fixes for SQL ambiguity/timezone/threshold, failed comment restoration after unmount, synchronous note-save deduplication, blank-note discard confirmation, structured access-error classification, call callback ownership, and Catch Up identity reuse remain in place. Do not reimplement them. Reopen a closed defect only with a concrete regression or a failing acceptance case caused by subsequent work.

Verification reference: the implementation report records 526/526 full-suite passes; the latest independent review ran 33/33 relevant tests plus typecheck, lint (0 errors/80 warnings), and `build:app`. The full 526-test suite was not independently rerun during preparation of this plan. Execution must establish its own current baseline.

Some original audit IDs contain broader requirements than the defect already fixed. For example, E-03 still includes due-date/file-selection transitions, F-03 includes day/context-owned presentation state, and C-06 includes all mounted consumers. The checklist below names those remaining clauses explicitly.

## 2. Fixed product and implementation decisions

1. Preserve Court, Lists, Buckets, Team, Nudges, Me, Work/Home, current Thing vocabulary, Poppins, and the white/violet design. No navigation merger, framework replacement, or new analytics vendor.
2. Introduce no billing system, subscription tiers, paid entitlements, or paywalls. Existing authorization, owner/member roles, file-size protections, and safety rollout flags remain. Pricing and operating-cost modelling are separate product work, not prerequisites for this A–H implementation.
3. Keep the existing React Query identity architecture and canonical mutation claims. Do not perform another global query-key migration. Add explicit keys only for newly different data shapes such as paginated feeds and summary queries.
4. Preserve controlled detail variants. Implement the original Bucket requirement by composing `InlineThingDetailWorkspace` on desktop with its required `children`; retain an accessible sheet/dialog on small screens. Share behavior and section components across variants rather than forcing identical markup.
5. History page size defaults to 50. Use `(created_at, id)` cursors with stable ordering and explicit Load older recovery. Never return an incomplete Court merely to reduce requests.
6. Chat uses one client-generated operation/message UUID per logical send, reused for retries. Prefer the existing row primary key where its schema and RLS permit this. Add a narrow RPC/constraint only if needed to enforce the contract; never emulate server idempotency with a disabled button.
7. Drafts remain session-memory data, cleared on identity retirement. Preserve drafts through route/panel changes; hard-reload persistence is not added. Store draft revisions and stable operation ownership where asynchronous work can race edits.
8. Owned blob URLs transfer between composer, retained draft, and viewer. Revoke only after the last owner releases them. Never send a `blob:` URL as a durable attachment to another user.
9. A valid saved profile timezone wins, including UTC. Browser timezone is fallback for a successfully established missing/invalid saved zone. Failed/unresolved profile loading is not proof that the saved zone is missing.
10. Morning Brief auto-open remains disabled until its live rollout gates pass. Manual review and the rest of the product remain usable. Do not introduce payment gates as a substitute for rollout readiness.
11. Prepare additive SQL, typed adapters, local SQL tests, fixture scripts, and staging tests as part of implementation. Missing deployment credentials do not block writing and testing those artifacts locally.
12. Preserve published history and unrelated work. Work on the existing branch unless the checkout has changed or isolation is needed. No forced push, destructive reset, production mutation, external invitation, live call, migration deployment, or release is included in the local execution instruction.

## 3. The completion checklist

Each checkbox below closes only after its numbered acceptance conditions pass or a specifically identified external execution result is recorded in the release checklist. “Implemented” without consumer integration is insufficient. A package can be `LOCAL PASS / RELEASE PENDING` when all local work is complete and its exact live dependency is listed.

- [ ] **T00 — Establish the baseline and reliable test/build commands.**
- [ ] **T01 — Finish read cancellation, error recovery, and access-loss consumers.**
- [ ] **T02 — Complete draft ownership and temporary-file ownership.**
- [ ] **T03 — Finish shared mutation coordination and interaction blockers.**
- [ ] **T04 — Complete bounded histories and reliable shared chat.**
- [ ] **T05 — Correct read/unread behavior and Hub presentation.**
- [ ] **T06 — Separate overview summaries from full detail loading.**
- [ ] **T07 — Finish precise realtime invalidation and reconnect behavior.**
- [x] **T08 — Apply shared typography, controls, elevation, and motion.**
- [ ] **T09 — Complete Court, shared detail, and Magic Box.**
- [ ] **T10 — Complete Morning Brief behavior, actions, and responsive layout.**
- [ ] **T11 — Complete Lists and Buckets.**
- [ ] **T12 — Complete welcome, authentication, and three-step onboarding.**
- [ ] **T13 — Complete Nudges, Me, preferences, and public-profile checks.**
- [ ] **T14 — Complete file preview, calls, meetings, and Bridge local coverage.**
- [ ] **T15 — Run integrated acceptance, fix failures, and reconcile all audit IDs.**

Execute in this order. A package may prepare an interface used by a later package, but the later package owns the final rendered behavior. Do not postpone a known failing local acceptance test to staging.

**After each package:** record `status | changed files | tests/evidence | commit | exact remaining dependency` beneath its task heading or in the existing audit ledger. Keep one row per package and link detailed tests; avoid another large progress narrative after every commit.

**One final review:** after T00–T15 have passed locally, review the integrated diff and the acceptance evidence once. Fix reproducible failures inside their existing task. Continue until those tests pass; do not generate a new plan or seek permission to fix an in-scope bug. Any genuinely new feature request goes in a separate future backlog.

## 4. Contracts shared by every package

These are implementation invariants, not optional additional phases:

- Capture operation input before work starts: entity ID, identity epoch, relevant Work/Home scope, operation ID, and draft revision. Do not reread a successor render's entity or a successor account's token to finish old work.
- Every cache write, toast, timer, focus move, receipt update, and notification continuation checks the ownership relevant to it. A stale operation must still release its own resources without clearing a newer owner's state.
- `onMutate` stopping its optimistic work does not automatically stop React Query's mutation function. Explicitly reject a retired operation before any subsequent write or external side effect; use captured operation input rather than render closures.
- Mutation failure removes/reverts only that operation's optimistic contribution. It cannot replay a whole old cache snapshot over unrelated messages or newer changes. Keep the existing Thing rollback-chain behavior.
- Empty success, missing entity, confirmed access loss, unresolved first fetch, offline cached data, transient refresh failure, and partial auxiliary failure remain distinct.
- A 403/permission error hides protected stale data. An RLS-filtered empty collection alone does not prove revocation: use an authoritative parent/membership read when that distinction is required.
- Profile/mode/context/UUID boundaries apply to drafts, read state, feeds, query seeds, and uploads. Same display names are never identity proof.
- Every new or changed data shape is updated at all consumers: query key, optimistic patching, invalidation, preview adapter, read counts, and tests. Never store arrays and `InfiniteData` under the same exact key.
- Verify real boundaries where they matter: React Query mutation lifetimes, mounted observers, React DOM transitions, SQL execution, deferred media tasks, and browser navigation. Do not use source-text matching as proof of interaction behavior.
- A fixed test count is not a completion target. Preserve tests that still express a valid contract; replace obsolete source-layout assertions with coverage of that contract.

## 5. Detailed work packages

### T00 — Baseline, build safety, and executable browser harness

**Owns:** A-01, A-03, V-02; provides the harness used by the later tasks.

**Existing files:** `AGENTS.md`, `package.json`, `package-lock.json`, `eslint.config.js`, `.github/workflows/quality.yml`, `playwright.config.ts`, `scripts/alias-loader.mjs`, `scripts/dom-test-setup.mjs`, `scripts/migrate.mjs`, `vercel.json`, `tests/e2e/preview/smoke.spec.ts`, `tests/e2e/staging/README.md`.

**New if needed:** `playwright.staging.config.ts`, `tests/e2e/fixtures/`, and a small shared browser fixture helper. Keep production code free of an authentication bypass created for tests.

- [ ] Record branch, HEAD, dirty files, Node version, and results of typecheck/full tests/lint/build:app once. Preserve the existing untracked `.agents/` and `output/` work.
- [ ] Classify behavior-claiming source assertions in `scripts/katalist-state.test.mjs`, `scripts/katalist-foundation.test.mjs`, `scripts/katalist-regression.test.mjs`, `scripts/court-dual-mode-workspace.test.mjs`, `scripts/court-stack-components.test.mjs`, and `scripts/inline-thing-detail-workspace.test.mjs`. Convert them when the owning package changes the behavior; retain deliberate architecture assertions. Keep a role/lifecycle test inventory covering owner, assignee, collaborator, view-only, unrelated user, terminal work, and UUID identity.
- [ ] Split browser execution into explicit local-fixture and staging configurations. The local command starts a server on an isolated configurable port with `reuseExistingServer: false`; staging-only execution never registers localhost projects. An explicit combined run starts both required environments. Do not kill another server to free a port.
- [ ] Local fixtures must run the real client components against deterministic mocked transport or an isolated local backend. Distinguish preview-mode tests from live-mode-with-mocked-transport tests. Block unexpected outbound requests in fixture runs; simulated writes must remain local.
- [ ] Record the tested commit/build identifier in browser artifacts. Make skipped staging tests visible as unexecuted coverage rather than silently omitting their existence from the final report.
- [ ] Add local browser smoke/fixture CI, pinned compatible Node, browser installation, traces/screenshots on failure, and artifact upload. Keep hosted staging execution opt-in with explicit isolated configuration.
- [ ] Triage the 80 warnings by rule/file: fix correctness warnings in owning tasks; document intentional ones with narrow reasoning. Do not disable whole rules to reduce the count.
- [ ] Prepare safe build/deploy separation in source: make the application build command migration-free and expose migrations only as an explicit operator step. Preserve command compatibility through `build:app`. Record the deployment configuration change for release approval before publishing it.
- [ ] Document the two migration systems accurately: `scripts/migrate.mjs` reads root `migrations/`; the Morning Brief SQL is in `supabase/migrations/`. Do not claim `npm run db:migrate` deploys Supabase receipt RPCs. Identify the configured Supabase deployment method separately.

**Acceptance:** local-only and staging-only configs enumerate the intended tests; local fixture tests perform no remote writes; app build succeeds without DB credentials and invokes no migration; warning dispositions and the baseline are recorded. Actual hosted CI results and deployment activation belong to RELEASE-01/02.

### T01 — Query truth, cancellation, and mounted access-loss handling

**Owns:** B-01, B-02, B-03, B-04 and remaining consumer clauses of C-06.

**Existing files:** `src/lib/query-policy.ts`, `src/lib/domain-error.ts`, `src/components/katalist/AsyncState.tsx`, `src/features/court/{fetch-court,use-court}.ts`, `src/features/lists/{use-lists,fetch-list-detail,use-list-things}.ts`, `src/features/buckets/{fetch-buckets,fetch-bucket-items,use-bucket-items,use-bucket-notes}.ts`, `src/features/nudges/use-nudges.ts`, `src/features/catchup/use-catchup.ts`, chat/file/meeting hooks and their route consumers.

**New if needed:** `src/lib/read-request.ts` for abort/deadline ownership. Extend existing policy modules if clearer.

- [ ] Retain the accepted structured error classifier. Standardize hook exposure of readiness, error category, retained data, background fetching, and retry. A never-fetched paused query must remain unresolved; do not infer success from `!isLoading`.
- [ ] Thread React Query's cancellation signal through query functions, mapper dependencies, and supported Supabase `.abortSignal(...)`/fetch calls. Apply the 15-second deadline to the read operation, including dependent phases. Clear timers/listeners in `finally`.
- [ ] Differentiate deadline abort from navigation/query cancellation: timeout gets recovery UI; normal cancellation should not produce an error toast. Leave writes outside this read-timeout policy.
- [ ] Preserve the existing 3-second slow feedback and show retry plus a real route-away action by 15 seconds. Retrying cancels/supersedes the abandoned read. A late response cannot replace the newer query's result.
- [ ] Build the consumer matrix: Court; Lists index/detail; Buckets index/detail/notes; Nudges rows/history/eligibility; Morning Brief; Hub conversation/messages/files; List members/meetings. For each, check initial load, true empty, retained-data failure, not-found, confirmed denial, offline, and retry.
- [ ] Add a shared access-loss presentation/authority path where needed. On confirmed loss, hide messages/files/member/meeting/detail content, clear owned drafts according to the access-loss policy, close affected dock views, cancel their work, and release subscriptions. Keep unrelated entities intact.
- [ ] For an RLS empty result, use the parent/membership authority query to distinguish an empty authorized collection from a no-longer-accessible parent. Do not turn every empty query into a permission error.
- [ ] Preserve Nudges' `rowsError` versus `eligibilityError`, separate retries, and unconfirmed action state. Creation toolbars remain available when their collection is empty.

**Acceptance:** a held read aborts/reports timeout and retries successfully; loaded+500 stays visible with a warning; loaded+403 hides protected data; offline+confirmed-empty stays a real empty state; paused first fetch is unresolved. Mounted List/chat/files/meeting/dock observers react to confirmed loss with both full and incomplete membership event payloads. Local observer coverage passes; deployed event delivery is RELEASE-03.

### T02 — Draft revisions, entity transitions, and file-resource ownership

**Owns:** remaining E-03/G-06 clauses and H-04. Supplies safe primitives for T04/T09.

**Existing files:** `src/features/drafts/session-drafts.ts`, `src/features/things/ThingDetailContent.tsx`, `src/features/things/use-thing-comments.ts`, `src/features/buckets/use-bucket-note-editor.ts`, `src/lib/file-utils.ts`, `src/features/things/attachments.ts`, `src/features/court/MagicBox.tsx`, `src/features/lists/ListChatPanel.tsx`, `src/features/calls/ListCallPanel.tsx`.

**New if needed:** `src/features/drafts/use-session-draft.ts` and `src/lib/owned-file-resources.ts`.

- [ ] Preserve all accepted comment/note fixes. Add monotonically increasing draft revision/tombstone ownership where emptiness alone currently means “unchanged.” A user typing and then deliberately clearing a newer draft must not have an old failed submission resurrected over that decision.
- [ ] A persistent draft owner handles settlement after component unmount. Mounted controls observe draft-store changes for the same scope; reopening before an old send fails must still show the restored draft once that failure arrives. Do not depend solely on per-call mutation callbacks surviving unmount.
- [ ] Finish `null → Thing A → Thing B → null` behavior for due-date edit input, selected attachment, avatar and bucket data. Use a per-Thing due-edit draft only while dirty; otherwise derive server state. Clear selected file when it no longer belongs to the displayed Thing.
- [ ] Verify note-editor route/unmount/identity behavior in addition to session and edit-revision checks. A late save/delete cannot clear a successor identity's draft or emit its toast. Preserve synchronous Save deduplication and the accepted created-note key migration.
- [ ] Introduce explicit ownership of object URLs and FileReader work. Retained draft and viewer may hold independent references; releasing one cannot invalidate the other. Release on discard/remove/replacement, rejected stale completion, last-owner unmount, and identity retirement. Revoke only URLs this application created with `URL.createObjectURL`.
- [ ] Make `processFileForUpload` cancellation/fallback settle once. Clear its timer and handlers; abort the FileReader where possible. A late reader event after fallback must not create a second abandoned URL.
- [ ] Preserve actual `File`/Blob or durable storage handles needed for retry. Before a real comment/message persists, upload attachment bytes through the authorized storage path and persist durable descriptors. A local blob URL is preview-only and cannot be a shared message attachment.
- [ ] Keep stored draft, live input, pending-operation state, and resource ownership aligned after selection changes. Scope completed processing by initiating epoch even if the component still exists. Register processing as a blocker until settled.
- [ ] Replace third-party Office/Google viewer URLs for private files with an authorized download/unsupported-preview fallback unless there is a documented product consent contract. Do not silently disclose signed private-file URLs to a viewer service.

**Acceptance:** failed send before/after close/reopen restores only the submitted unchanged revision; a newer typed-then-cleared draft is respected; null/A/B transitions keep state separate; note creation/adoption starts the next new note blank; old-account completions neither write nor toast. Blob-URL spies prove acquisition/release balance while retained drafts remain viewable; private attachments open from a second isolated session after upload. Heap measurements are finalized in T15.

### T03 — Shared actions and complete interaction blocking

**Owns:** B-05, F-04 and the coordination portion of F-07.

**Existing files:** `src/features/things/query-updates.ts`, `src/components/katalist/{InteractionBlockerProvider,use-interaction-blocker}.tsx` / `.ts` as present, `src/features/catchup/CatchUpStack.tsx`, `src/features/court/{CourtLaneStack,MagicBox}.tsx`, detail/chat/note composers, `src/features/calls/use-list-call.ts`.

**New if needed:** a small shared Thing action runner adjacent to `query-updates.ts`; reuse existing claim/patch functions.

- [ ] Route Morning Brief Catch/pace/Move Now through the existing QueryClient-scoped claim and patch mechanism. Scope Nudge and dismiss actions to their actual domain. Keep timed Snooze on its personal-visibility path while preventing duplicate dispatch.
- [ ] Return an explicit action outcome (`performed`, `already-in-flight`, `failed`, `retired`) so a deduplicated no-op cannot advance the review queue or record a receipt as though an action succeeded.
- [ ] Capture the moment/entity/epoch/context before action dispatch. Check it before every later toast, refresh, advance, receipt, or focus move. Retry a failed receipt separately from the already successful Thing mutation.
- [ ] Wire blockers to dirty Magic Box/chat/note/due-date composers, attachment processing/upload, blocking create/edit/invite dialogs, and calls in joining/connected/reconnecting states. `useBlockWhile(joined)` alone does not cover a pending permission prompt/join.
- [ ] Use existing blocker tokens/refcounts; each owner releases only its own token. Panel unmount with retained background work must transfer or retain that operation's blocker until its operation settles. A saved dormant draft need not block every screen forever: active editing or active processing is the blocking condition.
- [ ] Confirm at most one automatic Morning Brief controller is active for the visible Court mode; hidden responsive variants must not each attempt the daily claim.

**Acceptance:** Court/detail/brief acting simultaneously on the same Thing makes one domain operation and one appropriate receipt; different Things remain independent. Two blockers release independently; no modal opens during active composing/upload/join; clearing the final blocker reevaluates eligibility. Stale failures preserve successor state and focus.

### T04 — Bounded history, shared chat drafts, and idempotent sends

**Owns:** C-03, G-08, G-09. T11 later replaces the duplicate List route chat with this completed panel.

**Existing files:** `src/features/lists/{use-list-messages,ListChatPanel}.ts` / `.tsx`, `src/features/things/use-thing-comments.ts`, `src/features/hub/use-conversations.ts`, `src/features/hub/components/ConversationWorkspace.tsx`, `src/features/hub/ChatHeadsDock.tsx`, `src/routes/api/hub/notify-message.ts`, `src/domain/query-keys.ts`, message schema/RLS migrations.

**New if needed:** `src/features/lists/chat-operations.ts`, bounded fetch modules, `src/features/lists/chat-scroll-state.ts`, additive SQL for summary/idempotency needs proven by schema inspection.

- [ ] Implement bounded latest-page reads for List messages, Thing comments, and Thing activity. Order by timestamp plus UUID, fetch 50, derive the next cursor from the last fetched row, and reverse presentation as needed. Use server-side cursor predicates rather than offset-only pagination.
- [ ] Use distinct paginated query keys and update every caller/optimistic patch/invalidation path for `InfiniteData`. Export a flattened view for presentation; deduplicate by durable ID and preserve total/unknown-count semantics.
- [ ] Add Load older, older-page spinner/error/retry, preserved viewport anchor, and new-message indicator while scrolled up. Realtime arrival, retry, and page prepend must not jump the reader to the bottom.
- [ ] Move chat text/attachment drafts and scroll anchors into the shared identity/conversation store from T02. Dock, Hub, and List route consume one contract. Synchronize concurrent same-conversation composers so a stale instance cannot overwrite a newer revision or send duplicate retained work.
- [ ] Make send input carry immutable List ID, author identity/epoch, body, validated mention IDs, attachment descriptor, and operation/message UUID. Set pending state synchronously at the operation owner. A re-render cannot redirect send or callback to another List.
- [ ] Optimistically add a row with that stable UUID and explicit pending/sent/failed status. Retry uses the same ID. If insert encounters an existing ID, verify the authorized existing row belongs to the same operation; never overwrite another row via blind upsert.
- [ ] Reconcile realtime echo before/after the HTTP response with one row. On failure, retain the failed row/draft and offer deliberate retry/remove; do not replace the whole feed with an old snapshot.
- [ ] Make notifications idempotent by persisted message ID and authorized membership, using an existing delivery dedupe facility or a narrow server-side unique operation/outbox record. Do not push again on a retry that merely discovers an already committed message. Capture/check initiating authority before any post-send session lookup/notification; no successor-account token reuse.
- [ ] Validate mention membership server-side; duplicate display names resolve to chosen UUIDs. `sendSystem` and call-start entries follow the same immutable target/epoch and dedupe rules where they can retry.
- [ ] Implement history search on the server across all accessible pages with validated bounded filters. Do not label filtering loaded rows as full-history search.

**Acceptance:** 1,000+ rows with equal timestamps are reachable once each; first fetch is bounded; page failure preserves loaded rows. Slow send, lost response after commit, repeated retry, realtime-first echo, A/B switching, close/reopen, same-conversation dock+workspace, and account switch all preserve one logical operation and correct drafts. Notification retry produces no duplicate delivery request accepted by the server.

### T05 — Read state, counts, and Team/Hub behavior

**Owns:** C-08, G-10, G-11; coordinates auxiliary count failures with C-04.

**Existing files:** `src/features/things/read-state.ts`, `src/features/hub/chat-read-state.ts`, `src/features/hub/{use-conversations,ChatHeadsDock}.ts` / `.tsx`, `src/features/hub/components/{ConversationWorkspace,HubSidebar,ContactsDialog,NewGroupDialog}.tsx`, `src/routes/team.index.tsx`, `src/routes/team.$conversationId.tsx`, `ThingDetailContent.tsx`.

- [ ] Pass explicit identity/mode to Thing read APIs and namespace storage accordingly. Never credit an unscoped legacy timestamp to the current user. Use actor/profile UUID for self-authorship; do not suppress another same-name author's unread message.
- [ ] Mark through the latest actually viewed message/comment boundary, not wall-clock now. Chat must be selected, visible, successfully loaded and showing the relevant message boundary. Files/Call tab visits and failed reads do not clear unread.
- [ ] Preserve unread for arrivals below/above a reader's visible position. Share read changes across List/Hub/dock via one event/store and cross-tab storage handling. Preview reads must not issue live notification writes.
- [ ] Propagate exact-count failures as unknown/error with retry, retaining a truthful unread indicator if known. Include viewer identity in viewer-relative count keys. Do not show zero mentions simply because the lookup failed.
- [ ] Hub landing distinguishes no conversations from a populated sidebar with no selection. Header uses the selected conversation record while authoritative detail loads, otherwise skeleton; missing members are not rendered as a confirmed zero.
- [ ] Keep one primary call entry, clear Chat/Files/Call tabs, named search, contextual Pin labels, and a dock close action that preserves the draft. Contacts/group creation expose pending/failure and preserve input.

**Acceptance:** two profiles reading the same Thing retain independent history; legacy values are ignored; Files/Call/hidden/loading views leave unread intact; actually viewed chat updates all surfaces consistently; new messages while reading old history remain indicated. Slow/failed header fetch does not fabricate membership or start a call.

### T06 — Summary/detail separation and efficient auxiliary data

**Owns:** C-01, C-02, C-04, H-01.

**Existing files:** `src/features/things/{map-thing-rows,attachments,use-thing}.ts`, `src/features/lists/{map-list-rows,use-list-things}.ts`, `src/features/court/fetch-court.ts`, `src/features/buckets/{fetch-buckets,fetch-bucket-items}.ts`, `src/features/hub/use-conversations.ts`, `src/features/me/use-trophy.ts`, `src/features/people/actor-query.ts`, `src/features/court/ThingStackCard.tsx`, domain Thing types.

**New if needed:** explicit summary/detail fetch modules, summary query keys, an additive authorized summary RPC and local SQL tests.

- [ ] Define an overview projection carrying all fields needed for lane/capability decisions plus exact or explicitly unknown counts and bounded preview metadata. Define detail sections independently. Do not make a summary masquerade as a fully loaded Thing with fake empty attachments/comments.
- [ ] Update common mappers and every overview consumer to request only summary data. Full attachments/comments/activity load on detail intent; Activity remains lazy until selected. Keep complete Court membership and correct List/Bucket unique counts.
- [ ] Replace reading every comment to compute overview counts with a batched authorized aggregate. Use the read watermark from T05 for unread semantics, including viewer-specific authorship. Inspect existing SQL capabilities before adding an endpoint.
- [ ] For a new aggregate/RPC, validate bounded UUID inputs and context, derive the caller from `auth.uid()`, and preserve source-row authorization. Prefer invoker/RLS execution; a definer function requires explicit equivalent membership checks and a fixed safe search path. Use minimal EXECUTE grants. Execute the actual additive SQL with isolated fixtures for unrelated/view-only/member callers; do not claim deployed RLS behavior from a stubbed local identity.
- [ ] Replace Hub's broad message-body assembly with latest-message/member/count summaries and a bounded conversation list strategy. Fetch only the participant identity records needed by visible data where supported.
- [ ] Batch signed URLs with `createSignedUrls` by storage bucket/path set; deduplicate paths, preserve per-file missing/denied/expired/signing-error outcomes, and bound signed-URL lifetime. Parallel per-file signing is still N requests and is not sufficient.
- [ ] Remove `PdfCanvas` from `ThingStackCard` and other overview lists. Use an existing thumbnail or a file-type tile with reserved geometry; do not generate a thumbnail by opening the full PDF on every card. Explicit preview mounts the renderer.
- [ ] Remove swallowed attachment/count errors and catch-to-empty fallbacks. Distinguish required mapping failure from unavailable optional preview metadata. A unavailable count is shown as unknown, with retry, never a fabricated zero.
- [ ] Preserve accepted fetch parallelization, direct List-detail mapping, and `getActorId` caching. Verify actor creation/change invalidation and legitimate no-row behavior rather than rewriting that cache.
- [ ] Add request counters and duration boundaries for cold/warm Court, Lists, Bucket and Hub fixtures. Record request volume separately from concurrent scheduling. For missing deployed summary RPCs, show a truthful limited/error state or a reviewed bounded compatibility path; do not silently restore unbounded reads.

**Acceptance:** Court overview performs no full PDF/comment/activity-history load; overview signed-URL requests scale by batches; detail loads the selected entity only. Aggregate SQL respects authorizations and known/unknown counts. Cold/warm 0/30/300 Thing and 0/10/100 List fixture counts are recorded; live performance remains separately labelled.

### T07 — Payload-aware realtime, focus, and reconnect

**Owns:** C-05, C-07; preserves and verifies C-06 broad fallback.

**Existing files:** `src/features/realtime/{event-invalidation-map,RealtimeInvalidationProvider,invalidation-batcher,IdentityBoundary,identity-cache-policy}.ts` / `.tsx`, `src/features/lists/list-chat-channel-registry.ts`, `src/domain/query-keys.ts`, personal-state invalidators.

- [ ] Forward event type plus old/new payloads. Map reliable Thing/List/Bucket IDs to the actual existing entity keys and necessary aggregate keys. For parent moves, invalidate both old/new parent collections.
- [ ] Use the smallest safe fallback when IDs are missing. Keep the accepted membership invalidation families and mounted-authority checks; a primary-key-only DELETE must still trigger a useful authority refresh.
- [ ] Add paginated/summary targets introduced by T04/T06. Deduplicate equivalent targets and remove redundant narrow entries when a broad prefix in the same flush already covers them.
- [ ] Keep the existing single root owner, 150ms trailing window, maximum delay, epoch guard, and last-consumer channel release. Do not move ownership again.
- [ ] On focus/reconnect, flush any pending batch and perform one coalesced catch-up authority refresh where needed. Test fresh cached queries as well as stale ones; React Query's default stale-only focus refetch is not proof that missed events are recovered.
- [ ] Register/dispose focus/reconnect work with the identity owner. Inactive/hidden panels cannot keep duplicate channels alive indefinitely. Old callbacks cannot invalidate the next account's data.

**Acceptance:** 20 related events produce bounded, deduplicated refreshes; unrelated entity detail remains quiet; parent moves refresh both parents; incomplete payloads preserve correctness; Strict Mode/route switching keeps one root owner; last chat consumer detaches; pending work is discarded on identity change. Local reconnect simulation passes; real event delivery/timing is RELEASE-03.

### T08 — Shared type, controls, elevation, and motion rollout

**Owns:** D-01 through D-04. Each later page package must use these contracts.

**Existing files:** `src/styles.css`, `src/components/ui/{button,input,dialog,sheet,popover,dropdown-menu}.tsx`, `src/components/katalist/PersonAvatar.tsx`, status/table primitives, `src/hooks/use-motion-preference.ts`, `src/lib/motion-tokens.ts`, `src/features/court/{use-stack-gesture,CourtLaneStack,CourtFocusView}.ts` / `.tsx`.

- [x] Map semantic roles to page titles 24–28px, section headings 16–18px, body/actions 14px, compact desktop data 13px, metadata at least 12px, and mobile inputs 16px. Use 1.4–1.6 body line height. Preserve visual hierarchy rather than globally replacing numeric classes.
- [x] Use desktop hit regions at least 32px and touch hit regions at least 44px, independently of icon size. Native buttons/links, visible focus, names, disabled semantics, and adequate space between targets are required.
- [x] Apply explicit dialog/popover/menu/sheet elevation classes first. Then remove universal shadow suppression and inspect remaining legacy shadows. Base surfaces stay border-led.
- [x] Apply existing motion tokens to actual GSAP/CSS consumers: 100–150ms feedback, 180–240ms local motion, workspace at most 280ms. Preserve OS-or-app reduced motion, immediate preference updates, and cleanup on input/route/preference changes.
- [x] Keep ordinary document scrolling outside focused gesture regions. Provide an in-memory preference update when storage fails so the current session still follows the selected setting.
- [x] Measure palette/role contrast and store results. Do not infer a conformance failure merely from font size, or conformance success merely from a screenshot.

**Acceptance:** shared overlays remain distinguishable; no nested controls or invisible focus; representative long-label/error content passes mobile and 200% zoom; reduced motion removes spatial movement; rapid input does not queue animations. T15 collects all page screenshots, keyboard evidence and frame traces.

### T09 — Court, common detail sections, and Magic Box

**Owns:** A-02, E-01 through E-05, with T02 owning draft primitives.

**Existing files:** `src/routes/index.tsx`, `src/features/court/{CourtDesktop,CourtLaneStack,ThingStackCard,CourtWithOthersSidebar,CourtWorkspace,CourtFocusView,CourtDetailModal,MagicBox}.tsx`, `court-stack-model.ts`, `court-view-model.ts`, `parse-toss.ts`, `src/features/things/{ThingDetailContent,InlineThingDetailWorkspace,ThingDetailSheet}.tsx`.

**New section components:** `src/features/things/components/{ThingIdentityHeader,ThingStatusControls,ThingAttachments,ThingDiscussion}.tsx`, unless equivalent sections already exist. Extract presentation plus its explicit shared contract, not a new independent mutation system.

- [ ] Convert queue/navigator click targets to native controls. Expose previous/next/View all and button/keyboard alternatives for every swipe/drag command, including Snooze. Use the same capability/command path as gestures.
- [ ] Preserve the accepted ID-based selection and deferred-focus ownership logic. A failed removal restores selection only when the user has not navigated; it cannot steal focus from another input/panel.
- [ ] Enforce readable layouts: >=1280px three lanes plus sidebar when they fit; 1024–1279px labeled With Others toggle; below 1024px stacked/collapsible lanes and dedicated With Others access. Use bounded media from T06.
- [ ] Distinguish empty Court from filtered-empty, provide capture versus Clear filters, and keep visible/total counts understandable.
- [ ] Extract the four detail sections once. Shared capabilities/pending/mutations/drafts remain canonical. Present work status first, acknowledgement second, and assigned importance versus personal pace explicitly. Keep terminal headings readable and disabled reasons understandable.
- [ ] Implement real Comments/Activity tabs and consume bounded history/load-more/error states from T04. Test nullable transitions with the actual component, not only hook ordering.
- [ ] In Magic Box, display destination List and Work/Home before submit. Store text, chosen assignees, attachment operations, and successful upload handles in the scoped session draft.
- [ ] Show per-file validation/uploading/ready/failed, truthful indeterminate progress where bytes are unavailable, Retry and Remove. Keep successful files and assignee results on partial failure; retry only failed work using stable operation IDs where the transport supports them.
- [ ] Escape closes/returns focus while retaining input. Capture shortcut focuses the composer. Successful capture identifies created Thing(s) and offers Open. Guard delayed timers/toasts/navigation after scope changes.

**Acceptance:** keyboard-only Capture→Catch→pace→comment/file→Sort passes; swipe and button versions are equivalent; null/A/B/detail-close keeps correct file/avatar/due/comment state. Court/List/Bucket/Nudge display equivalent permissions for the same Thing. Magic Box partial failure and route changes retain text/files and do not recreate prior successful work.

### T10 — Complete Morning Brief once, including its actual design

**Owns:** F-01 through F-09. Accepted SQL and four follow-on fixes are retained; remaining clauses below finish the whole feature.

**Existing files:** `src/features/catchup/{use-catchup,use-morning-brief,morning-brief-schedule,morning-brief-receipts,catchup-logic}.ts`, `{CatchUpOverlay,CatchUpStack,CatchUpStackCard,CatchUpBanner}.tsx`, `src/features/court/CourtDesktop.tsx`, `src/routes/api/jobs/daily-maintenance.ts`, `src/features/notifications/NotificationPanel.tsx`, receipt and Catch Up migrations.

**New if needed:** `MorningBriefQueue.tsx`, a small presentation-scope/receipt model, additive context-filter RPC migration. Keep existing CatchUp internal names where renaming offers no benefit.

- [ ] Pass Work/Home into live moment fetching and filter by the authorized resolved Thing's actual context before counts/eligibility/actions. Apply to every preview category as well. Add a validated backward-compatible RPC parameter only if required; context in the query key alone is insufficient.
- [ ] Expose successful readiness, failed initial/child load, background failure and retry to the banner/overlay. Manual review can show a recoverable error even when count is zero; automatic opening requires confirmed usable moments.
- [ ] Scope presentation state by identity, context, effective zone and local date. Retain accepted post-await checks. Reset/derive `alreadyPresentedToday` from the matching receipt: an old day's successful receipt cannot make today's flag true. Close or deliberately rebind an open brief when its scope retires.
- [ ] Require a resolved valid timezone source. A failed/no-data profile query remains unresolved; it must not silently become confirmed browser-zone fallback. Handle pending/paused queries explicitly.
- [ ] Normalize a premature server rejection at the adapter boundary using the actual error shape; only clear that attempt's key if it still owns the key. Schedule a bounded recheck using refreshed authoritative timezone/threshold information; prove the timer actually retries rather than changing an unrelated count in the test.
- [ ] Use one fresh clock snapshot for a decision. Retain receipt local date/timezone for presentation and dismissal; no recomputing a different scope after midnight. Keep successful receipt if opening is suppressed.
- [ ] Preview receipt persistence has a same-session fallback or explicit fail-closed behavior when storage/Web Locks are unavailable. Test remount, two contenders and manual review; only live SQL can establish cross-device claims.
- [ ] Replace the frozen deck of full objects with stable ordered moment IDs and live current data/capabilities. Preserve navigation position while status/access updates refresh or disable the selected moment. Revoked access cannot remain actionable in a snapshot.
- [ ] Consume T03's shared action outcome. Distinguish navigation/reviewed progress from successful resolution. Failed Thing action creates no receipt; failed receipt offers receipt-only retry without repeating the domain action. Open Thing closes review and navigates without silently changing work.
- [ ] Desktop layout: approximately 960px maximum width, greeting/date, only present category counts, bounded queue, selected detail, truthful progress. Mobile: viewport-safe full-height dialog, readable card/compact selector, sticky actions and keyboard-aware scrolling. Render real actor/reason/due/files/comment data; omit unsupported explanatory claims.
- [ ] Verify Escape/X/backdrop/finish/Open Thing all close and restore focus appropriately; manual reopen never consumes/resets the daily claim. First eligible late visit, tomorrow's threshold, hidden tab, active blockers, empty/error data, DST and timezone changes follow the original contract.

**Acceptance:** a clock/receipt/controller suite covers every transition above, including profile failure, date/context switch while open or pending, repeated renders, actual threshold timers, two local contenders and receipt-only retry. Layout/focus passes five viewports. SQL executes with first/duplicate claims and role contracts in local fixtures. Live RLS/concurrent devices/rollout remain RELEASE-02/03. Keep auto-open off until those pass.

### T11 — Lists and Buckets page completion

**Owns:** G-03 through G-07; reuses the completed chat/detail/note contracts.

**Existing files:** `src/routes/{lists.index,lists.$listId,buckets.index,buckets.$bucketId}.tsx`, `src/features/lists/{use-lists,use-list-things,ListChatPanel}.ts` / `.tsx`, `src/features/buckets/{use-bucket-items,use-bucket-notes,bucket-items-surface,SpringLoadedBucketFlyout}.ts` / `.tsx`.

**New List sections:** `src/features/lists/components/{ListThingsSection,ListMembersSection,ListInviteDialog}.tsx`, or clearly equivalent names.

- [ ] Lists index preserves owner/collaborator/view-only grouping, real List links, independently focusable row actions, named search, relative times with exact date on demand, and stacked narrow summaries. Keep creation outside collection-state boundaries.
- [ ] Fix filter hydration on profile/List changes before any persistence write. All remains the compatibility default. Validate stored values; A→B→A and same-name Lists remain independent. Never overwrite B's saved filter with A's prior render state.
- [ ] Preserve selected Thing by ID. If filtering hides it, provide an explanation and Clear filter action; avoid silently jumping to another Thing. Remove truly unused sort/due state or wire a specified control, rather than retaining inert options.
- [ ] Extract Things/Members/invite sections incrementally, preserving role enforcement, pending state and failure recovery. Replace duplicate inline List chat implementation with `ListChatPanel` from T04. Keep Things/Chat/Members semantics and clarify lane grouping's assigned-importance meaning.
- [ ] Buckets display “Private collection. Shared items keep their existing permissions.” Distinguish Add existing reference from Create Thing; neither action grants source access.
- [ ] Retain source reference identity when the Thing/List becomes unavailable, so a denied/deleted source is represented explicitly rather than disappearing as a successful empty result. Use authoritative source/access information and T01's handling.
- [ ] Reuse one add/remove command for keyboard and drag. Preserve unique accessible non-cancelled Thing denominator when direct and referenced-List membership overlap.
- [ ] Integrate Bucket desktop inline detail using the workspace's real two-pane prop contract, with correct children, selection and close/focus restoration. Small screens use the shared accessible sheet/dialog. Keep accepted note-save/draft fixes; expose saving/saved/error and recoverable note-read errors.

**Acceptance:** duplicate names, long descriptions, view-only access, corrupt filter storage, reused route A/B transitions, failed member/invite actions, private Bucket isolation, inaccessible references, unique counts, keyboard reference operations and failed note save all pass. Shared chat mounts do not multiply subscriptions or lose drafts.

### T12 — Entry flow and three-step onboarding

**Owns:** G-01, G-02.

**Existing files:** `src/routes/{welcome,auth,onboarding}.tsx`, `src/hooks/useSession.ts`, `src/lib/fixed-otp.ts`, `src/features/hub/components/ContactsDialog.tsx`.

- [ ] Reduce onboarding to three useful steps: capture, Court/Catch, optional Find people. Use existing local illustrative components; no live writes are needed to demonstrate capture in onboarding.
- [ ] Persist validated step/completion/skip state for the proper identity/session; implement Resume. Returning users do not replay welcome; Skip reaches Court without losing the option to resume.
- [ ] Unauthenticated direct onboarding/discovery links go through auth and return to a validated same-app destination. Reject external/invalid redirect destinations.
- [ ] Replace address-book/import claims with the actual in-app Find people behavior. Do not show permission/import success that never occurred.
- [ ] Demo entry and demo copy appear only in explicitly enabled deployments. Preserve fixed-OTP production restrictions. Give country selection a visible default/name and accessible validation.
- [ ] Cover invalid/expired OTP, resend cooldown, email fallback and session expiry with useful recovery and retained nonsecret input where appropriate.

**Acceptance:** new, returning, skipped, resumed, direct-linked, unauthenticated and expired-session users reach deterministic destinations. Three steps remain three; no mandatory extra contacts screen. Browser fixture auth flows do not weaken production auth.

### T13 — Nudges, profile, and preference completion

**Owns:** G-12, G-13; final B-01 page verification.

**Existing files:** `src/routes/{nudges,me}.tsx`, `src/features/nudges/{use-nudges,escalation-logic}.ts`, `src/features/me/{use-profile,use-trophy}.ts`, `src/features/push/PushRegistrar.tsx`, push config/registration, `src/features/notifications/use-notifications.ts`, public directory and Bridge payload contracts.

- [ ] Preserve working All lists/search/How nudges work/eligibility warnings. Finish semantic tabs, filter/no-results recovery, accessible disabled reasons and full history pagination if the UI promises all history.
- [ ] Verify manual versus automated nudge cooldown/quiet-hour behavior against the actual RPC contract. Do not add editable settings without persistence. Remove misleading upgrade/subscription wording when there is no corresponding product feature; no paywall is introduced.
- [ ] Me metrics distinguish activity events from completed Things and explain the implemented streak calculation. Retain legitimate private own-phone display and hidden synthetic email behavior.
- [ ] Profile-edit failure retains current edits; avatar upload has visible pending/per-file failure and retry. A retired save cannot replace a newer edit or account's state.
- [ ] Preference panels use accessible dialogs; motion preference survives reload. Push denied/unavailable states explain supported recovery and do not repeatedly prompt. Only explicit Enable initiates permission request.
- [ ] Keep theme/notification/privacy copy faithful to implemented features. Verify public directory/Bridge serializers omit private phone/email while private self-view can show them.

**Acceptance:** history failure keeps current Nudges visible; uncertain eligibility stays unconfirmed; cooldown rejection is recoverable. Profile rejection retains data; denied push does not loop; duplicate-name public profiles remain UUID-based; public fixtures contain no private fields.

### T14 — PDF, file recovery, calls, meetings, and Bridge

**Owns:** H-02, H-03, H-05, H-06, H-07, H-08; integrates T02/H-04 and T06/H-01.

**Existing files:** `src/features/things/{PdfCanvas,PDFViewer}.tsx`, `attachments.ts`, `src/lib/file-utils.ts`, `src/features/hub/components/HubFilesPanel.tsx`, `src/features/calls/{ListCallPanel,StartCallDialog,CallRingProvider,AnnotateCanvas}.tsx`, `{use-list-call,call-room,call-lobby,ringtone}.ts`, `src/features/lists/{ScheduleMeetingDialog,MeetingReminderCard}.tsx`, `src/routes/bridge.$token.tsx`, `src/routes/api/public/bridge/{thing,act,comment,redeem}.ts`, `src/lib/bridge-session.server.ts`, `tests/run-bridge-e2e.ts`.

- [ ] Retain/destroy PDF loading tasks on URL change/unmount; independently track document and requested-page generations. After `getDocument`, `getPage`, render, and resize work, verify canvas/document/page ownership before paint or state updates. Use the latest requested page after loading.
- [ ] Distinguish unsupported, expired URL, permission denied, and network failure. Refresh an expired signed URL once through authorized owner-aware lookup; a permission denial stays denied. Guard refresh by selected file identity.
- [ ] Provide named previous/next/page/download/retry controls, bounded page values, mobile-safe preview width/height, and actual asynchronous download failure feedback. Use fetch/blob or the transport's observable download path where supported; do not report completion from merely clicking an anchor.
- [ ] Preserve accepted call generation guards, callback guards, timer cleanup and late media disposal. Wire lifecycle values into visible joining/connected/reconnecting/ended/error UI.
- [ ] Handle permission denial with retry, instructions, and supported audio-only entry. Guard screen-share/device-change continuations like join: leave or a newer operation owns the final state. Stop microphone/camera/share tracks, ringtone, listeners and timers on every exit.
- [ ] T03 blocks Brief during joining/connected/reconnecting. Opening a conversation/review does not call or ring anyone. Explicit participant confirmation precedes real ring/send; retries cannot duplicate ring/system-message operations.
- [ ] Meeting fixtures exercise saved timezone, DST/due labels/reminders and repeat submit. Prepare the exact two-user/browser device checklist for live execution; synthetic media tests remain local evidence only.
- [ ] Inspect existing Bridge enforcement before modifying it. Implement executable local route/RPC tests for valid/expired/revoked/malformed/wrong-recipient/wrong-session/terminal/unrelated-Thing requests across thing/act/comment/redeem and file access. Use authoritative capabilities and generic safe errors; no raw-token logging.
- [ ] Test lost-response/repeated Bridge submit. Add server idempotency only where the current operation can duplicate a comment/transition, preserving the one-Thing authorization boundary. No private List/Bucket/contact/file expansion.

**Acceptance:** out-of-order PDF page/document results paint only current content; late permission/share completion stops tracks; stale call callback cannot affect successor state; failed download recovers; named controls work by keyboard. Local positive/negative Bridge cases pass and prepare the live script. Live multi-user calls/Bridge/RLS execution belongs to RELEASE-03/04.

### T15 — Integrated acceptance, measurements, final bug fixing, and reconciliation

**Owns:** V-01, V-03, V-04, V-05, V-06, V-07 and the final evidence for all packages.

**Existing files:** `tests/e2e/`, `scripts/`, `.github/workflows/quality.yml`, all page consumers above, existing audit/C/D–H ledgers and handoffs.

**New:** meaningful browser specs under `tests/e2e/preview/` or local-fixture subdirectory and `tests/e2e/staging/`, fixture builders, privacy-safe instrumentation under the existing logging boundary (or `src/lib/telemetry.ts` if none exists), `docs/superpowers/plans/KATALIST_A_TO_H_FINAL_ACCEPTANCE.md` for final evidence.

- [ ] Write/run the local fixture browser journeys in section 6. They execute the real router/components with controlled data/failures. Keep separate results for preview behavior and live-mode mocked transport; neither is labelled real Supabase acceptance.
- [ ] Write the equivalent staging fixtures/specs now, including setup, unique test IDs and narrowly scoped teardown. Missing credentials leave execution `RELEASE PENDING`; they do not leave the test files unwritten.
- [ ] Capture all five required viewport sizes and keyboard/zoom/reduced-motion cases. Run automated accessibility checks and manually inspect focus, target sizing, labels, error recovery and touch layouts. Record numeric contrast measurements and a desktop VoiceOver pass when available.
- [ ] Add bounded structured events for route load, query timeout/error, mutation failure, realtime reconnect, and Brief claim/presentation/dismiss/action. Log categories, durations and outcomes; exclude task/message text, private file URLs, tokens, phone/email and content. Test redaction and bounded volume. Existing infrastructure first.
- [ ] Run the performance fixtures from section 7 and attach environment-labelled output. Optimize actual failures in their owning tasks. Do not mark a performance target passed from unit-test timing or substitute a more favorable dataset without recording it.
- [ ] Run typecheck, full tests, lint, migration-free production build, local browser acceptance and isolated SQL tests against the final checkout. Fix every reproducible local acceptance failure; rerun affected tests and final required gates after code changes.
- [ ] Review the integrated diff once for missing consumers, stale closures, revoked access, duplicate writes, draft/resource loss and unsupported UI controls. Use the existing task as the defect's owner, add the smallest meaningful regression test, fix and verify. Do not restart A–H planning.
- [ ] Reconcile each of the 62 audit IDs using section 8. Update the current audit ledger and add dated links from older handoffs without erasing history. Distinguish accepted defect fixes, remaining clauses, locally passed implementation and unrun live gates.
- [ ] Final handoff includes actual HEAD, changed files grouped by task, results/artifact paths, locally closed audit IDs, migration/API inventory, exact release commands/configuration needs, and only concrete remaining blockers. Do not stop with “most work done” while a safe local task remains.

The migration/API inventory must name every new file, function signature, grant/policy, index or unique key, caller, old-client compatibility path, local SQL test, and deployment dependency. Use forward migrations for any schema already deployed; determine that from migration history rather than assuming an old file is safe to edit.

**Acceptance:** every T00–T15 task has recorded local evidence; every original audit ID has a disposition; no known local acceptance failure remains. The final report may say “local A–H implementation complete; release pending” only when every remaining item requires the external environment/authority described in section 9. Do not claim full A–H release completion until that section passes too.

## 6. Final browser acceptance matrix

Implement these as finite journeys with fixtures. Use the five viewport configurations for layout coverage; run expensive state permutations at a representative desktop and mobile size rather than an unnecessary full Cartesian product.

| ID | Journey | Required assertions |
|---|---|---|
| J01 | Auth/welcome/onboarding | New/returning/direct entry; 3 steps; skip/resume; OTP failure; validated return route; correct demo gating. |
| J02 | Court golden path | Capture → Catch → pace → comment/file → eligible Nudge → Sorted; visible feedback; correct terminal/history state; no duplicate operations. |
| J03 | Alternate entry points | Open same Thing from List/Bucket/Nudge; equivalent capabilities; Bucket inline desktop/mobile sheet; same draft and file ownership. |
| J04 | Concurrent mutations | Court/detail/Brief same Thing double action; independent other Thing; reverse-order failures; newer cache changes survive. |
| J05 | Draft navigation | Thing A/B/null and chat A/B; close/reopen before failure; newer typed-and-cleared revision; note create while editing; independent new note; due-date draft. |
| J06 | Scope retirement | Work/Home changes; live A → pending → live B; preview/live; held fetch/send/upload/timer settles afterward; no successor writes/toasts/focus or private state. |
| J07 | Read states | Initial failure, slow timeout, retry, offline never-fetched, confirmed empty offline, cached transient failure, 403 access loss, unavailable parent vs empty authorized collection. |
| J08 | Shared chat/history | 1,000 messages with timestamp ties; load older/search; scroll anchor; pending/failed/retry; realtime echo before response; same conversation dock/workspace; exact read boundary. |
| J09 | List/Bucket | Duplicate names; role gates; A/B saved filters; selected filtered-out item; references/unique progress; keyboard add/remove; unavailable source; notes errors. |
| J10 | Morning Brief | Before/after07:00, late first visit, next day/DST/timezone, profile loading/error, Work/Home data, blockers, actions/receipt failures, all close paths, manual reopen, retained receipt. |
| J11 | Files | No full PDF on overview; switch URL/page out of order; expired URL/denied access; unsupported preview; failed download; retained draft URL remains valid; remove/discard cleanup. |
| J12 | Calls/meetings | Explicit join/ring; permission denied/retry/audio-only; leave during acquire/share; reconnect UI; timer/track cleanup; meeting timezone. Local media mocks and live results labelled separately. |
| J13 | Hub/Nudges/Me | Empty/populated/header skeleton; tab-specific unread; contacts/group failure; history/eligibility distinction; profile rejection; denied push; privacy payloads. |
| J14 | Bridge | Positive/negative token/session/recipient/terminal/one-Thing tests; repeat submit; private files/fields blocked; local route tests plus prepared staging execution. |
| J15 | Accessibility/layout | 390×844, 768×1024, 1024×768, 1440×900, 1920×1080; long content; keyboard; 200% zoom; reduced motion; focus restoration; native semantics and labels. |

Common fixtures: owner, assignee, collaborator, view-only, unrelated and revoked user; duplicate display names with different UUIDs; shared and private sources; zero/normal/large datasets; deterministic clock. Real remote fixture creation belongs to the authorized staging step.

## 7. Performance and resource acceptance

Use a production-mode local build for local traces, then repeat network-dependent targets in staging. Record commit, dataset, browser, device, viewport, throttling, fixture mode, sample count, raw artifact path, result and pass/fail. Do not translate deterministic concurrency tests into claims about live latency.

| Metric | Target and measurement |
|---|---|
| Input feedback | Visible within 100ms; browser interaction trace. |
| Warm navigation | Useful cached content p75 ≤300ms over at least 20 navigations. |
| Cold primary route | Useful content p75 ≤2.5s under a recorded reference device/network profile. |
| Responsiveness | INP ≤200ms where field measurement exists; local interaction proxy explicitly labelled. |
| Layout stability | CLS ≤0.1 during route/media loading. |
| Motion | Target ≤16.7ms/frame at 60Hz; record tasks >50ms and dropped frames. |
| Stalled reads | Recovery and supported cancellation by 15 seconds; retry cannot be overwritten by old response. |
| Realtime | Visible update ≤1 second after client event receipt on a healthy connection. |
| Memory | 30 detail/file-preview open-close cycles; compare retained resources/heap after consistent cleanup, no monotonic retained-growth trend. |
| Data shape | 0/30/300 Things; 0/10/100 Lists; ≥1,000 messages. Initial history bounded; request counts distinguish batching from concurrency. |

If reference hardware or live credentials are unavailable, finish the harness and local fixture results, name the exact missing measurement, and put only that run in section 9. A local UI/runtime regression discovered during measurement must be fixed now.

## 8. Complete audit-to-task mapping

This table accounts for all 62 IDs in `KATALIST_A_TO_H_CODE_AUDIT_AND_COMPLETION_REPORT.md` (55 A–H plus 7 verification IDs). It supersedes historical counts of “untouched” items as an execution guide. Existing code may already satisfy a clause: inspect and record a test/evidence pass instead of rewriting it.

| Audit ID | Owner | Remaining disposition to establish |
|---|---|---|
| A-01 | T00/T15 | Behavioral test inventory; preserve valid domain/architecture tests. |
| A-02 | T09 | Nullable detail and dependent state transitions. |
| A-03 | T00/RELEASE-01 | Warning dispositions, migration-free build source, actual hosted CI/deploy configuration. |
| B-01 | T01/T13 | Preserve Nudges correction; rendered failure/readiness acceptance. |
| B-02 | T01 | Actual cancellation/deadline and retry/route-away recovery. |
| B-03 | T01 | Accepted classifier retained; every protected consumer reacts to confirmed loss. |
| B-04 | T01 | Consistent readiness/error/empty/offline across all named hooks/consumers. |
| B-05 | T03 | Shared claims and scope-owned continuations at remaining action surfaces. |
| C-01 | T06/T15 | Preserve optimizations; request-volume and timing evidence. |
| C-02 | T06 | Summary/detail separation, aggregate counts, batched signing. |
| C-03 | T04 | Bounded feeds/search/cursor correctness. |
| C-04 | T01/T05/T06 | Auxiliary failures/counts/files remain distinguishable from empty. |
| C-05 | T07 | Payload-scoped targets and move/fallback coverage. |
| C-06 | T01/T07/RELEASE-03 | Accepted invalidation retained; mounted consumers and real revocation delivery. |
| C-07 | T07/RELEASE-03 | Owner cleanup/focus/reconnect and live timing. |
| C-08 | T05 | Identity-scoped Thing read state and notification side effects. |
| D-01 | T08/T09–T14 | Typography tokens adopted on all pages. |
| D-02 | T08 | Overlay elevation rollout and removal of blanket suppression. |
| D-03 | T08/T15 | Native controls, hit targets, labels/focus/contrast. |
| D-04 | T08/T15 | Motion timing adoption, cleanup and measured frame behavior. |
| E-01 | T09 | Court native navigation and gesture-command parity. |
| E-02 | T09/T15 | Court breakpoints, empty/filtered states and media bounds. |
| E-03 | T02/T09 | Accepted comment fixes retained; remaining revisions/due/file/null transitions. |
| E-04 | T09/T11 | Shared sections/behavior; controlled variants; Bucket inline integration. |
| E-05 | T09 | Magic Box draft/upload/retry/destination/success behavior. |
| F-01 | T10/RELEASE-02 | Accepted SQL fix retained; deployed execution/roles pending. |
| F-02 | T10/RELEASE-02 | Accepted timezone/server-threshold correction retained; live contract. |
| F-03 | T10 | Accepted post-await checks retained; full presentation-scope ownership. |
| F-04 | T03 | All active dirty/modal/upload/call blockers. |
| F-05 | T01/T10 | Accepted data errors retained; visible manual error/retry and readiness. |
| F-06 | T10 | Full desktop/mobile Brief layout and truthful categories/progress. |
| F-07 | T03/T10 | Action versus navigation versus receipt-only retry. |
| F-08 | T10/T15/RELEASE-02 | Complete daily cases, preview fallback, live contenders/rollout. |
| F-09 | T10 | Actual Work/Home data filtering in every moment category. |
| G-01 | T12 | Three-step onboarding, auth return, skip/resume. |
| G-02 | T12 | Truthful discovery and OTP/auth acceptance. |
| G-03 | T11 | List index semantics and responsive states. |
| G-04 | T11 | Per-List filter hydration and selected-Thing stability. |
| G-05 | T11 | List section extraction and shared chat consumer. |
| G-06 | T02/T11 | Accepted notes fixes retained; remaining ownership/UI acceptance. |
| G-07 | T11 | Bucket references, private access, unique counts and commands. |
| G-08 | T02/T04 | Shared scoped chat drafts/scroll/continuations. |
| G-09 | T04 | Stable optimistic IDs, server idempotency and notification retry. |
| G-10 | T05 | Actually-viewed read boundary and consistent unread. |
| G-11 | T05 | Hub header/landing/tabs/actions/dock. |
| G-12 | T13 | Nudges semantics/history/cooldown acceptance. |
| G-13 | T13 | Profile/preferences/push/metrics/privacy acceptance. |
| H-01 | T06 | Thumbnail/tile overview without full PDF hydration. |
| H-02 | T14 | PDF document/page/task ownership. |
| H-03 | T14 | Preview/signed-URL/download recovery and controls. |
| H-04 | T02/T15 | Temporary resources, retained ownership, private viewer policy, memory cycles. |
| H-05 | T14 | Accepted join/callback fixes retained; integrated lifecycle remains verified. |
| H-06 | T03/T14 | Visible call recovery, all call blockers and exit cleanup. |
| H-07 | T14/RELEASE-04 | Meeting clock fixtures and live multi-user media. |
| H-08 | T14/RELEASE-04 | Local Bridge matrix and authorized live execution. |
| V-01 | T15 | Executable local/staging golden paths and fixture cleanup. |
| V-02 | T00/RELEASE-01 | Browser configs/CI artifacts and actual hosted run. |
| V-03 | T06/T15/RELEASE-05 | Performance harness, local traces, live/reference measurements. |
| V-04 | T08/T15/RELEASE-05 | Five viewports, keyboard/zoom/motion/contrast and manual assistive checks. |
| V-05 | T15 | Privacy-safe bounded event evidence and instrumentation. |
| V-06 | T15/RELEASE-01–06 | Source/test/release gates, compatibility and rollout. |
| V-07 | T15 | Accurate dated ledgers/source index/final acceptance report. |

## 9. The only external release checklist

Preparing scripts, tests and configuration below is local implementation work. Executing them against a remote database, sending real messages/calls or publishing changes requires the appropriate isolated environment and authorization. Keep an exact command/env-name checklist with credentials omitted from artifacts.

- [ ] **RELEASE-01 — Hosted CI and deployment configuration:** authorized push/PR, link successful workflow at the final commit, confirm hosting uses the pure app build, and record the explicit root-DB versus Supabase migration stages. Do not rewrite history.
- [ ] **RELEASE-02 — Schema/RPC deployment and Morning Brief:** deploy reviewed additive Supabase migrations to isolated staging using the actual configured tool; verify RLS/roles, early claim rejection, duplicate/concurrent claims, owner/context/date boundaries, old/new clients and rollback. Enable auto-open only after these results, then internal accounts/pilot.
- [ ] **RELEASE-03 — Live identity/realtime/access:** two isolated accounts; actual account switches, membership revoke while detail/chat/files/dock/meetings are open, full and incomplete event payload behavior, deployed publication/REPLICA IDENTITY, reconnect missed events, and latency. Confirm authoritative fallback when the removed member receives no DELETE event.
- [ ] **RELEASE-04 — Real calls/meetings/Bridge:** two test users/devices connect/reconnect/deny/share/end; all tracks stop; execute valid and negative Bridge matrix against deployed policies; use only uniquely identified disposable fixtures and scoped cleanup.
- [ ] **RELEASE-05 — Reference performance/accessibility:** repeat environment-dependent performance traces with real network/data; desktop VoiceOver and target-device touch/keyboard checks; record failures and fix their owning code task before release.
- [ ] **RELEASE-06 — Pilot and operational handoff:** approved small rollout, observed error/reconnect/claim events, rollback that preserves user work/receipts, owner sign-off and final release status. Operating cost/pricing can be planned separately; no paid-feature lock is part of this work.

A missing credential is a named execution dependency, not an unexplained blocker. The final report must list which release checkbox, required environment/authority, prepared script/spec, and next action remain. Do not ask the user to approve routine local fixes one at a time.

## 10. Verification cadence and stop rule

During a task, run the smallest relevant existing tests plus regression coverage for meaningful behavioral changes. Reproduce newly found defects before fixing them when practical; use a temporary independent checkout/source snapshot rather than overwriting unrelated dirty work. Keep useful assertions and never weaken a test just to match broken behavior.

At package boundaries run typecheck and the impacted regression group. Run the full suite/lint/build at coherent integration boundaries (after T03, T07, T11, T14) and finally at T15; do not repeat the same full suite after every comment-only edit. Increase coverage immediately for a new risk or failure.

Final required local commands:

```sh
npm run typecheck
npm test
npm run lint
npm run build:app
```

Run the explicit local browser command configured by T00 and the isolated SQL test commands. Record their actual names and outputs in final evidence. Do not substitute `npm run build` if the current script still invokes migrations.

The implementing agent may finish only when all local checklist conditions pass, or when it reaches a concrete blocker requiring unavailable external access/material product authority after completing all independent work. Time/context pressure alone is not a reason to replace implementation with another plan. Persist a short cursor (`task ID, completed substeps, changed files, last test, next action`) through context compaction and resume directly.

Do not label individual incomplete packages complete to keep momentum. Do not pause after every package asking whether to continue. Updates should say what finished and what is being implemented next.

## 11. Copy-paste instruction for the implementation agent

```text
Implement Katalist's remaining A–H completion work using:
docs/superpowers/plans/KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md

Read the complete plan, AGENTS.md, current git status and HEAD. The plan was
prepared at 34e69bd on katalist-plan/batch-a-baseline; reconcile any newer
changes before editing and preserve unrelated work.

Execute T00 through T15. This request authorizes the local implementation,
required test/fixture/configuration work, additive migration source, and
focused local commits of your changes. Do not push, deploy, apply remote
migrations, send real invitations/messages/calls, or use customer data.

The four latest review findings are already accepted locally. Preserve those
fixes and their tests. Implement only the remaining clauses assigned to
each task; do not restart A–H, redesign working identity/cache architecture,
add subscription/paywall features, or generate another implementation plan.

Use the plan's fixed product decisions and exact acceptance criteria. Wire
every helper into its real consumers. Test async ownership across entity,
context, identity, unmount and retry boundaries where applicable. When you
find an in-scope defect, reproduce it, assign it to its existing task, fix it,
and continue without asking for a new approval round.

Record checklist progress and evidence as you finish packages. Continue
through all independent local tasks even if staging is unavailable. Prepare
the release scripts/specs and list only their actual unrun external checks.
Do not treat missing live credentials as a reason to leave local source,
tests, SQL harnesses, browser fixtures or documentation unfinished.

After all packages, run the final local gates and perform one integrated
review. Fix reproducible acceptance failures and rerun affected checks.
Finish with the final commit, concise changes, actual test results and
artifact paths, dispositions for all 62 audit IDs, and the exact external
release checklist. Continue across context compaction using the saved task
cursor. Do not stop merely to ask whether to continue to the next package.
```

## 12. Final report template

```text
HEAD / branch:
Local implementation: T00–T15 [passed / exact remaining task]
Original audit coverage: 62 IDs reconciled [link]
Checks actually run: typecheck / tests / lint / build / local browser / SQL
Browser/layout/performance artifacts: [paths, environment, dates]
Known local acceptance failures: [none, or exact failing test/task]
Prepared migrations/API changes: [files, compatibility, deployment order]
External release status: RELEASE-01…06 with exact unrun cases/dependencies
No claims of live acceptance are based solely on fixtures or unit tests.
```
