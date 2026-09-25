# Katalist T11 — Lists and Buckets completion

Prepared 2026-09-25 against `e773399`, branch `katalist-plan/batch-a-baseline`.
This is an implementation handoff based on source inspection. It does not certify the reported T10 test results or close T10's outstanding mobile/timer requirements.

## 1. Objective and boundaries

Complete all eight T11 requirements in `KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md`: usable Lists index, safe persistent filters, ID-owned detail selection, reusable List sections/chat, truthful Bucket semantics, unavailable-reference preservation, shared reference commands/counting, and responsive Bucket detail/notes.

Proceed through the packages below without requesting approval between them. Complete local implementation, regression tests and browser verification, then reconcile the ledger. A pre-existing defect explicitly covered by T11 is still T11 work. Missing local mobile integration is not a release-only caveat.

Preserve the existing product vocabulary, typography/motion tokens, roles, authorization and accepted draft/epoch fixes. No new subscription, pricing, paywall, invite delivery service, notification system or database redesign. T09 Magic Box races and T10 completion gaps remain separate tasks unless a minimal integration correction is required here and documented.

Do not deploy or mutate production data for this task. Local preview/test fixtures and additive SQL fixtures, if required, are sufficient for local closure. Do not use the ordinary build script because it runs migrations; use `build:app`.

## 2. Read and map before editing

Paths below are repository-relative. Confirm current HEAD and dirty files first; another agent may have advanced the branch.

| Files | Responsibility / planned work |
| --- | --- |
| `docs/superpowers/plans/KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md`, T11 | Original acceptance; every checkbox must map to evidence. |
| `docs/superpowers/plans/KATALIST_A_TO_H_AUDIT_PROGRESS.md` | Preserve prior note/chat/detail fixes and record real completion. |
| `src/routes/lists.index.tsx` | Native links, row-action semantics, search, role groups, dates, narrow layout. |
| `src/routes/lists.$listId.tsx` | Filter ownership, stable selection, section extraction, shared chat and real invite results. |
| `src/features/lists/fixtures.ts`, `map-list-rows.ts` | Preserve machine-readable dates alongside display labels if needed. |
| `src/features/lists/use-lists.ts`, `fetch-list-detail.ts`, `use-list-things.ts` | Reuse scoped loading, roles and fetched data; avoid redundant fetches. |
| `src/features/lists/ListChatPanel.tsx` | Shared composer/feed with existing draft, media, blocker and bounded-history behavior. |
| `src/features/lists/use-list-messages.ts`, `list-chat-channel-registry.ts` | Subscription ownership, retries, history and mutation scope. |
| `src/features/lists/chat-operations.ts`, `chat-scroll-state.ts`, `chat-feed-model.ts` | Preserve existing search/message actions and scroll contract. |
| `src/routes/buckets.index.tsx`, `src/routes/buckets.$bucketId.tsx` | Bucket navigation, privacy copy, reference actions, detail/notes integration. |
| `src/features/buckets/fetch-bucket-items.ts`, `use-bucket-items.ts` | Preserve reference identity and classify resolution; shared command integration. |
| `src/features/buckets/fetch-buckets.ts`, `use-buckets.ts`, `bucket-items-surface.ts` | Existing counts/readiness; preserve successful data during transient failure. |
| `src/features/buckets/SpringLoadedBucketFlyout.tsx` | Route drag/drop through the same command as keyboard/button actions. |
| `src/features/buckets/use-bucket-notes.ts`, `use-bucket-note-editor.ts` | Keep revision ownership, create-ID adoption, duplicate-save and failure recovery. |
| `src/features/things/InlineThingDetailWorkspace.tsx`, `ThingDetailSheet.tsx`, `src/features/court/CourtDetailModal.tsx` | Inspect actual contracts; choose desktop two-pane versus accessible mobile detail. |
| `src/features/things/ThingDetailContent.tsx`, `components/` | Reuse existing detail behavior and capabilities. |
| `src/features/things/rpc.ts`, `query-updates.ts`, `src/domain/capabilities.ts` | Reuse authorized mutations, epoch/token ownership and rollback. |
| `src/features/drafts/use-session-draft.ts`, `session-drafts.ts` | Reuse List chat/note draft contract; no new ad hoc persistence store. |
| `src/features/realtime/identity-cache-policy.ts`, `src/domain/query-keys.ts` | Protect account transitions and cache reconciliation. |

Discover existing bucket progress RPC/migrations with `rg`; preserve their bounded aggregate implementation. Read nested AGENTS.md instructions applicable to any modified files.

## 3. Source-confirmed problems and inspection checkpoints

1. List detail reads localStorage only in a useState initializer. Its write effect depends on a changing profile/List key, so reusing the route can write A's current filter into B's slot. Stored strings are cast to the filter type without validation.
2. List selection uses `selected ?? laneThings[0] ?? filteredThings[0]`. Explicit selection, filtered-out selection, and no selection need separate treatment to avoid silent fallback.
3. List detail has a large inline chat implementation and calls `useListMessages` even though `ListChatPanel` already provides a reusable feed/composer contract.
4. Email invitation submit currently only calls `toast.success("Invitation sent…")` and clears the input. No send operation backs that success.
5. Lists index emulates links with navigation handlers and `role="link"`. Row actions need native independent semantics without nested interactive controls.
6. `ListRow.updatedAt` is a display string; live mapping uses `toLocaleString()`, preview fixtures use relative labels, and index sorting compares strings. Accurate sorting/date display requires a real timestamp field.
7. `fetchBucketItems` only emits references when the Thing/List resolves; invisible or missing sources disappear. Its union has no unresolved state. Preview resolution also drops missing sources.
8. Bucket detail still renders `CourtDetailModal` with `onOpenFullView={() => undefined}`. It has not adopted desktop inline detail.
9. `InlineThingDetailWorkspace` requires `children`. Its `items`+`onSelectThing` branch becomes a fixed full-screen navigator; the branch without navigator props is the two-column inline layout. Do not assume the component name guarantees inline behavior.
10. That navigator branch uses click-only divs and `aria-hidden` for background content; `aria-hidden` alone does not remove keyboard focus. Avoid invoking that branch accidentally; correct it only if T11 intentionally reuses it.
11. Flyout drag/drop calls `rpcAddToBucket` directly while the route uses hook mutations. These paths need a shared command.
12. Note editor already implements important failure/revision fixes. Inspect and preserve them; do not replace it with a fresh modal-local state implementation.

These are source findings, not a statement that every possible defect has been reproduced. Write focused reproductions for behavioral changes below.

## 4. Product decisions to use

- Lists remain grouped as owner, collaborator and view-only. Names are display labels; UUIDs identify everything.
- Filter default is All. Unknown/corrupt saved values resolve to All. No preferences are persisted into a shared anonymous account slot while auth is unresolved.
- An explicitly selected Thing stays selected by ID. If a filter hides it, show a clear explanation and Clear filters; do not silently select another Thing.
- Permission loss is different from being filtered out. Remove protected detail/actions on confirmed loss. A transient read failure is not proof of deletion.
- Bucket copy: **“Private collection. Shared items keep their existing permissions.”** Bucket ownership never grants edit/access to referenced sources.
- “Add existing reference” opens the existing-item picker. Do not label that action “New Thing”. If a genuine Create Thing flow already exists, expose it separately with its real destination; otherwise offer the existing create location/link, not a fake second creator.
- Unresolvable sources are shown as “Unavailable Thing” / “Unavailable List” unless an authorized response establishes a more specific reason. Missing RLS-filtered rows alone cannot distinguish deletion from access loss.
- Removing a Bucket reference removes only the reference, not its Thing/List. Keep this clear in labels and confirmation copy where needed.
- Bucket progress uses unique accessible non-cancelled Thing IDs across direct references and referenced Lists. Unavailable sources never count as completed or zero-work proof.
- Desktop Bucket detail uses a real inline source/detail layout. Mobile uses the existing accessible sheet/dialog and remains reachable below 1024px.
- Email invitations must never announce delivery without an actual supported backend result. Prefer removing the nonfunctional send form and keeping working team-member/invite-link flows over building a new delivery service.

## 5. T11-01 — Filters, selected identity and derived state

**Files:** List detail route; new `src/features/lists/use-list-things-filter.ts` or a small equivalent model/hook if helpful.

- [ ] Enumerate the actual supported quick filters and validate storage with that whitelist.
- [ ] Key by resolved identity kind/profile or demo actor plus List UUID. Check existing identity helpers; never use display names. Preserve compatible existing keys where safe.
- [ ] Make hydration atomic with ownership: changing the key must never persist the prior key's value under the new key. Suitable implementations include a keyed child owning the filter or an explicit `{key,value,hydrated}` model with gated writes.
- [ ] Do not mount two ordinary effects that read and write new-key state from the same old render; this reproduces the race.
- [ ] Handle storage throwing, missing data, invalid strings and SSR without crashing or hydration mismatch. Only write after the correct slot has hydrated or the user explicitly changes its value.
- [ ] Reused route A→B→A restores both filters. Identity A→B with the same List cannot copy preferences.
- [ ] Keep selected ID independent from filtered arrays and array order. Reset or restore selection deliberately on List change; no old List detail flash.
- [ ] Distinguish selected-visible, selected-filtered-out, selected-unavailable and no-selection. Keep a selected Thing when a refresh changes ordering.
- [ ] If filtered out, show “This Thing is hidden by your filters” with Clear filters and Close. Do not equate that state with access denial.
- [ ] Remove unused due/sort setters/state only after tracing consumers. Keep a documented fixed sort as a derived constant if no user control is intended; do not add speculative controls to justify dead state.
- [ ] Clarify NOW/NEXT/LATER grouping as assigned importance where that is the real source; do not relabel it personal pace if it is not.

**Tests:** reused mounted route A/B/A; same-name distinct UUIDs; two profiles; preview/live separation; corrupt storage; throwing storage; selected Thing filtered out; refetch reorder; source denial; route changes while detail/file preview is open.

## 6. T11-02 — Lists index semantics, times and narrow layout

**Files:** `lists.index.tsx`, List row type/mapping and affected fixtures. Bucket index gets matching native navigation/search fixes where required by the same page contract.

- [ ] Replace simulated link targets with router Links carrying real hrefs. Preserve open-in-new-tab/copy-link behavior.
- [ ] Place action buttons/menu triggers beside links, never inside a full-row anchor. Tab/Enter reaches each independently; menu actions do not navigate the row.
- [ ] Preserve group headings/counts and view-only indicators under filtering. Keep creation controls/dialog outside AsyncState's collection boundary.
- [ ] Give search a programmatic accessible name, clear action and distinct no-results recovery. Placeholder alone is insufficient.
- [ ] Add a raw timestamp field such as `updatedAtIso` if the existing type has only display text. Sort by parsed timestamps; render relative text with `<time dateTime>` and an exact localized date available on hover and keyboard focus.
- [ ] Update live mapping and deterministic preview fixtures. Do not parse strings such as “Yesterday” or locale-formatted dates to sort.
- [ ] Unknown/invalid dates show an honest fallback and sort consistently; do not fabricate a recent timestamp.
- [ ] Stack summaries at narrow widths and wrap long names/descriptions. Keep row actions visible/reachable and preserve role hierarchy.
- [ ] Retain existing permission checks for rename/edit/create; failures retain user input and show retryable feedback.

**Tests:** native hrefs; independent menu activation; keyboard traversal; chronological sort across month/year; unknown dates; empty collection with creation available; duplicate/long names; mobile overflow.

## 7. T11-03 — Extract List sections and make invitation outcomes truthful

**New components:** `src/features/lists/components/ListThingsSection.tsx`, `ListMembersSection.tsx`, `ListInviteDialog.tsx`, or equivalent clearly scoped components.

- [ ] Extract presentation with explicit typed props. Keep mutation/query ownership in the route or a dedicated existing hook; do not copy mutations into both parent and child.
- [ ] Extract one section at a time and preserve actual Things/Chat/Members routing/tab semantics, selected IDs, keyboard behavior and list-role gates.
- [ ] Capture List ID, member identity, requested role and epoch at mutation dispatch. Check current ownership before late toast/selection/dialog changes.
- [ ] Member add/remove/role change has a synchronous pending guard for the same operation. Independent member operations need not serialize unless required by the API.
- [ ] Pending indicators name the affected operation; do not close or erase edits after failure. Do not allow owner-role removal through a capability the server does not support.
- [ ] Trace invitation contracts. Existing team-member add must await `rpcAddListMember` and report its real outcome. Invite-link copy must report clipboard failure rather than success.
- [ ] Remove the toast-only email send implementation. If an already-supported email-invite RPC exists, use and test it; otherwise remove the send form and retain working invitation methods with truthful copy. No new email backend in T11.
- [ ] Ensure dialogs have labels, description, focus return and disabled/pending states; preserve search on failed invite.
- [ ] Remove obsolete imports/duplicate markup after extraction. Do not chase a target route line count.

**Tests:** collaborator/view-only cannot manage members; authorized owner paths; failed add/remove/role/copy retains relevant state; duplicate clicks issue one operation; pending A completion after navigation to B cannot close B; email UI never claims unsent delivery.

## 8. T11-04 — Replace inline List chat with shared ListChatPanel

**Files:** List detail route, `ListChatPanel.tsx` only where a narrow explicit interface extension is required.

- [ ] Inventory existing inline features before removal: message search, pinned messages, reply/edit/delete, attachments, mentions, history, calls/meeting affordances and header actions. Map each to the shared panel or surrounding route.
- [ ] Mount the actual `ListChatPanel` with List UUID, real permission contract and layout props. The panel owns composer/feed state.
- [ ] Reuse its existing ref methods (`scrollToMessage`, `showMessageResult`) if the route needs search-result navigation. Add a small supported prop/slot only for a real missing integration requirement.
- [ ] Remove duplicate inline feed/composer and redundant message subscriptions/state. Retain query consumers still needed by a real route feature; do not delete calls/meetings as incidental cleanup.
- [ ] Mount policy should avoid hidden duplicate feeds. Tab unmount/remount must preserve drafts through the existing store; active sends/uploads must retain the accepted completion behavior.
- [ ] Preserve bounded history/search, error/retry, mention state, attachment ownership and scroll position rules from T04.
- [ ] Use the real backend permission contract for view-only users; do not assume view-only means no comments/chat if current rules explicitly allow them.
- [ ] One List shown in route and dock uses the registry's shared channel; unmounting one consumer must not disconnect the other.

**Tests:** text/attachment draft survives tab switch and route return; same List in dock+route yields one underlying channel; last consumer detaches; failed send preserves correct revision; search result jump; history failure/retry; List/account transition drops late UI effects.

## 9. T11-05 — Bucket references, source resolution and counts

**Files:** `fetch-bucket-items.ts`, `use-bucket-items.ts`, Bucket route/renderers; aggregate code only if tests reveal a count defect.

Suggested union, adapt to existing conventions:

```ts
type BucketReference =
  | { kind: 'thing'; thingId: string; availability: 'available'; thing: Thing }
  | { kind: 'thing'; thingId: string; availability: 'unavailable'; thing?: never }
  | { kind: 'list'; listId: string; availability: 'available'; list: ListRow }
  | { kind: 'list'; listId: string; availability: 'unavailable'; list?: never };
```

- [ ] Build output from authoritative bucket reference rows, then attach resolved source objects. Preserve original source IDs even when resolution returns no authorized row.
- [ ] Preserve a reference-row ID if available/needed; otherwise use kind+source UUID as stable identity. Do not use a title or array position.
- [ ] A failed source request is an error, not an unavailable record. Do not convert network failure into tombstones for every item.
- [ ] An absent source after a successful authorized query may show neutral unavailability. Reveal deleted/denied distinctions only when authorized evidence supports them.
- [ ] If foreign-key cascading already deletes the reference row, document that actual schema behavior; do not invent a deleted reference that the backend no longer stores or add durable tombstone schema without a demonstrated requirement.
- [ ] Apply the same shape in preview using authorized accessibility checks. Preserve intended personal-shred filtering separately; do not undo a deliberate hide operation.
- [ ] Unavailable cards retain a private reference removal action but no protected title, preview, avatar, source edit or Open command. Refetch/revocation must not fall back to stale initial detail.
- [ ] Treat Bucket-level denial as full protected-page loss, not a collection of unresolved source cards.
- [ ] Reuse existing bounded progress aggregates. Test a direct Thing also present through one/multiple Lists, cancelled sources, duplicate references and unavailable Lists.
- [ ] Count each accessible non-cancelled Thing once. If an aggregate query fails, show unavailable progress; do not display 0% as a fabricated successful result.
- [ ] Keep collection reference count distinct from progress denominator. Explain unavailable references without implying their hidden source contains zero Things.

**Tests:** missing Thing/List preserves reference identity; source network failure remains error; no leaked stale metadata after denial; preview parity; duplicated direct/list membership; cancelled exclusion; sorted numerator uses the same denominator set; aggregate-error state.

## 10. T11-06 — One reference command for buttons, keyboard and drag

**Files:** `use-bucket-items.ts`, `SpringLoadedBucketFlyout.tsx`, Bucket detail; new `bucket-reference-commands.ts` if appropriate.

- [ ] Create/reuse one scoped add/remove operation with explicit Bucket ID and exactly one Thing ID or List ID, captured before await.
- [ ] Validate drag payload kind/ID/shape. Invalid or stale payloads produce no mutation; source access remains enforced by the server.
- [ ] Route picker buttons, keyboard activation and drag/drop through the same pending/error/cache path. Remove direct duplicate RPC orchestration from flyout.
- [ ] Deduplicate per Bucket+source+operation across surfaces; do not serialize all independent references. Use token ownership so stale finally cannot release a newer operation.
- [ ] Reconcile bucket-items, bucket detail and aggregate/list-of-buckets caches after success, guarded by epoch. Preserve existing data or rollback only the owned optimistic change after failure.
- [ ] Disable/annotate pending action for that source; retry failures without accidentally adding a duplicate reference.
- [ ] Use truthful privacy and action copy from section 4. Removing reference never calls Thing/List deletion.
- [ ] Keep keyboard users able to perform every reference operation without drag. Maintain spring-open behavior and cleanup when drag ends/cancels.

**Tests:** drag/button use equivalent arguments and invalidations; same-operation double trigger dispatches once; independent sources proceed; malformed drag ignored; remove failure restores reference; old-account completion is inert.

## 11. T11-07 — Bucket inline detail, mobile sheet and note states

**Files:** Bucket detail route; existing workspace/sheet only if required for a safe shared contract; note editor integration.

- [ ] Wrap real source content as `children` of `InlineThingDetailWorkspace` for desktop. Inspect the `hasNavigator` branch: passing items and onSelectThing currently makes it full-screen. Use the existing two-pane branch or add a narrowly defined explicit layout mode with tests preserving existing callers.
- [ ] Replace the desktop `CourtDetailModal` path and remove its no-op full-view callback. Keep selected Thing by UUID and current authorized data.
- [ ] On mobile render the shared accessible sheet/dialog from the same selected ID. Only one detail tree owns drafts/media/actions at a time; CSS-hidden duplicate editors are unacceptable.
- [ ] Changing breakpoint while detail is open preserves intended selection/draft and does not duplicate queries/subscriptions. Test both desktop→mobile and mobile→desktop.
- [ ] Capture opener element when selecting. On Close/Escape restore focus if still connected; otherwise use the source heading or a deliberate fallback. Do not override intervening navigation/focus.
- [ ] Keyboard selection, nested menus and file viewers work. Escape consumed by an inner dialog/menu must not close the outer workspace too.
- [ ] Confirm current capabilities derive from the source Thing/List permissions, not Bucket ownership. Denial clears protected content; transient errors retain recoverable state according to T01.
- [ ] Preserve note editor's revision-safe save, new-ID draft migration, synchronous save guard, blank-clear confirmation, unsaved-close handling and epoch guards.
- [ ] Expose Saving, Saved and failed-save feedback from actual mutation results. If success closes the dialog, a truthful success notification is sufficient; do not add an unrelated autosave system.
- [ ] Note read failure includes Retry. A background failure should not masquerade as an empty notes collection or erase unsaved text.
- [ ] Preserve per-note/per-Bucket draft identity through reused route transitions. Remove misleading disabled/no-op UI introduced by old detail integration.

**Tests:** actual inline children layout; mobile detail reachable; focus return; nested Escape; breakpoint changes; selection removed/revoked; note failed save; edits during save; double Save; new note ID adoption; note read Retry.

## 12. Verification matrix and evidence

Use existing meaningful suites first: `list-things-filter.test.mjs`, `list-detail-seed.test.mjs`, `fetch-list-detail.test.mjs`, `list-chat-panel-new-messages.test.mjs`, `list-chat-channel-registry.test.mjs`, `fetch-bucket-items-*.test.mjs`, `fetch-buckets-progress-dedup*.test.mjs`, `bucket-progress-{sql,volume}.test.mjs`, `use-bucket-note-editor.test.mjs`, `bucket-note-editor-live-mutation.test.mjs`, `use-bucket-notes-error.test.mjs`, `inline-thing-detail-workspace.test.mjs`.

Add real component/QueryClient tests for ownership and integration. Source-string assertions alone cannot prove filter hydration, chat lifecycle or responsive reachability. Keep SQL execution tests for any changed aggregate/RPC behavior. Update extraction assertions to inspect the new components without dropping their original behavioral intent.

| Required scenario | Local evidence |
| --- | --- |
| Profile/List A→B→A, corrupt storage | Mounted component + storage assertions; no cross-key overwrite. |
| Duplicate names and long descriptions | UUID navigation assertions and browser layout. |
| Selected-but-filtered vs revoked | Correct distinct UI, no automatic item jump or protected fallback. |
| Member/invite failure and double click | Actual promise control; retained state; one dispatch; no fake delivery. |
| Shared chat route/dock | Registry subscription counts and draft restoration. |
| Bucket privacy/source permissions | Fixture capability/access tests; no privilege via reference. |
| Missing reference vs failed fetch | Preserved reference versus recoverable error. |
| Overlapping memberships/counts | Unique denominator/numerator and unchanged bounded request behavior. |
| Keyboard/drop parity | Same command effects; removal cannot delete source. |
| Desktop and mobile detail | Reachable in both, one editor instance, focus and breakpoint transitions. |
| Note read/save failure | Retry/retained edits and existing ownership regressions. |

Create `tests/e2e/preview/lists-buckets.spec.ts` (or equivalent focused specs) using deterministic local fixtures. Exercise Lists index/detail Things/Chat/Members and Buckets index/detail Things/Lists/Notes at 390×844, 768×1024, 1024×768, 1440×900 and 1920×1080. Include keyboard traversal, long content, reduced motion and 200% equivalent reflow. Save and inspect screenshots of open detail and note/error states, not only landing pages.

Do not skip mobile feature tests because an entry is absent; implement the required entry. Test non-applicable layout branches conditionally while asserting the applicable alternative on every viewport. Prevent preview mutations from reaching live endpoints.

```sh
npm run typecheck
npm run lint
npm test
npm run build:app
npx playwright test tests/e2e/preview/lists-buckets.spec.ts --project=preview-desktop --project=preview-mobile --project=preview-tablet-portrait --project=preview-tablet-landscape --project=preview-full-hd
git diff --check
git status --short
```

During development run affected suites; run the full gates after integration. Repeat checks affected by later fixes. Use the existing isolated Playwright server port; do not stop the user's dev server. Check ambient staging variables do not redirect a preview run or suppress its local server.

## 13. Efficient execution and closure

Recommended order: filters/selection → index semantics → List section extraction → shared chat → Bucket reference model → shared commands → responsive detail/notes → integrated verification. Keep patches focused; do not rewrite the entire List route at once.

If another agent edits shared files, inspect its current changes and preserve them. Do not restore/stash/reset files containing unknown work to obtain a baseline. No history rewriting. Commit reviewable groups consistent with the branch workflow; no push/deploy is required for local completion.

Write `docs/superpowers/plans/KATALIST_T11_FINAL_HANDOFF.md` with:

1. Each original T11 checkbox mapped to source paths, completed behavior and test evidence.
2. Actual tested commit/tree, gate results and browser artifact paths.
3. Any changed shared contract and caller compatibility evidence.
4. Any additive migration with its local execution result and separately stated deployment status.
5. Exact remaining external checks, if any, and any local failures. No generic “all green” while required cases are skipped or missing.

Update T11 in `KATALIST_A_TO_H_AUDIT_PROGRESS.md` and tick corresponding items in `KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md` only when evidence exists. T11 local closure requires all seven packages and the original eight requirements implemented and tested. Local closure does not itself certify deployed RLS or production behavior.

## 14. Copy-paste implementation prompt

```text
Complete Katalist T11 using:
docs/superpowers/plans/KATALIST_T11_DETAILED_EXECUTION_PLAN.md

Read the plan fully and inspect current HEAD, AGENTS.md and dirty files.
Implement T11-01 through T11-07 without approval pauses between packages.
Make routine implementation choices yourself and preserve unrelated work.

Fix filter hydration/selection ownership; native index navigation and dates;
extract List sections; replace inline chat with the shared ListChatPanel;
remove fabricated invite success; preserve unavailable Bucket references;
unify keyboard/drag commands and unique counts; implement real desktop inline
detail and reachable mobile sheet behavior while preserving note/draft fixes.

Reuse actual existing contracts. InlineThingDetailWorkspace requires children
and its navigator branch is currently full-screen, so inspect before wiring.
Do not infer deleted versus denied from an RLS-hidden row. Bucket ownership
does not grant source permissions. Keep preview writes isolated from live data.

Run meaningful targeted regressions while developing, then the full local
gates and five-viewport browser suite. Mobile coverage is mandatory; do not
skip a missing entry point or label local gaps release-only. Use build:app.
Do not deploy, run production migrations or add a new email delivery service.

Finish with focused commits, updated T11 ledger/master checklist and
KATALIST_T11_FINAL_HANDOFF.md mapping every requirement to evidence. Continue
until all authorized local work is complete; report only concrete remaining
external blockers after completing independent work. Do not expand into T09,
T10, T12 or unrelated redesigns.
```
