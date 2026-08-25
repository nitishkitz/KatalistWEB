# Desktop Workflow Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make List Table the default, restore correct Catch/actions on every Thing surface, add List membership administration, expose accepted Team contacts to Magic Box mentions, float one active-state Magic Box across authenticated pages, and remove misleading optional metadata copy.

**Architecture:** Separate current-actor identity from the Court Things request so capability checks cannot fail with an unrelated surface query. Keep List/Team authorization in reviewed Supabase RPCs, then compose focused React hooks and view models for membership, mentions, List Table, Court filters, and the global AppShell composer. Reuse the same Thing capability function and Magic Box controller everywhere.

**Tech Stack:** React 19, TanStack Router/Query, TypeScript, Supabase/Postgres/RLS, Tailwind CSS, Node test runner, Playwright, Netlify.

**Spec:** `docs/superpowers/specs/2026-08-25-desktop-workflow-repair-design.md`

## Global Constraints

- Start from `codex/list-collaboration-board` at or after SHA `d6fdc5c4eb8337c9771445b57ec1f92548d4e0ba`.
- Work in an isolated worktree; do not alter the user’s dirty `dev` workspace.
- Never rebase, amend, squash, or force-push published history.
- Write each failing test and observe the intended failure before production code.
- Preserve the rule: only the current assignee can Catch; Pace and Work Status unlock only after Catch.
- Preserve optional List description and private cover image creation.
- Preserve Board as an optional view; Table becomes the default.
- Do not perform a full mobile List redesign in this phase.
- Keep UAT feature flags fail-closed in git.
- Do not apply SQL or deploy Netlify until all code checks and migration review pass.
- UAT Supabase target is only `dyxqlgnbwtbxxdfoiqva`; UAT Netlify target is only `startling-frangollo-bcf845`.
- Never expose or print the service-role key, auth pepper, raw invitation token, phone hashes, or private Storage paths.

---

### Task 1: Decouple current actor identity and reproduce the locked-action bug

**Files:**
- Create: `src/features/people/use-current-actor.ts`
- Create: `scripts/current-actor-capability.test.mjs`
- Modify: `src/domain/query-keys.ts`
- Modify: `src/features/court/use-court.ts`
- Modify: `src/features/lists/use-list-things.ts`
- Modify: `src/features/things/CatchActionButton.tsx`
- Modify: `src/features/things/ThingDetailSheet.tsx`
- Modify: `src/components/katalist/ThingRow.tsx`
- Test: `scripts/katalist-catch.test.mjs`
- Test: `scripts/katalist-permissions.test.mjs`

**Interfaces:**
- Produces: `useCurrentActor(): { actorId: string | null; isLoading: boolean; error: unknown }`.
- Consumes: authenticated profile ID from `useSession`; preview actor ID from `currentDemoActorId()`.
- Preserves: `getThingCapabilities(thing, actorId)` as the single capability decision function.

- [ ] **Step 1: Add a failing regression proving actor identity is independent from Court data**

```js
test("Thing actions use the current actor even when the Court Things request fails", () => {
  const source = read("src/features/things/ThingDetailSheet.tsx");
  assert.match(source, /useCurrentActor/);
  assert.doesNotMatch(source, /useCourt\(\)/);
});

test("a self-assigned waiting Thing exposes Catch and blocks Pace until Catch", () => {
  const waiting = selfThing({ acknowledgement: "waiting_for_catch", personalPace: null });
  assert.equal(getThingCapabilities(waiting, waiting.assignee.id).canCatch, true);
  assert.equal(getThingCapabilities(waiting, waiting.assignee.id).canSetPace, false);
});
```

- [ ] **Step 2: Run the focused tests and confirm the new source assertion fails**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/current-actor-capability.test.mjs scripts/katalist-catch.test.mjs scripts/katalist-permissions.test.mjs
```

Expected: the new test fails because Thing Detail and Catch still call `useCourt()`.

- [ ] **Step 3: Add the canonical current-actor query key and hook**

```ts
// src/domain/query-keys.ts
currentActor: (profileId: string | undefined) => ["current-actor", profileId] as const,

// src/features/people/use-current-actor.ts
export function useCurrentActor() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const query = useQuery({
    queryKey: keys.currentActor(user?.id),
    enabled: Boolean(user) && !preview,
    queryFn: async () => {
      const { data, error } = await supabase.from("actors").select("id").eq("profile_id", user!.id).maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    staleTime: Infinity,
  });
  return preview
    ? { actorId: currentDemoActorId(), isLoading: false, error: null }
    : { actorId: query.data ?? null, isLoading: query.isLoading, error: query.error };
}
```

- [ ] **Step 4: Make `useCourt` fetch Things only and consume `useCurrentActor` separately**

Change `fetchCourt(context)` to return `Thing[]`. Partition with `currentActor.actorId`, but do not discard that actor ID if the Things query errors.

- [ ] **Step 5: Replace surface-specific actor lookups**

Use `useCurrentActor()` in `CatchActionButton`, `ThingDetailSheet`, `ThingRow`, and `useListThings`. Pass `actorId` into `getThingCapabilities`; never infer capability from profile display name or List role.

- [ ] **Step 6: Verify all four surfaces use the shared Catch component**

Extend `scripts/katalist-catch.test.mjs` to assert Court card, List Table/action sheet, Bucket-opened Thing Detail, and direct Thing Detail all import `CatchActionButton` or render the same shared action contract.

- [ ] **Step 7: Run the focused tests**

Expected: all current-actor, Catch, and permission tests pass.

- [ ] **Step 8: Commit the isolated fix**

```bash
git add src/domain/query-keys.ts src/features/people/use-current-actor.ts src/features/court/use-court.ts src/features/lists/use-list-things.ts src/features/things/CatchActionButton.tsx src/features/things/ThingDetailSheet.tsx src/components/katalist/ThingRow.tsx scripts/current-actor-capability.test.mjs scripts/katalist-catch.test.mjs scripts/katalist-permissions.test.mjs
git commit -m "fix: restore Thing actions across authenticated surfaces"
```

### Task 2: Make accepted Team connections assignable and manage pending List invitations

**Files:**
- Create with CLI: `supabase migration new team_mentions_and_list_invitation_management`
- Create: `scripts/team-mention-list-members.test.mjs`
- Modify: `src/integrations/supabase/types.ts`
- Modify: `src/features/lists/server/list-invitations.ts`
- Modify: `src/features/people/use-assignable.ts`
- Modify: `src/features/team/use-team-directory.ts`
- Modify: `src/routes/team.tsx`
- Test: `scripts/list-collaboration-sql.test.mjs`
- Test: `scripts/magic-box-ranking.test.mjs`

**Interfaces:**
- `list_assignable_people()` returns only accepted/self/otherwise-authorized actors as `{ actor_id, display_name, avatar_url }`.
- `list_pending_list_invitations(p_list_id uuid)` returns masked, Owner-authorized pending invitation metadata.
- `revoke_list_invitation(p_list_id uuid, p_invitation_id uuid)` returns `boolean` and is idempotent.
- The migration path is the exact file printed by the CLI command; record it before editing and use that same path for every SQL step.

- [ ] **Step 1: Create the migration through Supabase CLI and record its generated path**

```bash
npx supabase --version
npx supabase migration new team_mentions_and_list_invitation_management
```

Do not hand-create a timestamped filename.

- [ ] **Step 2: Add failing SQL/source tests**

Require the generated migration to:

```js
assert.match(sql, /katalist_priv\.team_connections/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.list_assignable_people\(\)/i);
assert.match(sql, /list_pending_list_invitations/);
assert.match(sql, /revoke_list_invitation/);
assert.match(sql, /SET search_path = 'pg_catalog','public','katalist_priv'/);
assert.match(sql, /REVOKE EXECUTE .* FROM PUBLIC, anon/i);
```

Also require `useAssignablePeople` to invalidate/refetch after Team acceptance and removal.

- [ ] **Step 3: Run the targeted tests and confirm failure against the empty migration**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/team-mention-list-members.test.mjs scripts/list-collaboration-sql.test.mjs scripts/magic-box-ranking.test.mjs
```

- [ ] **Step 4: Redefine assignable people with accepted Team edges**

The SQL union must include:

```sql
SELECT a.id AS actor_id
FROM katalist_priv.team_connections c
JOIN public.actors a
  ON a.profile_id = CASE
    WHEN c.profile_a_id = auth.uid() THEN c.profile_b_id
    ELSE c.profile_a_id
  END
WHERE auth.uid() IN (c.profile_a_id, c.profile_b_id)
  AND a.kind = 'user'
```

Keep self, accessible Thing actors, and accessible List actors. Return only actor ID, display name, and avatar. Check `auth.uid()` inside the SECURITY DEFINER function and revoke `PUBLIC`/`anon` execution.

- [ ] **Step 5: Add safe pending invitation metadata**

Add nullable `phone_last4` with a four-digit check for existing rows. Update the server-only create function to accept and store the last four digits. Add Owner-only list/revoke functions; never return `phone_hash` or `token_hash`.

- [ ] **Step 6: Update the server invitation call**

Pass `phone.slice(-4)` to the new server-only function signature. Continue hashing the full normalized phone and raw token server-side.

- [ ] **Step 7: Invalidate identity caches after Team state changes**

After accept/remove/invite acceptance, invalidate exactly:

```ts
await Promise.all([
  queryClient.invalidateQueries({ queryKey: ["team-directory"] }),
  queryClient.invalidateQueries({ queryKey: ["team-requests"] }),
  queryClient.invalidateQueries({ queryKey: ["assignable-people"] }),
  queryClient.invalidateQueries({ queryKey: ["profile-directory"] }),
]);
```

- [ ] **Step 8: Update generated Supabase types and run SQL security checks**

Add exact arguments/returns for the changed functions. Run the targeted tests and `npx supabase db lint --local` when a local database is available. No SQL is applied remotely in this task.

- [ ] **Step 9: Commit the migration and client contract**

```bash
git add supabase/migrations src/integrations/supabase/types.ts src/features/lists/server/list-invitations.ts src/features/people/use-assignable.ts src/features/team/use-team-directory.ts src/routes/team.tsx scripts/team-mention-list-members.test.mjs scripts/list-collaboration-sql.test.mjs scripts/magic-box-ranking.test.mjs
git commit -m "fix: expose accepted Team connections to assignment"
```

### Task 3: Add members from an existing List and preserve rich List creation

**Files:**
- Create: `src/features/lists/ListMemberPicker.tsx`
- Create: `src/features/lists/ListPeoplePanel.tsx`
- Create: `src/features/lists/use-list-invitations.ts`
- Modify: `src/features/lists/NewListDialog.tsx`
- Modify: `src/routes/lists.$listId.tsx`
- Modify: `src/features/things/rpc.ts`
- Modify: `scripts/list-creation-people.test.mjs`
- Test: `scripts/team-mention-list-members.test.mjs`

**Interfaces:**
- `ListMemberPicker` emits either `{ kind: "connected"; profileId; role }` or `{ kind: "phone"; phone; role }`.
- `useListInvitations(listId)` returns `{ invitations, create, revoke, isLoading, error }`.
- Existing `rpcAddConnectedListMember(listId, profileId, role)` remains the immediate-add path.

- [ ] **Step 1: Add failing UI contract tests**

Require:

```js
assert.match(panel, /Add member/);
assert.match(panel, /Collaborator/);
assert.match(panel, /View only/);
assert.match(panel, /useTeamDirectory/);
assert.match(panel, /useListInvitations/);
assert.match(newList, /Description \(optional\)/);
assert.match(newList, /Cover image \(optional\)/);
assert.match(newList, /Skip for now/);
```

Add behavior tests for Owner-only administration, connected immediate add, phone invite, role selection, masked pending row, copy/share, revoke, and preserved Owner row.

- [ ] **Step 2: Run tests and confirm the existing inline Members panel fails the Add-member contract**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/list-creation-people.test.mjs scripts/team-mention-list-members.test.mjs scripts/katalist-permissions.test.mjs
```

- [ ] **Step 3: Extract one reusable member picker**

The picker searches accepted Team connections, validates Indian numbers through the existing normalization contract, and requires role selection before submission. It must not perform arbitrary public phone-directory searches.

- [ ] **Step 4: Implement the Owner administration panel**

Render in this order:

1. Header with `Members & permissions` and `Add member`.
2. Owner row, fixed as Owner.
3. Active member rows with role select and Remove for Owner only.
4. Pending invitation rows with masked last four digits, role, expiry, Replace link, and Revoke. A raw link is shown/copyable only in the immediate create response; Replace link revokes the old invitation and creates a new token.

Collaborator/View-only users see the roster without administration controls.

- [ ] **Step 5: Wire immediate add and secure invite**

Connected selection calls `rpcAddConnectedListMember`. Phone selection calls `/api/lists/$listId/invitations`, stores the returned share URL only in memory, and refreshes the pending-invitation query.

- [ ] **Step 6: Preserve and strengthen `NewListDialog`**

Keep Name required, Description optional, Cover optional, creator Owner, Add people, and Skip. Change phone staging from `string[]` to:

```ts
type PendingPhone = { phone: string; role: "collaborator" | "view_only" };
```

so invited phone roles are not hardcoded to Collaborator.

- [ ] **Step 7: Verify failure behavior**

If member/invite/cover work fails after List creation, keep the created List ID and show Retry for the failed step; never create a second List on Retry. Preserve the chosen description, cover, members, and roles.

- [ ] **Step 8: Run focused tests and commit**

```bash
git add src/features/lists/ListMemberPicker.tsx src/features/lists/ListPeoplePanel.tsx src/features/lists/use-list-invitations.ts src/features/lists/NewListDialog.tsx 'src/routes/lists.$listId.tsx' src/features/things/rpc.ts scripts/list-creation-people.test.mjs scripts/team-mention-list-members.test.mjs
git commit -m "feat: add List member administration"
```

### Task 4: Make List Table default and simplify Pace/ownership presentation

**Files:**
- Modify: `src/routes/lists.$listId.tsx`
- Modify: `src/features/lists/ListThingsToolbar.tsx`
- Modify: `src/features/lists/ListThingsTable.tsx`
- Modify: `src/features/lists/list-board-model.ts`
- Modify: `scripts/list-board-model.test.mjs`
- Modify: `scripts/list-desktop-ui.test.mjs`

**Interfaces:**
- `deriveListView(input: { things: Thing[]; status: ListStatusFilter; assigneeId: string | null; query: string; now: Date }): { now: Thing[]; next: Thing[]; later: Thing[]; flat: Thing[]; assignees: Person[] }` consumes all authorized List Things and applies status, query, and assignee filters only.
- `effectivePace(thing)` returns `laneOf(thing)` and is displayed as the single Pace value.

- [ ] **Step 1: Rewrite tests first**

Require Table default, no Mine/THEIRS strings, seven exact headers, no lane label under Thing, and an empty Due cell when absent:

```js
assert.match(route, /useState<ListView>\("table"\)/);
assert.doesNotMatch(toolbar, /MINE|THEIRS/);
assert.deepEqual(headers, ["Thing", "Assignee", "State", "Pace", "Due", "Updated", "Actions"]);
```

- [ ] **Step 2: Run List model/UI tests and confirm they fail against Board default and scope controls**

- [ ] **Step 3: Remove ownership scope from the model**

Rename `deriveListBoard` to `deriveListView`. Delete `ListScope` and `scope` from filtering; keep `myActorId` only where Board drag authorization needs it. Build avatar filters from all visible List Things. Keep deterministic Due/Updated/title ordering.

- [ ] **Step 4: Make Table default without removing Board**

Initialize `view` as `"table"`. Keep the accessible Board/Table toggle. Do not persist a previous Board selection as the new default in this phase.

- [ ] **Step 5: Render the exact Table contract**

`Thing` contains title only. `Pace` renders `effectivePace(thing).toUpperCase()`. `Due` renders formatted content only when `dueAt` is non-null. `Actions` opens the existing Thing Detail sheet.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/list-board-model.test.mjs scripts/list-desktop-ui.test.mjs
git add 'src/routes/lists.$listId.tsx' src/features/lists/ListThingsToolbar.tsx src/features/lists/ListThingsTable.tsx src/features/lists/list-board-model.ts scripts/list-board-model.test.mjs scripts/list-desktop-ui.test.mjs
git commit -m "fix: make the List table the default view"
```

### Task 5: Add Court assignee-avatar filters and remove Owner/My Pace wording

**Files:**
- Modify: `src/features/court/court-view-model.ts`
- Modify: `src/features/court/CourtDesktop.tsx`
- Modify: `src/features/court/CourtThingCard.tsx`
- Modify: `src/components/katalist/ThingRow.tsx`
- Modify: `src/features/things/ThingDetailSheet.tsx`
- Modify: `scripts/court-view-model.test.mjs`
- Modify: `scripts/list-desktop-ui.test.mjs`

**Interfaces:**
- `CourtFilterState.assigneeId: string | null` filters by `thing.assignee.id`.
- `courtAssignees(lanes): Person[]` returns unique people sorted by display name.

- [ ] **Step 1: Add failing Court filter tests**

Cover unique avatar derivation, filter composition across all four Court groups, toggle-clear behavior, and zero `Owner importance`, `Owner Pace`, or `My Pace` copy in Court cards/toolbars.

- [ ] **Step 2: Run `scripts/court-view-model.test.mjs` and confirm the missing assignee filter failure**

- [ ] **Step 3: Extend the pure Court filter model**

Add `assigneeId` to defaults and return unique assignees from the unfiltered active input. Apply the assignee predicate alongside quick, Due, acknowledgement, Work Status, and search filters.

- [ ] **Step 4: Add avatar chips to the Court toolbar**

Render `PersonAvatar` buttons after quick filters. Use `aria-pressed`, `aria-label="Filter by <name>"`, a visible selected ring, and a Clear action that resets assignee plus detailed filters.

- [ ] **Step 5: Simplify Court pace copy**

Remove Importance/Pace sort choices and their Owner/My labels. Keep Due and Recently updated sorting. Remove both Owner/My pace columns from the generic Court table and remove per-card Owner/My pace labels; NOW/NEXT/LATER lanes remain the pace communication. Rename the editable `My Pace` control in Thing Detail to `Pace` without changing its capability rule.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-view-model.test.mjs scripts/list-desktop-ui.test.mjs scripts/katalist-catch.test.mjs
git add src/features/court/court-view-model.ts src/features/court/CourtDesktop.tsx src/features/court/CourtThingCard.tsx src/components/katalist/ThingRow.tsx src/features/things/ThingDetailSheet.tsx scripts/court-view-model.test.mjs scripts/list-desktop-ui.test.mjs
git commit -m "feat: add Court people filters and simplify pace copy"
```

### Task 6: Render one floating Magic Box across authenticated pages

**Files:**
- Create: `src/features/court/FloatingMagicBox.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/features/court/MagicBox.tsx`
- Modify: `src/features/court/magic-box/MagicBoxComposer.tsx`
- Modify: `src/features/court/magic-box/MentionAutocomplete.tsx`
- Modify: `src/features/court/CourtDesktop.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/lists.$listId.tsx`
- Create: `scripts/floating-magic-box.test.mjs`
- Test: `scripts/magic-box-contract.test.mjs`
- Test: `scripts/magic-box-voice.test.mjs`

**Interfaces:**
- `AppShell` adds optional `magicBoxContext?: { listId: string; listName: string; editable: boolean }`.
- `FloatingMagicBox` renders exactly one composer per AppShell.
- `MagicBoxComposer` derives `idle | engaged | busy | recovery` visual state without changing Toss semantics.

- [ ] **Step 1: Add failing source and state tests**

Require AppShell ownership, no route-level duplicate composer, list-scoped editable behavior, global fallback for View-only, active glow classes, reduced-motion handling, and upward mention placement.

- [ ] **Step 2: Run Magic Box tests and confirm AppShell does not yet own the composer**

- [ ] **Step 3: Add the floating shell**

Use a fixed container with safe bottom spacing, desktop sidebar offset, maximum width, and `z-40` so dialogs/sheets at `z-50` remain above it. Add matching bottom padding to AppShell content so the composer never covers the last controls.

- [ ] **Step 4: Move composer ownership to AppShell**

Remove direct Magic Box rendering from Court desktop/mobile and List body. Pass editable List context from `lists.$listId`; on View-only Lists pass `editable: false`, causing a global Toss without `listId`.

- [ ] **Step 5: Implement visual state, glow, and reduced motion**

```ts
const visualState = recovering
  ? "recovery"
  : pending || recording || transcribing || assistBusy || attachmentBusy
    ? "busy"
    : focused || draft.rawText.trim()
      ? "engaged"
      : "idle";
```

Idle has a normal border. Engaged has a static violet glow. Busy/recovery may pulse. Add `motion-reduce:animate-none` and keep the static glow.

- [ ] **Step 6: Make menus bottom-safe**

Add a floating placement prop so mention autocomplete uses `bottom-[calc(100%+4px)]` and chip popovers prefer `side="top"`. Verify keyboard/ARIA behavior is unchanged.

- [ ] **Step 7: Run focused tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/floating-magic-box.test.mjs scripts/magic-box-contract.test.mjs scripts/magic-box-voice.test.mjs scripts/magic-box-controller.test.mjs
git add src/features/court/FloatingMagicBox.tsx src/components/layout/AppShell.tsx src/features/court/MagicBox.tsx src/features/court/magic-box/MagicBoxComposer.tsx src/features/court/magic-box/MentionAutocomplete.tsx src/features/court/CourtDesktop.tsx src/routes/index.tsx 'src/routes/lists.$listId.tsx' scripts/floating-magic-box.test.mjs
git commit -m "feat: float Magic Box across authenticated pages"
```

### Task 7: Remove fake Standalone and absent-Due copy everywhere

**Files:**
- Modify: `src/features/things/map-thing-rows.ts`
- Modify: `src/features/things/local-state.ts`
- Modify: `src/features/things/ThingDetailSheet.tsx`
- Modify: `src/features/court/ThingCard.tsx`
- Modify: `src/features/court/CourtThingCard.tsx`
- Modify: `src/features/court/court-view-model.ts`
- Modify: `src/components/katalist/ThingRow.tsx`
- Modify: `src/routes/buckets.$bucketId.tsx`
- Modify: `scripts/katalist-state.test.mjs`
- Create: `scripts/optional-thing-metadata.test.mjs`

**Interfaces:**
- Missing List: `{ listId: null, listName: null }`.
- Missing Due: render no metadata node; filtering may still use a neutrally named `Without due date` option if retained.

- [ ] **Step 1: Add failing mapping and source tests**

```js
assert.equal(unlisted.listId, null);
assert.equal(unlisted.listName, null);
for (const source of userFacingThingSources) {
  assert.doesNotMatch(source, /Standalone|No due date/);
}
```

- [ ] **Step 2: Run state/metadata tests and confirm current mapper/UI failures**

- [ ] **Step 3: Stop fabricating missing List names**

Return `null` when `list_id` is null. Keep `"List"` only as a defensive fallback when a non-null authorized List ID exists but its display name cannot be resolved.

- [ ] **Step 4: Render optional metadata conditionally**

In Thing Detail, omit the Source section when no real List exists and omit the Due section when `dueAt` is null. Apply the same condition to Court cards, generic rows, and Bucket rows.

- [ ] **Step 5: Remove the phrase from formatting helpers**

Change `formatCourtDue` to return `null` for no Due and update callers to render only non-null results. If the detailed Due filter remains, label it `Without due date`, never `No due date`.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/optional-thing-metadata.test.mjs scripts/katalist-state.test.mjs scripts/court-view-model.test.mjs scripts/katalist-buckets.test.mjs
git add src/features/things/map-thing-rows.ts src/features/things/local-state.ts src/features/things/ThingDetailSheet.tsx src/features/court/ThingCard.tsx src/features/court/CourtThingCard.tsx src/features/court/court-view-model.ts src/components/katalist/ThingRow.tsx 'src/routes/buckets.$bucketId.tsx' scripts/katalist-state.test.mjs scripts/optional-thing-metadata.test.mjs
git commit -m "fix: hide absent List and Due metadata"
```

### Task 8: Integration tests for the complete desktop flow

**Files:**
- Create: `tests/e2e/desktop-workflow-repair.spec.ts`
- Modify: `playwright.config.ts` only if the existing web-server configuration cannot run this spec.
- Modify: Task 1-7 files only when a failing test proves a defect.

**Interfaces:** Uses the real application routes and existing preview fixtures first; live UAT validation remains a separate release gate.

- [ ] **Step 1: Add Playwright cases for List and optional metadata**

Test that List opens in Table, headers match exactly, Mine/THEIRS are absent, Pace is its own column, Board can still be selected, and missing List/Due copy is absent.

- [ ] **Step 2: Add self Toss → Catch → actions cases**

Toss to self, assert Catch appears, assert Pace/status are initially unavailable, Catch once, set Pace/status, open the same Thing from List and Bucket, and assert actions remain enabled after reload.

- [ ] **Step 3: Add floating Magic Box cases**

Visit Court, Lists, Team, and Bucket Detail; assert exactly one Magic Box on each. Focus/type to observe engaged glow; exercise a busy state; verify no animated pulse under reduced motion.

- [ ] **Step 4: Add members and mention cases**

As Owner, add an accepted Team connection as View only, change to Collaborator, remove, invite a phone with a chosen role, confirm pending masked row, and revoke. With an accepted Team fixture, type `@` and select that person.

- [ ] **Step 5: Run Playwright locally**

```bash
npx playwright test tests/e2e/desktop-workflow-repair.spec.ts --project=chromium
```

Expected: all cases pass against the real application, not a component-only harness.

- [ ] **Step 6: Run the complete repository verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: tests/typecheck/build/diff check pass; lint has no new errors. Record pre-existing warnings separately.

- [ ] **Step 7: Review security and scope**

Confirm no secret, raw token, full invited phone, service role, true production flag, Storage bucket DML, production project reference, or build-time migration was added.

- [ ] **Step 8: Commit verification changes and push normally**

```bash
git add tests/e2e/desktop-workflow-repair.spec.ts playwright.config.ts
git commit -m "test: verify repaired desktop workflows"
git push -u origin codex/list-collaboration-board
```

Skip the commit if verification changed no files. Never force-push.

### Task 9: Apply the reviewed migration to UAT and deploy the exact SHA

**Files:** None beyond the already reviewed migration and code commits.

- [ ] **Step 1: Confirm exact targets and remote history**

Verify Git HEAD, Supabase project ref `dyxqlgnbwtbxxdfoiqva`, and Netlify site `startling-frangollo-bcf845`. Read the remote migration list. Abort if unexpected local migrations are pending.

- [ ] **Step 2: Review current Supabase documentation and changelog**

Check the current Supabase changelog and official documentation for SECURITY DEFINER, function grants, RLS, and CLI migration behavior before applying.

- [ ] **Step 3: Apply only the reviewed generated migration to UAT**

Use Supabase CLI from the linked isolated worktree. Never run migration from Netlify build. Re-read remote history and confirm pending is empty.

- [ ] **Step 4: Run database security verification**

Run advisors/lint and an authorization matrix for anon, Stranger, View-only, Collaborator, Owner, pending invitee, accepted Team connection, and removed connection. Confirm anon cannot call invitation/member/identity functions and accepted Team is the only newly assignable group.

- [ ] **Step 5: Deploy the exact pushed SHA**

Deploy only after SQL succeeds. Do not deploy an uncommitted worktree or a different branch. Keep unrelated attachment/Coey flags unchanged.

- [ ] **Step 6: Perform live two-user UAT**

With two dedicated tester accounts:

1. Connect and accept in Team.
2. Confirm both Team directories show the connection.
3. Type `@` in Magic Box and assign a Thing.
4. Toss to self, Catch, update Pace/status, and refresh.
5. Open that Thing from Court, List, Bucket, and Detail.
6. Add the connected user to a List as View only, change to Collaborator, then remove.
7. Confirm View-only denials and Collaborator allowances.
8. Confirm Table default, avatar filters, floating Magic Box glow, optional description/cover creation, and absent metadata copy.

- [ ] **Step 7: Sign-off or rollback safely**

Do not label pilot-ready unless the live matrix passes. If the client release fails, redeploy the prior known-good SHA or disable the scoped feature flag when available; do not drop Team/List data or rewrite migration history.

## Deferred work

- Full  px List visual redesign, touch drag/move alterna320/390tives, and mobile-specific Members layout remain a separate phase.
- This plan does not change production, paid Sarvam behavior, Magic Box attachment flags, or unrelated notification infrastructure.
