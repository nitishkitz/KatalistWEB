# Katalist Phase 1: independent review of the eight correctness fixes

Review date: 24 September 2026

Checkout: `49a7f9a` on `katalist-plan/batch-a-baseline`

Compared with: `KATALIST_A_TO_H_CODE_AUDIT_AND_COMPLETION_REPORT.md` and `KATALIST_A_TO_H_AUDIT_PROGRESS.md`

## Review result

I reviewed all eight reported fixes in the production code and the new regression tests. The original defects are addressed in several important places, but **Phase 1 is not ready to close**. Draft and note save paths can still lose user input, the access-loss classifier misses structured denial errors, and Morning Brief can make a claim with an unresolved timezone.

The most recent full verification at this exact commit passed: 488/488 tests, typecheck, lint with 0 errors and 80 warnings, and `build:app`. I ran that verification in the preceding review turn. This document is a source and test review; those checks were not rerun simply to create a second log. I also ran temporary focused probes for the behaviors below and removed the probe files afterward. There are no production-code changes in this review.

Priority definitions: **P1** can lose input, expose confirmed inaccessible cached content, or violate a core daily/call contract; **P2** is an important remaining behavioral gap. “Code fix accepted” below does not mean the prepared migration or live RLS behavior has been deployed or verified.

| Audit item | What the commit demonstrably fixed | Independent review disposition |
|---|---|---|
| F-01 | First and duplicate `claim_morning_brief` calls now execute in PGlite without the output-column ambiguity. | **Code fix accepted locally.** Real Supabase/RLS/concurrent-session verification remains open. |
| F-02 | Server prefers valid profile timezone, enforces 07:00, and dismisses a claimed receipt without recomputing its date. | **SQL fix accepted locally; client integration remains open.** See R-04. |
| F-03 | Context/blocker/hidden tab/empty or failed moments are checked after claim resolves. | **Partial.** Current timezone and loading/readiness are not rechecked; see R-04. |
| F-05 | Actor and Thing lookup errors are propagated and `useCatchup` exposes an error. | **Core fix accepted locally; one prerequisite error remains ignored.** See R-08. |
| H-05 | An old `join()` continuation no longer clears a newer room's ref/state. | **Partial.** Old room broadcasts and unmount are not fully generation guarded; see R-05. |
| E-03 | Comment text/files are scoped to a Thing and simple A→B→A switching is tested. | **Partial.** Failed send after unmount and pending attachment work can lose drafts; see R-01/R-02. |
| G-06 | Note read error/retry, per-note drafts, and session generation for switching editors are implemented. | **Partial.** Newer edits can be erased by an older save, duplicate saves remain possible, and clearing all fields skips confirmation; see R-03/R-06/R-07. |
| B-03/C-06 | Typed branch receives an error; confirmed access loss blocks stale data in covered string cases. Membership changes invalidate broader mounted query families and no longer destroy an observed query before invalidation. | **C-06 local invalidation path accepted; B-03 partial.** Structured denial errors are misclassified; live revocation delivery remains unverified. See R-09 and §4. |

## Actionable findings: what to change, where, and how

### R-01 — A failed comment send after closing detail loses the draft [P1, reproduced]

**Where:** `src/features/things/ThingDetailContent.tsx`, `submitComment()` around lines 590–630; `src/features/things/use-thing-comments.ts`, `post` mutation around lines 100–165; `src/features/drafts/session-drafts.ts`.

**What happens:** `submitComment()` clears the live text and stored draft before calling `thread.post.mutate(..., { onError })`. That `onError` is a per-call MutationObserver callback. When the detail unmounts before the request fails, React Query does not reliably invoke this per-call observer callback. A focused probe using the real `useMutation` and real `ThingDetailContent` found the reopened draft empty after rejection. The committed tests mock `post.mutate` and manually invoke its callback, so they do not exercise observer unmount semantics.

**Fix shape:** Capture `{thingId, epoch, submittedText, submittedAttachments, draftRevision}` at submit. Move failure restoration to a mutation-level handler or another lifecycle owner that persists after the detail unmounts. Restore only if that Thing's draft has not gained newer edits and the captured identity epoch remains active. A successful send clears only the submitted revision. Render the pending send independently of whether detail is still mounted; never submit the same operation twice after an uncertain network result.

**Regression test:** Mount real detail with real QueryClient/useMutation; type and submit; unmount; reject request; reopen the same Thing and assert text/files are restored. Repeat after a newer draft edit, identity change, and success-after-unmount. Mock the transport, not React Query's mutation callback behavior.

**Closure:** No text/file loss on failed send, same Thing or after unmount; no old failure overwrites a newer draft or another Thing.

### R-02 — File processing finishing after a detail unmount is not persisted [P2, source-confirmed]

**Where:** `ThingDetailContent.tsx`, `handleCommentFileChange()` around lines 435–470 and the draft write effect around lines 520–528.

**What happens:** The file handler captures Thing ID, but it only writes directly to `session-drafts` when the same component instance is showing a *different* Thing. After unmount, `thingIdRef` still holds the old ID, so it takes the `setCommentAttachments` path on an unmounted component; the write effect no longer runs. The processed attachment descriptor can disappear. Pending file processing also is not itself registered as an interaction blocker.

**Fix shape:** Capture identity epoch and a processing operation token when files are selected. Store completed descriptors directly in the captured Thing's draft if the epoch is still current, regardless of whether the component remains mounted. Mirror that draft into component state only when the same Thing is still displayed. Track pending processing and release any blob URL for a discarded/stale result. Register the pending operation with the interaction blocker until it resolves or is cancelled.

**Regression test:** Select a file whose processing promise is held; close/unmount detail; resolve the promise; reopen the same Thing. Assert the file appears once and no other Thing receives it. Then switch identity and assert the old result is discarded and object URL released.

### R-03 — A completed note save closes over newer unsaved edits [P1, reproduced]

**Where:** `src/features/buckets/use-bucket-note-editor.ts`, `saveNote()` and its `done` callback around lines 79–104.

**What happens:** `savedGeneration` changes only on editor open/close. A user can press Save, continue editing the same note while the request is pending, then have the older save succeed. `done()` still sees the same generation, clears the current draft, and closes the editor. A focused probe using a real React Query mutation reproduced `noteOpen === false` after the newer text was typed.

**Fix shape:** Keep a monotonically increasing edit revision alongside the editor session generation. Capture both the submitted revision and value on Save. On success, close/clear only if the current session *and* edit revision still match the submitted snapshot. If the user has made newer edits, keep the editor open, update the original saved baseline to the acknowledged value, and leave the new draft intact. Guard failure/toast continuation by session and identity as well.

**Regression test:** Save version A with a deferred mutation; type version B before it resolves; resolve A; assert editor remains open with B, draft B survives remount, and server acknowledgment for A does not overwrite B. Also test switch to another note and a failed save.

### R-04 — Morning Brief can claim before the profile timezone is known [P1/P2, reproduced path]

**Where:** `src/features/catchup/use-morning-brief.ts`, `profileQuery`/`timeZone` around lines 61 and 110–113, `attemptClaim()` around lines 115–171, threshold timer around lines 191–210; `src/features/catchup/morning-brief-schedule.ts`.

**What happens:** `profileQuery.data?.timezone ?? null` uses browser timezone while the profile is still loading. There is no `profileQuery.isLoading` or settled/error prerequisite in `isEligibleToAutoOpen`. If the browser's local time is after 07:00 but the saved profile zone is before 07:00, the server correctly rejects the early claim, yet `attemptedKeyRef` was already set and all later attempts for that same identity/context/local date return early. The brief can remain suppressed even when the actual profile's morning threshold later arrives. Separately, a focused hook probe held a claim, changed the effective timezone from New York (11:00) to Honolulu (05:00), then resolved the old claim; `open` became `true`. The new post-await condition rechecks context/blocker/visibility/count/error, but not current timezone, date, threshold or profile readiness.

**Fix shape:** Wait for the profile query to settle before automatic eligibility, using the browser zone only for a confirmed missing/invalid profile timezone. Maintain a scope record for the claim (`identity, context, effectiveTimezone, localDate, attempt/result`). After await, call the full eligibility model with *current* inputs, including the current time/date/timezone and loading state. Treat a typed “before morning threshold” response as not consuming today's attempt; reschedule at the server-aligned next threshold. Keep a successful receipt if display is suppressed, as the existing policy intends. Scope `alreadyPresentedToday` and dismissal to the receipt/context they describe.

**Regression tests:** Profile query pending then resolves to a zone still before 07:00; rejected early claim then successful later claim; timezone changes while claim is in flight; date crosses midnight during claim; context switch and blockers remain covered. Assert both RPC call count and rendered `open` state.

### R-05 — Superseded call-room broadcast callbacks still change the active call [P2, source-confirmed]

**Where:** `src/features/calls/use-list-call.ts`, `new CallRoom({ onState, onReaction, onDraw, onDocPage })` around lines 153–170 and unmount cleanup around lines 306–311; `src/features/calls/call-room.ts` broadcast handlers around lines 254–265.

**What is fixed:** The continuation after `await room.join()` and its catch/finally now check `joinGenerationRef`. This addresses the original A→leave→B→A completion race.

**What remains:** The `onReaction`, `onDraw`, and `onDocPage` callbacks set hook state without checking room/generation. `CallRoom` has a closed guard in `emit()` for participant state, but its broadcast handlers call these other callbacks directly. A queued event from an old room can repaint the newer call. Unmount cleanup calls `room.leave()` without retiring the hook generation; the old join's catch may still emit a stale toast after unmount. Reaction cleanup timers are not owned/cleared by room generation.

**Fix shape:** Define one `isActiveRoom(room, generation)` check and apply it in all CallRoom callbacks and async continuations. Advance generation in unmount cleanup. Clear reaction timers when the room retires. Optionally guard broadcast dispatch within `CallRoom` itself with `closed`, while retaining the hook-level ownership guard as defense.

**Regression test:** Start A, leave A, start B, fire A's delayed reaction/draw/page callbacks, and assert B's state does not change. Unmount while A join is pending; reject and assert no stale toast/state update. Keep the existing two-join test.

### R-06 — The note “synchronous pending guard” is not synchronous [P2, reproduced]

**Where:** `src/features/buckets/use-bucket-note-editor.ts`, `saveNote()` line 82; `scripts/use-bucket-note-editor.test.mjs` fake `notesApi` mutation.

**What happens:** The guard reads `create.isPending`/`update.isPending` from the last React render. In the committed test, the fake mutation sets `api.create.isPending = true` synchronously in `mutateAsync`, making two separate Save calls pass. With a real React Query `useMutation`, two calls to `saveNote()` before the hook rerenders both start create mutations; a focused probe counted two calls. This does not establish how often a real double click lands in that window, but it disproves the claimed synchronous deduplication guarantee.

**Fix shape:** Add a ref claimed synchronously before `mutateAsync`, scoped to the active note/session; release it in `finally` only if the token still owns that operation. Keep `isPending` for visible feedback/disabled state. If create succeeds but the response is lost, a client guard alone cannot prevent retry duplication; use an idempotency key or server uniqueness contract where the product requires exactly one new note.

**Regression test:** Call Save twice inside one React `act` before rerender with a real QueryClient/useMutation and deferred transport; assert one create request. Then finish and assert Save can be used again for new edits.

### R-07 — Clearing all text from a saved note skips discard confirmation [P2, reproduced]

**Where:** `src/features/buckets/use-bucket-note-editor.ts`, `requestCloseNoteEditor()` around lines 66–76.

**What happens:** The condition is `noteIsDirty && (noteTitle.trim() || noteBody.trim())`. When a note originally had text and the user removes it all, it is dirty but both trimmed fields are empty, so Cancel/Escape/backdrop closes and clears the draft without asking. `saveNote()` also routes blank text through this close path, so a blank edit can vanish without an explanation. A focused hook probe confirmed no confirmation call.

**Fix shape:** Base discard confirmation on `noteIsDirty` alone. Decide separately whether a blank note is allowed to save; if not, show validation and keep the editor open. Preserve the existing no-confirmation behavior when nothing has ever been changed.

**Regression test:** Open a saved note with nonempty title/body, clear both, reject the confirmation, and assert editor and draft remain. Check Save with blank content and Escape/backdrop paths.

### R-08 — `auth.getUser()` failure is still treated like a missing actor [P2, source-confirmed]

**Where:** `src/features/catchup/use-catchup.ts`, `fetchCatchupMoments()` around lines 50–72.

**What is fixed:** Actor-query and Thing-query errors now throw and become the hook's `error` rather than successful empty data.

**What remains:** The prerequisite `supabase.auth.getUser()` result reads only `data`, discarding `error`. A failed identity lookup produces `auth.user === null`, skips the actor lookup, then maps returned moments with `myActorId = null`. That is not a confirmed “this user has no actor” result; it can change viewer-relative fields/capabilities while reporting successful loaded moments.

**Fix shape:** Check and propagate `authError`. If the authenticated profile ID already supplied by `useSession` can be reused safely under current RLS, pass it to the fetch function instead of making another auth request; keep `myActorId === null` only for a successful actor query with no row.

**Regression test:** RPC returns moments, `getUser()` fails, and the hook reports error rather than success. A successful user lookup with no actor row remains distinct and intentional.

### R-09 — Structured access-denial errors still render stale protected content [P1, reproduced]

**Where:** `src/lib/query-policy.ts`, `classifyAsyncError()` around lines 43–52 and `resolveAsyncBranch()` around lines 83–110; `src/components/katalist/AsyncState.tsx`; `scripts/async-state-branch.test.mjs`.

**What is fixed:** Existing tests with message strings like “permission denied,” “not authenticated,” and “not found” now block stale content. The `list_members` invalidation targets and mounted-observer behavior are materially better.

**What remains:** `classifyAsyncError()` calls `extractErrorMessage()` and inspects only words. It ignores structured HTTP status and database error code. I invoked the current resolver with loaded data and `{status: 403, message: "Forbidden"}` and with `{code: "42501", message: "access denied"}`; **both returned `ready`**. A client that supplies either shape can continue rendering cached protected data after a confirmed denial. The test file currently uses only hand-chosen message strings.

**Fix shape:** Normalize each supported transport's error to a typed category at the query boundary, or inspect structured `status`/`code` before falling back to message text. Distinguish 401, 403/42501, 404/PGRST not-found, and transient 5xx/network. Let the confirmed-access-loss branch take precedence over offline fallback when the denial was already observed. Pass the category to consumers, including those not using `AsyncState`; clear or block their stale data after confirmed loss.

**Regression test:** Existing nonempty cache plus a structured 401/403/42501/404 result must hide content; 500/network retains content with a warning. Exercise both the pure resolver and at least one real mounted List/chat consumer.

## C-06: what is reviewed and what still requires a real environment

The source now maps `list_members` events to List detail/index, List chat, Hub conversation list/detail, Hub files, and meeting query families. The fast path uses `invalidateQueries()` rather than `removeQueries()`, and the added test uses a real mounted observer. This local fix addresses the previously reproduced observer gap.

It does **not** establish that a removed member's browser receives the DELETE event in deployed Supabase, what fields the publication includes under its actual `REPLICA IDENTITY`, or whether every mounted consumer hides a confirmed 403/empty-authority result. Preserve the wide invalidation fallback for incomplete payloads. In staging, revoke a disposable member while List detail, chat, files, sidebar and dock are open. Test both full and primary-key-only payloads where possible and inspect the actual deployed publication/RLS behavior. If the event is not reliably delivered to the removed member, add an authoritative refresh path that does not depend on that event, such as a suitable personal membership signal plus focus/reconnect revalidation and a bounded check for long-open views. Do not call this live gate passed from the local QueryObserver test.

## Suggested closure order

1. **Prevent loss and false access:** R-01, R-03, R-09.
2. **Complete ownership and timing:** R-04, R-05, R-02.
3. **Finish note and moment edges:** R-06, R-07, R-08.
4. Recheck each changed item against its own acceptance criteria; run the full local checks after the fixes. Then perform the prepared SQL/RLS and revocation tests in an isolated staging environment before marking live acceptance complete.

For each item, use a regression test that fails against the current implementation. Tests must exercise the library boundary that caused the defect: real React Query for mutation lifetimes and mounted observers, real SQL execution for RPCs, and a deferred clock/claim for Morning Brief. Keep the migration disabled in production until separately deployed and verified.

**Closure summary:** F-01 SQL source and C-06 local invalidation are reviewable as locally fixed. F-02's SQL correction and F-05's targeted child-query correction are also sound locally, with the integration edge cases above open. E-03, G-06, H-05, F-03, and B-03 remain partial. All live deployment and RLS gates remain open.
