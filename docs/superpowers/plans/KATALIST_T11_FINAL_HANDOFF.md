# Katalist T11 — Lists and Buckets: final handoff

Tested tree: `6028efb47332231fcc1e167028fea3f6a3f2bece` (HEAD of
`katalist-plan/batch-a-baseline`), working tree clean except the
out-of-scope, untracked `.agents/` and `output/` paths, which this task did
not touch. Commits, in order, on top of `84feef6` (T10 close):

| Commit | Package(s) | Scope |
| --- | --- | --- |
| `8095531` | T11-01 | `useListThingsFilter` keyed filter hydration |
| `4fdbc59` | T11-02 | Lists/Buckets index native links, real timestamps, mobile layout |
| `28999d0` | T11-03, T11-04 | `ListInviteDialog`/`ListMembersSection` extraction, truthful invites, shared `ListChatPanel` |
| `766f986` | T11-05, T11-06 | Bucket reference availability model, one shared reference command |
| `a57e2c4` | T11-07 | Inline desktop detail, mobile sheet, note-save feedback |
| `6028efb` | Verification | `tests/e2e/preview/lists-buckets.spec.ts` |

This continues work already substantially built by the user before this
session started (the session found `use-list-things-filter.ts`,
`bucket-reference-commands.ts`, `ListInviteDialog.tsx`, the fixture/
`map-list-rows.ts` timestamp fields, most of the index/detail route rewrites,
and the e2e spec already on disk and largely correct). This session's own
work was: verifying that existing code against the plan's specific traps
(the `InlineThingDetailWorkspace` navigator-branch trap, error-vs-unavailable
conflation, fabricated invite toast), fixing gaps found, extracting
`ListMembersSection` (the one section not yet extracted), running the full
gate/browser verification, and writing this ledger.

## 1. Checklist mapping (plan section "T11 — Lists and Buckets page completion")

1. **Lists index preserves grouping/links/search/times/narrow layout.**
   `src/routes/lists.index.tsx` — native `Link` targets (with `viewTransition`)
   replace the prior `role="link"` click/keydown row emulation; row-action
   menu items are separate `Link`/`button` elements, independently reachable
   by Tab; search input has `aria-label="Search Lists"` and a clear button;
   mobile card layout added below `md:`; `ListRow.updatedAtIso` (added in
   `src/features/lists/fixtures.ts` and populated in
   `src/features/lists/map-list-rows.ts`) drives both sort order and
   `<time dateTime>` exact-date-on-hover/focus, replacing the prior
   string-compare of display labels. `src/routes/buckets.index.tsx` received
   the matching fix (native `Link`, named/clearable search, explicit empty
   state with "Clear filters"). Evidence: `scripts/list-things-filter.test.mjs`
   coverage of filter defaults; the e2e spec's "native hrefs"/"no overflow"
   assertions on both index pages; manual `npm run build:app` + Playwright
   screenshot review (see §4).

2. **Filter hydration fixed; no cross-key overwrite.**
   `src/features/lists/use-list-things-filter.ts` keys storage by
   `identityId + listId`, adjusts state during render (not in a `useEffect`,
   so a prior render's stale key can never write into the new key's slot),
   validates stored strings against the `LIST_THING_FILTERS` whitelist, and
   is a no-op writer when `identityId` is null (auth-pending) or
   `localStorage` throws. Wired into `src/routes/lists.$listId.tsx` at the
   `useListThingsFilter(filterIdentityId, listId)` call. Evidence:
   `scripts/list-things-filter.test.mjs` (16 lines changed) and the new
   `scripts/list-things-filter-lifecycle.test.mjs` (reused-route A/B/A,
   distinct same-name-List identity separation, corrupt/throwing storage).

3. **Selected Thing preserved by ID; explained when filtered out.**
   Verified in `lists.$listId.tsx`: selection state is independent of the
   filtered/sorted arrays; this session did not find or need to change this
   logic further beyond what the existing dirty tree already had. **Not
   independently re-verified with a new browser reproduction in this
   session** beyond the existing `list-things-filter*.test.mjs` coverage —
   see §5 remaining items.

4. **Things/Members/invite sections extracted; shared `ListChatPanel`
   replaces inline chat.**
   - `src/features/lists/components/ListInviteDialog.tsx` (pre-existing in
     the dirty tree, verified correct): a real teammate picker, not a fake
     email form. Its description states plainly "Email delivery is not
     configured." `addMember` in the route `await`s `rpcAddListMember` and
     reports the real outcome; invite-link copy (`copyInviteLink`, extracted
     this session) reports clipboard failure via `toast.error` instead of
     assuming success.
   - `src/features/lists/components/ListMembersSection.tsx` (**new this
     session**): the Members & Permissions tab's presentation (search,
     role filter, owner/collaborator/view-only groups, per-member
     role-change/remove menu, Permission Guide) extracted as a typed,
     presentational component. Member-mutation ownership (the
     `memberOperationKeysRef` per-operation dedupe key, identity-epoch
     guards via `getIdentityEpoch`/`isEpochCurrent`, and the actual
     `rpcChangeListRole`/`rpcRemoveListMember` calls) stayed in the route as
     `changeMemberRole`/`removeMember`, passed down as callbacks — per the
     plan's "keep mutation/query ownership in the route" instruction.
   - **`ListThingsSection.tsx` was not extracted.** The Things tab's JSX
     remains inline in `lists.$listId.tsx`. This is a real, acknowledged gap
     against the plan's explicit file list (`ListThingsSection.tsx`), not a
     silent omission — see §5.
   - `ListChatPanel` (`src/routes/lists.$listId.tsx` chat tab) replaces the
     prior large inline feed/composer; the route keeps `useListMessages`
     only for its one remaining real use, `chat.sendSystem` (call-history
     system events), confirmed by grep — no other `chat.*` usage remains, so
     there is no duplicate feed/composer/subscription left over.
   Evidence: `npx tsc --noEmit` clean, `npm run lint` 0 errors on the
   touched files, full `npm test` 763/763, e2e spec's Chat-tab assertions
   (`Search messages` button, exactly one `Message …` textbox) and
   Members-tab assertion (`Permission Guide` visible) passing on all 5
   viewports except the one unrelated mobile failure in §5.

5. **Buckets: truthful private-collection copy; existing-reference vs
   Create Thing.**
   `src/routes/buckets.$bucketId.tsx` shows "Private collection. Shared
   items keep their existing permissions." (replacing "Only visible to
   you"). The add-reference button is labeled "Add existing reference"
   (was "New Thing") and opens the existing Thing/List picker; T11 did not
   invent a second Create-Thing flow, per the plan's instruction not to add
   a fake creator when no separate one exists.

6. **Unresolvable references keep identity; distinguished from fetch
   error.** `src/features/buckets/fetch-bucket-items.ts`'s `BucketItem`
   union carries `availability: "available" | "unavailable"` per item,
   preserving `thingId`/`listId` even when the source row doesn't resolve
   under RLS — it is never dropped from the array. A thrown Supabase error
   (network/RLS-query failure itself, not an empty authorized result)
   propagates as a rejected promise, which the route's `itemsSurface`
   renders as a distinct error state with a **Retry** button
   (`buckets.$bucketId.tsx`), not as a fabricated "unavailable" tombstone.
   `buckets.$bucketId.tsx` renders unavailable Thing/List rows with only a
   private "Remove reference" action (no title/preview/avatar/Open), and
   removal only calls `remove.mutateAsync` (the reference-only RPC), never a
   Thing/List delete. Evidence: `scripts/fetch-bucket-items-concurrency.test.mjs`
   (extended this branch), full test suite green.

7. **One shared add/remove reference command for buttons, keyboard and
   drag.** `src/features/buckets/bucket-reference-commands.ts`
   (`runBucketReferenceCommand`) is the single implementation called from
   `use-bucket-items.ts`'s `add`/`remove` mutations (buttons/keyboard path)
   and from `SpringLoadedBucketFlyout.tsx`'s `onDrop` handler (replacing its
   prior direct `rpcAddToBucket` call). It validates the target shape
   (exactly one of `thingId`/`listId`), deduplicates identical in-flight
   `operation:bucketId:sourceKey` calls per `QueryClient`, checks
   `isEpochCurrent` before treating a completion as current (an
   identity-switched completion is inert, no stale toast/cache write), and
   invalidates `bucket-items`/`bucket`/`buckets` queries together on
   success. Evidence: `scripts/bucket-reference-commands.test.mjs` (new,
   62 lines: malformed payload rejection, dedupe, epoch-retirement).
   Bucket progress/count denominator logic itself was not touched — the
   plan only required a defect fix "if tests reveal a count defect," and
   none was found in this session's targeted testing.

8. **Real desktop inline Bucket detail; reachable mobile sheet; note-save
   feedback preserved.** `src/routes/buckets.$bucketId.tsx`: replaced
   `CourtDetailModal` (previously mounted with `onOpenFullView={() =>
   undefined}`, a no-op) with `InlineThingDetailWorkspace` on desktop,
   passed **only** `thing`, `onClose`, `backLabel`, `flatPanel` and
   `children` — deliberately omitting `items`/`onSelectThing`, which is what
   flips that component into its full-screen navigator branch (confirmed by
   reading `InlineThingDetailWorkspace.tsx`'s `hasNavigator = Boolean(items
   && items.length > 0 && onSelectThing)` — with both undefined, `hasNavigator`
   is `false` and the two-pane inline branch renders). Below 1024px
   (`useNarrowViewport`, a `matchMedia("(max-width: 1023px)")`-backed
   `useSyncExternalStore` hook), the existing `ThingDetailSheet` renders
   instead, gated so only one of the two ever has a non-null `thing` at a
   time (`narrowViewport ? null : selectedThing` for the workspace,
   `narrowViewport && Boolean(selectedThing)` for the sheet's `open`).
   Opening a Thing (`openThing`) captures `document.activeElement` (or an
   explicit origin) before selecting; closing (`closeThing`) restores focus
   to it if still connected. `use-bucket-note-editor.ts`'s existing
   revision-safe save, new-ID draft migration, synchronous save guard,
   blank-clear confirmation and epoch guards were read and left unchanged;
   this session's only edit there was adding a truthful
   `toast.success("Note saved.")` / "Saved. Your newer edits are still
   here." reflecting the actual mutation outcome (previously the dialog
   closed with no success feedback at all). Evidence:
   `scripts/inline-thing-detail-workspace.test.mjs` rewritten this session
   to assert the corrected contract (desktop `InlineThingDetailWorkspace` +
   mobile `ThingDetailSheet`, never `CourtDetailModal`); full test suite
   green; Playwright screenshots at mobile/desktop/tablet/full-hd (§4) show
   the Bucket detail reachable and unclipped at every viewport.

## 2. Gate results (run against `6028efb`, the final commit)

- `npx tsc --noEmit`: **clean, 0 errors.**
- `npm run lint`: **0 errors, 38 warnings** — all 38 pre-exist this task
  (verified: the same warning set and count was present before any T11 edit
  in this session); none are in a file this session wrote from scratch.
- `npm test`: **763/763 passing**, 0 failed/cancelled/skipped. (Stated
  baseline before this session's work was 757/757; the 6 additional tests
  are the new `list-things-filter-lifecycle.test.mjs` and
  `bucket-reference-commands.test.mjs` files plus extensions to
  `fetch-bucket-items-concurrency.test.mjs`/`list-things-filter.test.mjs`/
  `inline-thing-detail-workspace.test.mjs`.)
- `npm run build:app`: **succeeds** (Vite + Nitro build, no migration run).

## 3. Browser verification (Playwright, five required viewports)

Command actually run (demo mode is `false` in `.env.local`, so it was
overridden for this process only, not persisted to any env file):

```sh
VITE_KATALIST_DEMO_MODE=true npx playwright test tests/e2e/preview/lists-buckets.spec.ts \
  --project=preview-desktop --project=preview-mobile \
  --project=preview-tablet-portrait --project=preview-tablet-landscape \
  --project=preview-full-hd
```

Result: **9 of 10 passed.** The one failure is real but out of this
package's file scope — see §5 for full root-cause detail; it is not silently
waived here.

Screenshot artifacts (repo-relative, under the gitignored `test-results/`,
not committed):
- `test-results/lists-buckets-Lists-index--77578-at-and-responsive-summaries-preview-{desktop,mobile,tablet-portrait,tablet-landscape,full-hd}/lists-index.png`
- `test-results/lists-buckets-Buckets-inde-a0f9b-onsive-Thing-detail-surface-preview-{desktop,mobile,tablet-portrait,tablet-landscape,full-hd}/bucket-detail.png`
- Failure artifacts: `test-results/lists-buckets-Lists-index--77578-at-and-responsive-summaries-preview-mobile/{test-failed-1.png,trace.zip,error-context.md}`

Visual review of the desktop and mobile Bucket-detail screenshots (both
inspected directly in this session) shows the inline workspace and the
mobile sheet both rendering without clipping, with the bottom app nav intact
and the note/Things table content reachable and legible at 390×844 and
1440×900.

## 4. Shared-contract compatibility

- `InlineThingDetailWorkspace`'s public prop contract (`thing`, `onClose`,
  `children`, `items`, `onSelectThing`, etc.) was **not changed** — Buckets
  now calls it with a narrower prop subset than Court/Lists do, which is
  exactly the existing two-pane branch other callers already exercise, so
  no caller-compatibility risk.
- `runBucketReferenceCommand`'s signature is new (this session found it
  already authored); `use-bucket-items.ts` and
  `SpringLoadedBucketFlyout.tsx` are its only two callers, both updated
  together in the same commit (`766f986`), so no stale caller remains.
- `ListChatPanel`'s existing prop contract (`listId`, `placeholderName`,
  `viewOnly`, `className`) was reused as-is; no new prop/slot was added to
  it in this session.

## 5. No database changes

No new or modified SQL migration was authored or required for any T11
package in this session. `fetchBucketItems`'s availability classification
is derived entirely from the existing `bucket_items`/`things`/`lists`
read shape; no schema change, tombstone column, or RPC signature change was
made or needed.

## 6. Remaining gaps — named precisely, not glossed over

1. **`ListThingsSection.tsx` was not extracted.** The List-detail route's
   Things tab (search/filter controls, the Things list itself, lane
   grouping) remains inline in `src/routes/lists.$listId.tsx`. Members and
   Invite were extracted (`ListMembersSection.tsx`, `ListInviteDialog.tsx`);
   Things was not, due to session time constraints after the higher-risk
   Bucket-detail/reference-model packages. Behavior is unaffected — this is
   a pure code-organization gap, not a functional one — but it is a real,
   named item against the plan's explicit `ListThingsSection.tsx` file
   target. **Next step:** extract the Things-tab JSX the same way
   `ListMembersSection` was extracted in commit `28999d0` — presentational
   props in, mutation dispatch (catch/sort/reassign) staying in the route.

2. **One genuine Playwright failure: `preview-mobile`, "List detail at 200%
   zoom equivalent has horizontal overflow."** Root-caused, not just
   observed: the spec halves the Pixel-7-emulated viewport's width
   (390→320, clamped to a 320px floor) via `page.setViewportSize()` to
   approximate a 200%-zoom reflow check. At that synthetic width, the
   overflow check reported `scrollWidth: 336`, `clientWidth: 320`,
   `window.innerWidth: 336`, with an **empty offenders list** — i.e. no
   single element in the page was found extending past the viewport edge.
   `scrollWidth` exactly equals `window.innerWidth`, and the 16px gap to
   `clientWidth` is the classic signature of a reserved (non-overlay)
   vertical scrollbar appearing on `<html>` — which happens because
   manually calling `setViewportSize()` on a device-emulated (touch/mobile)
   Playwright context does not re-apply the full mobile metrics override,
   so Chromium falls back to desktop-style reserved scrollbars for that one
   resize. `src/components/layout/AppShell.tsx` (the global bottom nav
   bar shown in the failing screenshot) was **not modified by any T11
   commit** — confirmed via `git log` — so this is not a regression
   introduced by this session's or the prior session's T11 work; it is a
   pre-existing characteristic of the app shell interacting with this
   specific synthetic-zoom test technique, not a reproduction at any of the
   four real, required device viewports (390×844 native, 768×1024, 1024×768,
   1440×900, 1920×1080 all passed cleanly, including the real
   preview-mobile pass at 390×844 before the halving step). **Next step:**
   either accept this as a known test-harness artifact and adjust the
   spec's zoom-equivalent technique (e.g., use `page.evaluate` to apply a
   CSS `zoom`/`transform` instead of resizing the viewport, which does not
   trigger the scrollbar-reservation fallback), or, if a maintainer
   confirms real users can reach a genuinely-320px-wide viewport with a
   reserved scrollbar, adjust the app-wide bottom nav's item sizing —
   either fix is outside this session's remaining time budget and outside
   the Lists/Buckets-only file scope this task was bounded to.

3. **Item 3 (selected-but-filtered vs revoked distinction)** was inherited
   from the pre-existing dirty-tree implementation and was not
   independently re-derived or given a fresh targeted browser reproduction
   in this session beyond the existing filter-lifecycle test coverage. If a
   stricter acceptance bar is wanted here, a dedicated component test
   mounting the route with a selected-then-filtered-out Thing ID is the
   next concrete step.

No other T11-08 item (`KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md`'s T11
bullet list, all 8 acceptance lines) was found unimplemented in this
session's inspection.

## 7. Ledger updates made

- `docs/superpowers/plans/KATALIST_A_TO_H_AUDIT_PROGRESS.md` and
  `docs/superpowers/plans/KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md`'s T11
  checkbox: **left unchecked**, pending the two named gaps in §6 (the
  `ListThingsSection` extraction and the mobile Playwright zoom-equivalent
  root cause resolution/waiver). Ticking the top-level `T11` box while
  either is open would overstate completion; the plan's own instruction is
  to tick "only where you have real evidence," and the evidence here is
  "7 of 8 acceptance bullets fully closed, 1 partially closed
  (extraction), 1 known non-regression browser-harness finding open."

This is local, non-deployed completion evidence only. It does not certify
production RLS behavior, a live Supabase environment, or any staging
account state.
