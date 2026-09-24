# Katalist A–H: code audit and completion report

Date: 24 September 2026  
Audited checkout: `22b9bc3`, branch `katalist-plan/batch-a-baseline`  
Primary contract: `output/KATALIST_IMPLEMENTATION_MASTER_PLAN.md`  
Purpose: reconcile every master-plan work package against the implementation, and specify the remaining work. This is an audit, not authorization to deploy, migrate, send messages, or change customer data.

## 1. Verdict

**A–H is not completely implemented. It is also not release-verified.** There is substantial working implementation, but passing checks and completed progress-ledger rows do not prove all acceptance criteria.

The remaining work is not exclusively browser testing or database deployment. There are locally fixable correctness defects, incomplete UI/data behavior, unfinished component integration, and unwritten acceptance tests.

Most important findings:

1. The prepared Morning Brief claim function fails when executed: PL/pgSQL output variables conflict with unqualified SQL column names.
2. Morning Brief can open after its original eligibility conditions have stopped being true; the interaction-blocker primitive is not connected to dirty composers or other blocking dialogs.
3. A retired call join can clear the reference and state belonging to a newer join.
4. Session draft infrastructure exists but production composers do not consume it. Thing-detail text and attachment state are not a complete per-Thing draft model.
5. Membership-change invalidation does not cover every affected mounted surface. Broad invalidation and best-effort removal are not proof of revocation safety.
6. Summary/detail separation, bounded history fetching, typography adoption, the specified Morning Brief layout, onboarding reduction, and several workspace requirements remain unfinished.
7. The 15 passing Playwright cases are three anonymous smoke cases across five viewports, not the authenticated A–H acceptance matrix.

**Do not deploy the Morning Brief migration unchanged or enable its auto-open flag before fixing and testing it.** Preserve the currently disabled-by-default flag.

## 2. Reading this report

All paths below are relative to repository root: `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev`.

Status vocabulary:

| Status | Meaning |
|---|---|
| Implemented | Relevant source exists and the inspected behavior matches this part of the contract. Does not imply live verification. |
| Partial | Some required behavior exists; named requirements remain. |
| Defect | Source or an executable reproduction demonstrates a correctness problem. |
| Unverified | Evidence is insufficient to close the acceptance criterion; do not automatically rewrite the code. |
| External gate | Running the check needs isolated accounts, a deployment, device access, or explicit operational authority. Writing the test usually does not. |
| Scope decision | An implementation differs from the original plan and needs an explicit recorded acceptance or implementation of the original requirement. |

Priorities: P1 = correctness/data/lifecycle/release blocker; P2 = required functionality or important usability/performance gap; P3 = maintainability/polish. A priority is not a claim that a production incident has already occurred.

Evidence distinctions:

- **Executed:** independently run checks or a focused local reproduction.
- **Source:** traced implementation; runtime manifestation must be covered by the specified regression test.
- **Missing acceptance evidence:** requirement cannot be marked passed merely because no bug was observed.

This report covers every named A–H work package and the master plan's cross-cutting gates. It is not a claim that static inspection can discover every possible defect or establish live RLS security.

## 3. Verification baseline and audit boundaries

Independent verification at this same HEAD, retained from the immediately preceding review:

| Check | Result | What it establishes |
|---|---|---|
| `npm test` | 447/447 pass | Existing unit/component/static assertions pass. |
| `npm run typecheck` | Pass | Current TypeScript contract compiles. |
| `npm run lint` | 0 errors, 80 warnings | No configured lint errors; warnings remain. |
| `npm run build:app` | Pass | Migration-free app build succeeds. |
| `npx playwright test` | 15/15 pass | Anonymous auth/welcome/malformed-Bridge smoke coverage across five viewports. |

These results were not rerun or rebranded as a new verification run merely to write this document. Source remained at `22b9bc3`. Temporary review logs were `/tmp/katalist-review-{tests,types,lint,build,playwright}.log`; these are local ephemeral evidence, not durable CI artifacts.

No production source was changed by this audit. No migration, push, real invitation, message, call, or customer-data write was performed. Existing untracked `.agents/` and `output/` work was preserved.

The Morning Brief SQL reproduction used an isolated in-memory PostgreSQL-compatible PGlite instance, stub authentication/roles/profile data, and the actual migration source. It does not prove deployed Supabase behavior, but it does expose executable SQL ambiguity without needing deployment credentials.

## 4. Complete work-package reconciliation

| Master item | Current assessment | Remaining work in this report |
|---|---|---|
| A1 Baseline/classification/contracts | Substantially implemented; behavioral coverage incomplete | A-01 |
| A2 Conditional hooks | Hook ordering fixed; full state-transition acceptance incomplete | A-02, E-03 |
| A3 Lint/build/CI | Local checks implemented; deployment split and hosted CI open | A-03 |
| B1 Nudges readiness/isolation | Core correction implemented | B-01 verification |
| B2 Async-state contract | Partial | B-02–B-04 |
| B3 Mutation reliability | Strong Court/detail foundation; not every action/composer | B-05, E-03–E-05, G-06–G-09 |
| C1 Fetch efficiency/scaling | Parallelization, actor cache, direct List detail implemented; scaling partial | C-01–C-04 |
| C2 Realtime coalescing | Owner/batcher/epoch implemented; targeting/revocation incomplete | C-05–C-07; related isolation C-08 |
| D1 Typography/controls/elevation | Primitives implemented; page rollout incomplete | D-01–D-03 |
| D2 Motion/interaction | Preference contract implemented; timing/adoption/measurement partial | D-04 |
| E1 Court overview/navigation | Several improvements implemented; keyboard/gesture/viewport acceptance partial | E-01–E-02 |
| E2 Shared detail | Capabilities shared; extraction/drafts/equivalence partial | E-03–E-04 |
| E3 Magic Box | Partial-batch retry improved; draft/upload/result contract partial | E-05 |
| F Morning Brief | Schedule/adapter foundations exist; defects and major acceptance gaps | F-01–F-09 |
| G1 Entry/onboarding | Preview and Connect improved; original flow contract incomplete | G-01–G-02 |
| G2 Lists | Core screens and filter exist; persistence/extraction/chat/semantics partial | G-03–G-05 |
| G3 Buckets/notes | Unique progress improved; notes/reference/accessibility partial | G-06–G-07 |
| G4 Team/chat/contacts | Shared chat used in Hub; read/draft/send/header contract partial | G-08–G-11 |
| G5 Nudges controls | Formerly inert controls fixed; full acceptance still needs checks | G-12 |
| G6 Me/preferences | Labels/push/motion improved; remaining UX/privacy acceptance | G-13 |
| H1 Files/PDF | Size caps/lazy library import exist; lifecycle/thumbnail/recovery gaps | H-01–H-04 |
| H2 Calls/reminders | Low-level leave race improved; higher-level race and recovery gaps | H-05–H-07 |
| H3 Bridge | Existing enforcement and client status fix; execution evidence incomplete | H-08 |
| §12 Performance | No complete recorded target matrix | V-03 |
| §13 Verification/release | Local checks pass; browser and release gates incomplete | V-01–V-04 |
| §14 Rollout/observability | Feature flag/additive intent exist; instrumentation and rollout evidence incomplete | V-05–V-06 |
| §§15–16 Handoffs/file index | Need reconciliation with actual source and outstanding work | V-07 |

## 5. Batch A — engineering baseline

### A-01 — Finish converting behavioral claims into behavioral tests [P2]

**Where:** `scripts/katalist-state.test.mjs`, `scripts/katalist-foundation.test.mjs`, `scripts/katalist-regression.test.mjs`, `scripts/court-dual-mode-workspace.test.mjs`, `scripts/court-stack-components.test.mjs`, `scripts/inline-thing-detail-workspace.test.mjs`; classification document `docs/superpowers/plans/2026-09-22-batch-a-test-failure-classification.md`.

**Implemented:** Baseline failures were classified; the suite is green. Domain/model and real QueryClient/component tests have materially improved coverage. Do not undo valid classification corrections simply to recreate historical failures.

**Remaining:** Source-string assertions still cannot establish DOM focus, rendered permissions, draft retention, or successful interactions. A regex that matches a helper name is not evidence that its consumer is wired correctly.

**Change:** Inventory existing tests by contract: static architecture, pure domain, library integration, component, browser. Keep deliberate architecture assertions. Replace behavior-claiming source assertions with rendered interactions or pure-domain tests at the appropriate boundary. Record intentional pre-Catch owner importance/post-Catch personal pace semantics; preserve UUID identity and completed/cancelled history.

**Accept:** Explicit tests for owner, assignee, collaborator, view-only and unrelated users; same-title Lists remain distinct; live/preview lifecycle parity is documented where intentional. Tests fail if the behavior is broken, not merely if a variable is renamed.

### A-02 — Verify nullable Thing transitions and all dependent state [P2]

**Where:** `src/features/things/ThingDetailContent.tsx`, `src/features/people/directory.ts`.

**Implemented:** `useMemo` for buckets and avatar hooks now precede the nullable return. This hook-order defect is fixed.

**Remaining:** A hook-order correction does not prove draft/file/avatar/bucket state correctness across `null → A → B → null`.

**Change:** Add a real rendered transition test; include delayed avatar/file results arriving after selection changes. Complete E-03 rather than adding an unrelated reset that destroys drafts.

**Accept:** No hook-order error, wrong avatar, stale selected file, previous Thing's comment submitted to another Thing, or wrong bucket membership.

### A-03 — Close build/deployment separation and CI evidence [P2]

**Where:** `package.json`, `eslint.config.js`, `.github/workflows/quality.yml`, deployment configuration.

**Implemented:** One active ESLint config; removed redundant config; unknown/error narrowing; pure `build:app`; four local CI-equivalent commands. `build:app` does not migrate.

**Remaining:** `build` still runs `vite build && npm run db:migrate`. Hosted CI has not been proven by an actual run. The 80 warnings need dispositions; do not assume every hook warning is harmless just because lint exits zero.

**Change:** Preserve the safe local command. With deployment-owner approval, split the deployment app build from an explicitly authorized migration stage. Triage warnings by rule/file; fix correctness warnings first, document false positives, do not globally disable rules. Add browser CI as V-02.

**Accept:** A clean CI run is linked after an authorized push; app verification never invokes migrations; deployment migration is an explicit, visible operation. No history rewriting.

## 6. Batch B — data truth and mutations

### B-01 — Preserve and verify the completed Nudges separation [P2 verification]

**Where:** `src/features/nudges/use-nudges.ts`, `src/routes/nudges.tsx`.

**Implemented:** Profile/context-scoped queries; Court readiness participates in row loading; `rowsError` and `eligibilityError` are distinct; separate retry paths and unconfirmed eligibility state exist. Older handoff wording that says this separation is entirely absent is stale.

**Remaining check:** Render with Court pending, history rejected, eligibility rejected, truly empty success, and a context switch. Compare equivalent loaded Court/Nudges sets, not unrelated displayed counters.

**Accept:** Current rows survive auxiliary failure; eligibility is not falsely confirmed negative; zero appears only after a successful relevant fetch; retries target the failing layer.

### B-02 — Implement actual read cancellation and recovery [P2]

**Where:** `src/components/katalist/AsyncState.tsx`, `src/lib/query-policy.ts`, Court/List/Bucket/Nudge query functions, `src/lib/domain-error.ts`.

**Evidence:** The 3-second/15-second display timers exist. They do not abort reads. The inspected query paths do not propagate query cancellation/timeout signals. The stalled UI offers retry but does not fulfill the complete retry-and-navigation contract.

**Change:** Pass QueryFunctionContext's signal to supported Supabase/fetch reads. Combine it with a bounded read deadline without cancelling writes. Clean timers on settle/unmount. Model timeout as a retryable read error, not empty success. Provide a safe route-away action. Ensure retry supersedes or cancels the abandoned request instead of stacking requests.

**Accept:** A deliberately stalled read is cancelled where supported by 15 seconds; recovery UI appears; retry succeeds; the old response cannot overwrite the new result. Unsupported cancellation is documented per transport rather than claimed working.

### B-03 — Distinguish authorization loss from harmless background errors [P1]

**Where:** `src/lib/query-policy.ts` (`classifyAsyncError`, `resolveAsyncBranch`), `src/components/katalist/AsyncState.tsx`, consumers and permission-sensitive hooks.

**Evidence:** Branch selection uses `hasError`/`isEmpty`; nonempty data bypasses the blocking error branch. Classification is message-oriented, not a reliable structured status/code contract. Nonempty stale data plus a forbidden result is not equivalent to a transient background failure.

**Change:** Carry a typed failure category through the hook/UI boundary. Preserve same-scope data on transient network/refetch failure with a nonblocking warning. On confirmed unauthorized/forbidden/revoked access, remove protected content and show sign-in/unavailable recovery even if old data exists. Do not treat ambiguous transport failure as authorization loss. Normalize HTTP status and database error code as well as message.

**Accept:** Loaded data + 500 remains visible with retry; loaded data + confirmed 403 does not remain readable; expired identity closes protected state; 404/unavailable and successful empty are distinct.

### B-04 — Finish shared-state adoption and policy consistency [P2]

**Where:** `AsyncState.tsx`, `query-policy.ts`, route hooks, `src/features/buckets/use-bucket-notes.ts`, `src/features/catchup/use-catchup.ts`, chat/file hooks.

**Evidence:** Correct offline/confirmed-empty branching exists, but some hooks still return only `data ?? []` plus loading, hiding errors from their consumers. Optional background-fetch state is not a complete background-recovery presentation.

**Change:** Audit every protected collection and detail surface for first-load, retained-data refetch, successful empty, not-found, forbidden, offline and retry. Expose `error`, `hasFetchedOnce`, `isFetching`, retry where appropriate. Apply retry-once policy only to transient reads; retain deliberate no-retry writes.

**Accept:** A rejected notes or Morning Brief child query never becomes “nothing here”; a paused never-fetched query is not confirmed empty; create controls remain outside empty/loading content boundaries.

### B-05 — Extend mutation guarantees to remaining consumers [P1/P2]

**Where:** `src/features/things/query-updates.ts`, `src/features/court/CourtLaneStack.tsx`, `src/features/things/ThingDetailContent.tsx`, `src/features/catchup/CatchUpStack.tsx`, personal-state helpers.

**Implemented:** Court/detail shared claims, epoch-scoped tokens, per-location rollback chains, profile-scoped Court patching, and navigation-aware focus restoration exist. Do not replace these with snapshot rollback or value equality alone.

**Gap:** `CatchUpStack.runAction` still relies on component-local `busy` and direct RPC calls. A local pending state does not share deduplication or ownership with Court/detail; asynchronous continuations also need scope checks.

**Change:** Use the same claim/mutation coordinator for shared Thing actions from Morning Brief. Preserve separate personal-visibility semantics for timed snooze. Guard success/error/toast/refresh/receipt continuations with initiating epoch and relevant context/entity generation. Use synchronous claims, not only disabled buttons.

**Accept:** Two surfaces starting the same Thing action make one write; unrelated Things proceed independently; old callbacks cannot affect a new context; failed actions retain position and newer updates. Invitations/destructive/external operations keep explicit acknowledged progress and no fictitious undo.

## 7. Batch C — fetching, identity, and realtime

### C-01 — Keep completed optimizations; measure their real effect [P2]

**Where:** `src/features/court/fetch-court.ts`, `src/features/buckets/fetch-buckets.ts`, `fetch-bucket-items.ts`, `src/features/things/map-thing-rows.ts`, `src/features/lists/map-list-rows.ts`, `use-lists.ts`, `src/features/me/use-trophy.ts`, `src/features/people/actor-query.ts` (`getActorId`).

**Implemented:** Independent lookup parallelization, direct List-detail mapping, actor resolution cache, child-error propagation improvements, deterministic concurrency tests. Profile-scoped List seeding, identity boundary, Court cache patch scoping and profile-scoped chat read storage are implemented; do not re-list them as missing from older reports.

**Change:** Add route-level counters/timers around actual query boundaries. Report request volume separately from serialization/latency. Test actor provisioning/change invalidation and null-result caching against the current cache helper; retain legitimate dependencies/fallbacks.

**Accept:** Dataset-tagged cold/warm evidence, explicit request counts and scaling curves. Parallelism alone is not described as fewer requests; deleting a redundant auth/detail request can be counted separately.

### C-02 — Separate overview summaries from heavy detail [P2]

**Where:** `map-thing-rows.ts`, `map-list-rows.ts`, `attachments.ts`, Court/list summary consumers, Thing detail queries.

**Evidence:** The common Thing mapper still fetches real attachments and comment-related data for overview batches. Comment-count resolution reads comment rows rather than only an aggregate. Heavy detail hydration remains coupled to overview mapping. `attachments.ts:fetchRealAttachments` also calls `createSignedUrl` once per attachment inside `Promise.all`: those requests are concurrent but their count still scales with attachment rows.

**Change:** Define explicit summary and detail models; preserve existing domain/capability inputs. Fetch only bounded preview metadata/counts for overview. Load full attachments, comments and activity on detail intent. Batch signed-URL creation with the supported storage batch API and retain per-file error state; do not call parallel per-file requests a constant request count. Use a batched aggregate endpoint/query where required; prepare additive SQL and isolated tests if the database API lacks it. Do not silently replace missing fields with fabricated zeroes.

**Accept:** Opening Court does not fetch full attachment/PDF/comment histories; opening detail loads the correct entity with a clear loading/error state; counts remain exact or explicitly unknown. Core Court grouping stays complete.

### C-03 — Add bounded server pagination and stable feed semantics [P2]

**Where:** `src/features/lists/use-list-messages.ts` (`fetchMessages`), `src/features/things/use-thing-comments.ts` (comments/activity queries), `src/features/hub/use-conversations.ts` (`fetchConversations`), history search.

**Evidence:** Inspected message/comment/activity reads are unbounded ordered selects. Hub conversation assembly reads message rows broadly. This does not meet the 1,000-message scaling contract and can encounter backend row limits.

**Change:** Use stable cursor pagination with `(created_at, id)` tie-break ordering. Fetch conversation latest-message/count summaries without downloading all message bodies. Preserve scroll anchors, prepend deduplication, realtime inserts, retries and context scoping. Search must query the server, not only loaded pages. Do not paginate Court incompletely to hide this workload.

**Accept:** 1,000+ messages are reachable exactly once, equal timestamps do not skip/duplicate rows, initial payload is bounded, older-page failures are recoverable without erasing current messages.

### C-04 — Finish secondary-query failure propagation [P1/P2]

**Where:** `map-thing-rows.ts` (`fetchRealAttachments(...).catch(() => new Map())`), `src/features/things/attachments.ts` (`fetchRealAttachments`), `src/features/catchup/use-catchup.ts` (`fetchCatchupMoments`), read-count helpers in `src/features/hub/chat-read-state.ts`.

**Evidence:** Attachment failure can become an empty attachment map both inside `fetchRealAttachments` (`if (error || !rows?.length) return result`) and in its caller's catch. Signed-URL creation errors are discarded separately. Catchup's actor and Thing reads discard their `error` fields. Unread-count queries also read `count` without surfacing an error.

**Change:** Classify required data versus optional decoration. Required Thing/permission failures must reject or expose a partial state. Optional names can have a truthful fallback, but “no files/no unread/no moments” must not mean “lookup failed.” Return typed partial errors or separate queries and retries.

**Accept:** Inject each failure separately. Visible results identify unavailable auxiliary data; no false successful empty/count. Preserve newly fixed Trophy/other fetch error handling instead of relying on outdated deferred lists.

### C-05 — Route realtime payloads to scoped targets [P2]

**Where:** `src/features/realtime/event-invalidation-map.ts` (`targetsForEvent`), `RealtimeInvalidationProvider.tsx`, `invalidation-batcher.ts`, query-key factories.

**Implemented:** Single root owner, epoch guards, 150ms trailing batching with bounded delay, cleanup, reconnect catch-up.

**Gap:** Provider calls `targetsForEvent({ table })`, discarding payload IDs. The mapper accepts old/new but returns only broad static prefixes. A single entity change can refetch unrelated families.

**Change:** Forward old/new/event type; route trustworthy IDs to actual existing entity keys and necessary aggregate keys. Fall back to the smallest safe family when payload is incomplete. Include both old/new parents for moves. Do not assume DELETE fields exist. Preserve deduplication and authoritative server reads.

**Accept:** Twenty related events yield bounded deduplicated refreshes; unrelated cached entities stay quiet; parent moves invalidate both sides; missing payload IDs do not omit necessary refreshes.

### C-06 — Make membership revocation clear all inaccessible surfaces [P1]

**Where:** `RealtimeInvalidationProvider.tsx`, `event-invalidation-map.ts`, `use-conversations.ts`, `use-list-messages.ts`, Hub file/meeting/detail hooks, permission-state presentation.

**Evidence:** `list_members` maps only to `list` and `lists`. The payload-dependent fast path removes only List detail and List messages. Hub conversations/files and other mounted protected state are not comprehensively covered. Therefore the comment that the broad invalidation is the complete fallback guarantee is stronger than the source establishes.

**Change:** Define one access-loss reconciliation path: invalidate/recheck membership authority, close or replace inaccessible detail, clear mounted message/file/member/meeting views and derived dock/sidebar state, cancel their work and detach channels. Ensure mounted observers actually transition; `removeQueries` alone is not a proof. Handle incomplete DELETE payloads via authoritative refetch/recheck.

**Accept:** Open the same List in detail/Hub/dock, revoke membership, and test with full AND primary-key-only event payloads. No stale protected content remains after confirmed loss; unrelated Lists remain intact. Add real QueryObserver/component tests locally; later verify deployed RLS/publication/REPLICA IDENTITY with isolated accounts.

### C-07 — Verify focus/reconnect/subscription lifecycle end to end [P2]

**Where:** realtime provider, shared list-chat channel registry, root identity boundary, chat consumers.

**Change:** Prove one owner across route changes/Strict Mode, last-consumer-only channel detach, old-epoch callbacks rejected, pending batches disposed, and catch-up after missed events. Reconcile master-plan “flush promptly on focus” with current reliance on React Query defaults: test fresh as well as stale queries and an outstanding batch. Add an explicit focus flush only if required; avoid duplicate global refetch loops.

**Accept:** Repeated mount/unmount/reconnect does not multiply subscriptions, healthy event-to-visible latency meets the recorded target, old identity events cannot repaint new identity state. Live reconnect is an external execution gate, not a reason to omit local tests.

### C-08 — Scope Thing-comment read state, separately from fixed chat read state [P2]

**Where:** `src/features/things/read-state.ts` (`getThingLastReadAt`, `markThingAsRead`, `calculateCommentCounts`), `ThingDetailContent.tsx`, comment-count mapper consumers.

**Evidence:** This separate store still uses `katalist_thing_read_${thingId}` without profile identity. Profile A reading a shared Thing can suppress Profile B's unread comments on the same browser. Fixing `hub/chat-read-state.ts` did not fix this module.

**Change:** Thread explicit identity through read/write/count APIs and include profile/session kind as appropriate in storage keys. Never credit an unscoped legacy timestamp to an unknown current profile. Guard remote notification-read side effects by live initiating identity; preview must not trigger unintended live writes. Prefer UUID actor identity over display-name matching for authorship.

**Accept:** Same Thing, two profiles, different unread history remain independent; preview/live do not share history; legacy keys are not trusted; account switch during notification update produces no successor UI/cache side effect.

## 8. Batch D — shared visual/interaction foundations


### D-01 — Apply typography and density tokens to actual pages [P2]

**Where:** `src/styles.css`, `src/components/ui/button.tsx`, `input.tsx`, status/avatar/table components, Court/detail/List/Bucket/Team/Nudges/Me/auth/onboarding screens.

**Evidence:** Tokens and control variants exist; page-by-page adoption is explicitly deferred in the handoff. Numerous local small/fractional font declarations remain. Small text alone is not a WCAG violation, but unadopted tokens do not fulfill D1.

**Change:** Map page title 24–28px, section 16–18px, body/action 14px, compact desktop 13px, metadata at least 12px, mobile input 16px. Use semantic roles/shared density variants and 1.4–1.6 body line height. Migrate one surface at a time, preserving wrapping and information hierarchy.

**Accept:** Screenshot/DOM measurements at all five viewports and 200% zoom, including long titles/names/errors. No primary content clipped or hidden by the new scale. Poppins/white-violet product direction remains unchanged.

### D-02 — Adopt scoped elevation, then remove global suppression [P2]

**Where:** `src/styles.css` (elevation variables and universal shadow suppression), shared dialog/popover/dropdown/sheet surfaces.

**Evidence:** Elevation variables exist while the global shadow suppression remains. Defining unused tokens is not completion.

**Change:** Migrate overlays to explicit surface/elevation classes, keep base surfaces border-led, then remove the universal suppression. Do not re-enable all historical shadows with a global deletion before auditing consumers.

**Accept:** All overlay types remain visually distinguishable, keyboard focus visible, and no unexpected stacked legacy shadows appear.

### D-03 — Finish hit areas, semantics, and numeric contrast review [P2]

**Where:** shared controls plus raw buttons/queue controls in Court/detail/PDF/chat/List/Bucket screens.

**Change:** Use at least 32px desktop and 44px touch hit regions; convert clickable non-native elements when appropriate, give icon-only controls names, visible focus, correct disabled semantics. Measure contrast for text/status/placeholder/disabled states; document results rather than inferring from hex values or screenshots alone.

**Accept:** Keyboard-only primary workflow; no nested buttons; touch targets do not overlap; correct accessible names and tab ordering. See PDF pagination's unnamed icon buttons under H-03.

### D-04 — Finish motion timing adoption and cleanup tests [P2]

**Where:** `src/hooks/use-motion-preference.ts`, `src/lib/motion-tokens.ts`, `src/styles.css`, `use-stack-gesture.ts`, `CourtLaneStack.tsx`, `CourtFocusView.tsx`, preference UI.

**Implemented:** OS OR stored-app reduction, startup/change subscriptions and shared preference are present.

**Remaining:** Timing tokens are not equivalent to replacing every hand-coded GSAP/CSS duration. Handoff explicitly defers retuning. No recorded frame-budget proof.

**Change:** Adopt feedback 100–150ms, local 180–240ms, workspace ≤280ms where appropriate. Reduced motion skips spatial movement. Test cleanup of tweens/Observers on rapid input/unmount. Preserve normal page scrolling outside focused gesture regions. Decide and test an in-memory fallback if saving the preference fails.

**Accept:** Preference changes immediately across CSS/GSAP, survives normal reload, follows cross-tab/OS changes, does not build an animation queue; 60Hz frame target is measured, not inferred.

## 9. Batch E — Court, detail, and capture

### E-01 — Finish native Court navigation and non-gesture action parity [P2]

**Where:** `CourtDesktop.tsx`, `CourtLaneStack.tsx`, `ThingStackCard.tsx`, `CourtWithOthersSidebar.tsx`, `CourtWorkspace.tsx`, `court-stack-model.ts`.

**Implemented:** With Others toggle at intermediate widths, capability-gated Sort button, Catch controls, selection/focus restoration foundation.

**Remaining:** Complete native-control migration for queue/navigator elements, visible prev/next/View all, and button-equivalent Snooze/drag actions. Existing Sort/Catch buttons do not prove parity for all gestures.

**Change:** Inventory gesture actions and give each a labeled keyboard/touch command using the same capability/mutation path. Preserve selected ID, not just index. Keep capability-disabled explanations.

**Accept:** All operations available without swipe/drag; explicit navigation during failed mutation is respected; deferred focus never steals focus from another panel/input.

### E-02 — Verify Court layout, filtered states, and media bounds [P2]

**Where:** Court desktop/workspace/stack/card/view-model files, `src/routes/index.tsx`.

**Change:** Verify ≥1280 readable lanes plus sidebar; 1024–1279 labeled toggle; below1024 stacked/collapsible lanes and dedicated With Others access. Keep bounded image previews and predictable metadata. Differentiate truly empty Court from filtered-empty; expose capture vs Clear filters and explain visible/total counts.

**Accept:** Five viewport captures, keyboard and 200% zoom; long titles and media do not displace actions; opening/closing detail restores the same Thing and position. Replace full-PDF card rendering under H-01.

### E-03 — Integrate real per-Thing drafts and entity-safe async work [P1]

**Where:** `src/features/things/ThingDetailContent.tsx`, `src/features/drafts/session-drafts.ts`, inline/modal/focus/sheet wrappers.

**Evidence:** Draft store exports exist but no production consumer imports were found. Detail keeps `comment` in component state; Thing-change effects reset attachment selection/attachments but do not implement a per-Thing text draft. Failure restoration writes text/attachments into current component state without a complete per-entity draft ownership model.

**Change:** Key draft by identity/epoch, context as needed, Thing ID and composer kind. Hydrate on entity selection; retain on close/navigation; explicit discard only. Capture initiating entity and draft revision for uploads/submits. A late failure restores that entity's draft without overwriting newer text or another entity. File selection must belong to the selected Thing. Register nonempty draft/upload as a blocking interaction.

**Accept:** Type in A, switch B, type B, fail A's pending send: A and B retain their own text/files; B never submits A's draft. Null/unmount/account change follows the documented discard policy. Closing nested dialogs does not discard drafts accidentally.

### E-04 — Complete shared detail architecture or record a scoped exception [P2 / scope decision]

**Where:** `ThingDetailContent.tsx`, `InlineThingDetailWorkspace.tsx`, `ThingDetailSheet.tsx`, `CourtDetailModal.tsx`, `CourtFocusView.tsx`, proposed `src/features/things/components/{ThingIdentityHeader,ThingStatusControls,ThingAttachments,ThingDiscussion}.tsx`.

**Implemented:** Shared capability function and some shared presentation; view-only banner extracted. Variant UIs still differ materially.

**Change:** Extract shared behavior and section contracts without forcing identical layouts. Controlled variants may retain different composition while sharing mutation/pending/capability/draft behavior. Make work status primary, acknowledgement secondary, and pace ownership explicit. Implement real Comments/Activity tab semantics. Preserve readable terminal detail headings and intentional completed-row treatment.

**Scope note:** Handoff says the user approved retaining variants and Bucket modal. This audit does not independently establish that approval. If accepted, record the exact superseded original requirements and revised acceptance. A modal is not intrinsically a bug; silently calling an unmet original extraction/inline requirement complete is the reporting problem.

**Accept:** Same Thing from Court/List/Bucket/Nudge shows equivalent state/permissions and mutation outcomes; no stale draft/file; terminal controls explain read-only state. Layout may differ intentionally.

### E-05 — Finish Magic Box draft/upload/result contract [P2]

**Where:** `src/features/court/MagicBox.tsx`, `parse-toss.ts`, `src/features/things/attachments.ts`, `src/lib/file-utils.ts`, draft/blocker primitives.

**Implemented:** Multi-assignee retry tracks failed assignees instead of recreating successful ones; size validation exists.

**Change:** Show destination List/context before submit. Persist draft and successful uploaded file handles on recoverable failure/navigation. Track each file as validating/uploading/ready/failed with retry/remove and truthful progress (indeterminate if bytes unavailable). Keep successful files on partial failure. Escape returns focus without deleting text. Success identifies created Thing(s) and offers Open. Guard timers/toasts against retired scope.

**Accept:** Double submit makes one operation; retry after partial success targets only failed work; slow/unsupported/oversize/file failure does not lose other files or text; changing route does not silently discard draft. Do not auto-retry external notifications.

## 10. Batch F — Morning Brief

### F-01 — Fix executable claim SQL before deployment [P1, reproduced]

**Where:** `supabase/migrations/20260923100000_morning_brief_receipts.sql`, `claim_morning_brief` around the insert conflict clause and duplicate-row select.

**Reproduction:** Creating the migration succeeds. First invocation fails with `column reference "local_date" is ambiguous`. `RETURNS TABLE` creates a PL/pgSQL variable named `local_date`, conflicting with `ON CONFLICT (profile_id, context, local_date)`. Replacing that clause in memory with the unique constraint name reaches a second ambiguity in `WHERE ... local_date = v_local_date` on duplicate invocation.

**Change:** Use `ON CONFLICT ON CONSTRAINT morning_brief_presentations_profile_id_context_local_date_key DO NOTHING` (verify exact constraint name); qualify all table columns with aliases in reads. Audit every output-variable/column overlap. Do not assume migration parsing executes function branches.

**Accept:** Execute actual SQL locally: first claim true, duplicate false, separate context/date independent, authenticated owner only, no anonymous invocation, owner-only receipt reads. Add concurrent claims in isolated Postgres when available. Keep SQL test in the suite rather than a source-string check. If migration has already been deployed elsewhere, use a forward corrective migration, not rewritten deployed history.

### F-02 — Align client/server timezone and threshold contract [P1/P2]

**Where:** same migration's claim/dismiss functions, `morning-brief-schedule.ts`, `morning-brief-receipts.ts`, `use-morning-brief.ts`.

**Evidence:** Client respects a valid profile `UTC`; SQL treats `UTC` as a fallback signal and substitutes the client timezone. The comment claiming explicit UTC is respected contradicts the condition. Server claim does not enforce the 07:00 threshold. Invalid/missing profile timezone handling must agree on both sides.

**Change:** One explicit effective-timezone rule: valid saved profile zone wins, including UTC; browser zone only if profile zone is absent/invalid. Do not infer “unset” from a valid UTC value. Validate zone and calculate date/eligibility from server time. Use the same rule in dismiss; preferably dismiss the actual claimed receipt key rather than recomputing a different day after midnight/timezone change.

**Accept:** UTC user travelling elsewhere, invalid/missing zone, DST boundaries, before/after07:00, midnight and profile timezone change all produce matching client/server scope. Early direct claim cannot consume the day's automatic presentation contrary to contract.

### F-03 — Revalidate after claim; scope open state and timers [P1]

**Where:** `src/features/catchup/use-morning-brief.ts` (`attemptClaim`, threshold timer, dismiss/open state).

**Evidence:** After awaiting claim, only identity epoch is checked before `setOpen(true)`. Work/Home context changes do not necessarily advance identity epoch. Visibility/blocker/moments can change while the request is pending.

**Change:** Capture a scope generation including identity/context/effective date/timezone. Maintain fresh eligibility inputs and recheck them after await. Cancel stale continuations on scope change/unmount. Scope/reset open/presentation state; dismiss using the receipt associated with the displayed presentation. If eligibility disappears after successful claim, retain receipt and do not open; manual review remains available.

**Accept:** Deferred claim + context switch, call start, dialog open, typing, hidden tab, empty/error moments, logout or unmount never opens stale UI. Overnight timer reevaluates the new date with current inputs.

### F-04 — Wire all interaction blockers, not only connected calls [P1/P2]

**Where:** `src/components/katalist/use-interaction-blocker.ts`, provider, Magic Box/detail/chat/note composers and blocking dialogs, `src/features/calls/use-list-call.ts`.

**Evidence:** Only production `useBlockWhile` consumer found is the call hook, with `joined`. Draft/modal blockers are not integrated; joining is not blocked by that boolean.

**Change:** Register active dirty composers, attachment selection/upload, blocking dialogs and call joining/connected/reconnecting states. Use ownership tokens/refcounts so one component cannot release another's blocker. Clean on close/discard/unmount/identity retirement. Do not treat every harmless popover as an indefinitely blocking interaction.

**Accept:** Auto-open waits until the actual blocker ends; simultaneous blockers release independently; no stale blocker after unmount; a pending call cannot be interrupted by Morning Brief.

### F-05 — Expose real moment errors and require successful loading [P1]

**Where:** `src/features/catchup/use-catchup.ts` (`fetchCatchupMoments`, return contract), `use-morning-brief.ts`, banner/overlay.

**Evidence:** Hook exposes moments/count/loading but no error. Required Thing lookup errors can become `[]`; controller can evaluate cached moments without knowing a current query failed.

**Change:** Propagate actor/Thing errors, return error/readiness/refetch state, and gate auto-open on the defined successful readiness contract. Manual review shows recoverable error instead of empty success. Preserve correctly loaded moments during transient refresh with explicit state; do not silently use uncertain eligibility for automatic interruption.

**Accept:** Initial RPC failure, child Thing failure, background failure, paused never-fetched and true empty success are distinct; no failed fetch is represented as “no moments.”

### F-06 — Implement the requested responsive brief, not just its name [P2]

**Where:** `CatchUpOverlay.tsx`, `CatchUpStack.tsx`, `CatchUpStackCard.tsx`, `CatchUpBanner.tsx`.

**Evidence:** Overlay remains `max-w-xl`, with title/count and one stack. It is not the original approximately960px desktop queue/detail/category/progress design, nor an explicitly full-height mobile dialog.

**Change:** Desktop greeting/date, actual present-category counts, bounded navigable queue, selected detail and truthful review progress. Mobile viewport-safe full-height surface, readable single card/compact selector/sticky actions and keyboard-aware scrolling. Keep real actor/reason/due/files/comments; omit unsupported explanation rather than inventing it.

**Accept:** Correct counts/selection at empty/single/many moments, long text and five viewports; focus trap/Escape/restoration/reduced motion; no fake sample data in live view.

### F-07 — Separate navigation, action success, and receipt failure [P2]

**Where:** `CatchUpStack.runAction`, `useCatchup.surfaceMoment`, `catchup-logic.ts`.

**Implemented:** Actions call the surface receipt after successful action; navigating cards is not automatically an action. Keep that distinction.

**Change:** Combine B-05 shared claims with explicit receipt status. `surfaceMoment` currently starts a fire-and-forget mutation; make failures recoverable without repeating the already-successful Thing action. Never label traversal “resolved.” Verify completed/failed action changes against current moment identity, not a stale deck index. Keep stable queue order if useful, but do not freeze authorization/status indefinitely with the deck snapshot: current entity changes/revocation must update or disable displayed actions.

**Accept:** Failed Thing action records no receipt; failed receipt can retry only the receipt; next/previous does not resolve; opening Thing/dismiss closes without modifying underlying work.

### F-08 — Complete daily-behavior and rollout tests [P2 / external gate]

**Where:** morning-brief schedule/receipt/controller tests, SQL tests, browser fixtures, feature flag.

**Change:** Cover all original cases: before/after07:00, first late visit, Escape/X/backdrop/completion/open-Thing, reload, midnight, DST, timezone change, empty/error, manual reopen, account/context switch, snoozed work, successful/failed action and two claim contenders. Test storage-unavailable preview behavior; current preview adapter may claim again after remount when persistence fails. Use session fallback or explicitly bounded fail-closed behavior. Do not claim cross-device atomicity from localStorage/Web Locks.

**Accept:** One live automatic presentation per owner/context/date; tomorrow reevaluates; manual always accessible; unavailable RPC skips auto-open. Deploy corrected additive schema before internal flag/pilot. Notification scheduling remains separate from popup eligibility.

### F-09 — Filter the actual moment data by Work/Home context [P1]

**Where:** `src/features/catchup/use-catchup.ts` (`fetchCatchupMoments`, `derivePreviewMoments`, query function), `supabase/migrations/20260922140000_catchup_excludes_active_snooze.sql` (`list_catchup_moments`).

**Evidence:** The query key includes context, but the live query function takes no context. The current RPC takes no context and its candidate queries do not filter it; the follow-up Thing lookup also lacks a context predicate. Preview follow-up/ghost construction uses context, but notification/snooze collection and final moment-to-Thing resolution do not consistently filter the resolved Thing's context. A scoped cache key does not scope the underlying returned data.

**Change:** Pass active context into the fetch function and filter authorized resolved Things/moments by actual Thing context. If moving this to the RPC for efficiency, use an additive, validated context parameter and preserve existing caller compatibility. Apply the same filter to every preview moment category before counts and auto-open eligibility. Never derive context from a title or stale UI label.

**Accept:** One profile with actionable Work and Home moments sees only the chosen context in count, queue and actions; Home-only moments cannot trigger a Work receipt/auto-open. Test every category and context switch while a fetch is pending. Cross-context filtering does not replace authorization checks.

## 11. Batch G — page-by-page completion

### G-01 — Complete onboarding flow, not only the example card [P2]

**Where:** `src/routes/onboarding.tsx`, `welcome.tsx`, `auth.tsx`, `src/hooks/useSession.ts`.

**Evidence:** Onboarding still has six steps and an additional contacts screen; Connect routing and real illustrative preview improved. The original three-step, skip/resume, authenticated-return contract is not implemented by those fixes.

**Change:** Three concrete steps: capture, Court/Catch, optional discovery. Preserve progress per appropriate identity/session, provide Skip/Resume, route unauthenticated direct entry through auth with validated return destination. Do not replay welcome for returning users.

**Accept:** New/returning/direct-link/skipped/expired-session flows have deterministic destinations. No blank preview and no six-step mandatory replay.

### G-02 — Correct discovery copy and finish auth acceptance [P2]

**Where:** contacts screen in `onboarding.tsx`, `ContactsDialog.tsx`, auth/welcome, `src/lib/fixed-otp.ts`.

**Evidence:** “I need your contacts”/matching copy remains although the button opens in-app Contacts rather than performing an address-book import.

**Change:** Label Find people and describe actual discovery; do not imply permission/import success. Preserve auth return to intended discovery. Gate demo entry/copy to explicitly enabled deployments. Verify country control default/name, OTP invalid/expired code, resend cooldown and email fallback.

**Accept:** Connect does what it says; no fabricated imported contacts; auth states are accessible and recoverable. Do not infer an OTP/security defect without testing the configured contract.

### G-03 — Finish List index semantics and responsive states [P2]

**Where:** `src/routes/lists.index.tsx`.

**Implemented:** Creation controls remain available for empty collections after AsyncState boundary correction.

**Change:** Preserve role grouping, true List-name link and separately focusable actions, persistent accessible search name, relative timestamps plus exact date on demand, stacked narrow summaries. Replace interactive row divs where they duplicate link/button behavior and avoid nested controls. Ensure empty/filtered/error/forbidden states remain distinct.

**Accept:** Keyboard open/new-tab/row-actions, duplicate titles, long names, no results, empty success and failed read at mobile/zoom.

### G-04 — Make List filters and selected-detail state entity-safe [P2]

**Where:** `src/routes/lists.$listId.tsx`, filter storage key `katalist.lists.things_filter...`, selected-Thing logic.

**Evidence:** Active/All/Completed UI exists; storage key includes user/List. State initializes from localStorage once, then an effect writes when the key changes. If the router reuses the component for another List, A's selection can overwrite B's saved filter. Validate actual route reuse rather than assuming remount.

**Change:** Read and validate persisted filter on List/profile scope change before writing, or use an explicitly keyed child. Default All. Preserve selected ID when possible; if a filter hides it, explain and offer Clear filter. Expose/remove inert due/sort state intentionally rather than leaving inaccessible controls.

**Accept:** A→B→A retains each List's filter with no transient overwrite; corrupted storage falls back safely; context/account changes do not leak selection; selected filtered-out item is explained.

### G-05 — Extract List workspace and reuse shared chat [P2]

**Where:** `src/routes/lists.$listId.tsx`, proposed `src/features/lists/components/` Things/Members/invite sections, `ListChatPanel.tsx`.

**Evidence:** Route remains large and retains separate chat presentation rather than fully composing the shared panel. Fixing one scrolling behavior does not remove two implementations.

**Change:** Extract behavior-covered sections incrementally; route owns loading/tab/composition. Reuse shared chat draft/send/read/scroll behavior while allowing context-specific layout. Clarify assigned importance in lane grouping. Preserve member/invite permissions and pending/error states.

**Accept:** Things/Chat/Members tab semantics, role gates, long descriptions, member removal and rapid List switch; no duplicate subscriptions or lost scroll/drafts. Do not combine extraction with an untested lifecycle rewrite.

### G-06 — Fix Bucket note error/draft/save ownership [P1/P2]

**Where:** `src/features/buckets/use-bucket-notes.ts`, `src/routes/buckets.$bucketId.tsx` note editor/save/close handlers.

**Evidence:** Hook throws query errors but returns only `notes: data ?? []` and loading; consumer cannot distinguish failure from empty. Editor save/close workflow lacks full per-note draft ownership and unsaved-close protection.

**Change:** Expose read error/retry/readiness; show AsyncState appropriately. Key draft by profile/Bucket/note (including a stable new-note ID). Show saving/saved/error; use a synchronous pending guard. Capture edit-session generation so save A cannot close or overwrite newly opened note B. Confirm or retain on dirty close; preserve input after failure.

**Accept:** Rejected read is not “no notes”; double save creates once; close/open another note during pending save does not affect the new editor; failed save retains text; identity changes clear private drafts by policy.

### G-07 — Finish Bucket reference/permission/command semantics [P2]

**Where:** Bucket index/detail, `use-bucket-items.ts`, `bucket-items-surface.ts`, `SpringLoadedBucketFlyout.tsx`.

**Implemented:** Unique-Thing progress deduplication is improved. Do not regress direct-plus-List overlap handling.

**Change:** Add “Private collection. Shared items keep their existing permissions.” Distinguish adding a reference from creating a Thing (avoid misleading New Thing labels). Provide explicit unavailable-reference state on revoked/deleted sources. Use same add command from keyboard and drag. Define denominator as unique accessible non-cancelled Things. Resolve inline-vs-modal scope decision under E-04.

**Accept:** Another profile cannot read private Bucket; reference addition changes no source permission; inaccessible source is not false empty; shared source counted once; keyboard add/remove and failed operations recover.

### G-08 — Scope chat drafts, scroll, and async continuations [P1/P2]

**Where:** `src/features/lists/ListChatPanel.tsx`, duplicate List chat until removed, `ConversationWorkspace.tsx`, `ChatHeadsDock.tsx`, session draft store.

**Change:** Per-identity/conversation draft and scroll anchors; register dirty/upload blockers. Preserve drafts through close/route change, explicit discard only. Restore the correct conversation's input after failed send; ignore old entity callbacks when the panel changes. New-message pill instead of forced bottom scroll when reading older content.

**Accept:** A/B rapid switch, dock/full workspace of same conversation, failed sends and route unmount preserve correct state; no draft submitted to wrong destination.

### G-09 — Add stable optimistic message identity and retry [P2]

**Where:** `src/features/lists/use-list-messages.ts` (`send`/`sendSystem`), shared chat UI, notification endpoint contract.

**Evidence:** Send inserts directly without a stable client message ID/onMutate pending row workflow. A success response lost after server commit can make naive retry duplicate the message. Post-insert notification flow awaits a fresh session and must be reviewed for stale-scope effects.

**Change:** Generate a stable operation/message ID once; server-enforce idempotency where needed. Render pending/sent/failed; retry same ID; reconcile realtime echo without duplicate rows. Resolve mentions to validated profile IDs, not just text. Capture initiating epoch/session authority and stop later side effects if retired; never associate an old operation with a new account's token.

**Accept:** Slow send, network loss after commit, repeated retry, realtime-before-response, account switch between awaits and duplicate names/mentions. One logical send yields one row and no duplicated external notification.

### G-10 — Mark read only for content actually viewed [P2]

**Where:** `src/features/hub/components/ConversationWorkspace.tsx` read effect, `src/features/hub/chat-read-state.ts`, shared chat, dock and List index unread consumers.

**Implemented:** Read storage is profile-scoped and background-tab suppression exists. The old cross-profile localStorage gap is fixed.

**Evidence:** Workspace effect checks document visibility but not `tab === "chat"`, loaded content or visible message boundary. It writes wall-clock now on entering the workspace, including Files/Call.

**Change:** Mark through latest actually viewed message timestamp/ID only when visible chat content is ready and appropriately read. Do not clear all unread by visiting Files/Call. Share the event/source across sidebar/List/dock, handle cross-tab storage updates if required. Preserve unread above/below a reader's scroll position.

**Accept:** Open Files/Call => unread retained; hidden/failed-loading chat => retained; view messages => consistent counts across surfaces; arriving messages while reading history remain indicated.

### G-11 — Finish Hub landing/header/actions [P2]

**Where:** `src/routes/team.index.tsx`, `team.$conversationId.tsx`, `HubSidebar.tsx`, `ConversationWorkspace.tsx`, Contacts/NewGroup dialogs, dock.

**Change:** Distinguish genuinely empty account from populated “Select a conversation.” Seed header from chosen sidebar record or skeleton; do not derive fabricated zero members from missing data. Keep clear Chat/Files/Call destinations, one primary call entry and consistent search. Contextualize Pin labels by message. Verify dock can be dismissed without losing work.

**Accept:** Slow/failed header fetch, empty/populated accounts, long names, keyboard tab/action navigation, contacts/group errors, and no accidental call just from opening/reviewing a conversation.

### G-12 — Finish Nudges acceptance without undoing completed work [P2]

**Where:** `src/routes/nudges.tsx`, `use-nudges.ts`, `escalation-logic.ts` and RPC contract.

**Implemented:** All lists filter, truthful How nudges work dialog, corrected search and actionable See all exist; eligibility error separation exists.

**Change/check:** Verify semantic tabs, selected filter/no-result recovery, actual server-backed history pagination if See all promises full history, accessible disabled explanations, RPC cooldown/quiet-hour parity and distinct manual/automated limits. Apply D1 tokens.

**Accept:** Every enabled control works as labeled; failed history does not hide current work; uncertain eligibility is not a false negative; server rejection produces truthful recovery. Do not invent editable settings without persistence.

### G-13 — Complete profile/preferences acceptance [P2]

**Where:** `src/routes/me.tsx`, `use-profile.ts`, `use-trophy.ts`, push registrar/config/registration, notification hooks, directory/public contracts.

**Implemented:** Last7days label, synthetic-email hiding, own-phone display, explicit push enable and real permission state, motion setting.

**Change/check:** Explain actual streak calculation; keep event-count metrics distinct from completed Things. Accessible preference dialogs, profile-save draft retention, avatar per-file progress/failure, denied permission recovery, truthful theme/notification/privacy copy. Verify public payload privacy separately from legitimate private self-view.

**Accept:** Save rejection keeps edits; permission denied does not repeatedly prompt; supported recovery is explained; reduced motion reloads; public directory/Bridge responses do not expose private phone/email. No dark-mode expansion merely to justify old copy.

## 12. Batch H — files, calls, and Bridge

### H-01 — Remove full-PDF hydration from overview cards [P2]

**Where:** `src/features/court/ThingStackCard.tsx` (renders `PdfCanvas` for first PDF), `src/features/things/PdfCanvas.tsx`, attachment summary pipeline.

**Evidence:** pdf.js is dynamically imported, but mounting `PdfCanvas` on a Court card still calls `getDocument` for the actual PDF. Lazy library import is not a thumbnail-only overview.

**Change:** Render a generated/cached thumbnail or file-type summary on cards; load full PDF only on explicit preview. Bound media geometry and retain aspect ratio. No expensive offscreen document work.

**Accept:** Court with many PDF attachments does not initiate full document loads; explicit preview does; initial payload/frame time remains bounded.

### H-02 — Fix PDF loading/render races and cancellation [P1/P2]

**Where:** `src/features/things/PdfCanvas.tsx` load effect and `renderPage`.

**Evidence:** `getDocument(...).promise` is awaited without retaining/destroying its loading task. Render cancels the current task before `await doc.getPage`, but does not recheck a render generation after that await. An older page request can resume after a newer one and render into the same canvas. The load continuation also captures the original page value.

**Change:** Retain PDF loading task, destroy/cancel at URL change/unmount; separate document and page generations. After every await, verify document/page/generation/canvas ownership before drawing or updating state. Cancel prior render when installing the new one. Use latest requested page after document resolves; resize safely without racing.

**Accept:** Deferred page1/page2 results resolving out of order always show latest selection; URL A→B during load never paints A; unmount terminates pending work; no stale error/ready state. Add mocked PDF-task component tests locally.

### H-03 — Implement preview/download recovery and accessible controls [P2]

**Where:** `PDFViewer.tsx`, `PdfCanvas.tsx`, `attachments.ts`, `HubFilesPanel.tsx`, `src/lib/file-utils.ts` (`downloadFile`).

**Evidence:** PDF error is generic; download creates a link rather than reporting asynchronous failure; cached signed-URL refresh is deferred. PDF prev/next icon buttons lack explicit accessible names in the inspected source; preview has fixed widths requiring responsive verification.

**Change:** Distinguish unsupported/expired/access-denied/network failure. Refresh expired signed URLs through authorized owner-aware lookup, retry boundedly, and never bypass denied access. Provide file-level retry/download state and named page controls. Preserve file ownership when selection changes. Make preview fit small screens/keyboard.

**Accept:** Expired URL recovers once; revoked access stays denied; failed download is explained; correct file after rapid switch; keyboard previous/next have names and hit targets.

### H-04 — Own and release temporary file resources [P2]

**Where:** `src/lib/file-utils.ts` (`getSafeFileUrl`, `processFileForUpload`), Magic Box/comment/chat/call preview owners, attachment helpers.

**Evidence:** `processFileForUpload` creates blob URLs; repository search shows explicit revocation for List covers but not a complete lifecycle for these Thing upload previews.

**Change:** Make blob URL ownership explicit: release on remove/discard/replacement/unmount when no retained draft needs it; retained drafts must transfer ownership instead of premature revocation. Clean failed uploads and FileReader/timers; do not revoke remote URLs. Review external Office/Google viewer use: it sends file URLs to third parties, so keep private-file policy explicit rather than treating it as an internal renderer.

**Accept:** Repeated upload/remove/preview cycles release resources; retained draft previews remain valid; 30-cycle heap test has no monotonic retained-growth pattern. Third-party private URL disclosure is either explicitly approved or replaced with a suitable safe fallback.

### H-05 — Guard call-hook lifecycle against stale joins [P1]

**Where:** `src/features/calls/use-list-call.ts` (`join`, catch/finally, callbacks, `leave`), `call-room.ts`.

**Implemented:** Low-level CallRoom leave-vs-media acquisition cleanup was improved. Do not remove it.

**Source sequence:** join A pending → leave A → join B → A rejects. A's unconditional catch assigns `roomRef.current = null`, sets error, and finally clears connecting. Those operations can now target B's UI/ref. B can lose its cleanup owner.

**Change:** Use a monotonically scoped join/room generation. Every onState/onReaction/onDraw/onDocPage and await continuation verifies it owns the active room. Clear the ref only if it equals that room. Dispose failed/retired room without touching its successor. Track/clear reaction timers and other hook resources; include context/list change policy.

**Accept:** Deferred A/B joins resolving/rejecting in either order cannot clear B, emit stale toast, set false connection state, or leak media. Final leave stops B tracks. Test the hook, not only the low-level class.

### H-06 — Complete visible call recovery and blocker integration [P2]

**Where:** `use-list-call.ts`, `ListCallPanel.tsx`, `StartCallDialog.tsx`, `CallRingProvider.tsx`, `AnnotateCanvas.tsx`.

**Change:** Show joining/connected/reconnecting/ended/error states in actual UI, not only return values. Recover mic/camera denial with actionable retry/instructions and supported audio-only choice, not just toast. Block Morning Brief during joining as well as connected/reconnecting. Stop ringtone/tracks/listeners/timers on all exit paths; require explicit participant confirmation before ring/send.

**Accept:** Opening a review never initiates a call; denial yields a recoverable panel; leaving during permissions/screen-share stops late tracks; no stale ringtone or active mic. Unit/component tests first, isolated two-user device tests later.

### H-07 — Verify meetings and real multi-party behavior [P2 / external gate]

**Where:** `ScheduleMeetingDialog.tsx`, `MeetingReminderCard.tsx`, call-lobby/ring/media implementations.

**Change/check:** Clock/timezone fixtures for meeting due labels/reminders, explicit ring targets and no double-send on retry. Prepare two-account call E2E checklist with permission denial, disconnect/reconnect, screen-share end, supported device switch and final leave. Never use real contacts as fixtures.

**Accept:** Meeting timezone matches displayed due/reminder; two isolated users connect/recover/leave; all tracks stop. Record browser/device evidence rather than claiming it from mocked media alone.

### H-08 — Execute and extend Bridge authorization/idempotency coverage [P1 release gate]

**Where:** `src/routes/bridge.$token.tsx`, `src/routes/api/public/bridge/{thing,act,comment,redeem}.ts`, `src/lib/bridge-session.server.ts`, relevant SQL RPCs, `tests/run-bridge-e2e.ts`.

**Implemented/evidence:** Public flow has existing token/session enforcement and scoped server checks; backwards status button was corrected. No new authorization bypass is asserted by this report.

**Remaining:** Existing live matrix was not run against this checkout/deployed policies. Anonymous malformed-token smoke is not a positive/negative authorization test.

**Change/check:** Run isolated valid/expired/revoked/malformed/wrong-recipient/wrong-session/terminal/unrelated-Thing cases against every endpoint, including comments/files. Verify authoritative capabilities, one-Thing scope, generic safe errors and safe next step, no raw token/private payload logging. Test repeated submit and lost response for duplicate comments/state transitions; add idempotency only where absent and required.

**Accept:** All cases have executable assertions and recorded environment/fixture cleanup; private List/Bucket/phone/file data inaccessible. Service-role credentials never enter browser bundles or logs. Deployment and live fixture creation require explicit authority.

## 13. Verification, rollout and documentation completion

### V-01 — Write the missing authenticated browser matrix [P2]

**Where:** `tests/e2e/preview/smoke.spec.ts`, new isolated authenticated specs under `tests/e2e/staging/`, fixtures.

**Evidence:** Current 15 passes repeat three anonymous cases across five viewports. Staging currently has setup documentation, not the complete golden-path implementation.

**Change:** Write fixtures and specs now; mark execution gated by explicit isolated credentials, not silently passed. Golden path: capture → Catch → pace → comment/file → eligible Nudge → Sorted from Court/List/Bucket. Cover Work/Home, two identities, view-only, revoked access, duplicate names, slow/offline/stale tab, dirty drafts and failed mutations.

**Accept:** Test list maps to master acceptance clauses; fixture IDs unique and cleanup confined; no real conversations/customer data touched; skipped live cases visibly reported as unverified.

### V-02 — Repair mixed Playwright configuration and wire safe CI [P2]

**Where:** `playwright.config.ts`, `.github/workflows/quality.yml`.

**Evidence:** When staging env is configured, `webServer` becomes undefined but localhost preview projects remain registered. A full run then still needs localhost although the config no longer starts it. `reuseExistingServer: true` also makes an unknown existing server possible evidence unless its revision is checked.

**Change:** Separate explicit preview/staging configs or select projects/server lifecycle consistently. Use an isolated configurable port; record tested build SHA; do not stop another developer's server. Add anonymous smoke CI with browser install and trace artifacts. Add separately authorized staging job/secrets later.

**Accept:** Preview-only, staging-only and intentionally combined invocations each work with documented dependencies; CI does not mutate production or auto-migrate; real CI result linked after authorized push.

### V-03 — Implement and run performance measurement harness [P2]

**Where:** route/query instrumentation, browser performance specs, isolated dataset fixtures, report artifacts.

| Metric | Required target/evidence |
|---|---|
| Input feedback | ≤100ms visible feedback, interaction trace |
| Warm navigation | Useful content p75≤300ms, at least20 navigations |
| Cold route | Useful content p75≤2.5s with fixed device/network/dataset |
| Responsiveness | INP≤200ms where measurable; distinguish lab proxy from field INP |
| Layout stability | CLS≤0.1 during route/media load |
| Motion | Target≤16.7ms/frame at60Hz; record long tasks>50ms |
| Stalled read | Recovery/cancellation evidence by15s |
| Realtime | Visible update≤1s after receipt on healthy connection |
| Memory |30 detail/preview cycles with retained-heap comparison |

**Datasets:** 0/30/300 Things, 0/10/100 Lists, paginated1,000-message conversation. Record browser/device/viewport/build/network/account fixture for every trace. A credentials gap blocks live measurement, not writing counters, fixtures or deterministic stalled-request tests. Do not add virtualization/new infrastructure without measured need.

### V-04 — Finish accessibility and responsive acceptance [P2]

**Where:** all primary routes and dialogs, browser tests and manual checklist.

**Change:** Five viewports:390×844,768×1024,1024×768,1440×900,1920×1080. Test keyboard-only,200%zoom,reduced motion,touch and desktop VoiceOver. Add automated scans locally for anonymous/fixture-supported screens; they do not inherently require live credentials. Manual semantics/focus behavior is still required.

**Accept:** No inaccessible primary action, trapped focus, invisible dialog title, nested control, inaccessible validation or offscreen action. Record contrast/target measurements; do not claim full WCAG conformance from a scan.

### V-05 — Add privacy-safe observability [P2]

**Where:** existing logging/instrumentation boundaries, route/query/mutation/realtime/Morning Brief controllers.

**Change:** Structured events for route load, query failure/timeout, mutation failure, reconnect and brief claim/presentation/dismiss/action. Include safe category/duration/outcome/scope identifiers only where appropriate; no message/task body, file content, phone, raw token or credential. Prefer existing infrastructure; no new analytics vendor by default.

**Accept:** Tests verify redaction and bounded event volume; dashboards/log queries can distinguish claim failure from no moments and failed load from true empty. Product evaluation tracks first capture/Catch/completion and return usage without claiming retention from visual polish.

### V-06 — Separate source completion, test completion and release authorization [P1 release gate]

**Where:** corrected migration, flag configuration, deployment checklist, final handoff.

**Change:** Fix SQL and local regressions → isolated SQL/RLS tests → authorized schema/RPC deployment → old/new client compatibility → internal flag → small pilot → expand. Rollback disables auto-open/restores previous UI without deleting receipts/customer work. Do not bundle deployment with app build.

**Accept:** Recorded owner/environment/approval/results for each external operation. No known hook-order, identity leakage, authorization, duplicate-write, lost-draft, false-empty or inaccessible-primary-action defect remains. Off-by-default feature flag is mitigation, not proof of feature completion.

### V-07 — Correct completion reporting and source index [P2]

**Where:** `KATALIST_D_TO_H_PROGRESS.md`, `KATALIST_D_TO_H_FINAL_HANDOFF.md`, `2026-09-23-c1-c2-reconciliation.md`, master-plan status/index.

**Evidence:** Handoff §8 says every locally executable requirement is implemented, while §§6–7 list token rollout, durations, drafts and other locally executable work as deferred. Some older C/G gap statements are already stale.

**Change:** Link this audit; use implemented/partial/unverified/approved exception/external gate per acceptance criterion. Preserve historical reports as dated history rather than deleting evidence. Replace obsolete `use-realtime.ts` current-source references with provider/mapper/batcher files; distinguish proposed filenames from existing files. Record exact approved changes to original scope.

**Accept:** No batch marked wholly complete merely because its scaffolding/test count exists. A reader can identify remaining code work separately from unwritten tests and unrun live checks.

## 14. Execution order for the next implementation agent

Do not restart A–H, rewrite the application, or spend another round redesigning already-working identity primitives. Close this delta in bounded commits.

1. **Correctness first:** F-01/F-02 SQL; F-03/F-05 stale claims and truth; H-05 call race; E-03 draft ownership; G-06 notes; B-03/C-06 access loss.
2. **Shared integration:** F-04 blockers; B-05 shared actions; G-08/G-09 chat drafts/idempotency; H-02/H-04 media ownership.
3. **Data efficiency:** C-02/C-03 summary/pagination; C-04 failures; C-05/C-07 realtime targeting; B-02/B-04 cancellation/state adoption.
4. **Page completion:** D tokens/elevation/motion; E Court/detail/capture; F layout; G entry/List/Bucket/Team/Nudges/Me; H file/call recovery.
5. **Evidence/reporting:** A behavioral conversions; V browser/config/CI/instrumentation/accessibility; reconcile all tracker statuses.
6. **External validation only when authorized:** staging fixtures, migrations, two-user realtime/media/Bridge checks, performance runs, internal pilot.

For each fix: add the smallest regression test that fails against the old behavior; implement; run targeted tests then typecheck/full tests/lint/build:app. Use real QueryClient/React DOM where behavior crosses those boundaries. SQL must execute, not merely match strings. Keep edits scoped and preserve user work.

Do not turn absent staging credentials into a reason to leave client code, SQL test harnesses or test specifications unwritten. Conversely, do not fabricate a live pass from a mock. If the remaining work exceeds one session, stop with exact open audit IDs, not a broad completion claim.

## 15. Final completion checklist

- [ ] Every audit item has evidence-backed disposition: implemented, verified, approved exception, or explicitly external-gated.
- [ ] Every original A–H work package has all acceptance clauses mapped to tests/manual evidence.
- [ ] F-01 executable SQL failure fixed before migration deployment.
- [ ] No stale claim/call/upload/send/save continuation modifies a successor scope.
- [ ] Composers consume scoped drafts and blockers; no false-empty error handling.
- [ ] Access revocation removes confirmed inaccessible mounted content across surfaces.
- [ ] Summary/detail loading, pagination and realtime targeting meet the original performance design.
- [ ] Typography/control/elevation/motion primitives are actually adopted by pages.
- [ ] Original Morning Brief and onboarding behavior/layout implemented or explicitly revised with approval.
- [ ] File/call recovery and resource cleanup tested at hook/component and browser boundaries.
- [ ] Authenticated golden paths and Bridge/RLS/live media checks have recorded results, not inferred success.
- [ ] Performance/accessibility measurements attached with environment and datasets.
- [ ] Build remains migration-free for verification; operational rollout separately approved.
- [ ] Handoff distinguishes code completion, local verification, live verification and release completion.

**Bottom line:** Keep the substantial completed foundation. Finish the concrete remaining code and tests above. “447 tests pass” is a useful baseline, not the definition of A–H completion.
