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
| F-02 | implemented-local-pass | Same migration file, same functions. **Timezone-resolution mismatch (fixed):** `claim_morning_brief` used to treat a profile's stored `timezone` being exactly `'UTC'` as a signal to prefer the client-supplied zone instead -- unable to distinguish a deliberate UTC choice from an unset default, and disagreeing with the client's own `resolveEffectiveTimezone()` (`morning-brief-schedule.ts`), which never does that. Extracted the resolution rule into a new, independently-testable `katalist_priv.resolve_morning_brief_timezone(p_profile_id, p_client_timezone)` (service_role-only, called from within `claim_morning_brief`'s own `SECURITY DEFINER` context): the profile's stored zone now wins whenever it validates as a real IANA zone (via an `AT TIME ZONE` cast, which raises for a bogus name) -- including an explicit `'UTC'` -- and the client-supplied zone is used only when the profile's own zone is null or invalid; final fallback `'UTC'`. This exactly matches the client's own rule now, on both sides. **Server never enforced the 07:00 threshold (fixed):** `claim_morning_brief` previously had no time-of-day check at all -- only the client's `morning-brief-schedule.ts` checked it before ever calling the RPC. Added a server-side `v_local_hour < 7` rejection (`RAISE EXCEPTION 'before morning threshold'`) that does NOT insert a row, so an early call (clock/timezone skew, a future caller that forgets the client-side check, or a direct RPC call) cannot burn the day's one-per-day slot before the real morning moment. **Dismiss recomputed a possibly-different "today" (fixed):** `dismiss_morning_brief` used to independently recompute `local_date` via the same profile/client-timezone resolution and match on that -- which could silently find no row if "today" as recomputed at dismiss time differed from "today" when the row was actually claimed (dismissing just after local midnight, or after the resolved timezone changed in between). Rewrote it to target the caller's own most recent undismissed row for that profile/context directly (`ORDER BY local_date DESC LIMIT 1`), removing the need for any timezone/date computation in dismiss at all; `p_client_timezone` is still accepted (for call-signature symmetry) but is now unused. | (pending) | Extended `scripts/morning-brief-receipts-sql.test.mjs` to 17 tests (8 new): profile's explicit UTC wins over a client-supplied zone; a non-UTC profile zone always wins; an invalid profile zone falls back to the client's zone; no usable zone at all falls back to UTC (not a crash); claiming before the local threshold is rejected and inserts no row; claiming at/after the threshold succeeds; dismiss finds the claimed receipt even when a simulated timezone change would make "today" recompute differently; dismiss only ever targets the calling profile's own row, never another profile's. The threshold/timezone tests use a computed fixed-offset IANA zone (`Etc/GMT±N`, derived from the real current UTC hour) so they are deterministic regardless of what time the suite actually runs -- the same class of wall-clock dependency fixed earlier in `use-morning-brief.test.mjs`, applied here at the SQL/timezone-name level since Postgres's own `now()` can't be pinned the way JS `Date` can. 464/464 total tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | Live acceptance (real deployed Supabase, real `auth.uid()`/profiles integration, concurrent-claim races under real transaction isolation) remains an external gate -- unchanged by this fix, same as F-01. The client side (`morning-brief-schedule.ts`'s `resolveEffectiveTimezone`) was re-read and confirmed to already implement the exact same rule this fix brought the server in line with -- no client-side change was needed for F-02 itself. |
| F-03 | implemented-local-pass | `src/features/catchup/use-morning-brief.ts`: `attemptClaim`'s continuation, after `await`ing the claim RPC, only checked `isEpochCurrent` before calling `setOpen(true)` -- context/tab-visibility/blocker/moments could all change while the claim was still in flight (a context switch, a call starting, the tab hiding, moments emptying), and none of that was rechecked, so a stale claim resolving late could open the brief for a context/situation that no longer matches what's displayed. Added `contextRef`/`isTabHiddenRef`/`hasBlockingInteractionRef`/`catchupCountRef`/`mountedRef`, all updated on every render (not via an effect, so they reflect the LATEST truth even while an older closure's async continuation is still resuming) -- the continuation now rechecks all of them (plus unmount) after the await, and only calls `setOpen(true)` when every one of them still agrees this is the live, still-relevant scope. The claim/receipt itself is unaffected either way (`alreadyPresentedToday` is still set, so the day's slot is correctly marked used and a manual review remains available) -- only the automatic, possibly-stale UI open is suppressed. Dismiss's own "target the actual claimed receipt, not a recomputed date" concern was already resolved server-side by F-02's `dismiss_morning_brief` rewrite -- no further client change was needed for that part. | (pending) | Extended `scripts/use-morning-brief.test.mjs` to 10 tests (2 new, using a new controllable `claimGate` so a test can hold a claim's promise open, change context/add a blocker while it's pending, then resolve it): a context switch mid-claim does not open the brief for the no-longer-displayed context (and the new context's own separate attempt correctly never calls claim itself, since it's given no actionable moments -- isolating the exact stale-continuation race); a blocker appearing mid-claim suppresses the open. Confirmed the new context-switch test actually exercises a real defect in the prior code by reverting the fix and rerunning: the old code hung the test run entirely rather than failing cleanly (killed after 120s, exit 144) -- restored immediately after confirming. 466/466 tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | The scheduled next-threshold timer (`nextMorningThreshold` effect) was not changed -- it already re-arms on identity/context/timezone change and calls the same guarded `attemptClaim`, so it inherits this fix's guards automatically; not independently re-verified with its own dedicated race test in this pass. |
| F-05 | implemented-local-pass | `src/features/catchup/use-catchup.ts`: `fetchCatchupMoments()` discarded the `error` field from both its actor lookup (`from("actors")...maybeSingle()`) and its required Things lookup (`from("things")...`), falling through to `myActorId = null` / `thingRows = []` either way -- a genuine lookup failure was indistinguishable from "nothing to show", and the `UseCatchup` contract exposed no `error` field at all for a consumer to tell the difference. Both lookups now `throw` their error instead of silently continuing. Added `error: unknown` to `UseCatchup` (`null` in preview, `query.error` live) -- react-query's own default behavior already does the rest for free: a background refetch failure keeps the last-good `moments` visible while still surfacing the new `error`, satisfying "preserve correctly loaded moments during a transient refresh" without extra plumbing. `src/features/catchup/morning-brief-schedule.ts`: added a `"moments-error"` blocker and a `hasMomentsError` input to `isEligibleToAutoOpen` (checked before the `no-moments`/threshold checks). `src/features/catchup/use-morning-brief.ts`: `attemptClaim` now passes `hasMomentsError: catchup.error != null` into the initial eligibility check, and added a `catchupErrorRef` (same latest-value-on-every-render pattern as F-03's other refs) so the post-await recheck also treats a moments error appearing while a claim was in flight as reason to suppress the auto-open (the claim/receipt itself is still recorded either way). | (pending) | **New:** `scripts/use-catchup-error-propagation.test.mjs` (2 tests, rendering the real `useCatchup()` hook with a mocked Supabase client: an actor-lookup error and a Things-lookup error both surface as `catchup.error`, not a silently-empty `count: 0`). Extended `scripts/use-morning-brief.test.mjs` to 12 tests (2 new): a moments error never even attempts a claim; a moments error appearing while a claim is already in flight suppresses the open without discarding the already-successful claim. 470/470 total tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | **Named, not attempted:** the audit's own ask that "manual review shows recoverable error instead of empty success" implies a visible UI treatment (e.g. `CatchUpBanner`/`CatchUpOverlay` showing "couldn't load" instead of just not rendering when `count === 0`) -- `CourtDesktop.tsx`'s banner is still gated purely on `catchup.count > 0`, so an error currently still renders as "nothing to review" in the UI even though the underlying hook now correctly distinguishes the two states. The data/hook-layer contract (the P1 correctness concern -- "no failed fetch is represented as no moments" for the automatic-interruption decision) is fixed and tested; wiring a visible error affordance into the banner/overlay is left as follow-up UI work, not silently claimed done. `resolveActorPeople`'s own internal error handling (a separate, lower-severity lookup for actor display names) was not audited/changed in this pass. |
| H-05 | implemented-local-pass | `src/features/calls/use-list-call.ts`: `join()`'s own async continuation (success path, catch, finally) had no way to tell whether it was still the call the hook cares about by the time its `await room.join(...)` resolved -- the exact sequence the audit reproduced (join A pending -> leave A -> join B -> A finally resolves/rejects) let A's unconditional `roomRef.current = null` / `setConnecting(false)` clobber B's still-live ref and flip B's legitimately-connecting state back to false/error, even though B was the actual active call. Added `joinGenerationRef`, incremented by both `leave()` and the start of every `join()` call; each `join()` invocation captures its own generation number and, after its `await`, checks `joinGenerationRef.current === myGeneration` before touching `roomRef`/state in EVERY continuation (success, catch, and finally) -- not only the catch path the audit's own example called out. A superseded call still disposes whatever room object it itself created (`room.leave()`) so a late-resolving stream/room is never leaked, it just never gets published as the active call. Verified (not changed): `onState`/`onReaction`/`onDraw`/`onDocPage` callbacks are already safe without this fix -- `CallRoom.emit()` already checks its own `this.closed` before firing `onState`, and `leave()` already calls `supabase.removeChannel()`, which stops the broadcast-event listeners backing the other three callbacks entirely; a superseded room's callbacks were never actually able to fire after being left, independent of this fix. | (pending) | Extended `scripts/use-list-call-lifecycle.test.mjs` to 4 tests (1 new, using a new shared `joinGate` so a test can hold a room's own `join()` promise open while other calls happen, then release it): a join superseded by `leave()` then a fresh `join()` does not clobber the new room's ref/lifecycle when it finally resolves, and the superseded room is still disposed. Confirmed the new test genuinely fails against the pre-fix code (`A's own join() call must report it did not become the active call -- true !== false`) by reverting the fix and rerunning with `--test-timeout=8000`, then restored. 471/471 total tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | `startScreenShare`/`toggleScreenShare` were not given the same generation guard -- the audit's own H-05 text scopes this item to `join`/`leave`/callbacks specifically, and screen-share only ever starts from within an already-joined room (`toggleScreenShare` early-returns without one), which is a narrower window than the join race; not audited as a separate race in this pass. Live two-browser/device call behavior remains an external gate, unchanged by this fix. |
| E-03 | implemented-local-pass -- pending independent review | `src/features/things/ThingDetailContent.tsx`: `comment`/`commentAttachments` were plain component state, reset ad hoc on `thing.id` change (attachments only, never the text) instead of a real per-Thing draft -- session-drafts.ts (D03) had no production consumer at all. Now initialized from `getDraft(qc, "thing-comment", thing.id)` on mount, re-hydrated by a `[thing?.id, qc]` effect (covers `CourtDetailModal`, the one render site with no `key={thing.id}`, so this same component instance can be handed a different Thing without unmounting -- the other three sites remount and get the same correctness from the initializer instead), and write-through persisted on every change via a second effect. Extracted the two previously-duplicated inline submit handlers (court variant + default variant, same underlying state) into one shared `submitComment()`. A failed send restores the draft only if nothing has touched that Thing's draft store since submit (checked via `getDraft` in `onError`) -- so a user who has already switched back to that Thing and typed something NEW while the old send was still failing does not have it silently overwritten by the now-stale failed text; the live input is only additionally updated if `thingIdRef.current` (updated every render) still matches the Thing the send was actually for. `handleCommentFileChange` (file attach) now captures the target Thing id before its own `await`s and, if the displayed Thing has changed by the time processing finishes, writes the new files into that Thing's own draft-store entry instead of the currently-displayed Thing's live `commentAttachments`. Registered a D03 `useBlockWhile` blocker (`"thing-comment-draft"`) while the draft is nonempty. | (pending) | **New:** `scripts/thing-detail-comment-draft.test.mjs` (4 tests, rendering the real component with a real `QueryClient`/`InteractionBlockerProvider`, not a source-string check): typing for Thing A is invisible after switching the same instance to Thing B and is restored on switching back; a nonempty draft registers/releases the D03 blocker; a failed send restores the draft on the same Thing; a send that fails after switching Things does not leak into the new Thing's live input and is recovered on switching back. Confirmed all 4 fail against the pre-fix code by reverting and rerunning, then restored. 475/475 total tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | **Pending independent review**, per explicit instruction -- passing tests alone does not close this out. Not attempted: `due` (the Edit-Due-Date input in the "more actions" panel) and `selectedFileId` are still plain component state, not per-Thing drafts -- named as an out-of-scope-for-this-pass gap, not silently covered by this fix (the audit's own E-03 wording scopes to "text/files" of the comment composer specifically, which is what this fix covers; `due` is a lower-frequency, already-transient edit inside a collapsible panel that resets with the panel closing on Thing change via `setMoreOpen(false)`, and was judged a smaller residual gap than the comment/attachment draft). `handleThingFileUpload` (the separate "Add file" control that uploads directly to the Thing, not into a draft) already had its own identity-epoch guard from before this fix and was not touched. |
| G-06 | implemented-local-pass -- pending independent review | `src/features/buckets/use-bucket-notes.ts`: threw its query error inside `queryFn` but never exposed it in the return value -- `notes: query.data ?? []` fell through to an empty array on failure, indistinguishable from a genuinely empty Bucket. Added `error`/`refetch`. `src/routes/buckets.$bucketId.tsx`: wired a real "Couldn't load notes" + Retry state (was previously falling into the identical "No notes yet" empty state on a read failure). **Extracted** the note editor's session/draft ownership out of the route into a new standalone hook, `src/features/buckets/use-bucket-note-editor.ts` (specifically so it is testable without a router context, matching the same reasoning behind extracting `submitComment` in E-03) -- fixing three real defects along the way: Save had **no pending guard** at all (a fast double-click/double-Enter fired two create/update mutations for the same note); Cancel/Escape/backdrop **discarded unsaved text with no confirmation** (now routed through one `requestCloseNoteEditor()` that confirms via `window.confirm` -- matching this codebase's own existing pattern for "Cancel Thing" -- only when there is actually unsaved content, comparing current title/body against the note's original saved values); and **Cancel doesn't wait for a pending save** -- if the user cancelled away from a pending save and opened a DIFFERENT note before it resolved, the old save's own success callback would close/clear whatever note the user had since opened, guarded here with a generation counter (`noteSessionRef`) bumped on every open/confirmed-close and checked before an async save/delete's continuation is allowed to touch shared state -- the exact same pattern already used for E-03/F-03/H-05 in this same audit pass. Also wired real per-note/per-"new note" drafts via `session-drafts.ts` (`"bucket-note"` composer kind, keyed by note id or a stable `new:${bucketId}` slot for a not-yet-created note) so unsaved text survives the editor's *component* unmounting/remounting (e.g. navigating away and back), distinct from an explicit confirmed Cancel, which correctly clears it. | (pending) | **New:** `scripts/use-bucket-note-editor.test.mjs` (5 tests, rendering the real extracted hook against a controllable fake `notesApi`, not a source-string check): a double-click on Save while the first create is pending fires only one create; closing with unsaved text requires confirmation and stays open if declined; closing with nothing typed needs no confirmation; an unsaved draft survives an unmount/remount without an explicit discard; Cancel not waiting for a pending save does not let that stale save close a different, newer note's editor. Confirmed 3 of the 5 fail against a manually-reverted pre-fix version of the hook (temporarily removing the pending guard/confirm/generation checks), then restored the real fix. **New:** `scripts/use-bucket-notes-error.test.mjs` (2 tests: a rejected read surfaces as `error`, not an empty array; a successful read still maps rows correctly and reports no error). 482/482 total tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | **Pending independent review**, per explicit instruction -- passing tests alone does not close this out. The `Draft<T>` store's generic `{value, attachments}` shape was reused for a note's two text fields (title in `value`, body in `attachments[0]`) rather than adding a second draft-store shape -- a pragmatic reuse of D03's existing primitive, not a perfect type fit; named rather than silently presented as a clean abstraction. Confirmation uses `window.confirm` (matching this codebase's own existing "Cancel Thing" pattern elsewhere), not a styled in-app dialog -- a smaller polish gap, not a correctness one. |
| B-03/C-06 | implemented-local-pass -- pending independent review | **B-03** `src/lib/query-policy.ts` (`resolveAsyncBranch`): branch selection used a bare `hasError: boolean` and only blocked when `hasError && isEmpty` -- stale non-empty data plus a CONFIRMED 403/unauthenticated/not-found error fell through to the "ready" branch and rendered normally, with zero indication anything was wrong. Changed the signature to take the actual `error` (not a boolean) and call `classifyAsyncError` internally: a confirmed access-loss kind now forces `"error-blocked"` regardless of whether stale data exists, while an ambiguous/transient error (network blip, 5xx) with existing non-empty data still falls through to `"ready"` -- old data plus a harmless background failure is preserved, per the plan's own instruction, but old data plus a confirmed access loss is not. `src/components/katalist/AsyncState.tsx`: passes `error` through directly now; added a new `TransientErrorBanner` shown only in the surviving "ready + transient error" case, so a background refresh failure is now visibly surfaced (with Retry) instead of being completely silent. **C-06** `src/features/realtime/event-invalidation-map.ts`: `list_members` (a membership change, in particular a revocation) previously routed to only `["list", "lists"]` -- Hub's own conversation sidebar/detail, List chat, Hub/List files and meetings never even attempted the refetch that would discover "no longer accessible" via RLS. Expanded to `["list", "lists", "list-messages", "hub-conversations", "hub-conversation", "hub-files", "list-meetings", "upcoming-meetings"]`; also added the missing `"hub-conversation"` (singular, the Hub detail view) to `list_messages`'s own target list, which only had the plural sidebar index. `src/features/realtime/RealtimeInvalidationProvider.tsx`: the membership-revocation fast path's own best-effort eviction used `qc.removeQueries()` -- deleting the query object outright. Confirmed directly against a bare `QueryObserver` (not assumed) that this **defeats the batched `invalidateQueries()` enqueued in the very same event handler** for any ALREADY-MOUNTED, already-fresh observer: invalidating a query that no longer exists in the cache is a no-op, so the exact List detail page a user is looking at when their own access is revoked never actually re-fetched and never discovered the loss. Replaced with `qc.invalidateQueries()` for the same four keys (now also including `hub-conversation`/`hub-files`, previously only `list`/`list-messages`) -- confirmed this both forces an immediate refetch for an active observer AND still marks the query invalidated for the next time it's observed while inactive, without requiring anything to be removed first. | (pending) | Extended `scripts/async-state-branch.test.mjs` to 15 tests (rewritten to pass real error values instead of a bare boolean; 3 new: a FORBIDDEN/UNAUTHENTICATED/NOT-FOUND error with stale non-empty data all now resolve `"error-blocked"`, not `"ready"`). Extended `scripts/event-invalidation-map.test.mjs` (2 new: `list_members`'s full expanded target list; `list_messages` includes `hub-conversation`). Extended `scripts/realtime-invalidation-provider.test.mjs` to 13 tests (rewrote the 3 existing membership-revocation tests to check `isInvalidated` instead of `getQueryData() === undefined`, matching the new mechanism; 1 new -- mounts a REAL `useQuery` observer alongside the provider and proves it actually re-fetches once the fast path + batched invalidation flush, not just that a raw cache entry changed, directly addressing the audit's own "removeQueries alone is not a proof" point). Confirmed the new/changed tests fail against a manually-reverted pre-fix version of each file (query-policy.ts's old `hasError`/isEmpty-only branch; RealtimeInvalidationProvider.tsx's old `removeQueries()` fast path, which failed both the rewritten cache-state test AND the new mounted-observer test), then restored. 488/488 total tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | **Pending independent review**, per explicit instruction -- passing tests alone does not close this out. `AsyncState`'s new `TransientErrorBanner` is new UI surface, not yet exercised by any consumer-level screenshot/visual check (only the underlying branch logic and the banner's own render are covered) -- named as a smaller follow-up, not a correctness gap. Live RLS behavior (does a real revoked-membership row actually deliver this exact DELETE payload shape from a real Supabase instance, and does `list_members`'s own REPLICA IDENTITY setting affect what fields are present) remains an external gate this session cannot verify without a live database, unchanged from the pre-existing P8/P10 note this code already carried forward. Bucket/meeting-detail surfaces beyond the ones named in the user's own instruction (List detail, chat, files, sidebar, dock) were not separately audited for the same missing-invalidation pattern in this pass. |

## Independent review findings (KATALIST_PHASE1_INDEPENDENT_REVIEW.md, 24 Sep 2026)

An independent review of all eight Phase 1 fixes found several were only partial. Tracked as R-01
through R-09 in that document. Rows below use its own IDs.

| Review ID | Status | Files | Commit | Verification | Remaining |
|---|---|---|---|---|---|
| R-01 | implemented-local-pass -- pending independent re-review | `src/features/things/use-thing-comments.ts`: `submitComment()`'s draft-restore-on-failure logic lived in a PER-CALL `.mutate(vars, {onError})` callback, which does **not** reliably fire once the observing component (ThingDetailContent) has unmounted -- confirmed directly against a real `useMutation` (a bare per-call `onError` never fired post-unmount in an isolated repro, while a HOOK-LEVEL `useMutation({onError})` did). Moved the restore (and the send's success/error toasts) into `post`'s own hook-level `onMutate`/`onError`/`onSuccess` -- which DOES survive unmount. A second, independently-confirmed hazard: `useMutation` shares ONE `MutationObserver` across renders, rebinding its callback closures via `setOptions()` on every render -- a bare closure over the outer `thingId` variable would misattribute a mutation's own `onError` to whatever Thing the LATEST render happens to show, not the Thing the send was actually for (reproduced directly: switching a component's `thingId` prop before an in-flight mutation settled redirected its `onError` to the NEW thingId). Fixed by capturing `thingId` (plus the submitted text/attachments) in `onMutate`'s own returned `context`, read back in `onError` via the context argument, immune to later re-renders. `src/features/things/ThingDetailContent.tsx`'s `submitComment()` now only keeps a per-call `onError` for the purely cosmetic job of mirroring the (already hook-level-restored) draft store into the live input if the user is still on the same Thing -- there is nothing to mirror into if unmounted, which is fine. | (pending) | **New:** `scripts/thing-detail-comment-draft-failure.test.mjs` (4 tests, using the REAL `useThingComments` hook and a REAL `useMutation` -- only `rpcComment`/Supabase/identity are mocked at their own boundary, not `post.mutate` itself, unlike the earlier E-03 test file the review correctly flagged for not exercising real mutation-observer lifecycle): a failed send restores the draft when the detail is UNMOUNTED before the request settles; a failed send still restores into the live input when still mounted; a send that fails after switching Thing does not leak into the new Thing's input and recovers on switching back; a successful send clears the draft. Confirmed all 4 fail against the pre-fix code by reverting both files and rerunning, then restored. **Also found and fixed while building this test (a genuine test-infrastructure hazard, not a production bug):** `defaultOptions.mutations` needs its OWN `gcTime: 0`, separate from `queries.gcTime` -- mutations default to a 5-minute `gcTime`, which schedules a real `setTimeout` that kept the whole test file (and would keep `npm test` overall) hanging well past every assertion completing. Root-caused with a minimal no-React reproduction (`qc.getMutationCache().build(...)` alone hangs `node --test` with only `mutations: { retry: false }`; adding `gcTime: 0` alongside it exits cleanly) before touching any test using it. 490/490 total tests, 0 typecheck errors, 0 lint errors/80 warnings, clean build. | Pending independent re-review, per the same standing instruction as every other Phase 1 item -- passing tests alone does not close this out. R-02 (file processing finishing after unmount) was not addressed in this pass. |

| R-03/R-06/R-07 | implemented-local-pass -- pending independent re-review | `src/features/buckets/use-bucket-note-editor.ts`: three defects, all only visible against a REAL `useMutation` (the committed test file's fake `notesApi` flips `isPending` synchronously inside `mutateAsync`, masking all three). **R-03:** `saveNote()`'s `done()` callback checked only the editor's session generation, not whether the user had typed further edits to the SAME note while the save was in flight -- a slow save resolving after newer edits closed the editor and discarded them. Added a monotonically increasing `noteEditRevisionRef`, bumped by wrapped `setNoteTitle`/`setNoteBody` setters (reset to 0 on open, untouched by `openNoteEditor`'s own initial `setState` calls). `saveNote()` captures both the session generation and edit revision at submit; on success, closes/clears only if BOTH still match -- otherwise keeps the editor open, adopts the acknowledged value as the new baseline (`noteOriginal`), and leaves the newer draft intact; a first-time create also adopts the server-assigned id so a later Save updates rather than re-creates. **R-06:** the "synchronous" pending guard read `create.isPending`/`update.isPending`, which only updates on React's next render -- two `saveNote()` calls issued before that render both started a mutation (confirmed directly with a real `useMutation`). Replaced with a ref (`noteIsSavingRef`) flipped synchronously before `mutateAsync` starts and released in a `.finally()` regardless of outcome. **R-07:** `requestCloseNoteEditor()`'s confirmation condition was `noteIsDirty && (noteTitle.trim() || noteBody.trim())` -- clearing a saved note's text back to blank is dirty but trims to empty, so it closed without asking. Condition is now `noteIsDirty` alone. `saveNote()`'s blank-content branch used to always route through the close path silently; it now shows a validation toast and keeps the editor open when editing an EXISTING note (nothing to discard for a never-touched new note, which still closes without a prompt). | (pending) | **New:** `scripts/bucket-note-editor-live-mutation.test.mjs` (7 tests, using the REAL `useBucketNoteEditor` + REAL `useBucketNotes`/`useMutation`/`useQuery` -- only `supabase`/`useSession` are mocked at their own boundary, not `mutateAsync` itself, unlike the earlier G-06 test file the review correctly flagged for masking these three defects with a fake synchronous-`isPending` mutation): a stale save acknowledgment does not close the editor over newer edits and the newer text survives; a save with no further edits still closes/clears normally; two synchronous Save calls before any re-render start exactly one real mutation; the guard releases after settling so a later save still works; clearing a saved note's text to blank still requires the discard confirmation; a blank Save on an existing note shows validation and stays open; closing a never-touched new note still needs no confirmation. Confirmed 4 of the 7 fail (and the suite hangs) against the pre-fix file by stashing it and rerunning, then restored. 497/497 total tests (490 baseline + 7 new), 0 typecheck errors, 0 lint errors/80 warnings (unchanged baseline), clean build. | Pending independent re-review. R-09, R-04, R-05, R-02, R-08 were not addressed in this pass. |

| R-09 | implemented-local-pass -- pending independent re-review | `src/lib/query-policy.ts`: `classifyAsyncError()` and `isPermanentQueryError()` classified errors from lowercased message-text substrings only. A caller supplying a structured `{status: 403}` or `{code: "42501"}` shape without a recognized message substring (confirmed directly against the pre-fix resolver: `{status: 403, message: "Forbidden"}` and `{code: "42501", message: "access denied"}` both returned `"ready"` with stale non-empty data still loaded) fell through to `"failed"`, which `resolveAsyncBranch()` does not treat as confirmed access loss -- stale protected content kept rendering. Added `extractErrorStatus()`/`extractErrorCode()` helpers reading a `status`/`statusCode` number and a string `code` off the thrown object; both functions now check structured `status`/`code` FIRST (401→unauthenticated, 403 or `code:"42501"`→forbidden, 404 or `code:"PGRST116"`→not-found, `status>=500`→failed/transient, explicitly before message text so a coincidental substring in a 5xx message cannot be misread as a denial), falling back to the existing message-text checks only when no structured signal is present. | (pending) | **Extended:** `scripts/async-state-branch.test.mjs` (+12 tests): `classifyAsyncError()` returns the correct kind for structured 401/403/`42501`/404/`PGRST116`/500 inputs that carry no recognized message substring; `resolveAsyncBranch()` blocks stale non-empty data for a structured 403 and a structured `42501` code, and still renders `ready` for a structured 500 (transient, not a denial); `isPermanentQueryError()` returns true for structured 403/`42501` and false for a structured 500. Confirmed 8 of the 12 fail against the pre-fix file (403/42501/404/PGRST116 cases; 401 and 500 happened to already pass via message-text fallback) by stashing `query-policy.ts` and rerunning, then restored. 509/509 total tests (497 baseline + 12 new), 0 typecheck errors, 0 lint errors/80 warnings (unchanged baseline), clean build. | Pending independent re-review. This item addressed only the classifier's structured-error gap; the review's live-revocation-delivery question for B-03/C-06 (whether a removed member's browser actually receives the Realtime DELETE event, and every mounted consumer's own handling of a confirmed 403/empty-authority result) remains open per §"C-06: what is reviewed and what still requires a real environment" and requires isolated staging verification, not a unit test. R-04, R-05, R-02, R-08 were not addressed in this pass. |

| R-05 | implemented-local-pass -- pending independent re-review | `src/features/calls/use-list-call.ts` and `src/features/calls/call-room.ts`: H-05 fixed the A-leave-B-A-completion race for `join()`'s own continuation, but three related gaps remained. **Gap 1:** `onReaction`/`onDraw`/`onDocPage` set hook state directly with no ownership check -- a broadcast event already queued by Realtime before `removeChannel()`'s unsubscribe completes could still reach these handlers and repaint a NEWER call's state. Fixed at two layers: `call-room.ts`'s three broadcast handlers now check `this.closed` before invoking the callback (closed is set synchronously by `leave()`), and `use-list-call.ts` defines one `isActiveRoom()` check (comparing `joinGenerationRef.current` to the generation captured when that room's `join()` started) applied in `onState`/`onReaction`/`onDraw`/`onDocPage` as a second, hook-level ownership guard. **Gap 2:** unmount cleanup called `roomRef.current?.leave()` without retiring `joinGenerationRef`, so a `join()` still in flight at unmount time kept its generation current -- its later catch could still call `toast.error`/`setLifecycle`/`setLastError` after unmount. Fixed by bumping `joinGenerationRef.current` in the unmount cleanup, before `leave()`, so the join's own existing generation check (already used for exactly this purpose elsewhere) now also covers unmount. **Gap 3:** reaction auto-dismiss `setTimeout`s (in both `sendReaction` and the room's `onReaction`) were never tracked or cleared, leaking a timer past `leave()`/unmount. Added a `reactionTimersRef` Set populated by both call sites and drained (`clearTimeout` each, then `.clear()`) in both `leave()` and the unmount cleanup. | (pending) | **New:** `scripts/use-list-call-ownership.test.mjs` (4 tests, extending the existing `FakeCallRoom` mock pattern from `use-list-call-lifecycle.test.mjs` with `emitReaction`/`emitDraw`/`emitDocPage` helpers so a test can fire a stale room's own callback closures directly): a stale room's `onReaction` after `leave()`+rejoin does not repaint the new call's reactions, while the new (active) room's own reactions still apply; the same for `onDraw`/`onDocPage`; unmounting while a `join()` is pending and then rejecting emits no stale `toast.error` (sonner mocked to capture calls); `leave()` clears a pending reaction timer rather than leaking it (verified by wrapping global `setTimeout`/`clearTimeout` to track scheduled ids). Confirmed all 4 fail cleanly (no hang) against the pre-fix files by stashing both and rerunning, then restored. Fixed one incidental `react-hooks/exhaustive-deps` warning the new unmount-cleanup code introduced (captured `reactionTimersRef.current` into a local before the cleanup closure) to keep the lint baseline at 80. 513/513 total tests (509 baseline + 4 new), 0 typecheck errors, 0 lint errors/80 warnings (unchanged baseline), clean build. | Pending independent re-review. This item did not attempt the review's live-environment ask (deployed Realtime event delivery/timing for a genuinely dropped peer) -- only the ownership/lifecycle races reproducible locally. R-04, R-02, R-08 were not addressed in this pass. |

| R-02 | implemented-local-pass -- pending independent re-review | `src/features/things/ThingDetailContent.tsx`: `handleCommentFileChange()` captures `targetThingId` before `await processFileForUpload()`, but its post-processing branch compared it only against `thingIdRef.current` -- a ref only ever updated by a RENDER. After the component UNMOUNTS entirely (not just switches to a different Thing), `thingIdRef.current` keeps pointing at whatever Thing was last displayed, indistinguishable from "still mounted, same Thing" by that ref alone -- so it took the `setCommentAttachments()` branch (a no-op on an unmounted component) instead of the existing "different Thing" branch's direct `session-drafts.ts` write, and the processed attachment silently disappeared. Added an explicit `isMountedRef` (set true on mount, false in an unmount-cleanup effect) and changed both the live-state branch's condition and the error-toast condition to `isMountedRef.current && thingIdRef.current === targetThingId`. When that's false (unmounted, OR mounted but now on a different Thing), it now unconditionally takes the existing direct-draft-write path -- safe even across an identity switch, since `session-drafts.ts` stamps the epoch at write time and `getDraft()` re-checks it, so a stale write simply becomes unreadable rather than corrupting another identity's draft. Also added a `processingCommentFiles` counter feeding into the existing `useBlockWhile(...)` call for `"thing-comment-draft"`, so a file still being processed (not yet in `commentAttachments`) now also blocks Morning Brief's auto-open, per the review's "pending file processing also is not itself registered as an interaction blocker" note. Did not implement the review's blob-URL-revocation-for-discarded-results suggestion -- with this fix a processed file is never discarded (always persisted to the captured Thing's draft), so there is no longer a "discarded stale result" path in this component for R-02's reproduced scenario. | (pending) | **New:** `scripts/thing-detail-comment-file-unmount.test.mjs` (4 tests, real `ThingDetailContent` rendered with `variant="court"` -- the branch that actually mounts the comment composer's file `<input>`, confirmed by dumping the rendered HTML for the default variant and finding zero `<input type="file">` elements; only `supabase`/`useSession`/`rpc`/etc. mocked at their own boundary, same roster as the R-01 test file): a file whose processing resolves AFTER the whole detail unmounts is still persisted into that Thing's own draft; a file that resolves while still mounted on the SAME Thing still updates live state and renders normally; a file that resolves after switching to a DIFFERENT Thing lands in the original Thing's draft, not the newly displayed one; pending file processing registers the `useInteractionBlocker` blocker. Confirmed 2 of the 4 fail against the pre-fix file (the unmount-persistence case and the blocker-registration case; the other two were already correct) by stashing it and rerunning, then restored. 517/517 total tests (513 baseline + 4 new), 0 typecheck errors, 0 lint errors/80 warnings (unchanged baseline), clean build. | Pending independent re-review. R-04 and R-08 were not addressed in this pass. |

| R-04 | implemented-local-pass -- pending independent re-review | `src/features/catchup/use-morning-brief.ts` and `src/features/catchup/morning-brief-schedule.ts`: `profileQuery.data?.timezone ?? null` used the browser-zone fallback (`resolveEffectiveTimezone`) identically whether the profile was still loading OR had settled with no `timezone` column set -- those are not the same fact. If the browser's local time was already past 07:00 but the real (still-loading) profile zone was not, the client could attempt-and-lose the day's claim against the WRONG zone; the server's own authoritative threshold check (`claim_morning_brief`'s `IF v_local_hour < 7 THEN RAISE EXCEPTION 'before morning threshold'`) correctly rejected it, but `attemptedKeyRef` was already set before that await, so the exception's generic `catch` block (meant for "service unavailable, e.g. migration not deployed") silently swallowed it as a permanent failure for that identity/context/day -- the legitimate later claim, once the real profile zone's own 07:00 arrived, could never succeed for the rest of that day. Separately, a focused hook probe held a claim in flight, changed the effective timezone mid-await, then resolved it; `open` became `true` even though the post-await recheck covered context/blocker/visibility/moments but not current timezone/threshold/profile-readiness. **Fix:** added a `profileLoading` input (`!preview && Boolean(identityId) && profileQuery.isLoading`) to `isEligibleToAutoOpen()`, checked immediately after `authPending` and before the threshold check, with a new `"profile-loading"` blocker reason -- eligibility is now blocked outright until the profile query has actually settled, so the browser-zone fallback is only ever reached once "the profile has no zone" is a confirmed fact, not a loading artifact. Added `timeZoneRef`/`profileLoadingRef` (updated every render, same pattern as the existing `contextRef`/`hasBlockingInteractionRef`) so the post-await `stillEligibleToShow` recheck now also requires `!profileLoadingRef.current` and `isPastMorningThreshold(new Date(), timeZoneRef.current)` using the LATEST clock/timezone, not what was true when the claim started. Added a specific catch branch for the server's `"before morning threshold"` message: resets `attemptedKeyRef.current = null` instead of falling through to the generic `console.error` path, so the already-scheduled next-07:00-threshold timer (unchanged) can still legitimately retry later the same day instead of the slot being permanently burned. | (pending) | **Extended:** `scripts/morning-brief-schedule.test.mjs` (+1 test: `profileLoading: true` blocks even when the (unreliable) browser-zone guess looks well past threshold) and `scripts/use-morning-brief.test.mjs` (+2 tests, using the file's existing controllable `useProfile`/`claimMorningBriefLive` mocks and mocked clock): while the profile is still loading, no claim is attempted even though otherwise eligible, and one is attempted automatically once the profile settles, without a reload; a claim rejected by the server as premature does not mark `alreadyPresentedToday` and does not consume the day's attempt -- a later legitimate attempt (simulated by bumping `catchup.count`, standing in for the scheduled next-threshold timer firing) still succeeds and opens. Confirmed both new hook-level tests fail against the pre-fix files (12/12 prior tests still passed unmodified) by stashing both files and rerunning, then restored. 520/520 total tests (517 baseline + 3 new), 0 typecheck errors, 0 lint errors/80 warnings (unchanged baseline), clean build. | Pending independent re-review. Did not implement a typed "before morning threshold" RPC response (would require a migration signature change and re-deployment coordination) -- used message-text detection of the server's existing `RAISE EXCEPTION` text instead, matching this codebase's existing pattern (`domain-error.ts`) for classifying errors by message substring. R-08 was not addressed in this pass; this completes R-01/R-02/R-03/R-04/R-05/R-09 (six of the review's nine numbered items) plus C-06's locally-reviewable scope -- R-06/R-07/R-08 and every live-environment/staging verification (Realtime revocation delivery, RLS, the migration's actual deployment) remain open. |

| R-08 | implemented-local-pass -- pending independent re-review | `src/features/catchup/use-catchup.ts`: `fetchCatchupMoments()`'s prerequisite `const { data: auth } = await supabase.auth.getUser();` read only `data`, discarding `error` -- a failed identity lookup produced `auth.user === null`, indistinguishable from "genuinely authenticated but has no actor row" (a real, different, and successful state per the adjacent F-05 comment's own logic), silently mapping every moment with `myActorId = null` and reporting a successful load. Rather than just adding an `if (authError) throw authError;` check (which would still spend a second, independently-fallible auth round trip for identity `useCatchup()` already has), removed the `supabase.auth.getUser()` call entirely: `fetchCatchupMoments` now takes a `profileId: string | null` parameter, and `useCatchup()` passes `user?.id ?? null` from its own already-established `useSession()` call (the query is already `enabled: liveAuth`, i.e. gated on that same session existing, and the query key already includes `user?.id`) -- the same identity source used elsewhere in this codebase (e.g. `use-morning-brief.ts`'s `identityId`). `myActorId === null` is now reachable only via a successful `actors` query finding no row (still throws on `actorError`, unchanged from the existing F-05 fix), never via a swallowed auth failure. | (pending) | **Extended:** `scripts/use-catchup-error-propagation.test.mjs` (+2 tests, using the file's existing mocked `supabase`/`useSession`/RPC roster): no separate `auth.getUser()` round trip is made at all (a call counter on the mocked `getUser` stays at 0) -- the profile id from `useSession()` is reused directly; a signed-in profile with a genuinely empty `actors` lookup (`{data: null, error: null}`, i.e. `maybeSingle()` found no row) is a successful, distinct state and must not surface as `catchup.error`. Confirmed the first new test fails against the pre-fix file (which still made the now-removed call) by stashing it and rerunning; the second passed both before and after, since it was checking a state the pre-fix code also handled correctly -- restored. 522/522 total tests (520 baseline + 2 new), 0 typecheck errors, 0 lint errors/80 warnings (unchanged baseline), clean build. | Pending independent re-review. This completes all nine of the review's numbered findings (R-01 through R-09) plus C-06's locally-reviewable scope. Every live-environment/staging verification the review calls for -- deployed Realtime revocation delivery (B-03/C-06), the `morning_brief_receipts` migration's actual deployment and RLS behavior (R-04), and re-running the full local check suite one more time after all changes -- remains open and explicitly requires an isolated staging environment, not further local unit tests. |

## Second independent review pass: four follow-on findings after re-review at 4caf14f

The reviewer re-reviewed all landed fixes (522/522 tests, typecheck, lint, build all passing) and
found the original repros addressed, but identified four follow-on cases the first pass missed.
All four are fixed below in one pass.

| Finding | Status | Files | Verification | Remaining |
|---|---|---|---|---|
| Comment results can affect the wrong Thing [P1] | implemented-local-pass -- pending independent re-review | `src/features/things/use-thing-comments.ts`: `onError`'s rollback (`qc.setQueryData(["thing-comments", thingId], ...)`) and `onSettled`'s three invalidations all still read the outer `thingId` closure -- rebound via `setOptions()` on every render, the exact hazard R-01 already fixed for `onError`'s draft-restore body, just missed here. A send that settles after switching Thing could roll A's optimistic-comment rollback into B's cache, or invalidate/refetch B's query instead of A's. Both now use `context.thingId` (the Thing actually submitted for), already captured in `onMutate`'s context. Additionally, `PostCommentInput` changed from `string \| {body, attachments}` to a required `{thingId, body, attachments}` shape -- `mutationFn` itself was ALSO reading the outer `thingId` closure (worse than a cache-key bug: a render switching Thing between dispatch and mutationFn's actual execution could send the comment itself to the wrong Thing on the server). The one call site (`ThingDetailContent.tsx`'s `submitComment()`) now passes its own already-captured `submittedThingId` explicitly. | **New test** in `scripts/thing-detail-comment-draft-failure.test.mjs`: seeds distinct, non-empty caches for Things A and B (via a dedicated `QueryClient` with `staleTime: Infinity` and non-zero query `gcTime`, needed so the seeded-but-unobserved data survives until each Thing is actually rendered -- `gcTime: 0` was found to evict it near-instantly during the test's own `await` ticks), submits on A, switches to B, rejects A's request, and asserts B's cache is completely untouched, A's cache is correctly rolled back, and the only `invalidateQueries` call (spied via wrapping `qc.invalidateQueries`) targets `["thing-comments","thing-a"]`, never B. Confirmed it fails against the pre-fix file, then restored. | Pending independent re-review. |
| A processed file can cross account boundaries [P1] | implemented-local-pass -- pending independent re-review | `src/features/things/ThingDetailContent.tsx`: `handleCommentFileChange()`'s direct-draft-write branch called `setDraft()` without its optional `capturedEpoch` argument, so it defaulted to whatever epoch is CURRENT at write time -- the surrounding comment's claim that this "becomes unreadable" after an identity switch was incorrect; `setDraft()` stamps a write with the epoch it's given (or current, if omitted), so an unstamped late write is stamped with the NEW identity's epoch, making an old identity's file readable under a new account (for whatever Thing id happens to collide). Fixed by capturing `targetEpoch = getIdentityEpoch(qc).epoch` alongside `targetThingId` (before any `await`), and passing it explicitly as `setDraft`'s 5th argument -- per its own documented contract, a write under an already-stale captured epoch is now silently dropped instead of adopted by the new identity. | **New test** in `scripts/thing-detail-comment-file-unmount.test.mjs`: selects a file, unmounts (taking the direct-write branch), advances the identity epoch (`advanceIdentityEpoch`, real production code, unmocked) mid-processing to simulate an account switch, then resolves the file-processing promise -- asserts the resulting draft for that Thing id has no attachments (the write was dropped, not adopted under the new identity). Confirmed it fails against the pre-fix file, then restored. | Pending independent re-review. |
| Creating a note while continuing to type leaves an old "new note" draft [P2] | implemented-local-pass -- pending independent re-review | `src/features/buckets/use-bucket-note-editor.ts`: the R-03 "newer edits during save" branch adopts the server-created id (`setEditingNoteId(createdId)`) but never moved or cleared the OLD `new:<bucketId>` draft slot -- the write-through effect only ever WRITES the (now-current) key, it never clears a previous one. Starting a second new note later would read the stale `new:<bucketId>` key via `openNoteEditor()`'s own `getDraft` call and resurrect the first (already-created) note's abandoned in-flight text. Fixed by reading the live draft from the old key (`savedKey`, which equals `new:<bucketId>` in this branch since `editingNoteId` is null) and writing it forward to `createdId` via `setDraft`, then `clearDraft`-ing the old key, all synchronously in the same `done()` callback, before `setEditingNoteId` -- migrating the draft immediately rather than waiting for the write-through effect to (only partially) catch up on the next render. | **New test** in `scripts/bucket-note-editor-live-mutation.test.mjs`: creates a note, keeps typing during the pending create, resolves it (adopting the server id per R-03), asserts the OLD `new:<bucketId>` slot is now empty, closes, and asserts a SECOND `openNoteEditor()` (a genuinely new note) starts with a blank title rather than resurrecting the first note's abandoned draft. Confirmed it fails against the pre-fix file, then restored. | Pending independent re-review. |
| Morning Brief's post-claim check still omits the date [P2] | implemented-local-pass -- pending independent re-review | `src/features/catchup/use-morning-brief.ts`: the post-await `stillEligibleToShow` recheck (added in the R-04 fix) re-verified the CURRENT clock/zone is past 07:00 via `isPastMorningThreshold`, but never compared that against the LOCAL DATE the receipt was actually claimed for. A sufficiently delayed claim (or a timezone change mid-await that shifts the effective date) can resolve on a calendar day AFTER the one it claimed, with that new day's own 07:00 already passed too -- `isPastMorningThreshold` alone can't tell "still today" from "already tomorrow, also past 7am." Fixed by adding `result.localDate === localDateKey(new Date(), timeZoneRef.current)` to the `stillEligibleToShow` conjunction -- `claimMorningBriefLive`/`claimMorningBriefPreview` already return the actually-claimed `localDate` in their result, so this needed no new data, just an added comparison. | **New test** in `scripts/use-morning-brief.test.mjs`: dispatches a claim for "today" (`claimResult.localDate` pinned to the test's fixed fake-clock date), holds it pending via the existing `claimGate` mechanism, advances the file's already-established `mock.timers` fake `Date` forward by exactly 24 hours (still comfortably past 07:00 in the new day too), then resolves the claim -- asserts `open` stays `false` (the date mismatch blocks it) while `alreadyPresentedToday` is still `true` (the receipt itself is genuinely recorded). Confirmed it fails against the pre-fix file, then restored. | Pending independent re-review. |

526/526 total tests (522 baseline + 4 new), 0 typecheck errors, 0 lint errors/80 warnings (unchanged
baseline), clean build. Staging verification for the migration, RLS, and Realtime revocation
delivery remains open, as it has throughout this audit -- it requires an isolated staging
environment, not further local unit tests.

## KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md execution

Plan prepared at `34e69bd` on `katalist-plan/batch-a-baseline`, authorizing local execution of
T00-T15 without repeated approval pauses. Baseline reconciled: HEAD matched the plan's own baseline
exactly, no drift to reconcile.

### T00 — Baseline, build safety, and executable browser harness

**Status:** LOCAL PASS. **Owns:** A-01, A-03, V-02.

**Baseline established** (branch `katalist-plan/batch-a-baseline`, HEAD `34e69bd`, Node v22.19.0,
clean working tree except this plan doc): 526/526 tests, 0 typecheck errors, 0 lint errors/80
warnings, clean `build:app`. `.agents/` and `output/` untracked work preserved untouched.

**Warning triage** (all 80, by rule):
- `@typescript-eslint/no-unused-vars` (69) — left as-is; each is a small, page-local unused
  binding (destructured-but-unused state setters, unused imports) with no correctness content.
  Not fixed in T00 since fixing them means either deleting the dead code or wiring it to a real
  control, which belongs to whichever page task owns that file (T08-T14) — fixing it here without
  that context risks silently deleting a control a later task was about to wire up.
- `react-refresh/only-export-components` (8) — inspected each. Two were real, cheaply-fixed cases
  and are now fixed: `AppContextProvider.tsx` (moved `useAppContext`/`AppCtx`/the context object
  into `use-app-context.ts`, which was previously only a re-export shim -- now the real definition,
  matching the existing `use-interaction-blocker.ts` precedent) and `CourtLaneStack.tsx` (moved the
  `courtLaneContent` data constant into a new `court-lane-content.ts`, updating its two other
  consumers, `CourtCompactLane.tsx` and `ThingNavigator.tsx`). The remaining 6 are shadcn/ui
  generated primitives (`badge.tsx`, `button.tsx`, `form.tsx`, `navigation-menu.tsx`, `sidebar.tsx`,
  `toggle.tsx`) co-locating a `*Variants` cva export with their component -- a universal, accepted
  pattern across the shadcn/ui ecosystem; refactoring vendored-style primitives for a dev-only HMR
  nit is not worth the blast radius. Documented here as the "narrow reasoning," not fixed.
- `react-hooks/exhaustive-deps` (1) — `AppContextProvider.tsx`'s profile-scoped local-cache seed
  effect deliberately depends on `user?.id` (the only part of `user` it reads), not the whole
  `user` object, to avoid re-reading localStorage on every unrelated `User` field change (e.g. a
  token refresh). Documented with an inline comment and a scoped `eslint-disable-next-line`.
- "Unused eslint-disable directive" (2) — `public/firebase-messaging-sw.js`'s `no-undef` disable and
  `src/lib/auth/use-current-user.ts`'s `react-hooks/rules-of-hooks` disable were both dead (the
  underlying rule no longer fires there, likely a prior ESLint/config upgrade). Removed both.
- Net: **80 -> 75** warnings, all removals verified with 0 new warnings introduced and the full
  suite/typecheck/build still green after each change.

**Test classification** (the six named files, by whether each `test()` asserts on real rendered/
executed behavior or on `readFileSync`'d source text matched with `assert.match`/regex):
- `scripts/katalist-state.test.mjs` (6/6 real behavior) and `scripts/katalist-regression.test.mjs`
  (4/4 real behavior) -- no action needed, already exercise real functions/state.
- `scripts/katalist-foundation.test.mjs` (10 of 12 source-text, 2 real behavior) -- the source-text
  ones mostly assert specific RPC/grant/column names appear in specific migration/RPC/component
  files (e.g. "uses `assign_outside_katalist`, never `add_list_member`"). These are legitimate,
  narrow wiring-contract checks (a fact about which identifier is called, not a runtime behavior
  claim) and are retained as deliberate architecture assertions per the plan's own instruction.
- `scripts/court-dual-mode-workspace.test.mjs` (6/6 source-text), `scripts/court-stack-components.
  test.mjs` (16/16 source-text), and `scripts/inline-thing-detail-workspace.test.mjs` (6/6
  source-text) -- **all** assertions in these three files are `readFileSync` + regex/`.includes()`
  against component source, despite test names that read as runtime behavior claims (e.g. "overview
  is composed as three equal layered stacks", "Lists open Thing detail in an inline workspace").
  These do not currently prove any of that renders correctly -- only that certain strings/JSX
  shapes are present in the source text. Flagged for conversion to real React Testing Library
  render assertions in **T09** (Court dual-mode layout) and **T11** (Bucket inline
  `InlineThingDetailWorkspace` integration), the tasks that actually touch this behavior next, per
  the plan's own "convert when the owning package changes the behavior" instruction. Not rewritten
  in T00 itself.

**Browser harness** (`playwright.config.ts`, `.github/workflows/quality.yml`,
`tests/e2e/preview/README.md` new, `tests/e2e/global-setup.ts` new):
- Preview projects now use an isolated, configurable `KATALIST_E2E_PORT` (default 4173, distinct
  from the developer's own `npm run dev` on 8080) with `reuseExistingServer: false` -- always starts
  its own fresh server against the current checkout rather than silently reusing (and testing)
  whatever a developer already has running. Does not attempt to free/kill a colliding port.
- Added `metadata: { testedCommit }` (from `GITHUB_SHA`/`VERCEL_GIT_COMMIT_SHA`) so the HTML
  report/artifacts record which commit was under test.
- Confirmed directly that the preview specs need no real Supabase project -- only
  syntactically-valid `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` so the client constructs
  without throwing. Added a new `e2e-preview` CI job (installs Chromium, runs with fixture
  credentials pointing at an unreachable host, uploads the HTML report as an artifact on every run).
  A blanket same-origin request-blocking fixture was attempted for additional isolation and
  reverted: it also blocked Vite's own dev-server inspector/HMR requests, breaking the "no console
  errors" assertion -- documented in `smoke.spec.ts`'s own comment and the new README as a dead end,
  not attempted again without narrower per-host scoping.
- Found and fixed a real flake: a freshly-started (cold) local dev server under this suite's default
  parallel worker count raced first-navigation SSR compilation and failed roughly 2 of 3 runs across
  all five viewport projects together. Added `tests/e2e/global-setup.ts` (sequential warm-up fetch
  of every route the specs use) and set `workers: 1` for local (non-staging) runs -- confirmed 3
  consecutive full 15-test runs (5 viewports x 3 specs) passed cleanly after both changes together;
  global-setup alone was insufficient. Staging runs (a real, already-warm deployment) are unaffected
  by either change.
- `build:app` was already migration-free (`vite build` only); `build` (which also runs
  `db:migrate`) is intentionally kept separate and is not what CI/hosting should invoke.
- Documented the two migration systems accurately in `README.md`'s new "Database migrations"
  section: `migrations/` (root, `scripts/migrate.mjs`, the separate Neon/PGLite `pg` stack) versus
  `supabase/migrations/` (this app's actual Postgres schema -- Things/Lists/Buckets/Court/Morning
  Brief/etc.), and that nothing in this repo's `npm` scripts deploys the latter; that requires the
  Supabase CLI or an equivalent operator step against the actually-configured project.

**Verification:** 526/526 tests, 0 typecheck errors, 0 lint errors/75 warnings (down from 80),
clean `build:app`, 15/15 local Playwright preview specs passing reliably across 3 consecutive runs.

**Remaining dependency:** RELEASE-01 (hosted CI run of the new `e2e-preview` job at a real commit;
confirming the deployment host actually invokes `build:app`, not `build`).

### T01 — Query truth, cancellation, and mounted access-loss handling

**Status:** LOCAL PASS -- partial, remaining item below. **Owns:** B-01, B-02, B-03, B-04 and remaining
consumer clauses of C-06.

**Commits:** `da9c7c6`, `dfe6012`, `397c55a`, `ceeb936`, `fe104fd`.

**Done:**
- `src/lib/read-request.ts`: shared `withReadDeadline()` combining React Query's own per-query
  cancellation signal with an explicit 15s deadline (matching `AsyncState`'s existing
  `STALLED_QUERY_MS`), distinguishing "this request hit its own deadline" (`ReadTimeoutError`) from
  "cancelled for an unrelated reason" (route-away, a superseded query). Fully unit-tested (7 tests).
- `classifyAsyncError()`/`isPermanentQueryError()` (`query-policy.ts`) recognize the new "timeout"
  kind: not a confirmed access loss, not auto-retried. `AsyncState.tsx` renders the existing
  "taking longer than usual" + retry UI for it.
- Threaded end-to-end (queryFn signal -> `withReadDeadline` -> `.abortSignal()`) into every major
  read query function found in the codebase: `fetch-court.ts` (Things read, verified with a real
  mocked-transport call proving the abort signal actually fires), `use-lists.ts` (`fetchLists`,
  `fetchListDetail`), `fetch-buckets.ts`, `fetch-bucket-items.ts`, the inline `useBucket()` detail
  query, `use-nudges.ts` (both queries), `use-catchup.ts`'s `fetchCatchupMoments`, `use-
  conversations.ts` (`fetchConversations` and the single-conversation detail query), `use-hub-
  files.ts`'s `fetchFiles`, `use-list-messages.ts`'s `fetchMessages`, `use-list-things.ts`'s inline
  Things read, `use-list-meetings.ts`'s `fetchMeetings`, `use-upcoming-meetings-reminder.ts`'s
  `fetchUpcomingMeetings`. Extended `callUngeneratedRpc()`'s return type (`rpcs.ts`) to expose the
  real, already-callable `.abortSignal()` its underlying builder supports, which its type had
  erased. Updated ~10 existing test files' mocked query builders with `.abortSignal()` stubs so
  their existing assertions kept working against the new call shape.
- The actor lookup (`getActorId`/`actor-query.ts`) is a separate, shared, deduplicated 30s-cached
  lookup used by many features; threading per-caller cancellation through that shared cache was
  judged a larger, separate change and intentionally not attempted in this pass.

**Verification:** 537/537 tests (526 T00 baseline + 11 new), 0 typecheck errors, 0 lint errors/75
warnings (unchanged from T00), clean build, maintained across all five commits.

**Remaining (explicit, not started):**
1. **The access-loss consumer matrix.** `AsyncState` (the shared offline/error/empty/loading
   component with the confirmed-access-loss contract) is currently wired into only 4 of the ~12
   surfaces the plan names: Nudges (hook + route), Lists index, Buckets index. Court, List detail,
   Bucket detail, Hub conversations/messages/files, and meetings all still render their own bespoke
   loading/error/empty logic and do not yet hide protected content on a confirmed 403 the way
   Nudges/Lists/Buckets-index do. Re-plumbing each onto the shared contract is live-UI rework with
   real regression risk per surface, not a mechanical repeat of this pass's wiring -- deliberately
   deferred as its own body of work rather than rushed.
2. **RLS-empty-vs-parent-authority distinction.** Not started: using an authoritative parent/
   membership read to distinguish a genuinely empty authorized collection from a no-longer-
   accessible parent, per the plan's own B-03/C-06 clause.
3. A related, pre-existing (not introduced by this pass) finding noticed while wiring `use-
   conversations.ts`: `fetchConversations`'s `Promise.all` for `list_members`/`list_messages`
   destructures only `{data}`, never checking `error` -- an auxiliary-read failure there currently
   fails open as an empty result rather than a confirmed error, which is exactly the C-04 concern
   T01 names. Not fixed in this pass (out of the mechanical-wiring scope); flagged for whichever
   pass does item 1 above, since fixing it means deciding the correct AsyncState-driven presentation
   for that failure, not just adding an `if (error) throw`.

Per the plan's own "LOCAL PASS / RELEASE PENDING" convention, T01 is not marked complete. The two
items above are named, concrete remaining dependencies, not a vague "mostly done."

### T02 — Draft revisions, entity transitions, and file-resource ownership

**Status:** LOCAL PASS -- partial, remaining items below. **Owns:** remaining E-03/G-06 clauses and H-04.

**Commits:** `6530018`, `3644052`, `52d9928`.

**Done:**
- `session-drafts.ts`: added `getDraftRevision()`, a monotonically increasing edit count per
  (composer kind, entity), separate from the draft's own content/presence, bumped by every
  `setDraft()`/`clearDraft()` call (idempotently -- clearing an already-empty slot doesn't count as
  a second edit) and never reset, even across an identity retirement. Closes a real gap in
  `use-thing-comments.ts`'s restore-on-failure logic: the old check ("is the draft empty right now")
  could not distinguish "never touched since submit" from "typed something new, then deliberately
  cleared it back to empty" -- both look identical by content alone, but only the former is safe to
  overwrite with a stale failed-submit restore. `PostCommentInput` now carries an optional
  `draftRevision`, captured by `ThingDetailContent`'s `submitComment()` right after its own explicit,
  synchronous `clearDraft()` call.
- `ThingDetailContent.tsx`: the due-date edit input (`due` state) and selected-file-in-viewer id
  (`selectedFileId`) had no per-Thing reset at all, unlike the comment/attachments composer state a
  few lines above them -- switching Thing on the same component instance (e.g. via
  `CourtDetailModal`, which doesn't key by `thing.id`) left Thing A's unsaved due-date edit visible
  in Thing B's own "Edit Due Date" input. Reset both in the same effect that already
  resets `moreOpen`/rehydrates the comment draft on `thing.id` change.
- `use-bucket-note-editor.ts`: `saveNote()`/`deleteNote()` had no identity-epoch guard at all (only
  session/edit-revision, both same-identity concerns) -- a save/delete resolving after an account
  switch on the same component instance could still close the successor identity's editor and show
  this identity's own toast on their screen. Captured `getIdentityEpoch(qc).epoch` at dispatch time
  and check `isEpochCurrent()` first in every continuation.

**Verification:** 548/548 tests (537 T01 baseline + 11 new across three commits), 0 typecheck
errors, 0 lint errors/75 warnings (unchanged since T00), clean build, maintained across all three
commits. Each fix's regression test confirmed to fail against the pre-fix file.

**Remaining (explicit, not started):**
1. Explicit ownership of object URLs and FileReader work (`src/lib/file-utils.ts`,
   `attachments.ts`) -- retained draft and viewer holding independent references, revoke-on-
   last-owner-unmount, `processFileForUpload` cancellation settling once, no second abandoned URL
   from a late FileReader event after a fallback already ran.
2. Durable upload-before-persist: before a real comment/message persists, attachment bytes should
   go through the authorized storage path with a durable descriptor -- a local blob URL is
   preview-only and must never become a shared message attachment.
3. The same due-date/selected-file kind of audit for `MagicBox.tsx`, `ListChatPanel.tsx`, and
   `ListCallPanel.tsx` (named in the plan's own file list) has not been done -- only
   `ThingDetailContent.tsx` was audited and fixed in this pass.
4. Replacing third-party Office/Google viewer URLs for private files with an authorized fallback
   (plan's own explicit item) -- not investigated in this pass.

Per the plan's own "LOCAL PASS / RELEASE PENDING" convention, T02 is not marked complete.

### T03 — Shared actions and complete interaction blocking

**Status:** LOCAL PASS -- partial, remaining items below. **Owns:** B-05, F-04 and the coordination
portion of F-07.

**Commits:** `e0c1e65`, `3471ba3`.

**Done:**
- `MagicBox.tsx` registered no blocker at all -- added a `processingFiles` counter (same pattern as
  `ThingDetailContent`'s `processingCommentFiles`) and `useBlockWhile("magic-box-draft")` while
  there's unsent text, an attached file, or a file still processing.
- `use-bucket-note-editor.ts` registered no blocker at all -- added `useBlockWhile("bucket-note-
  draft")` gated on the editor being open AND `noteIsDirty` (the same dirtiness check already
  driving the discard-confirmation logic).
- `use-list-call.ts`'s `useBlockWhile(joined, "active-call")` missed the "joining" window (pending
  getUserMedia/permission/signaling) and "reconnecting" -- both still very much "in a call". Changed
  to block on `lifecycle === "joining" || "connected" || "reconnecting"`.
- Fixed two existing test files (`use-bucket-note-editor.test.mjs`, `bucket-note-editor-live-
  mutation.test.mjs`) whose render helpers didn't wrap in `InteractionBlockerProvider` -- adding the
  note-editor blocker made `useBlockWhile` throw in all 15 of that file's existing tests until fixed.

**Verification:** 552/552 tests (548 T02 baseline + 4 new), 0 typecheck errors, 0 lint errors/75
warnings (unchanged), clean build. Each fix's regression test confirmed to fail against the pre-fix
file.

**Remaining (explicit, not started):**
1. `ListChatPanel.tsx`'s own compose draft has no blocker registration (not audited/fixed in this
   pass).
2. Explicit action-outcome return values (`performed`/`already-in-flight`/`failed`/`retired`) for
   Morning Brief Catch/pace/Move Now actions -- not implemented; those still don't return a typed
   outcome a caller can branch on.
3. Routing Morning Brief's own actions through the shared `query-updates.ts` claim/patch mechanism
   -- not investigated; Morning Brief's action dispatch was not touched in this pass.
4. Confirming at most one automatic Morning Brief controller is active for the visible Court mode
   (hidden responsive variants must not each attempt the daily claim) -- not investigated.

Per the plan's own "LOCAL PASS / RELEASE PENDING" convention, T03 is not marked complete.

### T04 — Bounded history and shared chat

**Status:** CODE IMPLEMENTED / LOCAL PASS; browser and deployed-database validation pending.

**Changed code:** `src/lib/history-pages.ts`, `src/features/things/{fetch-thing-history,use-thing-comments,ThingDetailContent}.ts*`, `src/features/lists/{fetch-list-message-pages,use-list-messages,ListChatPanel,chat-operations,chat-feed-model,chat-mentions,chat-scroll-state,ActiveChatOperationBlocker}.ts*`, `src/features/drafts/{session-drafts,use-session-draft}.ts*`, the List route, call panel, Hub workspace/files, realtime invalidation, query keys, root blocker, notification endpoint, and additive `supabase/migrations/20260924120000_bounded_chat_and_notification_claims.sql`.

**Implemented:** latest 50-row `(created_at,id)` keyset pages for List messages and Thing comments/activity, with independent paged attachment/system/pinned histories and server-side full-history message search; Load older/error/retry, prepend anchor, scroll restoration, and new-message cues across shared chat surfaces. Chat text, staged attachment descriptors, and selected mentions now share an identity-scoped per-List draft. Sends claim an operation synchronously, use a client UUID for insert/retry/recovery, retain pending/failed rows, reconcile realtime echoes by UUID, and reject stale identity continuations. Server notifications derive text/mentions/recipients from the authorized persisted row and use an atomic one-claim-per-message SQL record before the provider call. This intentionally gives **at-most-once push attempts**, not guaranteed push delivery after a provider failure.

**Evidence:** 564/564 full tests, typecheck clean, lint 0 errors/75 existing warnings, migration exercised in PGlite, and `build:app` clean. New focused tests cover 1,001 same-timestamp rows, invalid cursor syntax, concurrent same-draft sends, lost-response recovery, retry UUID reuse, identity retirement, realtime echo dedupe, shared two-composer draft/attachment state, focused-search suppression on confirmed access loss, and atomic SQL notification claims. Existing tests updated only where their old flat-cache/source-shape assumptions no longer represented behavior.

**Still open:** no actual browser pass for scroll geometry, cross-surface navigation, or staging Supabase/RLS; the additive Supabase migration is **not deployed**. The List route still contains its separate chat markup until T11 replaces it with `ListChatPanel`; it consumes the same draft/send/pagination contract in the interim. T02's file-resource and durable-comment-attachment items and T05's read/unread semantics remain separate open packages. T06 owns the remaining unbounded overview aggregate and Hub summary reads. Do not treat this local code pass as release clearance.

### T05 — Read state, counts, and Team/Hub behavior

**Status:** LOCAL PASS. **Owns:** C-08, G-10, G-11; coordinates auxiliary count failures with C-04.

**Commits:** `59ef17d`, `63053e4`, `c5d27b1`.

**Done:**
- `read-state.ts` (Thing comment "last read" state) had no identity scoping at all -- a real,
  live bug matching the exact hazard `chat-read-state.ts` (Hub conversations) had already been
  fixed for. `getThingLastReadAt()`/`markThingAsRead()` now require an identity and are no-ops
  without one; the pre-scoping legacy unscoped key is never read as a fallback, only cleaned up on
  next write. `calculateCommentCounts()` reuses its existing `currentActorId` param as the scoping
  key. Updated all four call sites (`ThingDetailContent.tsx`, `CourtDetailModal.tsx`,
  `CourtFocusView.tsx`, `use-court.ts`). (`59ef17d`)
- Marking a Thing "read" no longer fires unconditionally on open. `ThingDetailContent.tsx` now
  gates the mark-read effect on the Comments tab actually being selected AND the comments query
  having settled without error, anchored to the latest LOADED comment's own timestamp rather than
  wall-clock `now()` -- a comment that arrives after that boundary still shows unread on the next
  check. `markThingAsRead()` takes an optional third `atTimestampMs` param for this; callers
  without a specific boundary still fall back to `now()`. The redundant, unconditional
  `markThingAsRead()` calls in `CourtDetailModal.tsx`/`CourtFocusView.tsx` (which would have undone
  this gating) were removed -- `ThingDetailContent`, which both render, now owns it exclusively.
  `use-thing-comments.ts` exposes `commentsIsLoading` so the gating effect can wait for the load to
  settle. (`63053e4`)

- `use-court.ts` zeroed a Thing's already-correct `unreadCommentCount` whenever the viewer had
  EVER read it before, with no check on *when* relative to the comments the server counted --
  discarding genuinely new unread comments that arrived after a prior read. Now only zeroes it
  when the read happened at-or-after the currently-displayed fetch (`query.dataUpdatedAt`).
  `markThingAsRead()` also wrote to the live `notifications` table unconditionally, including from
  a preview/demo session; guarded with `isPreviewMode()`. Both read-state stores (Thing comments,
  Hub conversations) only ever dispatched a same-tab `CustomEvent` -- added a native `"storage"`
  event listener alongside it so a mark-as-read in one tab now updates another tab's unread badges.
  `useConversationMentionCount()` collapsed a genuinely failed (retries exhausted) lookup to the
  same `0` as a confirmed empty result -- now returns a distinguishable `"unknown"`, surfaced in
  `HubSidebar` as a `"?"` badge instead of silently hiding it. `useListThings()` (the real,
  non-preview List route) hand-rolled its own mapping and never computed comment counts at all --
  now reuses `mapDbThingRows`, the same mapping Court uses. `team.index.tsx` (Hub landing) was a
  single hard-coded panel that told a brand-new account with zero conversations/lists to "pick" one
  from an empty sidebar -- now distinguishes a genuinely empty account from a
  populated-but-unselected one, with a loading state in between. `useConversation()` (Hub
  workspace header) had no seeding from the sidebar's already-fetched record -- the header showed a
  fabricated "Conversation" / "0 members" while its own detail query was in flight; now seeds via
  `placeholderData` from the sidebar cache, with `ConversationWorkspace` showing a skeleton only
  when genuinely nothing is available yet. Audited and found already correct, no changes needed:
  one primary call entry, Chat/Files/Call tabs, named search, contextual Pin labels, dock close
  preserving the draft, and Contacts/NewGroup dialogs' pending/failure/input-preservation behavior.
  (`c5d27b1`)

**Verification:** 584/584 tests (572 baseline + 12 new across 8 files), 0 typecheck errors, 0 lint
errors/75 warnings (unchanged), clean build. Every new regression test confirmed to fail against
its pre-fix source (via `git stash`) and pass post-fix.

Per the plan's own "LOCAL PASS / RELEASE PENDING" convention, T05 is not marked complete.

### T06 — Summary/detail separation and efficient auxiliary data

**Status:** PRODUCTION CLOSED (2026-09-25) — code, SQL, production migrations,
production deployment, authenticated route loading, and release gates are complete.

**Implemented locally:**
- `THING_OVERVIEW_COLUMNS` excludes `notes`. Court, List, Bucket, Bucket detail,
  accessible-Thing picker, and Catch Up overview fetchers use the overview mapper.
  The selected Thing still uses `useThing()`/`THING_COLUMNS` for full detail.
  `ThingStackCard` no longer mounts `PdfCanvas`; a PDF is a reserved-size file
  tile until the user explicitly opens the viewer.
- `get_thing_overview_stats` (`20260924160000_thing_overview_stats.sql`) is an
  invoker/RLS-scoped, ≤500-ID aggregate with context validation, exact comment,
  viewer-unread, and ready-attachment counts plus one preview descriptor. The
  client sends T05's local read watermark and batches preview URL signing.
  It never falls back to downloading all comment/attachment rows when the RPC
  is missing or fails: counts are `undefined`, and overview UI says “Counts
  unavailable.” Detail attachment and comment-count failures likewise remain
  distinguishable from confirmed empty results and expose retry.
- `createSignedUrls` now signs deduplicated Thing paths in ≤100-path requests,
  preserving per-file URL errors. The Court modal loads the selected Thing's
  full files only on detail intent, not from its one-file overview preview.
- `get_list_overview_counts` (`20260924180000_list_overview_counts.sql`)
  replaces `mapDbListRows`'s transfer of every Thing row solely to compute
  List counts; member and cover reads remain concurrent with the aggregate.
  A missing aggregate row or a query error rejects instead of reporting zero.
  Hub and List identity mapping now queries only the owner/member/author
  profile IDs discovered from their authorized page (in ≤100-ID chunks),
  rather than downloading the full directory on the common path.
- `get_bucket_progress` (`20260924200000_bucket_progress.sql`) computes
  exact, RLS-visible unique progress across direct Things and referenced
  List members in ≤500-Bucket batches. It removes the prior full member-Thing
  ID transfer while preserving the direct-plus-List overlap semantics; an
  isolated SQL fixture proves the dedup and a client regression checks the
  mapping. A failed/missing count rejects rather than displaying zero.
- `get_trophy_activity_stats` (`20260924210000_trophy_activity_stats.sql`)
  computes lifetime sorted/caught counts, rolling seven-day event count, and
  a local-calendar streak under invoker RLS in one response rather than
  transferring the entire actor activity history. Trophy and the capped
  Shred-history read still run concurrently. A failed aggregate rejects;
  the page now shows unavailable/retry (or labels cached data stale) rather
  than displaying fabricated zero counters. SQL and client failure fixtures
  cover the contract.
- `get_hub_conversation_page` (`20260924170000_hub_conversation_page.sql`)
  returns one latest-message summary per RLS-visible DM/group in a ≤100-row
  keyset page. `useConversations` uses infinite-query pages; the Hub rail has
  “Load more,” and search explicitly says it covers loaded conversations.
  `get_hub_unread_counts` (`20260924190000_hub_unread_counts.sql`) computes
  unread and mention counts for the whole visible page in one viewer-scoped
  request, excluding self-authored messages. A failed count aggregate shows
  unknown instead of zero or an N-per-row fallback. Hub member/read errors
  no longer become a false empty rail.

**Local evidence:** isolated PGlite tests execute all six T06 migrations against
owner/member/outsider policies and verify grants, bounds, exact counts,
self-authorship, latest-only ordering, and keyset behavior after a newly
arriving conversation. Client tests verify 0/30/300-Thing aggregate calls
(0/1/1), 0/10/100-List and Bucket count calls (each 0/1/1), and 0/10/100-Hub page calls
  (one summary request; one count/member request and one scoped-identity
  helper call for nonempty pages). These are
mocked transport request-volume/adapter-duration fixtures, **not** actual
network or route latency claims. The pre-existing Court/Thing mapper
parallelization and actor cache were retained.

**2026-09-25 local browser follow-up:** a dedicated local demo server on
port 4174 exposed five unintended Supabase reads on a preview Court reload,
including 401s from the directory/assignable paths. A failing unit test and
the browser request log reproduced the defect. `fetchProfileIdentities()`
and its scoped variant now resolve demo identities entirely locally, and
`useAssignablePeople()` waits for a real authenticated user. A repeated
preview Court reload recorded **0 Supabase requests**. The reproducible
read-only script `scripts/measure-preview-routes.mjs` recorded one sample per
cold/warm navigation at 1440×900, Chromium, against that development server:
Court 1674/958ms, Lists 1186/706ms, Buckets 1290/841ms, Team 1289/663ms;
all were HTTP 200 with 0 Supabase REST requests and 0 REST failures. These
are **demo/development-server** figures, not representative live latency or
authorization proof. The staging read-only RPC/count spec is prepared at
`tests/e2e/staging/t06-rpc-readonly.spec.ts` but has not run: staging URL,
publishable key and disposable-account environment are not configured here.
A separately built `VITE_KATALIST_DEMO_MODE=true` **production-mode local**
preview recorded one cold/warm navigation each: Court 3454/2250ms, Lists
3008/3030ms, Buckets 2029/2028ms, Team 2035/2035ms, all HTTP 200 and 0
Supabase REST requests. These single-sample local values are *not* a reliable
performance comparison or live-data scaling result. In that build, opening
the first demo NOW card displayed its selected-Thing detail (Files, Comments,
Activity), and the overview had no mounted PDF canvas. The local preview
contains no attached file, so actual PDF preview and signing still require a
seeded staging fixture.

A five-viewport read-only browser smoke initially surfaced an unrelated
incoming-call vibration defect: `createRingtone().stop()` called the
gesture-gated vibration API on the anonymous page's initial mount, before any
ring or user interaction. The fix only starts vibration after user activation
and only stops vibration that actually started. Both cases have a regression
test that failed against the prior implementation. The complete local suite
now passes: 630/630 unit tests, 15/15 browser smokes, clean typecheck/build,
and lint at 0 errors/75 existing warnings. One intermediate browser run
timed out on the first cold `/auth` compilation while the full unit suite ran
concurrently; the isolated rerun passed all 15, so this is not counted as a
product regression.

**Historical pre-closure gaps (superseded by the production closure below):**
- **2026-09-25 follow-up:** Hub's unread/mention aggregate failure already
  produced explicit `unknown` badges, but their tooltips incorrectly claimed
  the app was "retrying" without a scheduled retry. The loaded-conversation
  rail now shows a "Retry counts" action that refetches the aggregate and
  uses truthful unavailable labels. This is local UI behaviour only; it does
  not verify the undeployed RPC in production.
- **2026-09-25 pre-deployment production baseline:** the user supplied
  `https://katalist-web.vercel.app/` and signed into an existing account in
  the browser. Court, the specified existing List detail, Lists index,
  Buckets index and Team landing all rendered without console errors. The
  production site's compiled asset contains the same Supabase project ID as
  this checkout's `.env.local`. A read-only PostgREST OpenAPI inspection
  (service-role schema visibility; no row reads or writes) found **none of
  the six T06 RPC paths at that time**. This baseline was superseded by the
  authorized migration application recorded below. Separately,
  `git ls-remote --heads origin katalist-plan/batch-a-baseline` returned no
  remote branch: this checkout's T06/T07 commits are not the deployed app.
  These observations are a **production baseline**, not a pass of the new
  implementation. The user prohibited creating new production data or
  objects at that time, so no migration or write test was attempted. The user
  later explicitly authorized the six T06 functions, T07 publication, and
  app deployment; the database portion is now applied, but the app deployment
  remains gated by the broader schema chain below.
- **2026-09-25 authorized production database rollout:** the linked Supabase
  CLI was verified to target `dyxqlgnbwtbxxdfoiqva` (the checkout's configured
  project), not the different project exposed by the app connector. Production
  already had all required base tables/columns, `context_kind`, and enabled
  RLS on the watched tables. The two indexed tables were small (estimated 19
  attachments and 417 activity rows). Applied only the six T06 SQL files in
  timestamp order and recorded their exact versions in migration history;
  no customer records were changed. Catalog verification found all six RPCs
  `SECURITY INVOKER`, executable by `authenticated`, not `anon`. Read-only
  execution of every RPC succeeded (dummy UUIDs for bounded aggregates,
  page size 1 for Hub, UTC for Trophy). These management-role smoke calls do
  **not** prove authenticated RLS or browser performance.
- Route-level cold/warm request counters and measured duration boundaries for
  Court, Lists, Bucket and Hub in a safe browser/staging environment. The
  adapter fixtures above do not prove full-route volume or live speed.
- Verify authenticated production RLS (especially `thing_attachments`
  policies) and route behavior with a testable account. Catalog grants,
  isolated PGlite fixtures and management-role smoke calls are not a
  substitute for a real authenticated browser session.
- Production does contain `thing_attachments`, and the T06 aggregate applied
  successfully there. **2026-09-25 reconciliation:** the 12 production-only
  versions (UAT profile/rate limits, Firebase push outbox, Magic Box
  attachment saga/AI rate limits, public-identities security-invoker,
  catch-inherits-owner-importance, bucket reference idempotency, and list
  collaboration/team mentions/bucket pins) were pulled verbatim, read-only,
  from `supabase_migrations.schema_migrations` and committed as local files
  at their original timestamps (`d4afb34`) — `supabase migration list` now
  shows **0** local/remote mismatches for every version up to
  `20260825125932`. No production object was touched to do this. A collision
  check found no conflicting object redefinitions between those 12 and the
  still-pending 25. Full method and evidence:
  `docs/superpowers/plans/2026-09-25-t06-t07-migration-reconciliation.md`.
  **Resolved in closure:** the 25 history-pending versions were reconciled
  against the live catalog, colliding DDL was made repeat-safe, malformed
  `reopen_thing` SQL was corrected, and all 25 applied successfully. Migration
  history now has zero local/remote mismatches.
- Other screens still call the broad cached
  `getProfileIdentities()` directory helper; audit their cold-route volume
  separately before claiming app-wide directory efficiency.
- Browser verification of detail/overview transitions, unavailable-count
  banners, Hub pagination/search, and explicit PDF preview remains part of
  the later validation pass requested by the user.

### T07 — Payload-aware realtime and catch-up

**Status:** PRODUCTION CLOSED (2026-09-25) — the payload-aware client is
deployed, publication coverage is live, the production WebSocket subscription
handshake succeeds, and deterministic routing/reconnect/catch-up tests pass.

**Implemented locally:** the root owner now forwards `eventType` plus old/new
row fields into a pure routing map. Reliable Thing/List/Bucket IDs narrow
detail invalidation while summary/collection keys stay broad where their
membership can change. A Thing moved between Lists invalidates both parents;
a primary-key-only DELETE retains the broad membership/authority fallback.
The batcher removes narrow entries already subsumed by a broad prefix in the
same flush. Browser focus, visibility restoration, online, and Realtime
resubscription share an epoch-scoped catch-up gate; focus/online merge pending
events and refresh even mounted queries with `staleTime: Infinity` rather than
relying on stale-only framework defaults. Effect cleanup removes listeners,
discards pending work, and makes callbacks from discarded Strict Mode channels
inert. The existing one-root-owner and 150ms/500ms batching boundaries remain.

**Local evidence:** pure routing tests cover old/new parent moves, known-ID
narrowing and missing-ID fallback. Provider DOM tests prove payload delivery
leaves an unrelated Thing detail quiet, fresh mounted observers refetch on
focus, identity teardown removes listeners, and same-epoch Strict Mode stale
callbacks do nothing. The pre-existing 20-event batcher and reconnect tests
continue to pass. A further mounted-observer test proves a primary-key-only
membership DELETE still refetches a fresh List. Source inspection found that
the original `supabase_realtime` publication only contained seven tables,
omitting several subscribed tables including `list_members` and
`bucket_items`. The additive
`20260925100000_realtime_publication_coverage.sql` migration adds the missing
RLS-protected tables (without forcing `REPLICA IDENTITY FULL`); a PGlite test
executes it twice and verifies idempotent coverage. Production catalog checks
after its authorized application show all 14 watched tables published; the
`list_members` table still has default replica identity, so a DELETE may carry
only its primary key and the broad fallback remains necessary. The client also now
watches Lists, Buckets, Bucket notes and Thing attachments so the T06
summaries/details can respond to those events. No browser/staging Realtime
delivery claim is made: publication coverage is live, but the new client is
not deployed and no change event was generated for an end-to-end check.

**Historical pre-closure gap:** staging event payload inspection for
INSERT/UPDATE/DELETE (especially membership DELETE), live reconnect and
focus timing, and route-level request-volume measurements. These remain part
of the later code-first release validation pass.

**2026-09-25 routing follow-up:** a source/consumer audit found three missed
refresh paths, each reproduced by a failing routing test before correction:
comment/attachment events did not refresh all List/Bucket/Catch Up Thing
overview counts; List renames did not refresh Thing projections embedding the
List name or upcoming meeting labels; and List membership changes did not
refetch Thing surfaces even though checked-in `can_view_thing` RLS can grant
access through List membership. The corrected map preserves a scoped
`["list-things", listId]` target when the List ID is known, but keeps broad
Thing/other collection targets where the event payload cannot identify
affected Thing IDs. These tests prove routing, not live delivery or deployed
RLS; the production-only constraint below remains unchanged.
Local verification after this follow-up: 632/632 unit tests, 15/15 isolated
read-only browser smokes, clean typecheck/build, and lint at 0 errors/75
pre-existing warnings. The browser smokes cover anonymous entry routes, not
authenticated T06/T07 delivery or production migration behaviour.

**Production closure evidence:** the exact prebuilt app was deployed to
`https://katalist-web.vercel.app`; an existing authenticated account loaded
the specified List and its real Chat history with no browser warning/error;
the deployed page loaded the new production bundle; all 15 watched tables are
published; and a read-only production Realtime subscription reached
`SUBSCRIBED`. The full suite passes 632/632 with zero typecheck/lint errors and
a clean build. No customer row was mutated just to manufacture an event.
Payload routing, old/new-parent invalidation, primary-key-only DELETE fallback,
batching, focus/online catch-up, reconnect, epoch teardown and stale-channel
rejection are covered by deterministic and real-DOM tests. This evidence closes
T07 without violating the production-data constraint.

### T08 — Shared type, controls, elevation, and motion rollout

**Status:** LOCAL PASS -- complete and independently verified. **Owns:** D-01 through D-04.

**Commits:** `9e323da`, `356bf06`, `ddc729a`, `0f2ee35`, `88ab6a4`, `64992c5`, `6448253`.

**Starting-state audit:** contrary to a greenfield assumption, meaningful token
scaffolding already existed pre-labeled "D01"/"D02" in `styles.css`/
`motion-tokens.ts`/`use-motion-preference.ts` -- typography scale, control-height
and elevation tokens, and motion-duration bands were all defined, but essentially
unconsumed by real components, with confirmed floor/cap violations. This pass
closed the elevation, motion, and contrast-measurement gaps with tests; typography
and hit-target *adoption* across the wider app were audited and found to still need
a large, visually-reviewed rollout that this pass did not attempt blind.

**Done:**
- **Elevation:** `Dialog`/`Sheet`/`Popover`/`DropdownMenu` (`Content` and
  `SubContent`) now use `katalist-elevation-{dialog,popover}` utilities sourced
  from the existing `--elevation-*` tokens, replacing raw `shadow-lg`/`shadow-md`
  classes that the global `* { --tw-shadow: 0 0 #0000 !important }` suppression
  zeroed at runtime -- these four overlay types previously had **no visible
  elevation at all**. The new utilities set `box-shadow` directly, bypassing
  Tailwind's `--tw-shadow` variable machinery, so they render correctly without
  needing (or being blocked by) that global suppression's removal.
- **Motion:** fixed two Court spatial-motion durations that exceeded the plan's
  <=280ms workspace cap -- `CourtLaneStack`'s card-swap tween ran at 360ms, its
  drag-release snap-back at 300ms -- by sourcing both from `motion-tokens.ts`'s
  `workspace` band. `CourtFocusView`'s hero-flight tween is now sourced the same
  way. `CourtLaneStack` also duplicated its own
  `matchMedia("(prefers-reduced-motion: reduce)")` listener instead of sharing
  `use-motion-preference.ts`'s combined OS/storage/broadcast wiring (exactly the
  ad hoc check that hook's own header comment says it replaced); now shares it via
  a newly exported `subscribeToMotionPreference`.
- **Contrast:** built `scripts/lib/color-contrast.mjs` (OKLCH -> linear sRGB ->
  WCAG relative luminance -> contrast ratio, verified against the known
  white/black 21:1 extreme) and `scripts/measure-palette-contrast.mjs`, which
  measures every meaningful text/status/UI-component pair in `styles.css`'s
  token palette. Recorded in
  `docs/superpowers/plans/2026-09-25-t08-palette-contrast.md`: **four real,
  previously-unmeasured failures** -- destructive button label (3.89:1, needs
  4.5:1), the "Waiting" status label (2.99:1, needs 3:1), and both border tokens
  against the page background (1.44:1, needs 3:1). Not fixed here (recoloring
  the brand/status palette is a product decision), but no longer silently
  unmeasured.

**Closure pass (2026-09-25, commits `356bf06` through `6448253`):**
- **Contrast:** all four measured failures fixed at the token level --
  `--destructive` 0.63->0.59 (3.89:1->4.59:1), `--status-waiting` 0.68->0.67
  (2.99:1->3.11:1), and a new `--control-border` token (0.62) plus `--input`
  repointed to it (1.44:1->3.64:1) for meaningful (non-decorative) component
  boundaries. `--border` itself stays untouched (decorative dividers, not a
  WCAG 1.4.11 boundary). All 19 measured pairs now pass; report and tests
  updated from "known failure" to passing-threshold assertions.
- **Typography:** every exact `text-[10px]`/`text-[11px]` (191 instances) and
  every decimal sub-12px size found in a follow-up sweep (~130 more --
  `text-[8px]` through `text-[11.5px]`) bumped to `text-[12px]`, across 50+
  files. Several small fixed-height badges got a matching container-height
  bump (e.g. 16px->18px) to avoid clipping. `PersonAvatar`'s initials floor
  raised 10px->12px. A repo-wide regression test
  (`scripts/t08-typography-floor.test.mjs`) now fails on any future sub-12px
  arbitrary text size.
- **Hit targets:** Dialog/Sheet close buttons and PDFViewer's page-nav
  buttons given a real >=32px hit target (icon size unchanged); a broad
  parallel audit across Court/Hub/Lists/Calls/ThingDetailContent/routes
  added missing `aria-label`s, `focus-visible` rings where `outline-none` had
  no replacement, bumped several sub-24px icon-only targets to >=24px, and
  converted a handful of keyboard-inaccessible `<div onClick>` rows to real
  `<button>` elements. `scripts/t08-hit-targets.test.mjs` covers the shared
  primitives and Button's existing 44px touch variants.
- **Shadow suppression removed.** Every remaining `shadow-*` consumer (58 at
  the last count, growing to ~90 once `shadow-xs`/`shadow-2xs` were included)
  was individually classified -- dialogs/sheets/alert-dialogs ->
  `katalist-elevation-dialog`; popovers/menus/select/context-menu/hover-card/
  chart-tooltip -> `katalist-elevation-popover`; genuinely floating cards/
  toasts/docks -> `katalist-elevation-card`; base cards/inputs/buttons/
  tables/panels and selected/focus/drag-state indicators had their
  decorative shadow removed outright -- before the global
  `* { --tw-shadow: 0 0 #0000 !important }` rule was deleted from
  `styles.css`. `scripts/t08-shadow-suppression.test.mjs` guards against its
  return and against any new unclassified `shadow-*` usage. Two
  `drop-shadow-sm` uses on welcome/auth hero artwork were deliberately left
  (illustration, not component elevation).
- **Motion/gesture:** `scripts/t08-motion-gesture-contracts.test.mjs` adds
  source-verified coverage (GSAP's Observer plugin isn't faithfully
  reproducible in jsdom, matching this codebase's existing precedent) for:
  wheel/Observer scoped to the lane's own node (never window/document); the
  swipeable card renders no editable input to steal focus/scroll from;
  rapid navigation blocked while animating, with in-flight tweens reverted
  on every supersede and on unmount; the GSAP Observer killed on unmount;
  and reduced-motion snapping an in-flight animation immediately.
- **Browser verification:** `scripts/t08-browser-verification.mjs` (real
  Playwright, local demo-mode server, no remote/staging target) captured
  screenshots and computed-style measurements at all 5 required viewports
  (390x844, 768x1024, 1024x768, 1440x900, 1920x1080) for Court, Lists index,
  Buckets index, Team/Hub, and Me, plus a 200% zoom pass and a reduced-motion
  + keyboard-focus pass on Court. Result: zero sub-12px text found in the
  live DOM, zero sub-24px hit targets, zero console errors, no horizontal
  overflow at 200% zoom on Court, and a visibly rendered `focus-visible`
  ring (via `box-shadow`, confirmed by computed style) after two Tab
  presses. **One out-of-scope finding surfaced by this pass:** at 200% zoom,
  Court's three fixed-width NOW/NEXT/LATER lane columns do not reflow --
  column headers and card text clip/truncate ("NOW" -> "NO", "Additional" ->
  "Add ition") rather than wrapping or narrowing gracefully. This is a
  responsive-reflow (WCAG 1.4.10) issue in Court's grid layout, not caused
  by the 12px floor or any T08 token change, and is outside D01-D04's scope
  -- recorded here rather than fixed blind.
- A mechanical trailing-whitespace cleanup script used mid-pass had a regex
  bug that collapsed indentation in 3 files (caught via `git show --stat`
  reporting near-total line counts for what should have been single-line
  edits); fixed in a follow-up commit (`64992c5`) by restoring from the last
  good commit and re-applying only the intended edits with precise string
  replacement, verified clean against the same and other files.

**Verification:** 669/669 tests (632 baseline + 37 new across 6 files), 0
typecheck errors, 0 lint errors/75 warnings (unchanged), clean build. `rg
'text-\[[0-9.]+px\]' src` confirms zero values below 12px; `rg
'shadow-(sm|md|lg|xl|2xl|xs|2xs)' src` confirms zero unclassified usage
outside the two reviewed drop-shadow exceptions; the universal shadow
suppression is absent from `styles.css`.

**Independent closure review (2026-09-25):** reran all 37 focused T08 tests,
the complete 669-test suite, typecheck, lint and `build:app`; every gate passed
with the same 75-warning lint baseline and zero errors. Rechecked the saved
Playwright evidence (`output/t08-browser-verification/results.json`): 27 total
entries, including 25 route/viewport checks, with no HTTP, console, sub-12px
text, sub-24px target or horizontal-overflow failure recorded. The documented
Court lane clipping at 200% remains assigned to T09's responsive Court layout;
it does not invalidate D-01 through D-04. T08 is closed locally. No deployment
or database change was made by this package.

**Remaining (explicit):**
1. The 200% zoom column-reflow finding above (Court's NOW/NEXT/LATER grid) --
   a pre-existing responsive-layout gap, not a T08 token/consumer issue.
2. Full WCAG conformance and production visual review are not claimed here --
   this is a local, demo-mode verification pass, not a staging/production
   audit or an accessibility certification.

### T09 — Court, common detail sections, and Magic Box

**Status:** LOCAL PASS -- complete; an independent review found two Magic
Box race conditions, both fixed and reverified (see "Independent review
findings" below). **Owns:** A-02, E-01 through E-05.

**Commits:** `c81aba5`, `52bbb37`, `37ce6e5`, `12c0a9a`, `c736118` (items 1-4,
6-9); `e0fdbbb` (item 5 extraction); `b111048`, `d3e2ded` (independent-review
race fixes, below).

**Done (all 9 plan items):**
1. Queue/navigator click targets converted to native controls, with
   button/keyboard alternatives for swipe/drag commands including timed
   Snooze, sharing the same capability/command path as gestures (`c81aba5`).
2. Magic Box Escape retains the in-progress draft; a successful capture
   identifies the created Thing(s) and offers Open (`52bbb37`).
3. Magic Box shows its resolved destination List/Work-Home before submit and
   persists a real scoped session draft across route changes (`37ce6e5`).
4. Magic Box shows a per-file failed state with Retry instead of silently
   dropping a failed upload; successful files/assignee results survive
   partial failure (`12c0a9a`).
5. **This pass:** extracted the four shared Thing-detail sections --
   `ThingIdentityHeader`, `ThingStatusControls`, `ThingAttachments`,
   `ThingDiscussion` -- out of `ThingDetailContent.tsx` (1868 lines before,
   1028 after, confirmed via `wc -l`) into `src/features/things/components/`,
   following the same
   presentational-extraction discipline already established by
   `ThingViewOnlyBanner` (confirmed shared, byte-identical between variants)
   earlier in T09. `ThingIdentityHeader` and `ThingStatusControls` take a
   `variant: "default" | "court"` prop and render genuinely different
   markup per variant, matching pre-extraction behavior exactly (court's
   compact info-card/single Catch-or-Sort button vs. default's discrete
   People/Bucket/Acknowledgement/Pace/Work-Status sections) -- no visual
   unification was attempted where the two variants already diverged.
   `ThingAttachments` is court-only (the default variant has no Files list
   of its own, confirmed by grepping the pre-extraction file before
   assuming a default equivalent existed). `ThingDiscussion` covers the
   Comments/Activity tab bar, comment/activity lists, and composer for both
   variants, plus the default variant's "more actions" overflow slot
   (Catch/Nudge/Sort/Cancel/Shred/Edit-Due-Date/Assign-outside-Katalist),
   passed in as a `moreActionsPanel` node built and owned by
   `ThingDetailContent` -- there is no court-variant equivalent of that
   overflow at all. Every `rpc*` call, `run.mutate`/`withOptimisticPatch`
   invocation, draft-state read/write, and busy/caps computation stayed in
   `ThingDetailContent.tsx` unchanged; the four extracted components are
   purely presentational and only call the `on*` callback props they are
   given, per the plan's "extract presentation plus its explicit shared
   contract, not a new independent mutation system."
6. Real Comments/Activity tabs consuming T04's bounded history/load-more/
   error states, with nullable transitions (null/A/B/detail-close keeping
   correct file/avatar/due/comment state) tested against the actual
   component (`c81aba5`-`c736118` range; retained by item 5's extraction --
   full suite reverified after the move).
7. Court layout distinguishes empty Court from filtered-empty on the desktop
   layout, with capture vs. Clear-filters affordances and understandable
   visible/total counts (`c736118`).
8. Readable layouts across the required breakpoints (>=1280px three lanes
   plus sidebar, 1024-1279px labeled With Others toggle, below 1024px
   stacked/collapsible lanes) using T06's bounded media (covered by the
   `c81aba5`-`c736118` range).
9. Accepted ID-based selection and deferred-focus ownership logic preserved;
   a failed removal restores selection only when the user has not
   navigated (covered by the `c81aba5`-`c736118` range).

**Item 5 verification:** full repo `npm test` (688/688 pass, 0 failures),
`npx tsc --noEmit` (0 errors), `npm run lint` (0 errors; same pre-existing
warning set on `ThingDetailContent.tsx` -- confirmed by diffing against
`git stash`-ed lint output before this change, plus two now-removed unused
imports (`cn`, `ThingViewOnlyBanner`) that the extraction itself made
newly-unused), and `npm run build:app` (clean Vercel/Nitro build). Four
source-inspection tests that regex-matched markup moved out of
`ThingDetailContent.tsx` were updated to also read the new component
file(s), preserving each test's original intent rather than weakening it:
`scripts/court-stack-components.test.mjs` (E02, `ThingViewOnlyBanner` now
asserted against `ThingIdentityHeader.tsx`), `scripts/
court-dual-mode-workspace.test.mjs` (two tests: the default variant's
`>Pace<` heading and the court variant's "Mark Sorted"/"Add to bucket" text,
both now asserted against `ThingStatusControls.tsx`), and `scripts/
inline-thing-detail-workspace.test.mjs` (the `data-detail-region="people"`/
`"controls"` markers, now asserted against `ThingStatusControls.tsx`;
`data-detail-region="metadata"` has no court-variant equivalent and stayed
inline in `ThingDetailContent.tsx`, so that assertion is unchanged).

**Acceptance (plan text, verified):** keyboard-only Capture->Catch->pace->
comment/file->Sort passes; swipe and button versions are equivalent;
null/A/B/detail-close keeps correct file/avatar/due/comment state.
Court/List/Bucket/Nudge display equivalent permissions for the same Thing
(shared `getThingCapabilities` unchanged, only its consumers' rendering was
relocated). Magic Box partial failure and route changes retain text/files
and do not recreate prior successful work (items 2-4, unaffected by this
pass's detail-section extraction). T09 is closed locally. No deployment or
database change was made by this package.

**Independent review findings (both fixed):** a separate review pass found
that item 5's extraction was sound (confirmed against a full rerun:
688/688 tests, 0 typecheck errors, 0 lint errors, clean build) but flagged
two real races in Magic Box (items 2-4) that this pass's own verification
had not exercised, plus one inaccurate metric:
1. **Destination-scoped async work (P1).** File processing (`processOneFile`,
   used by both file-pick and Retry) and the Toss mutation are async and
   were not tied to the `draftEntityId`/context that started them --
   switching Work/Home or List destination while either was still in
   flight let the stale operation append a file to, or clear, the newly
   selected destination's draft once it resolved. Fixed (`b111048`) with an
   `epochRef` bumped on every `draftEntityId` change; each async operation
   captures the epoch before its first `await` and drops its result (does
   not call `setAttachedFiles`/`setFailedAttachments`/`setValue`/etc.) if
   the epoch no longer matches on completion. Regression-tested in
   `scripts/magic-box-destination-race.test.mjs` -- confirmed to hang/fail
   against the pre-fix code (a same-instance `rerender` with a changed
   `listId` while a mocked, manually-resolved `processFileForUpload`/
   `rpcCreateThing` promise is still pending) and pass cleanly post-fix.
2. **Stale `view` in the toast's Open callback (P1).** `onThingCreated` in
   `CourtDesktop` closed over the `view` memo directly; since the toast is
   created at mutation-success time but can be clicked much later, after
   further Court renders/refetches, the callback could keep searching an
   outdated snapshot and silently fail to open the newly created Thing even
   after data had actually refreshed in. Fixed (`d3e2ded`) with a
   `viewRef` written on every render (the same `xRef.current = x` idiom
   already used in `src/features/catchup/use-morning-brief.ts` for this
   exact "async callback needs the latest value, not its creation-time
   closure" problem), and the callback now searches `viewRef.current`.
   `scripts/magic-box-capture-ux.test.mjs`'s existing CourtDesktop-wiring
   test was updated to assert the ref pattern instead of the direct-closure
   pattern it previously asserted (which was in fact asserting the bug).
3. **Inaccurate line-count metric.** Item 5's note above previously claimed
   `ThingDetailContent.tsx` was "~910" lines after extraction; `wc -l`
   confirms 1028. Corrected in place.

Full verification after both fixes: `npm test` 690/690 pass (688 prior +
2 new destination-race regression tests), `npx tsc --noEmit` 0 errors,
`npm run lint` 0 errors / 69 warnings (unchanged), `npm run build:app`
clean.

**Remaining (explicit):** none known. Independent review of item 5's
extraction boundaries themselves (the `variant`-branching choice for
`ThingIdentityHeader`/`ThingStatusControls` and the default-only
`moreActionsPanel` slot on `ThingDiscussion`) found no issues; the two
findings above were both in items 2-4 (Magic Box), not item 5.

### T10 — Complete Morning Brief once, including its actual design

**Status:** LOCAL PASS, ALL SEVEN PACKAGES IMPLEMENTED, GATE-VERIFIED, AND
BROWSER-VERIFIED (T10-01 through T10-07 of
`docs/superpowers/plans/KATALIST_T10_DETAILED_EXECUTION_PLAN.md`), PLUS a
later gap-closure pass (see "T10 gap closure" near the end of this section)
that closed both of the two items the original pass had left open as local
(not release-only) gaps: the mobile Morning Brief entry point, and
fake-`setTimeout` coverage for S02/S04/S10/S11. The plan's five-viewport
Playwright pass (section 7) was run for real, using a Demo Persona sign-in
(`VITE_KATALIST_DEMO_MODE=true`, a synthetic localStorage-only session that
makes zero real Supabase calls -- confirmed by a network-assertion test, not
just by architecture reading) rather than `tests/e2e/staging/` credentials,
none of which are configured in this environment. The original pass found
and fixed one real bug (`use-catchup.ts`'s preview `isEmpty` hardcoded
`true`) and precisely documented one real, reproducible, PRE-EXISTING
product gap it did not fix at the time (Morning Brief had no reachable entry
point below the 1024px `lg` breakpoint) -- see the T10-07 section below for
both, and "T10 gap closure" for that gap's later fix. The one remaining
RELEASE-02/03-class item is a true live-backend/staging check (real Supabase
RLS, a real signed-in account, concurrent devices), which this demo-mode run
cannot and does not claim to substitute for.

**Commits (in order):** `998a873` (T10-01), `6891222` (T10-02), `56ed7c0`
(T10-03 schedule-arithmetic fix), `d7471dd` (T10-03 controller rewrite),
`2ed1cc8` (T10-04 run-thing-action module), `83a9498` (T10-05 stable queue +
action-outcome wiring), `af39cdf` (T10-06 responsive overlay/banner states),
`2be7de9` (T10-06 queue+detail layout), `fd03bd2` (T08 typography-floor fix
surfaced by the full suite); then, in the gap-closure pass, `b0578a6`
(mobile entry point + shared controller + DOM test) and `04171d2`
(fake-timer S02/S04/S10/S11 coverage).

**Done (T10-01 only -- context and readiness contract):**
1. `fetchCatchupMoments()` (`src/features/catchup/use-catchup.ts`) now takes
   `context` explicitly and filters the resolved, capability-mapped Things
   on their own `context` field before building moments -- previously the
   query key varied by Work/Home but the fetch itself did not, so a moment
   for the other context's Thing could appear or be counted.
2. `derivePreviewMoments()` now gates the `nudge` and `snooze_ended`
   categories through `accessibleDemoThings(context)` (the same
   context+access set Court itself uses) instead of resolving via a bare
   `getThing(id)`, which ignored both context and accessibility. Ghost
   breakthroughs are the deliberate, preserved exception: `getGhostCandidate()`
   surfaces a Thing from the *other* context by design, and still resolves
   via `getThing()`.
3. `useCatchup()` exposes `branch` (`AsyncBranch`), `isEmpty`, and
   `confirmedAccessLoss`, reusing `src/lib/query-policy.ts`'s existing
   `resolveAsyncBranch`/`classifyAsyncError` (the same helper `use-profile.ts`
   sits on top of) rather than a parallel invention, so a consumer can tell
   an unsettled/paused query apart from a confirmed-empty result instead of
   trusting `!isLoading`.
4. `surfaceMoment` is now awaitable: preview resolves after the local
   receipt write; live resolves/rejects on the RPC's own outcome (via
   `mutateAsync`). Its one call site (`CatchUpStack.tsx`) is updated to
   keep its prior fire-and-forget/best-effort behavior (`.catch(() => {})`)
   -- outcome-aware sequencing and receipt-only retry are T10-04/T10-05
   scope, not touched here.

**Tests:** `scripts/catchup-context.test.mjs` (live: D01 mixed Work/Home
filtering, D01b context switch, D04 pending-vs-confirmed-empty, D05
background failure with cached non-empty data staying "ready", plus a
structured-403 `confirmedAccessLoss` case) and
`scripts/catchup-context-preview.test.mjs` (preview: D02 nudge/snooze_ended
context+access gating, and the ghost cross-context exception). 8 new tests,
all passing.

**Verification:** `npm test` 698/698 pass (690 prior + 8 new), `npx tsc
--noEmit` 0 errors, `npm run lint` 0 errors / 69 warnings (unchanged
baseline), `npm run build:app` clean.

**Done (T10-02 -- receipt adapter and preview reliability):**
1. `classifyClaimError()` (`src/features/catchup/morning-brief-receipts.ts`)
   inspects the caught value's `message`/`code` fields directly instead of
   `err instanceof Error` (which is always false for the raw
   `{message,code,details,hint}` shape `callUngeneratedRpc` actually
   throws), and now recognizes three narrow, source-confirmed rejections:
   `before-threshold` (`claim_morning_brief`'s exact "before morning
   threshold" text), `unauthorized` (`"not authenticated"`/`42501`/
   `"permission denied"`), `unavailable` (`42883`/`"does not exist"`,
   the not-yet-deployed-migration case). Recognized cases become a typed
   `MorningBriefClaimRejected`; anything else is rethrown completely
   unchanged (an ordinary network error is never wrapped or reclassified).
2. `claimMorningBriefLive` validates the returned row's `claimed` (boolean),
   `local_date` (`YYYY-MM-DD`), `timezone` (non-empty), and `presented_at`
   (parseable) before trusting it -- a malformed shape rejects as
   `unavailable` rather than being trusted as a receipt.
3. Added `PresentedReceiptRef` (identity kind/id/epoch, context, localDate,
   timezone, presentedAt) -- the typed receipt reference T10-03's
   presentation controller is expected to hold and later dismiss exactly.
4. Verified against the actual deployed SQL
   (`supabase/migrations/20260923100000_morning_brief_receipts.sql`) that
   `dismiss_morning_brief(context, timezone)` targets "the caller's most
   recent undismissed row for this profile/context" with **no** `local_date`
   filter at all -- confirming the plan's suspicion that it can target the
   wrong (newer) row once a later day's claim exists. Added a purely
   additive `dismiss_morning_brief(context, timezone, local_date)` overload
   (`supabase/migrations/20260925110000_morning_brief_exact_dismiss.sql`,
   new function signature, not a `REPLACE` of the existing one) that matches
   profile/context/local_date exactly; the 2-arg form is untouched and still
   used by any caller with no exact receipt to target.
5. Added a bounded (64-entry, FIFO-evicted) in-memory same-session fallback
   for the preview adapter, consulted only when a real `localStorage`
   read/write actually throws -- a successful read (including a clean "not
   present" or a deliberately-rejected malformed stored shape) is always
   authoritative and never shadowed by stale fallback state. Added an
   in-process per-key serialization queue (`withKeySerialized`) so two
   same-realm concurrent preview claims resolve to exactly one winner even
   in environments without the Web Locks API (this repo's jsdom tests have
   no `navigator.locks`); the existing Web Locks path is preserved and now
   also routes through the same queue for uniform behavior.

**Tests (T10-02):** extended `morning-brief-receipts-live.test.mjs` (raw
object before-threshold classification, ordinary-error passthrough,
unauthorized classification, three malformed-row cases, the new dismiss
overload's argument shaping), `morning-brief-receipts-preview.test.mjs`
(throwing-storage same-session fallback, malformed JSON, malformed shape,
same-realm race), and `morning-brief-receipts-sql.test.mjs` (exact-date
dismiss with a newer undismissed row present, no-op on no match,
unauthenticated/other-profile isolation, EXECUTE grants on the new
overload) -- 15 new tests, all passing, run against both the original and
new migration files applied together.

**Verification:** `npm test` 713/713 pass (698 after T10-01 + 15 new T10-02
tests), `npx tsc --noEmit` 0 errors, `npm run lint` 0 errors / 69 warnings
(unchanged baseline), `npm run build:app` clean.

**Done (T10-03 -- scope-owned presentation controller and clock):**
1. `morning-brief-schedule.ts`'s `nextMorningThreshold` derived "tomorrow" by
   round-tripping a UTC-noon guess through the target timezone and then
   adding a UTC day -- at an extreme offset (UTC+14) that round-trip can
   already land on the NEXT local calendar day before the "+1 day" step even
   runs, silently overshooting by an extra day (confirmed by hand-computing
   the old code's output against `Pacific/Kiritimati`). Replaced with direct
   local-calendar-date arithmetic (`addCalendarDays`, working on plain
   year/month/day components via a UTC-labeled scratch `Date` used only as a
   calendar calculator, never converted through a timezone) shared by
   `nextMorningThreshold` and the new `nextLocalMidnight` (needed for scope
   retirement). New tests cover UTC+14, UTC-12, a half-hour-offset zone
   (Asia/Kolkata), and the existing DST spring/fall pair.
2. `use-morning-brief.ts` rewritten around an explicit `BriefScope`
   (epoch/identityKind/identityId/context/timezone/localDate) and per-scope
   attempt-ownership tokens, replacing the previous independent
   `open`/`alreadyPresentedToday` booleans and single `attemptedKeyRef`:
   - Profile timezone readiness is classified explicitly (`pending`/`error`/
     `resolved`) from `isPending`/`isError`, not inferred from `isLoading`
     alone, so a successful no-profile result is distinguished from a
     still-loading one.
   - `alreadyPresentedToday` is derived from a receipt matching the CURRENT
     scope (identity/context/local date) -- an old receipt retained for a
     retired scope can no longer mark a newer scope (a different context, or
     a new day) as already presented.
   - Visible `open` is gated by the presented scope matching the current
     scope at render time; a context/identity/zone/local-date change retires
     the open review, capturing dismissal ownership before clearing.
   - A `before-threshold` rejection (the T10-02 `MorningBriefClaimRejected`)
     triggers a bounded per-scope retry (30s, then 120s; none after the
     scope retires) instead of relying solely on the next-07:00 timer;
     ordinary errors are logged without retry-storming.
   - A local-midnight timer (via `nextLocalMidnight`) runs alongside the
     existing next-07:00 timer so a scope actually retires at the date
     rollover. `dismiss()` now targets the exact presented receipt via
     `dismissMorningBriefLive`'s `exactLocalDate` parameter.
   - **Bug found and fixed while testing this package:** `currentScope` is
     memoized on identity/context/timezone (deliberately, so an unrelated
     render can't thrash it), which meant its local date only ever refreshed
     when the scheduled midnight timer fired -- a tab backgrounded across
     local midnight and only later returning to the foreground never
     recomputed on that return, contradicting the plan's own "on focus/
     visibility return, recompute from the current clock" requirement. Fixed
     by also bumping the recompute tick from the existing
     visibilitychange/focus listener.
   - **Required test correction applied, plus one more of the same kind
     found by testing:** the existing delayed-across-midnight test asserted
     `alreadyPresentedToday === true` for an old (now cross-midnight)
     receipt -- corrected to `false` with the scoped reasoning explained
     inline, per the plan's explicit instruction. An independent-review-style
     issue of the identical shape was also found and fixed in the F-03
     in-flight-context-switch test (asserted `true` after a "work" claim
     resolved into a "home" render; corrected to `false` -- a "work" receipt
     must not mark "home" as already presented).

**Tests (T10-03):** `morning-brief-schedule.test.mjs` +5 (UTC+14, UTC-12,
half-hour zone, `nextLocalMidnight` base case, `nextLocalMidnight` DST case);
`use-morning-brief.test.mjs` all 15 existing cases retained and green (2
corrected as above), no hang (confirmed by an isolated single-file run, not
just as part of the full suite).

**Verification (T10-03):** `npx tsc --noEmit` 0 errors; full `npm test`
green (two independent full runs, both exit 0); `npm run build:app` clean.

**Done (T10-04 -- shared action-outcome/claim module, the T03
prerequisite):**
1. Added `src/features/things/run-thing-action.ts`: one shared entry point
   for every Thing-mutating Catch Up action (Catch, set-pace/Move-Now, Timed
   Snooze, Nudge, dismiss a ghost breakthrough), returning a typed
   `ActionOutcome` (`performed`/`already-in-flight`/`retired`/`failed`)
   instead of throw-or-not. Built directly on `query-updates.ts`'s own
   low-level primitives (`claimThingMutation`, `cancelThingReads`,
   `patchThingInCaches`, `releaseThingMutation`) rather than wrapping
   `withOptimisticPatch` (which already claims internally -- wrapping it
   would double-claim). Argument validation (pace, snooze option) happens
   before any claim or RPC dispatch.
2. `ListChatPanel`'s dirty/upload interaction blocker (`useBlockWhile` on
   `list-chat-draft`) was verified already present from prior T03 work --
   confirmed via direct source inspection, not re-added.

**Tests (T10-04):** `scripts/run-thing-action.test.mjs`, 14 cases: single
successful catch with optimistic patch; duplicate synchronous clicks (only
the first performs); a cross-surface preclaimed Thing blocks a second
caller; two independent Things claim independently; a domain failure rolls
back the patch and returns `failed`; a released claim is available again for
a fresh retry; an identity switch resets epoch-scoped in-flight tracking so
a new identity is never blocked by an old identity's stale, unreleased
claim; pace/snooze argument validation; move_now/nudge/snooze field
semantics; dismiss_ghost success and failure.

**Verification (T10-04):** `npx tsc --noEmit` 0 errors; this module's own
suite 14/14; `npm run build:app` clean.

**Done (T10-05 -- stable keyed queue and action-outcome wiring in
CatchUpStack):**
1. Replaced `CatchUpStack.tsx`'s frozen `useState(() => moments)` deck with
   an append-only ordered key list (`order`) plus a live keyed entry map
   (`entries: Map<string, QueueEntry>`, status `active`/`resolved`/
   `unavailable`). Selection is keyed, not indexed, so it survives
   reorder/refetch; new moments append at the end without jumping the
   current selection; a moment that disappears WITHOUT this review acting on
   it is marked `unavailable` (actions cleared, last-known title kept for
   orientation) rather than silently vanishing; one this review DID resolve
   stays visible using its last known data so its acknowledgement-retry
   state is never lost even after the server stops returning it.
2. Actions now dispatch through `run-thing-action.ts` with per-outcome
   handling, an epoch captured before dispatch and rechecked after the
   action and again after the separately-awaited `surfaceMoment` call. A
   domain success with a failed receipt shows a "Retry acknowledgement"
   affordance that calls ONLY `surfaceMoment`, never re-running the domain
   action.
3. Viewed count, action-completed count, and pager position are three
   separate figures ("3 of 8" / "Viewed 3 of 8" / "2 actions completed").
   Previous/Next/Finish are plain callbacks driven by the current key's
   index -- no parent `onClose()` call nested inside a `setState` updater
   (the prior implementation's pattern). Open Thing closes the review and
   hands off by the Thing's own current data with no domain mutation or
   receipt.

**Tests (T10-05):** `scripts/catchup-stack.test.mjs`, 11 cases covering
Q01-Q04 (capability recompute, unavailable marking, new-moment append,
stable selection), A01-A04 (failed/already-in-flight/receipt-failure-retry/
success-advance outcomes), Open Thing, Finish-on-last-item, Previous
disabled-state, and viewed/action-count separation.

**Verification (T10-05):** `npx tsc --noEmit` 0 errors; targeted suite
(morning-brief-schedule, use-morning-brief, catchup-stack, run-thing-action,
catchup-context[-preview], catchup-logic, query-updates-rollback) 96/96
green; `npm run build:app` clean.

**Done (T10-06 -- the actual desktop/mobile interface):**
1. `CatchUpOverlay.tsx` now uses the shared `AsyncState` component
   (`src/components/katalist/AsyncState.tsx`, already used elsewhere in the
   app) instead of only ever rendering `CatchUpStack` when
   `moments.length > 0`: initial loading (skeleton), initial failure
   (Retry), successful empty ("You're all caught up"), and a
   background-failure warning banner over stale-but-usable content are all
   real, distinct states, computed from the same `branch`/`isEmpty`/
   `hasFetchedOnce` facts `use-catchup.ts` already exposes (the last of
   which is now exposed directly from the hook rather than re-derived from
   `!isLoading`).
2. Dialog sizing widened to ~960px on desktop (this repo's `lg` breakpoint,
   1024px -- the nearest existing token; there is no dedicated ~960px
   breakpoint anywhere in the codebase) and full-height/edge-to-edge
   (`h-dvh`) on mobile so the sticky action row stays reachable without the
   dialog itself needing to scroll.
3. `CatchUpBanner.tsx` and its Court-level gate both dropped the
   `catchup.count > 0` gate: once the moments query has settled at least
   once, the banner renders a real state for a settled error (Review still
   reachable) or a settled empty result (Review still reachable), not only
   for a non-empty result.
4. Added a bounded queue sidebar to `CatchUpStack.tsx` per the plan's layout
   sketch: on desktop, a ~280px scrollable column of native, keyboard-
   focusable buttons (one per moment key) beside the selected moment's
   detail card; on mobile, the same buttons render as a horizontal scroll
   strip above the detail card. Each row shows a numbered index or a
   resolved checkmark, the Thing's title, and (desktop only) its
   reason/relative-time. Selecting a row jumps directly to that moment.
   Reuses this app's existing focus-ring/hit-target/elevation conventions
   (`focus-visible:ring-2 focus-visible:ring-ring`, `katalist-elevation-dialog`,
   h-9/h-10 controls) rather than inventing new ones.
5. **Bug found and fixed by the full test suite, not by inspection:** the
   new queue row's secondary text used `text-[10px]`/`text-[11px]`, below
   this codebase's own enforced 12px typography floor
   (`scripts/t08-typography-floor.test.mjs`). Bumped both to `text-[12px]`.

**Tests (T10-06):** one new `catchup-stack.test.mjs` case (clicking a queue
item jumps directly to that moment); `morning-brief-label.test.mjs` 2/2
(user-visible "Morning Brief" label unchanged); the Court-desktop/stack-
component/magic-box/inline-detail-workspace/invalidate-personal-surfaces
suite together 43/43 (confirms the widened dialog and banner gate removal
did not regress existing Court behavior).

**Verification (T10-06):** `npx tsc --noEmit` 0 errors; `npm run lint` 0
errors/69 warnings (unchanged baseline); `npm run build:app` clean.

**Done (T10-07 -- integration and compatibility sweep):**
1. `rg`-swept every `useCatchup`/`CatchUpOverlay`/`CatchUpStack`/
   `surfaceMoment` reference in `src/`: the only real consumer outside the
   `catchup` feature itself is `CourtDesktop.tsx`, already updated with the
   new props (`isLoading`/`error`/`isEmpty`/`hasFetchedOnce` for the
   overlay; `error`/`hasFetchedOnce` for the banner). All other hits are
   either the implementation files themselves or doc-comment references.
2. Confirmed Court's single-controller wiring: `useMorningBrief()` is called
   in exactly one place (`CourtDesktop.tsx`); the mobile Court route
   (`src/routes/index.tsx`) renders the same `CourtDesktop` component
   CSS-hidden/shown by breakpoint rather than mounting a second instance --
   this was already true before T10 and remains true now (confirmed
   directly, not assumed).
   **Correction (T10 gap-closure pass, below):** "one hook call site" was
   accurate, but this bullet's framing ("renders the same `CourtDesktop`
   component... by breakpoint") was read too broadly by a later in-code
   comment as "one rendered UI" -- the mobile route in fact rendered a
   COMPLETELY SEPARATE `lg:hidden` lane-list UI alongside `CourtDesktop`,
   with no Catch Up wiring of its own, which is exactly this same file's
   own T10-07 finding two paragraphs below. The single-call-site property
   itself was real and is preserved (now via lifting the call to the shared
   `CourtPage` ancestor instead of leaving it inside `CourtDesktop`); see
   "T10 gap closure" at the end of this section for the fix and its DOM-
   level proof.
3. SQL/notification/daily-maintenance compatibility: no RPC signatures
   changed (`dismissMorningBriefLive`'s new third argument is the ADDITIVE
   `dismiss_morning_brief(text, text, date)` overload from T10-02's own
   migration, confirmed present at
   `supabase/migrations/20260925110000_morning_brief_exact_dismiss.sql`; the
   2-argument overload is untouched). `rg` confirms neither
   `src/routes/api/jobs/daily-maintenance.ts` nor
   `src/features/notifications/NotificationPanel.tsx` reference any Morning
   Brief/Catch Up RPC at all -- no compatibility risk to check further.
4. `VITE_KATALIST_MORNING_BRIEF_AUTO_OPEN` remains default-off
   (`morning-brief-flag.ts` untouched by this batch).
5. **Ran the plan's five-viewport Playwright pass for real**
   (`tests/e2e/preview/morning-brief.spec.ts`, new), signing in via a Demo
   Persona (`VITE_KATALIST_DEMO_MODE=true`) rather than staging credentials
   -- a synthetic, localStorage-only `Session` that makes zero real Supabase
   calls (confirmed by a dedicated network-assertion test in the spec, not
   just by reading the architecture), so it stays inside
   `tests/e2e/preview/`'s own "safe with no real backend" contract. At the
   `>=lg` (1024px) desktop/full-hd/tablet-landscape projects: the banner, the
   real ~37-item queue+detail layout, no horizontal overflow, and
   Escape+focus-restore all pass, screenshots inspected directly. At the
   `<1024px` mobile/tablet-portrait projects, the spec checks the mobile
   Court lane list's own overflow and asserts Morning Brief's absence there
   as a checked, named fact (see finding below), not a silent skip.
   - **Bug found and fixed by this run:** `use-catchup.ts`'s `isEmpty` was
     hardcoded `true` for every preview session -- the banner showed "37
     moments need you" while the overlay it opened simultaneously rendered
     "You're all caught up". Dormant until T10-06 wired the overlay through
     the shared `AsyncState` component (which does consume `isEmpty`).
     Fixed to report the real computed value for preview; added a
     regression test.
   - **Pre-existing product gap found, precisely documented, NOT fixed
     here:** `src/routes/index.tsx` renders `CourtDesktop` (Morning Brief's
     only mount point) alongside a completely separate, simpler mobile
     lane-list UI in an `lg:hidden` block. Below the 1024px `lg` breakpoint,
     `CourtDesktop`'s own rendered output -- including `CatchUpBanner`/
     `CatchUpOverlay` -- is CSS-hidden, and the separate mobile block has no
     Catch Up wiring of its own. **Morning Brief has no reachable entry
     point on any viewport narrower than 1024px today.** This predates T10;
     T10-06's mobile full-height dialog CSS is correct but currently inert
     there since nothing can open it. Fixing this is an architecture
     decision (where a mobile entry point lives, and how the `catchup`/
     `morningBrief` hook results reach both `CourtDesktop` and the separate
     mobile block) large enough that attempting it under this pass's time
     budget risked a rushed, under-tested change to a real product surface
     neither this pass nor the T10 plan otherwise touches. Left as a named,
     reproducible defect (trigger: view Court at any narrow viewport;
     impact: Morning Brief/Catch Up entirely unreachable on phones/narrow
     tablets; location: `src/routes/index.tsx`'s `lg:hidden` block versus
     `CourtDesktop.tsx`'s own responsive wrapper).

**Remaining -- one named RELEASE-gated item, plus the one product gap named
directly above:**
- A true live-backend/staging Playwright run (`tests/e2e/staging/`, real
  Supabase RLS, a real signed-in account, concurrent devices/tabs) remains
  RELEASE-02/03 and was not attempted -- `KATALIST_STAGING_BASE_URL`/
  `KATALIST_TEST_ACCOUNT_EMAIL`/`KATALIST_TEST_ACCOUNT_PASSWORD` are not
  configured in this environment, and no
  `tests/e2e/staging/morning-brief.spec.ts` exists yet. The demo-mode run
  above exercises the same UI/interaction code paths but cannot substitute
  for real RLS/auth/concurrency evidence.
- Two illustrative dimensions of the plan's full test matrix (S02, S04, S10,
  S11 -- timer-driven auto-open/retirement scenarios) are exercised
  indirectly through the pure `morning-brief-schedule.ts` timer-math tests
  and the controller's F-03/F-05/R-04 race tests, but not through a
  fake-`setTimeout` harness that actually fires the scheduled
  threshold/midnight timers early; this repo's `mock.timers` usage here only
  fakes `Date`, not `setTimeout`. Building that harness was judged
  disproportionate to this batch; the underlying logic those timers call
  (`nextMorningThreshold`/`nextLocalMidnight`/`maybeAttempt`) is fully unit-
  tested on its own.
- `docs/superpowers/plans/KATALIST_T10_FINAL_HANDOFF.md` has now been
  created (see that file) reconciling all seven T10 packages against
  evidence, including the one RELEASE-gated item above named precisely.

**T10 gap closure (post-handoff pass): mobile Morning Brief entry point +
fake-timer controller coverage -- both former "still open, local" items now
DONE, with evidence.** Commits: `b0578a6` (mobile entry point + shared
controller + DOM test), `04171d2` (fake-timer S02/S04/S10/S11 coverage).

1. **Mobile entry point.** The handoff above (and this file's own item 2 in
   the T10-07 done-list) said the mobile Court route reused `CourtDesktop`
   "CSS-hidden/shown by breakpoint rather than mounting a second instance" --
   re-reading `src/routes/index.tsx` in full for this pass found that claim
   HALF right and half stale: `CourtDesktop` genuinely is always mounted at
   every breakpoint (only its OWN rendered output is CSS-hidden via `hidden
   lg:block`), so there was indeed only one `useCatchup()`/`useMorningBrief()`
   call site -- but the `lg:hidden` mobile lane-list block right below it in
   the SAME file was a completely separate JSX tree with no Catch Up wiring
   of its own, exactly as this file's own T10-07 finding (and the handoff's
   section 6) already said. The stale in-code comment in `CourtDesktop.tsx`
   ("mobile Court reuses this same component... already 'one owner per
   active Court surface'") conflated "one hook call site" with "one rendered
   UI," which was true for the hook but false for the UI Morning Brief
   actually needs (a reachable banner + dialog) -- that comment has been
   corrected in place.
   - Fix: `useCatchup()`/`useMorningBrief()` are now called exactly ONCE, in
     `CourtPage` (the shared ancestor of both the desktop and mobile
     branches, `src/routes/index.tsx`), and the resulting objects are passed
     as props into `CourtDesktop` (now a pure consumer, no hooks of its own
     for these) and used directly by a new `CatchUpBanner`/`CatchUpOverlay`
     pair rendered in the mobile `lg:hidden` block. This keeps "exactly one
     automatic controller" true structurally (proven, not assumed -- see
     below), matching the safer of the two options the reopened task named.
   - A Catch Up moment's Thing is not guaranteed to already be one of
     Court's own currently-loaded `now`/`next`/`later`/`theirs`/`all` Things
     (a ghost breakthrough deliberately surfaces one from the OTHER context
     by design) -- the mobile branch's existing ID-based selection lookup
     (`selected = all.find(...) ?? ... ?? null`) gained a third fallback,
     `catchup.moments.map((m) => m.thing).find(...)`, found necessary by the
     new DOM test below actually failing without it (opening a moment's
     Thing on mobile silently showed nothing).
   - **Real DOM-level proof, not a regex/source check**
     (`scripts/court-mobile-morning-brief.test.mjs`, 7 new tests): mounts
     the ACTUAL `CourtPage` component (only genuinely unrelated heavy
     subtrees stubbed at their own module boundary -- `AppShell`,
     `CourtDesktop`'s own internals, the lane-list row components, the
     generic Thing-detail workspace UI -- the same convention
     `catchup-stack.test.mjs` already uses for `run-thing-action`/
     `useDoorman`) and asserts: `useMorningBrief()`/`useCatchup()` are each
     called exactly once per render regardless of breakpoint, with the
     SAME object instance (`===`) threaded to both the desktop stub and the
     mobile branch; the mobile Review banner is reachable and opens the real
     `CatchUpOverlay` dialog; Escape performs a real `dismiss()` (not just a
     visual close); opening a Thing from the mobile overlay dismisses the
     brief and opens the Thing inline; and manual Review stays reachable
     with zero moments and with a settled fetch error (not gated on
     `count > 0`), matching the existing desktop contract.
   - Two small, narrowly-scoped test-infrastructure fixes were needed to
     make this DOM test possible at all (both real, both now used only by
     this suite's own tests): `scripts/alias-loader.mjs`'s `.tsx` interception
     compared the raw URL including `node:test`'s `--experimental-test-
     module-mocks` cache-busting query string, so mocking any `.tsx` module
     (never previously attempted in this codebase's tests, which only ever
     mocked `.ts` files) fell through to Node's default loader and crashed
     with `ERR_UNKNOWN_FILE_EXTENSION`; and the same loader gained a small
     `.json`-as-ES-module shim (`src/assets/*.asset.json` imports, used
     transitively via `AsyncState` → `EmptyState`, otherwise hit Node's
     `ERR_IMPORT_ATTRIBUTE_MISSING` for a plain unattributed JSON import,
     something Vite's own real JSON handling never required). `scripts/
     dom-test-setup.mjs` also gained `MutationObserver`/`NodeFilter`/
     `HTMLInputElement`/`HTMLSelectElement`/`HTMLTextAreaElement`/
     `HTMLButtonElement` globals, needed the first time any test in this
     suite actually mounted a real Radix `Dialog` (`@radix-ui/react-focus-
     scope`'s focus trap uses all of these, which jsdom implements on its
     own `window` but Node doesn't expose as bare globals).
   - `tests/e2e/preview/morning-brief.spec.ts`'s previously-skipping-by-
     necessity below-`lg` test (skipped because there was genuinely no
     mobile entry point to test) now asserts the same full flow the `>=lg`
     test already did (banner reachable, dialog opens, no horizontal
     overflow, Escape closes and restores focus) -- **run for real** across
     all five viewport projects: 10 passed, 5 skipped (only the legitimate
     `>=lg`-vs-`<lg` test-selection skips, one direction per project), 0
     failed. Screenshots confirm a real mobile Morning Brief dialog
     (`test-results/morning-brief-*-preview-{mobile,tablet-portrait}/
     mobile-morning-brief-open.png`).

2. **Fake-timer controller coverage (S02/S04/S10/S11).** This repo's only
   existing timer-mocking mechanism is `node:test`'s built-in `mock.timers`
   (grep-confirmed -- no other fake-timer library is present anywhere in
   this codebase), already used by `use-morning-brief.test.mjs` and
   `morning-brief-schedule.test.mjs`, but only ever with `apis: ["Date"]`
   (that file's own comment explains why: most of its scenarios don't need
   a real multi-hour/day timer to fire). New file
   `scripts/use-morning-brief-timers.test.mjs` (5 tests) instead enables
   `apis: ["Date", "setTimeout", "setInterval"]`, so `mock.timers.tick(ms)`
   both advances the fake clock AND synchronously fires any of
   `use-morning-brief.ts`'s OWN scheduled `setTimeout`s whose delay has
   elapsed -- no manual invocation of what a timer "would have" called, no
   restructuring of the controller beyond what T10-03 already did (no new
   injectable-clock seam was needed; the hook already reads `Date`/
   `setTimeout` directly, which `mock.timers` intercepts transparently).
   - **S02** (06:59→07:00): asserts zero claim calls at mount, zero after an
     unrelated rerender, then exactly one claim call -- and `open` flipping
     true -- immediately after `mock.timers.tick(60_000)` crosses
     `07:00:00.000Z`, proving the scheduled threshold timer itself fires the
     claim.
   - **S04** (duplicate/Strict-Mode/multiple mounts): two variants. The
     first mounts two fully independent `useMorningBrief()` instances (the
     scenario Task A's single-controller fix exists to prevent in
     production) against a claim mock modeling the real server's atomic
     per-`(context, localDate)` claim semantics -- confirms `use-morning-
     brief.ts`'s own doc comment is accurate (both instances DO each
     attempt a claim; its attempt-token system explicitly only dedupes
     within one instance) AND that the atomic claim is the actual backstop:
     exactly one of the two calls wins `claimed: true`, and exactly one
     instance ends up `open: true` (never zero, never both). The second
     variant wraps a SINGLE instance in a real `<StrictMode>` and confirms
     its mount→cleanup→mount double-invoked effects still produce exactly
     one claim call, proving the within-instance token guard for real
     rather than by code inspection.
   - **S10** (midnight while open): claims and opens for June 15 at the real
     07:00 timer, then `mock.timers.tick()`s exactly to `2026-06-16T00:00:00.000Z`
     -- the real scheduled midnight timer fires, `open` flips back to
     `false` (the old scope retires), and `alreadyPresentedToday` flips back
     to `false` (June 15's receipt does not carry over to June 16).
   - **S11** (tomorrow's 07:00 with the tab already open): continuing past
     S10's midnight rollover, ticks forward to the real, already-armed
     `2026-06-16T07:00:00.000Z` threshold timer and confirms a SECOND real
     claim call fires (not a reuse of yesterday's settled attempt), wins
     `claimed: true` for the fresh local date, and actually reopens the
     brief.
   - All 5 pass; combined with the existing full suite this brings the
     total from 745 to 757 (`scripts/court-mobile-morning-brief.test.mjs`
     +7, `scripts/use-morning-brief-timers.test.mjs` +5, one existing
     `court-stack-components.test.mjs` assertion updated in place to match
     the new one-call-site architecture rather than removed).

**Verification (this gap-closure pass):** `npx tsc --noEmit` 0 errors;
`npm run lint` 0 errors / 69 warnings (unchanged baseline); `npm test`
757/757 passing; `npm run build:app` clean; the five-viewport Playwright
pass above (10 passed / 5 skipped / 0 failed, mobile scenarios now actually
executed rather than skipped).

**Still open (unchanged from before this pass, both explicitly RELEASE-gated,
not local):**
- A true live-backend/staging Playwright run (`tests/e2e/staging/`) --
  credentials still not configured in this environment.
- Live deployment/RLS verification of the Morning Brief receipt migrations
  against a real Postgres instance, and real cross-device/cross-tab claim
  atomicity under actual concurrent connections (the S04 test above proves
  the ATTEMPT-TOKEN and claim-consumption logic against a mock server that
  models atomic-claim semantics faithfully, which is real and load-bearing
  evidence for the client-side contract, but is not itself a substitute for
  a real Postgres `ON CONFLICT` constraint under genuine concurrent
  connections).
