# Katalist — Batches D–H implementation execution plan

Prepared: 2026-09-23. Inspected baseline: `ff8ae12` on `katalist-plan/batch-a-baseline`.

Purpose: implement Batches D–H from one execution instruction. Batch C implementation is outside this document's scope. This is a specification, not evidence that the work below is already implemented. Local code completion, deployment, and live acceptance are separate milestones.

All source paths below are repository-relative to `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev`. Existing symbols named below were inspected or identified in source. Names explicitly marked **new** are proposed implementation destinations. Do not recreate a proposed module if a subsequent commit already provides the same responsibility.

## 1. How the executing agent must work

Read this document completely, `AGENTS.md`, the working diff, and the relevant source before editing. Start D implementation after this inspection. Do not reopen A–C or perform their deferred backlog as part of this task. Do not produce another plan revision as a substitute for implementation. Continue across batches without asking permission at every checkpoint. Ask only when an unresolved material product decision or external action cannot be inferred from the accepted contract.

Preserve unrelated changes, the existing branch, and Lovable history. No force push, history rewriting, deployment, production messages/calls, or migration execution. Preparing additive migration source and tests is part of the implementation work specified here; applying it is a later deployment action. Keep each independently reviewable change working. Commit focused slices when authorized by the implementation request and available permissions; inability to commit does not block editing or verification.

Do not rewrite the application, replace React Query, introduce another UI framework, add Redis, or add virtualization without evidence. Preserve Court, Lists, Buckets, Team, Nudges, Me, the white/violet palette, Poppins, existing role vocabulary, and server-enforced Thing lifecycle. Dark mode, new notification campaigns, new analytics vendors, and unrelated product expansion are out of scope.

Use existing tests and the installed Node/TypeScript loader, React Testing Library, and jsdom. Add tests that expose behavioral risks; do not generate source-string assertions to mirror implementation. Keep useful existing contract tests. For source assertions that become obsolete through an intentional extraction, replace their actual contract with behavioral coverage and explain the change.

### Required tracking

Create **new** `docs/superpowers/plans/KATALIST_D_TO_H_PROGRESS.md` with one row per work ID in this document: status, files, commit when available, verification, remaining dependency. Update it at meaningful checkpoints. Use only these statuses:

- `not-started`, `in-progress`, `implemented-local-pass`.
- `implemented-deployment-pending`, `live-acceptance-pending`.
- `blocked-external`, with an exact dependency and unaffected next work.

A phase is not complete because its document exists or because the test count increased. Every required behavior must have an implementation target and acceptance evidence. Continue independent work when a live check is unavailable.

## 2. Baseline and boundaries

References: `output/KATALIST_IMPLEMENTATION_MASTER_PLAN.md` and `output/KATALIST_BRUTAL_REVIEW_REPORT.md`. The C reconciliation is context only. Existing A–C fixes, identity epochs, query/mutation contracts, actor cache and realtime ownership must be preserved.

The supplied baseline report claims 328 passing tests, zero lint errors and 80 warnings. These were not re-run while writing this plan. Establish the actual baseline at execution start. This document does not authorize reopening the remaining C backlog.

Inspected D–H evidence:
- Bucket detail renders `CourtDetailModal`, while `InlineThingDetailWorkspace` requires a different composition contract.
- Morning Brief currently uses Court's local `catchUpOpen` state and a Catch Up overlay; the daily scheduler is new work.
- Me writes a reduced-motion preference directly and CSS suppresses shadows globally.
- Shared Thing detail, capture, chat, files, calls and Bridge have existing production implementations to refine incrementally.

If a D–H requirement needs an unfinished C capability, consume the existing interface or add a narrow compatible adapter. Record the exact external dependency if that is insufficient; continue independent D–H work. Do not relabel C pagination, actor caching or subscription redesign as D–H work.

## 3. Execution order and dependency rules

| Order | Work IDs | Deliverable |
|---|---|---|
| 1 | D01–D03 | Shared type, motion, keyboard and draft contracts |
| 2 | E01–E04 | Court, common detail, Bucket detail integration, capture |
| 3 | F01–F04 | Morning Brief schedule, receipts, UI and actions |
| 4 | G01–G06 | Page refinements using the established shared contracts |
| 5 | H01–H04 | Attachments, calls, Bridge and validation artifacts |
| 6 | Z01 | Reconciliation, evidence, final handoff |

Prepare database changes separately from UI changes. An unavailable deployment must not block compatible UI, local tests, preview behavior, or later unrelated batches. Keep unfinished backend-dependent features disabled by default. Do not claim a feature works against an unapplied schema.

### Common acceptance contract applying to every work item

Every item must preserve profile/mode isolation, current authorization rules, distinct loading/error/empty states, keyboard access, reduced motion, and supported mobile layouts. A failed read cannot become a successful zero. A failed write retains user input and offers a deliberate retry. Background refresh preserves usable same-identity content. Duplicate clicks cannot cause duplicate operations. Capture identity/epoch before async work; re-check after awaits before subsequent effects, and when timers fire. No code may obtain a new epoch to relabel old work as current.

Tests must cover both success and the particular failure the item prevents. Pure UI changes need component checks appropriate to risk; authorization, concurrency, scheduling and pagination need domain/integration coverage. Typecheck, test, lint and migration-free build are required at batch boundaries and before final delivery. Run targeted tests during a slice; avoid repeatedly rerunning an unchanged full suite without a reason.

## 4. Batch D — shared foundations

### D01 — Typography, controls and surfaces

**Existing:** `src/styles.css`, `src/components/ui/button.tsx`, `input.tsx`, `src/components/katalist/PersonAvatar.tsx`, shared badges/tables/dialogs.

**Add:** Semantic CSS roles: page title 24–28px, section 16–18px, body/actions 14px, dense desktop data 13px, secondary metadata 12px minimum, mobile input 16px. Body line-height 1.4–1.6. Introduce control density variants with desktop 32px minimum and touch 44px targets. Keep icon artwork size separate from hit target.

**Modify:** Apply tokens to shared primitives first, then each page through G. Do not globally regex-replace every numeric font size. Let titles and translated/long content wrap. Preserve browser zoom. Visible focus ring on every interactive control; status cannot rely on color alone.

**Surface sequence:** Define restrained card/popover/dialog elevation tokens; migrate overlay consumers; only then remove global shadow suppression in `styles.css`. Check focus-ring utilities remain intact. Keep base surfaces border-led.

**Tests/evidence:** Component variants and focus visibility; measured contrast for text/status tokens; touch target and 200% zoom browser checks later. Small font alone is not proof of WCAG failure. No snapshot pretending to measure contrast.

### D02 — Unified motion preference

**New:** `src/hooks/use-motion-preference.ts`, `src/lib/motion-tokens.ts`. Existing: Me preference panel, root/AppShell, `use-stack-gesture.ts`, `CourtLaneStack.tsx`, `CourtFocusView.tsx`, `styles.css`.

**Contract:** Effective reduction = OS reduce OR stored app reduce. Preference stored with current existing device-level semantics; accessibility preference does not need account-specific storage. Subscribe to media-query and storage changes, broadcast same-tab changes, and remove listeners. Use a hydration-safe server snapshot. Apply CSS class and GSAP policy from one value.

**Timing:** Feedback 100–150ms; local transition 180–240ms; workspace at most 280ms. Reduced mode removes spatial movement, preserving immediate state/focus feedback. Kill active tweens/Observers on preference change and cleanup. Do not trap normal page wheel scrolling outside the active gesture area.

**Tests:** OS change, setting change, reload, cross-tab, unavailable storage, rapid inputs, unmount cleanup. Browser frame performance is measured later, not inferred from duration constants.

### D03 — Focus, overlays and session drafts

**Existing:** Radix dialog/sheet/popover wrappers, `InlineThingDetailWorkspace`, `ThingDetailSheet`, `CourtDetailModal`, Magic Box, chat and notes composers.

**New:** `src/features/drafts/session-drafts.ts` for an identity-owned in-memory store only if no equivalent exists; `src/components/katalist/InteractionBlockerProvider.tsx` for call/modal/dirty-composer registrations used by Morning Brief. This provider tracks interaction eligibility, not a second general application state store.

**Contract:** Draft key = identity mode/profile + entity + composer kind. Conversation/List/Thing/notes text never follows selection to another entity. Clear on explicit discard, confirmed successful send, identity retirement or confirmed revoked access. Do not persist sensitive text to localStorage. Retain failed drafts and valid uploaded descriptors during same-session navigation; revoke temporary object URLs on discard/retirement.

**Focus:** Only topmost overlay consumes Escape. Close restores the launching control if it still exists, otherwise a meaningful page heading. Deferred focus rechecks intervening navigation and active element. Background auto-open must not interrupt dirty composers, active calls or blocking dialogs. Use explicit registrations; do not inspect arbitrary DOM text to guess dirty state.

**Tests:** Nested file preview Escape closes only preview; failed draft save; A→B; same entity across surfaces; removed launcher; registration cleanup in Strict Mode. Do not introduce a global Escape listener that closes every surface.

## 5. Batch E — Court and Thing detail

### E01 — Court layout and accessible navigation

**Existing:** `src/routes/index.tsx`, `CourtDesktop.tsx`, `CourtWorkspace.tsx`, `CourtLaneStack.tsx`, `ThingStackCard.tsx`, `CourtWithOthersSidebar.tsx`, `ThingNavigator.tsx`, `court-stack-model.ts`, `court-view-model.ts`.

**Modify:** Keep NOW/NEXT/LATER and With Others. Use stable card metadata order: title, responsible person, status/acknowledgment, due/pace, bounded preview. Expose Catch/pace/Sort through capability-based buttons as well as gestures. Keep previous/next and View all discoverable. Replace clickable nonsemantic containers with buttons/links without nesting interactive controls.

**Responsive:** At >=1280px allow lanes plus sidebar only when readable minimum widths fit. At 1024–1279px put With Others behind a named toggle. Below 1024px provide stacked/collapsible lanes and an explicit With Others view. Avoid horizontal document overflow; local card scrollers must be intentional and labeled.

**State:** Retain selected Thing ID through refetch, detail close and failed action; preserve established navigation-version focus protection. No matches offers Clear filters, truly empty offers capture. Counts explicitly reflect filtered or total sets; use the same model for headings and rendered cards.

**Tests:** Keyboard capture→Catch→pace→open→close→Sort; rollback restores membership and selection only if user has not moved; equal titles stay ID-based; 200% zoom, long titles, 0/30/300 Things. Do not change lane ownership semantics.

### E02 — Extract common detail without changing behavior

**Existing:** `ThingDetailContent.tsx`, `InlineThingDetailWorkspace.tsx`, `ThingDetailSheet.tsx`, `CourtDetailModal.tsx`, `CourtFocusView.tsx`, `src/domain/capabilities.ts` (`getThingCapabilities`), `rpc.ts`, query-updates and detail hooks.

**New:** Under `src/features/things/components/`: `ThingIdentityHeader.tsx`, `ThingStatusControls.tsx`, `ThingAttachments.tsx`, `ThingDiscussion.tsx`. Extract a mutation controller/hook only if needed to make variants share the actual action implementation.

**Sequence:** Establish same-Thing cross-surface capability tests; extract one section at a time keeping existing inputs and actions; typecheck and targeted tests; then apply D tokens. Route/container owns selection and close; feature hooks own data; common action controller owns claims, server calls, reconciliation and errors; sections render controlled UI.

**Contract:** Work status primary; acknowledgment secondary; distinguish personal pace from owner-assigned importance. Sorted/cancelled detail titles remain readable. Read-only/terminal controls explain state. Comments/Activity are semantic tabs using the existing feed APIs. Support their pagination interface if available; missing server pagination remains a C dependency. Detail section errors are independent. Do not add duplicate RPC paths in extracted components.

**Tests:** Null→A→B→null; owner/assignee/collaborator/view-only/unrelated; default/court variants; pending action; revoked access; missing avatar/files; draft and selected-file isolation. File selection survives refresh only if attachment still belongs to the selected Thing.

### E03 — Bring Buckets onto shared detail composition

**Existing:** `src/routes/buckets.$bucketId.tsx` (`BucketDetailPage`, `thingStatusMeta`, `matchesQuery`), `CourtDetailModal`, `InlineThingDetailWorkspace`.

**Modify:** Wrap the appropriate Bucket Things source content as `children` of `InlineThingDetailWorkspace`; provide selected Thing, close handler, source item list/navigation and `backLabel="Bucket"`. Preserve Lists/Notes tabs and their state. A standalone modal's prop contract cannot be copied onto the workspace. Keep a small-screen sheet variant when required by the shared responsive contract.

**Remove:** Bucket-specific duplicate Thing action/status implementation once shared sections cover it. Do not remove `CourtDetailModal` globally while other callers still use it legitimately.

**Tests:** Open same Thing from Court/List/Bucket/Nudge: equal capabilities/state; close returns to Bucket tab/filter/scroll; filter hides selected item with an explanation and clear-filter action; terminal mutation, deleted source and denied source access recover.

### E04 — Magic Box resilient capture

**Existing:** `MagicBox.tsx` mutation and handlers, `parse-toss.ts`, `attachments.ts`, `src/lib/file-utils.ts`, `rpc.ts`.

**Modify:** Show effective context/List destination before submit. Preserve parser meaning and assignee semantics. File entries show validating/uploading/ready/error and individual retry/remove. Block submit only for invalid/unready required uploads; preserve successful uploads through retry. Disable duplicate submission immediately with a claim, not only after next render.

**Result:** Preserve created Thing IDs from RPC results so acknowledgment can offer Open. For multi-assignee creation, show actual successful/failed results and retry failed work only; do not replay successful creates. Never invent idempotency support—prepare it explicitly if required. Escape restores focus without deleting draft; label capture distinctly from chat/comment input.

**Tests:** Empty/unsupported files, partial upload, delayed create, failed create, repeated Enter/click, account switch mid-upload, route switch, correct context/List, result opens actual created ID. Test real parser fixtures, not a redesigned vocabulary.

## 6. Batch F — Morning Brief

### F01 — Clock and eligibility model

**New:** `src/features/catchup/morning-brief-schedule.ts` and `use-morning-brief.ts`. Existing: `CatchUpOverlay`, `CatchUpBanner`, `CatchUpStack`, `CatchUpStackCard`, `useCatchup`, `catchup-logic.ts`, `CourtDesktop`.

**Exact behavior:** Once per identity/profile, active Work/Home context and local calendar date, after 07:00. There is no noon cutoff: the first eligible visit later that day qualifies. Valid profile timezone wins; otherwise browser timezone, validated before use. Pending auth, failed/loading moments, empty actionable set, hidden tab, active call, blocking dialog or dirty composer suppress auto-open. Re-evaluate when the blocker clears, on focus/visibility, context/date/timezone changes, and at the next threshold.

**Dismissal:** Escape, X, backdrop, finish-review, and opening a Thing close the brief; no path deletes/completes work. Suppress automatic presentation for the remainder of that profile/context/date. Next day after 07:00 it may show if actionable moments exist. Manual banner reopening works at any time and does not reset the daily receipt. Paging does not resolve moments.

**Model:** Inject clock and timezone. Compute calendar dates/next threshold using timezone-aware operations; never add a fixed 24 hours across DST. Cancel timers on context/identity change and verify epoch when they fire. Store selected moment by stable moment key. Do not silently call OS notifications or open a browser when the app is closed.

**Tests:** 06:59/07:00, first visit 18:00, midnight, DST forward/back, timezone change, Work/Home, preview/live, reload, manual reopen, blocker clears, no moments, failed query, stale timer. Timezone travel can change the date key; document that the receipt is per effective local date, not a rolling 24-hour cooldown.

### F02 — Atomic presentation receipt and compatible rollout

**New:** Dedicated additive migration in `supabase/migrations/` with next available timestamp; `morning-brief-receipts.ts` adapter; typed RPC wrapper using the repository's current conventions.

**Table:** `morning_brief_presentations`: authenticated profile FK, context constrained to Work/Home values, local_date, validated timezone, presented_at, optional dismissed_at; unique `(profile_id, context, local_date)`. RLS owner-only reads; mutation policy or RPC privileges must prevent a caller from claiming another user's receipt.

**Claim RPC:** Derive identity from auth; validate context, timezone and eligible date against server time. Prefer stored profile timezone; when absent, accept a validated browser IANA timezone under the same documented fallback. Atomically insert `ON CONFLICT DO NOTHING`, return `{claimed, localDate, timezone, presentedAt}`. Never trust client-supplied profile or arbitrary future date. Two clients cannot both win. No task description/body/phone in receipts.

**Rendering:** Check blockers before claim and again after await. If identity changes, do not open. If a claim wins but a new blocker/route interruption prevents rendering, retain the receipt and manual access; favor avoiding repeated interruptions. Dismissal recording is best effort and cannot undo the presentation receipt.

**Adapters:** Preview uses identity/context/date-scoped local receipt with same visible behavior, a same-browser lock where supported and storage events. State cross-device atomicity only for the server adapter. When live service unavailable, skip automatic opening, keep manual access, and avoid an infinite retry loop.

**Flag:** New `VITE_KATALIST_MORNING_BRIEF_AUTO_OPEN`, disabled by default. Existing app and manual review operate before schema deployment. Prepare migration/SQL tests locally; do not execute against remote DB.

**Tests:** Concurrent claims, other-profile access, anonymous claim, invalid timezone/context/date, pre-07:00, repeat day, next day, service failure, late response after switch. If a local PostgreSQL test environment is unavailable, keep SQL acceptance explicitly pending; unit mocks do not prove RLS.

### F03 — Morning Brief presentation

**Modify:** `CatchUpOverlay`, `CatchUpBanner`, `CatchUpStack`, `CatchUpStackCard`. Preserve internal CatchUp names where rename provides no value. Visible title becomes Morning Brief.

**Desktop:** Max width approximately 960px with viewport margins, greeting/date, actual category counts, selected moment, short queue and review position. Only show categories represented by real model values. Bound previews. Use known actor/due/event data; no fabricated summaries or unsupported urgency claims.

**Mobile:** Full-height accessible dialog using dynamic viewport height and safe-area padding, one card, compact selector and sticky actions. Keep content scrollable with virtual keyboard. Apply D typography/motion.

**States:** Manual opening while data loads shows recoverable loading. No moments says no review needed. Partial errors identify unavailable information. Preserve selected key when refreshing; if removed by successful action, advance predictably. End label is “Review finished,” not “All resolved,” unless all items actually resolved.

**Accessibility:** Dialog title/description, focus trap, topmost Escape, restore focus to banner or Court heading, non-color categories, accessible selected/total position without excessive announcements.

### F04 — Wire ownership and actions

**Existing:** `CourtDesktop.catchUpOpen`, `openCatchUpThing`, `CatchUpStack.runAction`, `useCatchup.surfaceMoment`; inspect mobile Court route before wiring.

**Modify:** One presentation controller per active Court surface; do not mount competing schedulers in desktop and hidden mobile trees. Pass controlled open/close and manual trigger to overlay/banner. Use shared mutation claim/reconciliation for actions. Receipt for a moment is written only after its action succeeds. Handle receipt failure without repeating an already successful Thing action; revalidate and report accurately.

**Remove:** Competing manual local state once controller owns presentation. Keep manual reopening and current permissions. Cleanup must not fire an unguarded refresh under the next identity.

**Tests:** Real component Escape/X/backdrop/open-Thing paths, double action, failed RPC, action success plus receipt failure, tomorrow re-open, call blocks presentation, two mounted route variants cannot duplicate claim.

## 7. Batch G — all remaining screens

### G01 — Welcome, auth and onboarding

**Existing:** `src/routes/welcome.tsx`, `auth.tsx`, `onboarding.tsx` (`OnboardingPage`), `src/hooks/useSession.ts`, `src/lib/fixed-otp.ts`, Contacts flow.

**Modify:** Welcome optional; auth sign-in/profile creation; onboarding capture→Court/Catch explanation→optional people discovery. Replace blank preview with existing cards and local, explicitly illustrative data. “Find people” opens actual Contacts flow; do not claim device contacts imported. Skip/resume has deterministic destination. Direct unauthenticated onboarding routes through auth preserving a validated local return route; disallow external redirect URLs.

**Auth:** Accessible phone/country labels, visible country default, meaningful invalid/expired OTP, resend countdown, submitting state and email fallback. Keep production authentication semantics unchanged. Demo entry appears only under existing explicit demo configuration; never enable fixed/demo OTP in production to satisfy tests.

**Tests:** New/returning user, skipped onboarding, direct URL, expired session, failed OTP/resend, failed profile save, demo disabled. Preview components never create real Things or invite people.

### G02 — Lists index and workspace

**Existing:** `src/routes/lists.index.tsx` (`ListTable`, `GroupSection`, `ListsPage`, `handleSubmit`, `uploadAndAttachCover`), `src/routes/lists.$listId.tsx`, `useLists`, `useList`, `use-list-things.ts`, `ListChatPanel`.

**New:** `src/features/lists/components/ListThingsPanel.tsx`, `ListMembersPanel.tsx`, `ListInviteDialog.tsx`, and `list-view-model.ts` if filtering warrants extraction.

**Index:** Preserve role grouping, search and creation controls outside empty-state boundaries. Native List links and independent action controls. Relative timestamp plus accessible exact date. Narrow screens use stacked summary rows; menus remain reachable. Cover upload failure retains draft and successful create identity so retry does not create another List.

**Workspace:** Extract Things/Members/invite sections before visual changes. Route retains parameter/query state, selected tab and composition. Reuse shared ListChatPanel; remove duplicate discussion rendering only after parity. Add Active/All/Completed with All compatibility default. Persist filter by profile/mode/List. Define Active as nonterminal, Completed as sorted, All includes cancelled with clear status. Preserve server domain semantics and current importance grouping.

**Selection:** Store ID, derive entity from current data. If filters exclude selected item, show why and offer Clear filters; confirmed revocation clears details. Retain own member role and constrain controls by server capabilities. Guard role/remove/add async handlers and preserve failure feedback.

**Tests:** Same-name Lists, owner/view-only, member removed mid-view, long description, filtered selection, empty creation, cover failure, older chat loading, route A→B while fetch pending.

### G03 — Buckets, references and notes

**Existing:** `buckets.index.tsx` (`BucketTableRow`, `BucketsPage`), `buckets.$bucketId.tsx` (`BucketDetailPage`, `saveNote`, `openNoteEditor`, `matchesQuery`), `use-buckets.ts`, `use-bucket-items.ts`, `use-bucket-notes.ts` (`useBucketNotes`), `bucket-items-surface.ts`, `SpringLoadedBucketFlyout.tsx`.

**Modify:** Explain “Private collection. Shared items keep their existing permissions.” Adding reference never grants access. Keep Things/Lists/Notes and accessible search labels. A known unavailable reference gets a safe placeholder without leaking revoked title/content; network failure remains retryable error. Reuse E03 detail.

**Notes:** Capture bucket/note identity before save, disable duplicate save, show saving/saved/error, retain draft on failure, prompt on explicit close with unsaved edits. Clear draft only after acknowledged success or discard. Provide keyboard equivalent for add-to-bucket drag action.

**Progress:** Deduplicate Thing IDs across direct and referenced Lists; denominator unique accessible non-cancelled Things, numerator sorted subset. Zero denominator uses neutral empty indicator rather than divide-by-zero or invented 100%. If referenced contents are not fully available, show unknown/loading or use an authorized server aggregate; do not derive global completion from paged subsets.

**Tests:** Private Bucket isolation, reference permission unchanged, overlap counts, cancelled items, missing List, failed note save, deletion during edit, filter and selected detail retained.

### G04 — Team, chat, contacts and dock

**Existing:** `team.tsx`, `team.index.tsx`, `team.$conversationId.tsx`, `HubSidebar`, `ConversationWorkspace`, `ContactsDialog`, `NewGroupDialog`, `ChatHeadsDock`, chat hooks/read-state.

**Modify:** Populated landing says Select a conversation; zero conversations offers creation. Seed header from selected sidebar record with matching ID/profile, otherwise skeleton; never show invented zero members. Preserve Chat/Files/Call with one clear primary call entry. Search has scope and accessible label. Stable responsive sidebar/back behavior.

**Messaging:** Use identity/conversation-scoped drafts and scroll anchor. Optimistic messages have stable client identity and sending/failed state. Preserve failure retry without duplicating acknowledged messages. Inspect existing send RPC support; if an ambiguous timeout cannot safely retry, reconcile by request ID or prepare additive idempotency support before enabling automatic retry. Mentions carry verified selected profile IDs, not arbitrary regex-derived recipients.

**Reading:** New messages while scrolled away show New messages control and do not jump to bottom. Mark read only when appropriate content is visible and tab active. Unread agrees across sidebar, List surface and dock through the existing shared read-state APIs. If profile-scoping work remains incomplete, record it as a C dependency and avoid inventing a second read-state store. Dock is dismissible and must not obscure primary controls or auto-open competing overlays.

**Tests:** Rapid conversation switch, delayed header, send fail/retry, duplicate delivery, older-page prepend, pin outside latest page, mention count, revoked membership, hidden tab, multiple consumers and account switch.

### G05 — Nudges controls and truthful history

**Existing:** `src/routes/nudges.tsx` (`NudgesPage`, `handleNudge`, `statusPill`), `use-nudges.ts`, `escalation-logic.ts`.

**Modify:** Wire All lists to actual list-ID filtering of loaded authorized rows; counts consistently reflect filter or visibly label totals. Search says Search Things or people. Replace unsupported editable settings with How nudges work explaining actual server cooldown/quiet-hour rules. Remove inert See all or connect to paginated history if current data can support it.

**States:** Preserve separated eligibility/loading/error. Unconfirmed eligibility does not mean forbidden. Explain disabled action and cooldown; RPC remains authoritative. Tabs are semantic, no-results differs from all caught up. Guard handleNudge continuation and dedup.

**Tests:** Filter names collide but IDs do not, cooldown rejection updates UI, failed history preserves rows, offline loaded rows, double nudge, successful row removal, account/context switch. Do not send real notifications during tests.

### G06 — Me and notifications

**Existing:** `src/routes/me.tsx`, `use-profile.ts` (`useUpdateProfile`, `useUploadAvatar`), `use-trophy.ts`, `PushRegistrar.tsx`, `push-config.ts`, `use-notifications.ts`, `NotificationPanel.tsx`.

**Modify:** Label rolling metric Activity in the last 7 days; describe current streak calculation. Hide synthetic auth email as contact information. Own private phone may remain visible. Profile edits preserve draft after error; avatar upload has progress and duplicate prevention. Preference panels use existing accessible dialogs. Reuse D02 motion setting and remove unimplemented theme promises.

**Push:** Show actual supported/unsupported/default/granted/denied permission states. Permission request only on explicit Enable action; PushRegistrar must not trigger an unsolicited prompt. Explain denied recovery, in-app fallback and token-registration failure. Do not claim notification delivery just because permission was granted.

**Tests:** Metrics match query contract, failed update, avatar upload followed by account switch, denied/unsupported push, reload motion state, private fields excluded from public directory/Bridge payloads.

## 8. Batch H — secondary workflows and release readiness

### H01 — Files, signed URLs and PDF lifecycle

**Existing:** `attachments.ts` (`fetchRealAttachments`, `uploadThingAttachment`), `PDFViewer.tsx`, `PdfCanvas.tsx`, `HubFilesPanel.tsx`, `use-hub-files.ts`, `src/lib/file-utils.ts`, `ThingAttachments` from E02.

**Modify:** Lazy-import PDF renderer when opened. Cancel old PDF render/loading tasks on switch/unmount and handle expected cancellation without noisy errors. Bound image/PDF geometry; reserve aspect ratio. Revoke object URLs once not displayed. Refresh expiring signed URLs through authorized requests, not endless blind retries. Gate results by selected file and identity.

**UI:** Per-file upload progress, download/open, retry, unsupported type, unavailable and expired-link recovery. Overview never loads entire PDFs. Validate file type/size at existing client and server boundaries; retain real error messages safely.

**Tests:** Rapid A→B file switch, close during render, inaccessible file, expired URL, failed download, multiple file uploads with one failure. Browser memory/performance checks later use 30 open/close cycles and report actual evidence; no claim from component mocks alone.

### H02 — Calls and meeting lifecycle

**Existing:** `StartCallDialog`, `ListCallPanel`, `use-list-call.ts` (`join`, `leave`, `toggleMute`, `toggleCamera`, `toggleScreenShare`, document/draw controls), `call-room.ts` (`CallRoom`), `call-lobby.ts`, `CallRingProvider`, `ringtone.ts`, `AnnotateCanvas`, `ScheduleMeetingDialog`, `MeetingReminderCard`.

**Modify:** Explicit idle/joining/connected/reconnecting/ended/error state derived from actual transport/media events. Controls reflect availability; permission denial has recoverable fallback and clear guidance. Leave/unmount/identity retirement stop owned tracks, ringtone, screen sharing, timers and listeners. If getUserMedia resolves after leave, immediately stop returned tracks. Changing documents invalidates old render work.

**Interaction:** Calls register D03 auto-open blocker. Opening a call tab/review screen does not ring participants. Starting/ringing requires explicit user action. Existing autojoin behavior must retain its intended authorization and not broaden through route navigation. Meeting times display effective timezone and preserve stored instants.

**Tests:** Mock media/transport join success/failure, delayed permission after leave, reconnect, double join, device removal, screen-share ended, cleanup, annotation isolation, reminder boundaries. Two-account real-media checks are live acceptance with test users; never ring customers.

### H03 — Bridge authorization and recovery

**Existing:** `src/routes/bridge.$token.tsx`; `src/routes/api/public/bridge/{thing,act,comment,redeem}.ts` route handlers; `src/lib/bridge-session.server.ts` (`readBridgeCookie`, `bridgeCookieHeader`, `clearBridgeCookie`, `bridgeError`, `logBridgeFailure`); related RPC/migrations found through imports.

**Sequence:** Map token→redeem→cookie/session→Thing capability→action/comment. Preserve existing server authorization; UI cannot grant actions. Prepare positive/negative tests before changes. Validate inputs and re-check capability on every operation, including files, after expiry/revocation.

**UI:** Explain one-Thing access, render only allowed actions, safe unavailable/expired state, preserve comment draft on recoverable failure. Terminal state is readable. Retry an ambiguous write only when idempotency/reconciliation supports it. No raw tokens in logs, analytics, error text or screenshots.

**Tests:** Valid recipient, anonymous, expired, revoked, malformed, wrong session/recipient, unrelated Thing ID, completed/cancelled action, duplicate comment submission, private profile fields/files. Client tests do not prove deployed RLS; run database fixtures locally when possible and track deployment separately.

### H04 — Repeatable browser and release artifacts

**New:** `playwright.config.ts` and `tests/e2e/` if no equivalent exists by execution time. Reuse installed Playwright. Add separate preview and authenticated staging projects; staging tests require explicit test account configuration, not production defaults. Do not include credentials in source/report.

**Local coverage after code:** Capture→Catch→pace→comment/file→eligible Nudge→Sorted from Court/List/Bucket; Work/Home, direct routes, duplicate names, empty data, slow reads, offline, failed write, draft retention, Morning Brief clock/dismissal, keyboard and reduced motion. Use request interception for deterministic failures and label it as controlled testing.

**Viewports:** 390×844, 768×1024, 1024×768, 1440×900 and 1920×1080. Keyboard-only, 200% zoom, touch targets, long names/content. Automated accessibility checks supplement manual focus/screen-reader review; do not claim full conformance from a scanner.

**Performance targets:** Feedback <=100ms; warm useful content p75 <=300ms; cold primary route p75 <=2.5s on fixed reference dataset; lab responsiveness target <=200ms; CLS <=0.1; 60Hz frame target 16.7ms. Record device/build/network/dataset. Use 20 navigation samples for route comparison and 0/30/300 Things, 0/10/100 Lists, 1000-message history. Treat these as targets, not guaranteed results. Profile before adding virtualization or broad memoization.

**Live checklist:** Two genuine accounts switch, real RLS and revoked membership, duplicate daily claim across devices, actual realtime disconnect/reconnect, media calls, staging migrations, old/new client compatibility. Missing credentials block these checks only.

**CI/release:** Keep `npm run build:app` separate from migrations. Inspect `.github/workflows/quality.yml`; local passing checks do not establish GitHub Actions execution. Morning Brief auto-open flag stays off before receipt deployment and live validation. Prepare rollout/rollback instructions; do not execute deployment. Never delete receipts to roll back UI.

## 9. Complete page and subsystem coverage matrix

| Route/surface | Required work IDs | Result |
|---|---|---|
| `__root.tsx`, AppShell, navigation | D02/D03, F04 | One identity/realtime owner; consistent preference, focus/blockers |
| `/` Court | E01/E04, F01–F04 | Accessible lanes, reliable capture, daily brief |
| Shared Thing inline/modal/sheet | D03, E02/E03, H01 | Shared behavior, independent hydration, safe drafts |
| `/lists` layout/index | G02 | Scoped summaries, creation/search/role groups |
| `/lists/$listId` | E02, G02, H02 | Things/chat/members, filters, safe member actions |
| `/buckets` layout/index | G03 | Private collection semantics and usable empty creation |
| `/buckets/$bucketId` | E03, G03 | Shared detail, unique progress, resilient notes |
| `/team` layout/index | G04 | Correct rail/unread and populated landing |
| `/team/$conversationId` | G04, H01/H02 | Paged chat, files/calls and drafts |
| Chat dock / List chat | D03, G04 | Preserve existing shared subscriptions; consistent unread presentation and drafts |
| `/nudges` | G05 | Working filters, truthful eligibility/history |
| `/me` and NotificationPanel | D02, G06 | Honest metrics, preferences and permissions |
| `/welcome`, `/auth`, `/onboarding` | G01 | Deterministic entry and real onboarding preview |
| `/bridge/$token` and four Bridge APIs | H03 | One-Thing capability enforcement and recovery |
| Calls/ring API | H02 | Keep API semantics; modify only if lifecycle tests expose a required defect |
| Nudge notify / hub notify-message APIs | E04/G04/G05 | Preserve behavior; verify idempotency/identity boundaries when affected |
| Daily-maintenance / escalate-nudges jobs | F01/F02, G05 | Inspect timing contracts; no duplicate brief popup job or unsolicited notification expansion |
| Route wrappers / root errors / not-found | D01/D03, H04 | Preserve routing; accessible navigation/recovery, no independent redesign |

Every route returned by `rg --files src/routes` must appear in the progress inventory. Newly discovered routes get an explicit applicable item or reason for no change; do not silently skip them.

## 10. Shared contracts and migration rules

1. Query keys must encode every variable that changes returned viewer-relative data, unless the proven identity boundary and epoch guard enforce exclusivity. New caches default to explicit identity scope. Do not mix summary and hydrated detail under an indistinguishable key/value contract.
2. Read errors distinguish unavailable/denied/transient/successful empty. Do not expose protected stale content after confirmed access loss. Offline alone is not confirmed access loss.
3. Mutation scope is initiating identity + entity + operation. Shared claims stop duplicates; server remains authoritative. Rollback cannot undo another writer. Successful external notifications are not undoable unless supported by a real inverse.
4. Drafts live in identity-scoped session memory. Settings/read receipts use deliberately scoped persistence. Accessibility preference remains device-level by design.
5. All new database objects are additive, documented and RLS-tested where local tooling permits. Never use service-role access in browser code. Explain migration dependencies and compatibility before enabling flags.
6. Use generated database types when available; isolate temporarily ungenerated RPCs using the existing validated wrapper pattern. Do not spread `any` or disable lint rules to bypass new contracts.
7. Server cursor pagination preserves global ordering, ties, unread/pinned semantics and older-data access. Client slicing is a display operation, not a network optimization.
8. Native buttons/links and existing accessible primitives are preferred. Role attributes do not automatically replace keyboard behavior. Topmost overlay owns dismissal.

## 11. Verification and final evidence

At start capture `git status --short`, current SHA, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build:app`. Preserve unrelated failures with evidence; newly introduced failures must be resolved.

At each work item, run relevant behavior tests. At D/E/F/G/H boundaries run the required suite. Do not claim tests failed against old source unless that was actually demonstrated. Do not claim live database/security/performance acceptance from mocks.

**Z01 final files:** Update the D–H progress ledger. Create `docs/superpowers/plans/KATALIST_D_TO_H_FINAL_HANDOFF.md` containing:

- Baseline/end SHA and working-tree state; files/commits grouped by work ID.
- Completed visible behavior per page, including added/modified/removed responsibilities.
- Actual check commands/results and unresolved warnings.
- New schema/RPC artifacts, rollout order and feature flags.
- Local browser evidence when run, with environment and limits.
- Exact live checks remaining and required test accounts/environment.
- Any unsatisfied acceptance criterion with cause; never call it done because it was documented.

Code completion means all locally executable requirements above are implemented and tested, database-dependent source is prepared with compatible rollout, and no unresolved local correctness defect is knowingly shipped. Release completion additionally requires deployment and live/browser acceptance. Keep these claims separate.

## 12. Copy-paste execution instruction

```text
Implement docs/superpowers/plans/KATALIST_D_TO_H_IMPLEMENTATION_EXECUTION_PLAN.md end to end.

Read the complete document, AGENTS.md, current source and working diff. Preserve existing A/B/C work and unrelated changes. Batch C completion is outside this task. Execute D01–D03, E01–E04, F01–F04, G01–G06, H01–H04 and Z01 in dependency order.

This request authorizes the application/test/documentation changes and additive migration source specified by the plan. Do not push, deploy, run remote migrations, send real customer messages or ring real participants. Keep deployed-schema compatibility and leave new backend-dependent features disabled until deployment acceptance.

Create and maintain the progress ledger. Implement in focused, verifiable slices; commit them when permitted. Give concise progress updates while continuing. Do not stop for approval between phases, replace implementation with another plan, or defer locally executable work because live credentials are missing. Complete independent work when an external dependency is blocked.

Use the existing test stack and add meaningful regression tests. Typecheck, test, lint and build:app must pass at required checkpoints. Preserve domain/capability contracts, identity isolation, error states, drafts and focus. Prepare repeatable browser tests after the code changes; label controlled tests separately from live Supabase/RLS/media verification.

Before finishing, reconcile every D–H work ID and route. Deliver the final handoff document with changes, checks, commits, schema/flag rollout and precise remaining live acceptance. Do not claim release completion without the required live evidence. Continue until the locally executable implementation and the complete handoff are finished.
```

This instruction is designed to avoid repeated approval turns. It cannot guarantee that every future agent has enough runtime, credentials or context to finish in one uninterrupted turn. If interrupted, resume from the progress ledger and existing diff; do not restart, duplicate finished work or silently reduce scope.
