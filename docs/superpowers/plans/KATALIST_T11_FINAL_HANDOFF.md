# Katalist T11 — Lists and Buckets: final handoff

**Status: T11 is locally closed.** All eight plan acceptance bullets are
implemented and evidenced. One genuine, precisely-documented finding remains
open (§6) — a pre-existing, out-of-file-scope accessibility defect in the
global `AppShell.tsx` bottom navigation, confirmed unrelated to any T11
commit and confirmed pre-existing on the pre-T11 baseline. It is reported
here rather than silently waived, but it does not block T11's own top-level
checkbox because it is not a Lists/Buckets defect and `AppShell.tsx` is not
a T11-owned file.

Tested tree: `7599bb2` (HEAD of `katalist-plan/batch-a-baseline`), working
tree clean except the out-of-scope, untracked `.agents/` and `output/`
paths, which this task did not touch. Commits, in order, on top of
`84feef6` (T10 close):

| Commit | Package(s) | Scope |
| --- | --- | --- |
| `8095531` | T11-01 | `useListThingsFilter` keyed filter hydration |
| `4fdbc59` | T11-02 | Lists/Buckets index native links, real timestamps, mobile layout |
| `28999d0` | T11-03, T11-04 | `ListInviteDialog`/`ListMembersSection` extraction, truthful invites, shared `ListChatPanel` |
| `766f986` | T11-05, T11-06 | Bucket reference availability model, one shared reference command |
| `a57e2c4` | T11-07 | Inline desktop detail, mobile sheet, note-save feedback |
| `6028efb` | Verification | `tests/e2e/preview/lists-buckets.spec.ts` |
| `2fc191d` | Docs | First-pass handoff/ledger (superseded by this revision) |
| `7599bb2` | T11-03 | `ListThingsSection` extraction (closes the last named component gap) + fresh selection-state tests |

This continues work already substantially built by the user before this
session started (the session found `use-list-things-filter.ts`,
`bucket-reference-commands.ts`, `ListInviteDialog.tsx`, the fixture/
`map-list-rows.ts` timestamp fields, most of the index/detail route rewrites,
and the e2e spec already on disk and largely correct). This session's own
work was: verifying existing code against the plan's specific traps (the
`InlineThingDetailWorkspace` navigator-branch trap, error-vs-unavailable
conflation, fabricated invite toast), fixing gaps found, extracting
`ListMembersSection` and `ListThingsSection` (the two sections not yet
extracted), adding a fresh DOM-level test for the selected-filtered-out vs
selected-unavailable distinction, root-causing and precisely documenting
the one remaining Playwright finding, running the full gate/browser
verification, and writing this ledger.

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
   Verified in `lists.$listId.tsx` (now `ListThingsSection.tsx`'s rendering
   of state the route computes): `selected` is looked up by ID against the
   full unfiltered `listThings`, independent of the filtered/sorted arrays;
   `selectedIsVisible` checks membership in `filteredThings` separately.
   The three outcomes are rendered as genuinely distinct UI: **selected-
   visible** renders the real `ThingDetailContent`; **selected-filtered-out**
   (`selectedId && selected && !selectedIsVisible`) renders "This Thing is
   hidden by your filters." with both a **Clear filters** action
   (`clearThingFilters`, resetting `thingsFilter`/`dueFilter`/`personFilter`)
   and **Close**; **selected-unavailable** (`selectedId && !selected` — the
   ID no longer resolves against `listThings` at all) renders a distinct
   "This Thing is no longer available." with **only Close**, deliberately
   withholding Clear filters since clearing filters cannot recover a
   genuinely gone/inaccessible Thing. Evidence: the new
   `scripts/list-things-section-selection-states.test.mjs` (added in commit
   `7599bb2`) mounts the real `ListThingsSection` component via
   `@testing-library/react` and asserts, at the DOM level, that each of the
   four states (visible / filtered-out / unavailable / no-selection) renders
   its correct, distinct copy and actions and never the other state's copy
   — a fresh reproduction, not a source-string check.

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
   - `src/features/lists/components/ListThingsSection.tsx` (**new in commit
     `7599bb2`**): the Things tab's presentation (lane navigator with
     Now/Next/Later counts, the Active/All/Completed quick-filter control,
     the Thing row list, the inline detail/PDF-preview pane, and the Toss
     composer) extracted the same way as `ListMembersSection`. All derived
     state (`grouped`, `laneThings`, `activeThing`, `selTint`,
     `selectedIsVisible`) and the `thingsFilter` value/setter
     (`useListThingsFilter`) stay owned by the route; the route passes them
     down plus three small composed callbacks (`selectLane`,
     `closeSelectedThing`, `clearThingFilters`) that previously lived inline
     in the JSX event handlers. This closes the last of the plan's three
     named new components (`ListThingsSection`, `ListMembersSection`,
     `ListInviteDialog` are all now real files).
   - `ListChatPanel` (`src/routes/lists.$listId.tsx` chat tab) replaces the
     prior large inline feed/composer; the route keeps `useListMessages`
     only for its one remaining real use, `chat.sendSystem` (call-history
     system events), confirmed by grep — no other `chat.*` usage remains, so
     there is no duplicate feed/composer/subscription left over.
   Evidence: `npx tsc --noEmit` clean, `npm run lint` 0 errors on the
   touched files, full `npm test` 763/763, e2e spec's Chat-tab assertions
   (`Search messages` button, exactly one `Message …` textbox) and
   Members-tab assertion (`Permission Guide` visible) passing on all 5
   viewports except the one unrelated, out-of-scope AppShell finding in §6.

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

## 2. Gate results (run against `7599bb2`, the final commit)

- `npx tsc --noEmit`: **clean, 0 errors.**
- `npm run lint`: **0 errors, 38 warnings** — all 38 pre-exist this task
  (verified: the same warning set and count was present before any T11 edit
  in this session); none are in a file this session wrote from scratch.
- `npm test`: **768/768 passing**, 0 failed/cancelled/skipped. (Stated
  baseline before this session's work was 757/757; the 11 additional tests
  are `list-things-filter-lifecycle.test.mjs` (new),
  `bucket-reference-commands.test.mjs` (new),
  `list-things-section-selection-states.test.mjs` (new, 4 tests, the
  selected-visible/filtered-out/unavailable/no-selection reproduction), and
  small extensions to `fetch-bucket-items-concurrency.test.mjs`/
  `list-things-filter.test.mjs`/`inline-thing-detail-workspace.test.mjs`.)
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

Result: **9 of 10 passed**, unchanged after the `ListThingsSection`
extraction (re-run against `7599bb2`). The one failure is real but out of
this package's file scope — see §6 for the full, DOM-confirmed root-cause
detail; it is not silently waived here.

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

## 6. The one remaining finding — precisely documented, not a T11 gap

Both previously-open items from the first pass of this handoff are now
closed:

- **`ListThingsSection.tsx` extraction** — closed in commit `7599bb2` (§1.4
  above).
- **Selected-filtered-out vs selected-unavailable, fresh reproduction** —
  closed in the same commit via
  `scripts/list-things-section-selection-states.test.mjs` (§1.3 above).

One finding remains, fully root-caused and reproduced against the pre-T11
baseline as requested, but judged **not a T11 gap** (reasoning below):

**Finding: `preview-mobile` fails "List detail at 200% zoom equivalent has
horizontal overflow."**

Reproduction command:

```sh
VITE_KATALIST_DEMO_MODE=true npx playwright test tests/e2e/preview/lists-buckets.spec.ts \
  --project=preview-mobile --grep "Lists index"
```

**Root cause, confirmed by direct DOM inspection (not inferred from the
error message alone).** The original handoff pass guessed this was a
Chromium scrollbar-reservation artifact from `setViewportSize()` on a
device-emulated context; that guess was **wrong**, and this pass replaced it
with a real measurement. Using a temporary diagnostic spec that scans every
element's `getBoundingClientRect()` against the requested 320px width
(rather than trusting `window.innerWidth`, which itself grows to
accommodate the offending content), the actual widest elements at the List
detail Members tab, viewport requested at 320px, are:

```json
{
  "innerWidth": 336,
  "offenders": [
    { "tag": "NAV", "cls": "fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t ...",
      "right": 336, "width": 336, "text": "CourtListsBucketsTeamNudgesMe" },
    { "tag": "DIV", "cls": "flex flex-wrap items-center gap-4", "right": 335.98, "width": 299.98,
      "text": "Back to ListARAndroid ReleaseO" }
  ]
}
```

The widest element is unambiguously **`AppShell`'s global fixed bottom
navigation bar** (`Court / Lists / Buckets / Team / Nudges / Me`, six
items): it cannot render narrower than 336px, 16px more than the 320px
CSS-pixel floor. Because this element uses `position: fixed`, Chromium's
mobile-emulation layout engine widens the effective layout viewport
(`window.innerWidth`) to fit it rather than clipping it or adding a
scrollbar — which is also exactly how a real mobile browser behaves when
fixed content cannot fit the requested viewport. The 320px check itself is
not an arbitrary or "wrong" test technique: it matches WCAG 2.1 Success
Criterion 1.4.10 (Reflow), which requires no loss of content/function via
horizontal scrolling at a width equivalent to 320 CSS pixels. This is a
real, valid accessibility check finding a real, valid accessibility defect
— it is just not a Lists/Buckets defect.

**(a) Confirmed not touched by any T11 commit:**

```sh
$ git log --oneline 84feef6..HEAD -- src/components/layout/AppShell.tsx
(no output)
```

Zero commits across this entire T11 session touched `AppShell.tsx`.

**(b) Confirmed pre-existing, not a regression, via a real before/after
comparison.** A temporary detached worktree was created at the pre-T11
commit `84feef6` (via `git worktree add --detach`, `node_modules` reused via
symlink since `package.json`/`package-lock.json` are unchanged across the
whole range — verified with `git diff 84feef6..HEAD -- package.json
package-lock.json`, empty), and the same 320px-viewport measurement was
taken against that commit's own List-detail route (its index page still
used click-handler rows rather than real links at that commit, so the
Things and Members tabs were reached via `[role="link"]`/tab-button
fallbacks instead of the current `<a href>` selectors):

| Commit | Things tab @320px | Members tab @320px |
| --- | --- | --- |
| `84feef6` (pre-T11) | `innerWidth: 356` | `innerWidth: 353` |
| `7599bb2` (this session, final) | n/a (Things tab has its own separate, larger pre-existing two-pane-desktop-layout overflow at *any* width — see note below) | `innerWidth: 336` |

The overflow is **larger at the pre-T11 baseline** (353–356px) than at the
current tree (336px) — i.e. this session's work did not introduce it, and
if anything the narrower current-session overflow suggests unrelated
incidental improvement, not regression. The worktree and its diagnostic
spec were removed after this comparison; no artifact from it was committed.

**Separate, out-of-scope note found during this investigation (not
fixed, not part of T11's 8 acceptance bullets):** the List-detail Things
tab's two-pane layout (`w-[340px]` navigator + `px-8`/`max-w-3xl` detail
pane) does not collapse to a single column below desktop width at all,
independent of the 320px WCAG floor — it already overflows a full,
un-halved 390px mobile viewport (a real `H1` was measured at `right: 509`
against a 390px-wide viewport in this session's diagnostic run). This
predates T11 (reproduced on the `84feef6` worktree too, at even larger
magnitude) and is a pre-existing List-detail mobile-responsiveness gap. It
is named here for visibility but was not in T11's eight acceptance bullets
(which cover filter hydration, selection identity, extraction, shared chat,
Bucket truthfulness/references/commands/detail — not a full mobile
reflow redesign of the Things-tab two-pane layout) and touching it would
mean redesigning List-detail's responsive layout wholesale, which this
session judged out of scope rather than attempt as an unplanned addition.

**(c) Disposition.** Per the coordinator's own conditional: fix the harness
if that's a quick, safe fix, otherwise document precisely. Loosening the
spec's 320px floor would not be a harness *fix* — it is the actual WCAG
1.4.10 threshold, so weakening it would hide a real (if out-of-scope)
defect rather than correct a testing mistake. The correct scope boundary is
that `AppShell.tsx` is not one of T11's owned files (see this plan's own
file-ownership table in `KATALIST_T11_DETAILED_EXECUTION_PLAN.md` §2) and
is shared, unmodified, cross-cutting chrome for Court/Lists/Buckets/Team/
Nudges/Me alike — fixing its nav-item sizing is a global accessibility
task, not a Lists/Buckets one, and belongs in its own dedicated pass rather
than folded into T11 unannounced. This finding is therefore reported as a
named, evidenced, out-of-scope defect for a future accessibility pass, not
treated as a T11 blocker.

No other T11 acceptance bullet (`KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md`'s
T11 bullet list, all 8 lines) was found unimplemented in this session's
inspection.

## 7. Ledger updates made

- `docs/superpowers/plans/KATALIST_A_TO_H_AUDIT_PROGRESS.md`: T11 section
  updated to reflect full closure plus the named AppShell finding.
- `docs/superpowers/plans/KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md`: all
  eight T11 sub-bullets and the top-level `T11 — Complete Lists and
  Buckets.` checkbox are now **checked**. This reflects genuine local
  completion of all eight acceptance bullets with test/gate/browser
  evidence; it does not certify the separate, out-of-scope AppShell finding
  in §6, which remains open and is tracked by this document, not by a T11
  checkbox (since AppShell.tsx was never a T11-owned file).

This is local, non-deployed completion evidence only. It does not certify
production RLS behavior, a live Supabase environment, or any staging
account state.
