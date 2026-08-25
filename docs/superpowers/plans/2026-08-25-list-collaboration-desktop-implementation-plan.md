# List Collaboration Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver desktop List collaboration, Team-backed List invitations, and reliable many-to-many Thing Bucket references before applying any UAT migration or deploying Netlify.

**Architecture:** Keep security-sensitive transitions in reviewed Postgres RPCs or server routes. Add focused pure view-models for Board/Table behavior, and let React hooks render those contracts. Use existing React/native desktop drag events plus a keyboard Move menu; mobile visual work is a later phase.

**Tech Stack:** React 19, TanStack Router/Query, TypeScript, Supabase/Postgres/RLS/Storage, Tailwind CSS, Node test runner.

**Spec:** `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev/docs/superpowers/specs/2026-08-25-list-collaboration-board-design.md`

## Global Constraints

- Branch: `codex/list-collaboration-board`, based on `origin/codex/magic-box-v2` SHA `75d9d44`.
- Desktop code first; defer mobile visual implementation.
- Write each failing test and observe the intended failure before production code.
- Migration files may be written but not applied before all code checks pass.
- Keep UAT feature flags false in git; do not touch production or another project/site.
- Owner is `lists.owner_profile_id`; never insert an Owner `list_members` row.
- View-only can read, comment, and chat, but membership alone grants no workflow mutation.
- Direct Thing assignee capabilities override a restrictive List role for that Thing.
- A Thing can exist in multiple Buckets; deleting a Bucket never deletes the Thing.
- Never expose service-role keys, invite tokens, phone lists, or private Storage paths.
- No force-push, rebase, amend, or squash of pushed history.

---

### Task 1: Bucket reliability and Supabase error visibility

**Files:**
- Create: `scripts/list-bucket-reliability.test.mjs`
- Create: `src/features/buckets/thing-bucket-selection.ts`
- Modify: `src/lib/domain-error.ts`
- Modify: `src/features/things/ThingDetailSheet.tsx`
- Modify: `src/features/buckets/use-buckets.ts`
- Modify: `supabase/migrations/20260825102421_bucket_reference_idempotency.sql`

**Interfaces:** `selectedBucketIds(buckets, thingId): Set<string>`; idempotent existing `add_to_bucket(uuid,uuid,uuid)` signature.

- [ ] Write failing tests for plain Supabase error objects, multiple selected Buckets, duplicate Add, remove-one-keeps-another, and Bucket deletion preserving the Thing.
- [ ] Run `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/list-bucket-reliability.test.mjs`; expect missing helper/SQL failures.
- [ ] Implement the pure selection helper:

```ts
export function selectedBucketIds(buckets: BucketCard[], thingId: string) {
  return new Set(buckets.filter((bucket) => bucket.thingIds?.includes(thingId)).map((bucket) => bucket.id));
}
```

- [ ] Extend `domainErrorMessage` to safely read string `message`, `code`, `details`, and `hint` from a plain object before mapping user copy.
- [ ] Replace `currentBucket` remove-then-add UI with independent checkboxes: check calls `rpcAddToBucket`; uncheck calls `rpcRemoveFromBucket`; invalidate Buckets and Bucket items.
- [ ] In SQL, authorize first, select and return an exact existing `bucket_items` row before insert, and log private activity only for a new row.
- [ ] Run the targeted test plus `scripts/katalist-buckets.test.mjs`; expect PASS.
- [ ] Commit exact Task 1 files as `fix: make Thing Bucket references idempotent`.

### Task 2: Secure List/Team database contracts

**Files:**
- Create: `scripts/list-collaboration-sql.test.mjs`
- Modify: `supabase/migrations/20260825102422_list_collaboration_desktop.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:** Adds List description/private cover path; private Team requests/connections/List grants; `create_list_v2`, `update_list_metadata`, `list_list_roster`, connected-member mutations, and server-only invite mutations.

- [ ] Write a failing SQL contract test requiring private tables, constraints, fixed `search_path`, internal `auth.uid()` checks, role validation, atomic Team+List acceptance, execute revokes, and zero DML on `storage.buckets`/`storage.objects`.
- [ ] Run the new test; expect failure against the blank migration.
- [ ] Add `lists.description` with 500-character check and nullable private `cover_storage_path`.
- [ ] Add canonical undirected Team edges and hashed, expiring invitation rows in `katalist_priv`; grant no direct Data API access.
- [ ] Implement public authenticated roster/member/metadata RPCs and server-only invitation RPCs. Validate `collaborator|view_only`, forbid Owner membership, and make create/accept/revoke/double-click flows idempotent.
- [ ] Update Supabase TypeScript types with exact new columns, enums, arguments, and returns; do not widen domain enums to `string`.
- [ ] Run SQL, permissions, and identity security tests; expect PASS.
- [ ] Commit exact Task 2 files as `feat: add secure List collaboration contracts`.

### Task 3: Server-only invitation and cover routes

**Files:**
- Create: `src/features/lists/server/list-invitations.ts`
- Create: `src/features/lists/server/list-covers.ts`
- Create: `src/routes/api/lists/$listId/invitations.ts`
- Create: `src/routes/api/lists/$listId/cover.ts`
- Create: `src/routes/api/list-invitations/accept.ts`
- Create: `scripts/list-collaboration-server.test.mjs`

**Interfaces:** `normalizeIndianPhone(string): +91 phone`; secure invite create/accept; private cover upload/remove.

- [ ] Write failing tests for bearer verification, non-owner denial, invalid/self phone, token hashing, expiry/revoke/double accept, no raw-token persistence/logging, and cover MIME/magic-byte/5 MiB validation.
- [ ] Run the new server test; expect missing route/helper failures.
- [ ] Generate 32 random bytes server-side, store only SHA-256 hash, and return the raw token only in the new share URL.
- [ ] Verify bearer session before using service-role dependencies; caller-supplied profile IDs are ignored.
- [ ] Validate JPG/PNG/WebP bytes and upload to private `list-covers/<list-id>/<random-id>.<ext>` without a public URL; compensate failed staging/finalization.
- [ ] Gate every new route with server flag `LIST_COLLABORATION_ENABLED=true`; return 404 when false.
- [ ] Run the new server test; expect PASS.
- [ ] Commit exact Task 3 files as `feat: add secure List invite and cover APIs`.

### Task 4: Pure List Board model, timestamps, and permissions

**Files:**
- Create: `src/features/lists/list-board-model.ts`
- Create: `src/features/lists/list-permissions.ts`
- Create: `scripts/list-board-model.test.mjs`
- Modify: `src/domain/thing.ts`
- Modify: `src/domain/capabilities.ts`
- Modify: `src/features/lists/use-list-things.ts`
- Modify: `src/features/lists/map-list-rows.ts`

**Interfaces:**

```ts
export type ListScope = 'mine' | 'theirs';
export type ListStatusFilter = 'all' | 'due' | 'waiting' | 'progress' | 'completed';
export function deriveListBoard(input: {
  things: Thing[]; myActorId: string | null; scope: ListScope;
  status: ListStatusFilter; assigneeId: string | null; query: string; now: Date;
}): { now: Thing[]; next: Thing[]; later: Thing[]; flat: Thing[]; assignees: Person[] };
export function canDragListThing(thing: Thing, myActorId: string | null): boolean;
```

- [ ] Write failing tests for Mine/THEIRS, Waiting temporary lane, Caught Personal Pace, status+person filter composition, Completed terminal grouping, deterministic due/update ordering, drag eligibility, actual List source, timestamps, and View-only chat/direct-assignee behavior.
- [ ] Run the new model test; expect missing exports.
- [ ] Add `createdAt` to `Thing`, select/map `created_at`, and compose actual List name instead of `Standalone`.
- [ ] Implement the pure Board derivation and `canDragListThing`: current assignee + Caught + non-terminal only.
- [ ] Update List capabilities: Owner/Collaborator metadata/workflow; Owner administration; View-only Chat/comments only through membership.
- [ ] Run model, state, and permission tests; expect PASS.
- [ ] Commit exact Task 4 files as `feat: add List board domain model`.

### Task 5: Rich creation and People administration

**Files:**
- Create: `src/features/lists/list-types.ts`
- Create: `src/features/lists/use-list-roster.ts`
- Create: `src/features/lists/use-list-invitations.ts`
- Create: `src/features/team/use-team-directory.ts`
- Create: `src/features/lists/NewListDialog.tsx`
- Create: `src/features/lists/ListPeoplePanel.tsx`
- Create: `scripts/list-creation-people.test.mjs`
- Modify: `src/features/lists/use-lists.ts`
- Modify: `src/features/things/rpc.ts`
- Modify: `src/routes/lists.index.tsx`
- Modify: `src/routes/lists.$listId.tsx`

**Interfaces:** `rpcCreateListV2`; composed roster `{ owner, members, invitations }`; Team-only immediate add; phone invite creates pending grant.

- [ ] Write failing tests for two steps, required name, optional description/cover, creator Owner, accepted Team role staging, Skip, double-submit guard, preserved failed form, Owner-first roster, role/remove permissions, and pending-no-access.
- [ ] Run the new test; expect missing components/contracts.
- [ ] Implement stable query hooks and create/update/member RPC wrappers with complete relevant invalidation.
- [ ] Implement Details then People dialog. Role defaults Collaborator; Owner is displayed but never inserted into members; cover uploads only after List ID exists with Retry/Remove.
- [ ] Implement People panel: Active and Invited sections; Owner change/remove/share/revoke controls; Collaborator/View-only read roster only.
- [ ] Client Team search uses approved directory RPC only and never arbitrary phone lookup.
- [ ] Run creation/People plus permission tests; expect PASS.
- [ ] Commit exact Task 5 files as `feat: add List creation and People administration`.

### Task 6: Desktop Board, compact Table, drag, and Chat

**Files:**
- Create: `src/features/lists/ListHeader.tsx`
- Create: `src/features/lists/ListThingsToolbar.tsx`
- Create: `src/features/lists/ListThingsBoard.tsx`
- Create: `src/features/lists/ListThingCard.tsx`
- Create: `src/features/lists/ListThingsTable.tsx`
- Create: `src/features/lists/ListChatPanel.tsx`
- Create: `scripts/list-desktop-ui.test.mjs`
- Modify: `src/features/lists/use-list-messages.ts`
- Modify: `src/features/things/ThingDetailSheet.tsx`
- Modify: `src/routes/lists.$listId.tsx`

**Interfaces:** Board/Table consume one derived model; drag persists `rpcSetPersonalPace`; Chat message includes avatar/name/time/client status.

- [ ] Write failing tests for Board default, Mine/THEIRS, NOW/NEXT/LATER, avatar filters, six Table headers, assignee avatar, combined State, Due/Updated, removed repeated Owner/My Pace labels, optimistic rollback, keyboard Move menu, reduced motion, Chat avatar/name/time/date separator/pending/failure/Retry/View-only send, and Created/Last updated detail fields.
- [ ] Run the new UI test; expect missing components.
- [ ] Implement compact header and toolbar with accessible Mine/THEIRS, Board/Table, status/search, person avatar chips, and Clear.
- [ ] Implement stable cards, reserved drag placeholder, overlay, cache snapshot/rollback, polite live announcements, Retry, and keyboard Move menu. Same-lane drop is a no-op.
- [ ] Implement Table exactly as `Thing | Assignee | State | Due | Updated | Actions`; Pace sits inside Thing.
- [ ] Implement paginated Realtime Chat with optimistic client IDs, deduplicated echoes, avatar before name, timestamp beside name, date separators, and failed Retry.
- [ ] Add exact Created and Last updated fields to Thing Detail.
- [ ] Run UI, model, permission, and state tests; expect PASS.
- [ ] Commit exact Task 6 files as `feat: add desktop List board table and chat`.

### Task 7: Flags, notifications, full verification, and push

**Files:**
- Create: `src/features/lists/list-flags.ts`
- Create: `scripts/list-collaboration-integration.test.mjs`
- Modify: `src/features/notifications/notification-navigation.ts`
- Modify: `.env.example`
- Modify: `netlify.toml`
- Modify only Task 1-6 files when a verification failure proves they need correction.

- [ ] Write failing tests requiring exact client/server false-by-default flags, safe List notification deep links, no token/phone/path payloads, correct tabs, and complete query invalidation.
- [ ] Run the integration test; expect flag/notification failures.
- [ ] Implement exact flags `VITE_LIST_COLLABORATION_ENABLED` and `LIST_COLLABORATION_ENABLED`, both false in git.
- [ ] Add allowlisted relative List invite/accept/role/remove notification routes and relevant query invalidation.
- [ ] Run all `scripts/list-*.test.mjs` plus Bucket, permissions, state, notification, and identity security tests.
- [ ] Run full verification:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

- [ ] Review diff for secrets, client service role, direct Storage bucket DML, other-project targets, build-time migration, and true flags in git.
- [ ] Commit verification adjustments as `test: verify desktop List collaboration` only if files changed.
- [ ] Push normally with `git push -u origin codex/list-collaboration-board`; never force.

### Task 8: UAT migrations and Netlify only after Task 7 passes

**Files:** None.

- [ ] Confirm target `dyxqlgnbwtbxxdfoiqva`; read remote migration history; abort if pending is not exactly the reviewed expected set.
- [ ] Keep flags false and provision private `list-covers` through UAT Storage API/Dashboard: public false, 5 MiB, JPG/PNG/WebP.
- [ ] Apply `20260825102421_bucket_reference_idempotency.sql`, then `20260825102422_list_collaboration_desktop.sql` through Supabase CLI, never Netlify build.
- [ ] Run migration list, advisors, Storage tests, and Owner/Collaborator/View-only/Assignee/Pending/Stranger/anon authorization matrix. Abort on failure.
- [ ] On Netlify site `startling-frangollo-bcf845` only, set both List collaboration flags true and deploy the exact pushed SHA.
- [ ] Smoke desktop create, People/invite, Mine/THEIRS, filters, drag+refresh, Table, Chat, timestamps, multi-Bucket add/remove/duplicate, Bucket deletion preservation, notifications, and denials.
- [ ] On smoke failure, set both flags false and redeploy the same SHA; do not drop schema or Bucket.

## Deferred Mobile Phase

After desktop UAT sign-off, write a separate implementation plan for 320/390 px List cards, one-lane mobile Board, compact Table cards, touch filters, People actions, Chat keyboard behavior, and a touch-safe lane move alternative. Do not claim mobile sign-off in this phase.
