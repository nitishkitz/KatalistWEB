# Collaboration Notifications and Court Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable collaboration notifications and nudges, List Chat/roster notification fan-out, hard List-scoped self/delegated Toss, persisted Bucket Pin/Unpin, `#List` Magic Box targeting, stable List Chat and filters, distinct List-state colors, clearer Court assignment tiles/people filters, and the approved animated Magic Box glow, then release the verified result to UAT Netlify.

**Architecture:** Keep collaboration events transactional in Postgres: domain RPCs emit recipient-owned `notifications` rows, the existing trigger fans those rows into the private Firebase outbox, and the existing Netlify drain delivers push. Add only one schema migration for notification emission, trusted paths, latest assigner projection, and Bucket pin persistence; keep the UI split into focused hooks/components for notification invalidation, Bucket state, List autocomplete, Chat layout, filters/status badges, Court relationships, and glow states.

**Tech Stack:** React 19, TypeScript 5.7, TanStack Router/Query, Supabase/Postgres/RLS/Realtime/Cron/Vault, Firebase Cloud Messaging, Tailwind CSS 4, Radix Select, Node test runner, Playwright, Vite, Netlify.

**Spec:** `docs/superpowers/specs/2026-08-25-collaboration-notifications-court-polish-design.md`

## Global Constraints

- Start from `codex/list-collaboration-board` at SHA `f22b7d2e13f9a4fdbb078f95781e92f23a0c1a63` or a forward descendant.
- Work only in `/private/tmp/KatalistWeb-list-collaboration-board`; do not modify the user's dirty `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev` workspace.
- Never rebase, amend, squash, force-push, or rewrite Lovable-published history.
- Write each failing test and observe the intended failure before production code.
- Preserve Team mutual-connection rules, List Owner/Collaborator/View-only authorization, Bucket reference-only semantics, and Catch-before-Pace/Status rules.
- Preserve UAT fixed OTP behavior; never expose or print auth pepper, service-role credentials, Firebase private keys, VAPID keys, invite tokens, token hashes, phone hashes, Vault secrets, or Cron secrets.
- Use `npx supabase migration new collaboration_notifications_bucket_pins` to create the migration; never invent the timestamp.
- Do not apply SQL until code tests, migration source tests, typecheck, lint, build, and diff checks pass.
- Apply SQL only to Supabase `dyxqlgnbwtbxxdfoiqva`; deploy only Netlify `startling-frangollo-bcf845`.
- Netlify builds must remain `vite build` only and must never run migrations.
- Keep Firebase push opt-in. In-app notifications must work without Firebase permission.
- Keep all notification navigation app-relative and allow only `/`, `/team`, `/lists/<uuid>`, and `/?thing=<uuid>`.
- Keep status text and icons; color must never be the only status signal.
- Preserve `prefers-reduced-motion` with no glow animation.
- Do not perform a general mobile redesign; shared controls must remain usable at 390 px.

## File map

### Database and generated contracts

- Create with Supabase CLI: one migration named `collaboration_notifications_bucket_pins`.
- Modify `src/integrations/supabase/types.ts`: add `buckets.pinned_at`, changed notification-claim result, and new RPC signatures.
- Create `scripts/collaboration-notifications-sql.test.mjs`: migration security, recipients, paths, pin ownership, and nudge fan-out contracts.
- Create `scripts/list-chat-notifications.test.mjs`: Owner/Collaborator/View-only message and roster recipient matrix.

### Notifications and nudges

- Modify `src/features/notifications/push-delivery.ts`: trusted explicit app paths.
- Modify `src/features/notifications/push-worker.server.ts`: send claimed explicit path.
- Modify `src/features/notifications/use-notifications.ts`: map payload path and stable unread refresh.
- Modify `src/features/notifications/NotificationPanel.tsx`: navigate to `/team` and trusted paths.
- Modify `src/features/realtime/use-realtime.ts`: invalidate both notification list and unread-count keys.
- Modify `src/routes/team.tsx`, `src/features/lists/ListPeoplePanel.tsx`, and `src/features/lists/use-list-invitations.ts`: refresh notifications after local mutations without using toasts as delivery.
- Create `scripts/collaboration-notifications-client.test.mjs` and extend `scripts/push-worker.test.mjs` and `scripts/notification-navigation.test.mjs`.

### Buckets

- Modify `src/features/buckets/use-buckets.ts`: read persisted `pinned_at`, expose pin mutation.
- Modify `src/features/things/rpc.ts`: add `rpcSetBucketPinned`.
- Modify `src/routes/buckets.index.tsx` and `src/routes/buckets.$bucketId.tsx`: real Pin/Unpin menus.
- Create `scripts/bucket-pinning.test.mjs`.

### Magic Box List targeting and glow

- Create `src/features/court/magic-box/list-token.ts`: find/replace/validate `#List` tokens.
- Create `src/features/court/magic-box/ListAutocomplete.tsx`: accessible List listbox.
- Modify `src/features/court/magic-box/types.ts`, `parser.ts`, `reducer.ts`, `payload.ts`, `keyboard.ts`, `useMagicBoxController.ts`, and `MagicBoxComposer.tsx`.
- Modify `src/styles.css`: named glow keyframes and reduced-motion override.
- Create `scripts/magic-box-list-token.test.mjs` and `scripts/magic-box-glow.test.mjs`; extend `tests/e2e/magic-box.spec.ts`.
- Create `scripts/list-scoped-toss.test.mjs`: current List UUID, self assignment, delegated assignment, View-only block, and refresh persistence contracts.

### List Detail

- Modify `src/features/lists/ListChatPanel.tsx`: bounded flex layout, scrollable messages, fixed composer.
- Modify `src/features/lists/ListThingsToolbar.tsx`: explicit Radix Status and Assignee selects.
- Modify `src/features/lists/list-board-model.ts`: complete status filter union.
- Modify `src/features/lists/ListThingsTable.tsx`: shared acknowledgement/work-status badges.
- Modify `src/components/katalist/AcknowledgementBadge.tsx`, `WorkStatusBadge.tsx`, and `src/styles.css`: semantic colors.
- Create `scripts/list-detail-collaboration-ux.test.mjs`.

### Court

- Modify `src/domain/thing.ts`: add `assignedBy: Person`.
- Modify `src/features/things/map-thing-rows.ts` and `src/features/lists/use-list-things.ts`: map latest assignment's `assigned_by_actor_id`.
- Modify `src/features/court/court-view-model.ts`: involved-person filtering.
- Modify `src/features/court/CourtDesktop.tsx` and `CourtThingCard.tsx`: avatar filters, relationship row, separate Catch action column.
- Create `scripts/court-assignment-visual.test.mjs`; extend `scripts/court-view-model.test.mjs`.

### Release

- Create `tests/e2e/collaboration-repair.spec.ts`: deterministic demo UI flows.
- Modify `docs/uat-runbook.md`: two-user notifications/nudges/push/pin/#List release matrix and rollback.
- Create `design-qa.md` during visual verification; it must end with `final result: passed` or release stops.

---

### Task 1: Freeze the failing contracts and create the migration shell

**Files:**
- Create with CLI: migration `collaboration_notifications_bucket_pins`
- Create: `scripts/collaboration-notifications-sql.test.mjs`
- Create: `scripts/collaboration-notifications-client.test.mjs`
- Create: `scripts/list-chat-notifications.test.mjs`
- Create: `scripts/bucket-pinning.test.mjs`
- Create: `scripts/magic-box-list-token.test.mjs`
- Create: `scripts/list-scoped-toss.test.mjs`
- Create: `scripts/list-detail-collaboration-ux.test.mjs`
- Create: `scripts/court-assignment-visual.test.mjs`
- Create: `scripts/magic-box-glow.test.mjs`

**Interfaces:**
- Produces: the exact CLI-generated migration path used by Tasks 2 and 3.
- Produces: failing tests for every reported regression before implementation starts.

- [ ] **Step 1: Confirm the branch and clean tracked baseline**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse @{upstream}
```

Expected: branch `codex/list-collaboration-board`; HEAD/upstream equal `f22b7d2e13f9a4fdbb078f95781e92f23a0c1a63`; only known generated directories are untracked.

- [ ] **Step 2: Discover the installed Supabase CLI before creating the migration**

Run:

```bash
npx supabase --version
npx supabase migration --help
npx supabase migration new collaboration_notifications_bucket_pins
```

Record the exact path printed by the final command. All later migration edits target only that file.

- [ ] **Step 3: Add the failing database contract**

The test must read the generated migration and assert all of these concrete signatures:

```js
assert.match(sql, /ALTER TABLE public\.buckets\s+ADD COLUMN IF NOT EXISTS pinned_at timestamptz/i);
assert.match(sql, /FUNCTION public\.set_bucket_pinned\(p_bucket_id uuid, p_pinned boolean\)/i);
assert.match(sql, /FUNCTION katalist_priv\.notify_profile/i);
assert.match(sql, /FUNCTION public\.request_team_connection/i);
assert.match(sql, /FUNCTION public\.accept_team_request/i);
assert.match(sql, /FUNCTION public\.accept_team_invitation_server/i);
assert.match(sql, /FUNCTION public\.create_list_invitation_server/i);
assert.match(sql, /FUNCTION public\.accept_list_invitation_server/i);
assert.match(sql, /FUNCTION public\.add_connected_list_member/i);
assert.match(sql, /FUNCTION public\.change_list_role/i);
assert.match(sql, /FUNCTION public\.remove_list_member/i);
assert.match(sql, /FUNCTION public\.claim_notification_deliveries/i);
assert.match(sql, /FUNCTION public\.notify_on_list_message/i);
assert.match(sql, /FUNCTION katalist_priv\.notify_list_participants/i);
assert.match(sql, /'\/team'/);
assert.match(sql, /'nudged'/);
assert.match(sql, /SET search_path (?:=|TO) 'pg_catalog','public','katalist_priv'/i);
assert.match(sql, /REVOKE (?:ALL|EXECUTE).* FROM PUBLIC, anon/i);
assert.doesNotMatch(sql, /GRANT .*notifications.* TO anon/i);
```

- [ ] **Step 4: Add failing UI/source contracts**

Require the current code to fail on:

```js
assert.doesNotMatch(bucketHook, /pinned:\s*i\s*<\s*2/);
assert.match(bucketHook, /pinned_at/);
assert.match(composer, /ListAutocomplete/);
assert.match(controller, /findActiveListToken/);
assert.match(controller, /options\.listId/);
assert.match(controller, /listId:\s*built\.listId/);
assert.match(chat, /flex-1.*overflow-y-auto/s);
assert.match(chat, /shrink-0/);
assert.match(toolbar, /SelectItem value="cancelled"/);
assert.match(table, /AcknowledgementBadge/);
assert.match(table, /WorkStatusBadge/);
assert.match(card, /assignedBy/);
assert.match(card, /Assigned by/);
assert.match(styles, /@keyframes magic-box-glow/);
assert.match(styles, /prefers-reduced-motion/);
```

- [ ] **Step 5: Run the new tests and observe failure**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/collaboration-notifications-sql.test.mjs scripts/collaboration-notifications-client.test.mjs scripts/list-chat-notifications.test.mjs scripts/bucket-pinning.test.mjs scripts/magic-box-list-token.test.mjs scripts/list-scoped-toss.test.mjs scripts/list-detail-collaboration-ux.test.mjs scripts/court-assignment-visual.test.mjs scripts/magic-box-glow.test.mjs
```

Expected: failures point to the empty migration, `pinned: i < 2`, missing `#List`, moving Chat composer, missing dropdown values, raw state text, missing assignment mapping, and missing named glow animation.

- [ ] **Step 6: Commit tests and the empty migration shell**

```bash
git add supabase/migrations scripts/collaboration-notifications-sql.test.mjs scripts/collaboration-notifications-client.test.mjs scripts/list-chat-notifications.test.mjs scripts/bucket-pinning.test.mjs scripts/magic-box-list-token.test.mjs scripts/list-scoped-toss.test.mjs scripts/list-detail-collaboration-ux.test.mjs scripts/court-assignment-visual.test.mjs scripts/magic-box-glow.test.mjs
git commit -m "test: capture collaboration repair regressions"
```

### Task 2: Emit persistent collaboration notifications transactionally

**Files:**
- Modify: CLI-generated migration from Task 1
- Modify: `src/integrations/supabase/types.ts`
- Test: `scripts/collaboration-notifications-sql.test.mjs`
- Test: `supabase/tests/database/firebase_push_outbox.test.sql`

**Interfaces:**
- Produces: `katalist_priv.notify_profile(p_profile_id uuid, p_kind text, p_title text, p_body text, p_actor_profile_id uuid, p_thing_id uuid, p_list_id uuid, p_path text, p_payload jsonb) returns uuid`.
- Produces: `katalist_priv.notify_list_participants(p_list_id uuid, p_excluded_profile_ids uuid[], p_kind text, p_title text, p_body text, p_actor_profile_id uuid, p_path text, p_payload jsonb) returns integer`.
- Produces: `claim_notification_deliveries(...)` rows with `path text` in addition to the existing fields.
- Consumes: existing `notifications_fanout_push` trigger; no direct write to the outbox from domain RPCs.

- [ ] **Step 1: Implement a private profile notification helper**

The helper must reject unsafe paths and skip self-notifications:

```sql
IF p_profile_id IS NULL OR p_profile_id = p_actor_profile_id THEN
  RETURN NULL;
END IF;
IF p_path <> '/'
   AND p_path <> '/team'
   AND p_path !~ '^/lists/[0-9a-f-]{36}$'
   AND p_path !~ '^/\?thing=[0-9a-f-]{36}$' THEN
  RAISE EXCEPTION 'unsafe notification path';
END IF;
INSERT INTO public.notifications(profile_id, kind, title, body, thing_id, list_id, payload)
VALUES (p_profile_id, p_kind, p_title, p_body, p_thing_id, p_list_id,
        coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('path', p_path))
RETURNING id INTO v_id;
```

Keep it in `katalist_priv`, fix `search_path`, revoke `PUBLIC`/`anon`/`authenticated`, and grant only `service_role` plus internal-owner execution as needed by the defining functions.

Add `notify_list_participants` as the only List fan-out helper. It selects the List Owner union active `list_members`, deduplicates by profile UUID, excludes every UUID supplied in `p_excluded_profile_ids`, calls `notify_profile` once per remaining profile, and returns the emitted count. It must never query pending invitations as active participants.

- [ ] **Step 2: Redefine Team request and acceptance functions**

Required recipients and paths:

| Mutation | Recipient | Kind | Path |
|---|---|---|---|
| `request_team_connection` | recipient | `team_request` | `/team` |
| `accept_team_request` | original sender | `team_request_accepted` | `/team` |
| `accept_team_invitation_server` | inviter | `team_invite_accepted` | `/team` |

Resolve display names inside the transaction for human copy. Use `INSERT ... ON CONFLICT` behavior already present, but do not emit duplicate notifications when an idempotent accept returns an already-accepted result.

- [ ] **Step 3: Redefine List invitation and membership functions**

Required recipients and paths:

| Mutation | Recipient | Kind | Path |
|---|---|---|---|
| registered-user `create_list_invitation_server` | invitee | `list_invite` | `/lists/<list_id>` |
| `accept_list_invitation_server` | inviter | `list_invite_accepted` | `/lists/<list_id>` |
| `add_connected_list_member` | added member | `list_member_added` | `/lists/<list_id>` |
| `change_list_role` | affected member | `list_role_changed` | `/lists/<list_id>` |
| `remove_list_member` | removed member | `list_member_removed` | `/team` |

Do not emit a registered-user notification when `invitee_profile_id` is null. Keep the share link as the only delivery mechanism for unregistered numbers.

After the direct recipient notification, fan out one `list_roster_changed` notification to existing participants with these exclusions:

| Mutation | Excluded from roster fan-out |
|---|---|
| `add_connected_list_member` | acting Owner and added profile |
| `accept_list_invitation_server` | accepting profile and inviter (the inviter already receives `list_invite_accepted`) |
| `change_list_role` | acting Owner and affected profile |
| `remove_list_member` | acting Owner and removed profile |

Use the same List path and include only safe payload fields: `change`, `profile_id`, and `role` when applicable.

- [ ] **Step 4: Redefine List Chat notification fan-out**

Replace `notify_on_list_message` in the same migration. For every inserted non-deleted message, call `notify_list_participants` with `ARRAY[NEW.author_profile_id]`, kind `list_message`, title `New message in <List name>`, body truncated to 180 characters, and `/lists/<list_id>`. The trigger must notify Owner, Collaborator, and View-only rows; deduplicate profiles; skip the author; and create no rows for a message insert that rolls back.

- [ ] **Step 5: Preserve and prove nudge notification fan-out**

Do not create a second nudge notification path. Keep `nudge_thing -> log_activity('nudged') -> thing_activity_notify -> notify_actor`. Redefine only if source inspection proves the UAT function differs. Add SQL assertions that `to_actor_id` is stored in activity metadata and that `notify_on_thing_activity` calls `notify_actor` for kind `nudged`.

- [ ] **Step 6: Add trusted path to the push claim result**

Extend `claim_notification_deliveries` to return:

```sql
coalesce(n.payload ->> 'path',
  case
    when n.thing_id is not null then '/?thing=' || n.thing_id::text
    when n.list_id is not null then '/lists/' || n.list_id::text
    else '/'
  end
)::text as path
```

Retain `FOR UPDATE SKIP LOCKED`, leases, retries, service-role-only execution, and private outbox tables.

- [ ] **Step 7: Update generated TypeScript contracts manually and consistently**

Add `pinned_at: string | null` to Bucket Row/Insert/Update types, `path: string` to `claim_notification_deliveries` returns, and `set_bucket_pinned` args/return. Do not change unrelated generated types.

- [ ] **Step 8: Run migration and List fan-out contract tests**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/collaboration-notifications-sql.test.mjs scripts/list-chat-notifications.test.mjs scripts/push-worker.test.mjs
git diff --check
```

Expected: all database source/security tests pass; no SQL was applied remotely.

- [ ] **Step 9: Commit database notification contracts**

```bash
git add supabase/migrations src/integrations/supabase/types.ts scripts/collaboration-notifications-sql.test.mjs scripts/list-chat-notifications.test.mjs supabase/tests/database/firebase_push_outbox.test.sql
git commit -m "fix: persist collaboration notifications"
```

### Task 3: Repair notification navigation, unread Realtime updates, and push paths

**Files:**
- Modify: `src/features/notifications/push-delivery.ts`
- Modify: `src/features/notifications/push-worker.server.ts`
- Modify: `src/features/notifications/use-notifications.ts`
- Modify: `src/features/notifications/NotificationPanel.tsx`
- Modify: `src/features/realtime/use-realtime.ts`
- Modify: `src/routes/team.tsx`
- Modify: `src/features/lists/ListPeoplePanel.tsx`
- Modify: `src/features/lists/use-list-invitations.ts`
- Modify: `scripts/push-worker.test.mjs`
- Modify: `scripts/notification-navigation.test.mjs`
- Test: `scripts/collaboration-notifications-client.test.mjs`
- Test: `scripts/list-chat-notifications.test.mjs`

**Interfaces:**
- `trustedNotificationPath(path)` accepts only `/`, `/team`, `/?thing=<uuid>`, and `/lists/<uuid>`.
- `ClaimedPushDelivery.path` is the server-selected path from Task 2.
- `mapNotificationRow` consumes `payload: { path?: unknown } | null` and returns a trusted path.

- [ ] **Step 1: Extend trusted navigation tests first**

Add exact expectations:

```js
assert.equal(trustedNotificationPath('/team'), '/team');
assert.equal(trustedNotificationPath('//evil.test'), '/');
assert.equal(trustedNotificationPath('https://evil.test'), '/');
assert.equal(trustedNotificationPath('/lists/not-a-uuid'), '/');
```

Require `mapNotificationRow` to prefer a valid `payload.path` over inferred Thing/List paths.

- [ ] **Step 2: Pass explicit path through the push worker**

Change the delivery type to include `path: string` and send:

```ts
path: trustedNotificationPath(delivery.path),
```

Keep title/body/kind as data payloads. Do not put secrets or raw invitation URLs into FCM data.

- [ ] **Step 3: Fix unread invalidation on every notification event**

Inside the `notifications` Realtime callback invalidate both prefixes:

```ts
void qc.invalidateQueries({ queryKey: ["notifications"] });
void qc.invalidateQueries({ queryKey: ["notifications-unread"] });
```

Do the same after nudge events. Do not require a page refresh or opening the Bell to fetch the unread count.

- [ ] **Step 4: Add `/team` notification navigation**

`NotificationPanel` must call `navigate({ to: "/team" })` for `/team`; preserve UUID-safe List and Thing navigation. Unsupported paths fall back to Court.

- [ ] **Step 5: Refresh notification queries after the current user's mutations**

After Team accept, List invite accept, direct add, role change, and remove, invalidate notification list/unread keys in addition to the existing domain caches. After sending List Chat, invalidate only the sender's messages/List caches locally; recipients receive Bell/unread invalidation from the inserted notification rows over Realtime. Keep every toast as local feedback only.

- [ ] **Step 6: Run focused notification tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/collaboration-notifications-client.test.mjs scripts/list-chat-notifications.test.mjs scripts/push-worker.test.mjs scripts/notification-navigation.test.mjs scripts/firebase-config.test.mjs
git add src/features/notifications src/features/realtime/use-realtime.ts src/routes/team.tsx src/features/lists/ListPeoplePanel.tsx src/features/lists/use-list-invitations.ts scripts/collaboration-notifications-client.test.mjs scripts/list-chat-notifications.test.mjs scripts/push-worker.test.mjs scripts/notification-navigation.test.mjs
git commit -m "fix: refresh and route collaboration notifications"
```

### Task 4: Persist Bucket Pin and Unpin

**Files:**
- Modify: migration from Task 1
- Modify: `src/integrations/supabase/types.ts`
- Modify: `src/features/things/rpc.ts`
- Modify: `src/features/buckets/use-buckets.ts`
- Modify: `src/routes/buckets.index.tsx`
- Modify: `src/routes/buckets.$bucketId.tsx`
- Test: `scripts/bucket-pinning.test.mjs`

**Interfaces:**
- `set_bucket_pinned(p_bucket_id uuid, p_pinned boolean) returns public.buckets`.
- `rpcSetBucketPinned(bucketId: string, pinned: boolean): Promise<Database['public']['Tables']['buckets']['Row']>`.
- `useBuckets()` returns `setPinned` mutation; `useBucket()` returns the same mutation for its Bucket.

- [ ] **Step 1: Add Bucket persistence SQL**

```sql
ALTER TABLE public.buckets
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
```

The RPC must require `auth.uid()`, update only `owner_profile_id = auth.uid()`, set `pinned_at = clock_timestamp()` for true and null for false, raise `Bucket not found` on zero rows, fix `search_path`, revoke `PUBLIC`/`anon`, and grant only `authenticated` and `service_role`.

- [ ] **Step 2: Remove positional pinning from live data**

Select `pinned_at` in both Bucket queries and map:

```ts
pinned: Boolean(b.pinned_at),
```

Delete `pinned: i < 2`. Keep preview fixtures explicitly pinned/unpinned.

- [ ] **Step 3: Add the shared mutation and cache invalidation**

On success invalidate `keys.buckets(user?.id, context)` and `keys.bucket(bucketId)`. Optimistic UI is optional; if used, restore the exact previous Query cache on error.

- [ ] **Step 4: Add card and detail actions**

The Bucket card ellipsis must open an actual menu containing `Pin` or `Unpin`. Bucket Detail settings must show the same action above Rename/Delete. Disable the action while pending and show `Bucket pinned.` or `Bucket unpinned.` only after RPC success.

- [ ] **Step 5: Verify sorting and empty pinned section**

Sort pinned Buckets by `pinned_at desc`, then unpinned by existing Recent/Name selection. Hide `Pinned Buckets` when none are pinned. New Bucket creation must land under All Buckets.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/bucket-pinning.test.mjs scripts/katalist-buckets.test.mjs scripts/list-bucket-reliability.test.mjs
git add supabase/migrations src/integrations/supabase/types.ts src/features/things/rpc.ts src/features/buckets/use-buckets.ts src/routes/buckets.index.tsx 'src/routes/buckets.$bucketId.tsx' scripts/bucket-pinning.test.mjs
git commit -m "feat: persist Bucket pinning"
```

### Task 5: Prove nudges from mutation through in-app and push outbox

**Files:**
- Modify: `scripts/katalist-freeze.test.mjs`
- Modify: `scripts/collaboration-notifications-sql.test.mjs`
- Modify: `src/routes/nudges.tsx`
- Modify: `src/features/nudges/use-nudges.ts`
- Modify: `docs/uat-runbook.md`

**Interfaces:**
- Consumes: existing `nudge_thing(uuid, nudge_reason, text)` and Task 2 notification trigger.
- Produces: UI refresh contract invalidating `nudges`, `nudge-history`, `thing`, `notifications`, and `notifications-unread` after success.

- [ ] **Step 1: Extend nudge behavior tests**

Cover Owner to assignee success, self-nudge rejection, stranger rejection, Sorted/Cancelled rejection, and second nudge inside 120 minutes rejection. Assert the activity metadata includes the target actor UUID and that notification kind is `nudged`.

- [ ] **Step 2: Fix client invalidation only if the test proves it missing**

After a successful nudge, invalidate:

```ts
await Promise.all([
  qc.invalidateQueries({ queryKey: ["nudges"] }),
  qc.invalidateQueries({ queryKey: ["nudge-history"] }),
  qc.invalidateQueries({ queryKey: ["thing"] }),
  qc.invalidateQueries({ queryKey: ["notifications"] }),
  qc.invalidateQueries({ queryKey: ["notifications-unread"] }),
]);
```

Keep failure messages from the RPC; never display success before the RPC resolves.

- [ ] **Step 3: Add the exact UAT two-user nudge proof**

The runbook must require: Owner creates/delegates Thing; assignee leaves it Waiting or Catches it; Owner nudges; recipient Bell increments without refresh; recipient opens deep link; registered push browser receives the notification; repeat nudge returns cooldown error; no duplicate row/outbox delivery exists.

- [ ] **Step 4: Run focused tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/katalist-freeze.test.mjs scripts/collaboration-notifications-sql.test.mjs
git add src/routes/nudges.tsx src/features/nudges/use-nudges.ts scripts/katalist-freeze.test.mjs scripts/collaboration-notifications-sql.test.mjs docs/uat-runbook.md
git commit -m "test: prove nudge notification delivery"
```

### Task 6: Add keyboard-accessible `#List` targeting to Magic Box

**Files:**
- Create: `src/features/court/magic-box/list-token.ts`
- Create: `src/features/court/magic-box/ListAutocomplete.tsx`
- Modify: `src/features/court/magic-box/types.ts`
- Modify: `src/features/court/magic-box/parser.ts`
- Modify: `src/features/court/magic-box/reducer.ts`
- Modify: `src/features/court/magic-box/payload.ts`
- Modify: `src/features/court/magic-box/keyboard.ts`
- Modify: `src/features/court/magic-box/useMagicBoxController.ts`
- Modify: `src/features/court/magic-box/MagicBoxComposer.tsx`
- Modify: `src/features/ai/protected-tokens.ts`
- Test: `scripts/magic-box-list-token.test.mjs`
- Test: `scripts/list-scoped-toss.test.mjs`
- Test: `tests/e2e/magic-box.spec.ts`

**Interfaces:**
- `ListTarget = { id: string; name: string; context: 'work' | 'home' }`.
- `findActiveListToken(text, caret): ListToken | null`.
- `replaceListToken(text, token, list): { text: string; caret: number; binding: ResolvedListBinding }`.
- Controller returns `listMenuOpen`, `rankedLists`, `activeListToken`, and `acceptList`.

- [ ] **Step 1: Implement pure token tests before code**

Cover empty `#`, prefix search, spaces after selected list name, binding invalidation after editing, `@Person #List` together, Escape, Arrow Up/Down wrapping, Tab/Enter acceptance, and unresolved List blocking Toss.

- [ ] **Step 2: Implement token parsing and binding**

Use an active raw token regex equivalent to `/#([^\s#]*)/g`. A selected binding may contain spaces because validity checks compare the exact `#${list.name}` slice by stored start/end. Add selected List spans to parser-protected spans so the token is removed from the Thing title just like a resolved person mention.

- [ ] **Step 3: Load only accessible Lists in the active context**

Reuse `useLists()`. Rank case-insensitive exact, prefix, then contains matches; tie-break by name and ID. When `options.listId` exists, do not open the List menu and keep the scoped List authoritative.

- [ ] **Step 4: Generalize keyboard handling without breaking `@`**

Replace `mentionMenuOpen` in keyboard context with `suggestionMenu: 'person' | 'list' | null`. Arrow/Tab/Enter/Escape act on the active menu. Enter must never Toss while either menu is open.

- [ ] **Step 5: Render accessible List suggestions**

`ListAutocomplete` uses `role="listbox"`; options use `role="option"`, stable IDs, selected state, List icon, name, and context. The input's `aria-controls`, `aria-expanded`, and `aria-activedescendant` must point to whichever menu is active.

- [ ] **Step 6: Build the final Toss payload**

Selected `#List` sets `listId/listName`; a List-scoped composer overrides it; no selection yields `listId = null`. An unresolved `#token` returns toss block reason `unresolved-list` and announces `Choose a List.`

- [ ] **Step 7: Prove List Detail Toss is hard-scoped to the open List**

Add tests around `useMagicBoxController({ listId, listName, surface: 'list' })` and `buildFinalCreateThingInput`:

```ts
expect(selfInput.listId).toBe(openListId);
expect(selfInput.assigneeActorId).toBeNull();
expect(delegatedInput.listId).toBe(openListId);
expect(delegatedInput.assigneeActorId).toBe(selectedPerson.id);
```

The live RPC call must pass `listId: built.listId` for both. A typed `#OtherList` cannot override `options.listId`. Owner/Collaborator success invalidates `keys.listThings(openListId)` and `keys.list(openListId)` so the row appears immediately. A View-only List passes `editable: false`, exposes no List-scoped Toss action, and never calls `create_thing`.

- [ ] **Step 8: Add deterministic browser coverage**

On a demo editable List, Toss plain text and assert the new row appears in that same List assigned to the current user. Then Toss `@Priya delegated item`, accept the mention, and assert the same List contains the new row with Priya as assignee. Reload after each creation and assert both rows remain scoped to the List. On a View-only fixture, assert the floating composer is global/non-editable for that List and cannot create a List Thing.

- [ ] **Step 9: Run parser/keyboard/scoped-Toss/E2E tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/magic-box-list-token.test.mjs scripts/list-scoped-toss.test.mjs scripts/magic-box-ranking.test.mjs scripts/magic-box-contract.test.mjs scripts/magic-box-controller.test.mjs
npx playwright test tests/e2e/magic-box.spec.ts --project=chromium
git add src/features/court/magic-box src/features/ai/protected-tokens.ts scripts/magic-box-list-token.test.mjs scripts/list-scoped-toss.test.mjs tests/e2e/magic-box.spec.ts
git commit -m "feat: target Lists with Magic Box hashtags"
```

### Task 7: Fix List Chat composer placement and explicit filter dropdowns

**Files:**
- Modify: `src/features/lists/ListChatPanel.tsx`
- Modify: `src/features/lists/use-list-messages.ts`
- Modify: `src/features/lists/ListThingsToolbar.tsx`
- Modify: `src/features/lists/list-board-model.ts`
- Modify: `src/routes/lists.$listId.tsx`
- Test: `scripts/list-detail-collaboration-ux.test.mjs`

**Interfaces:**
- `ListStatusFilter = 'all' | 'due' | 'waiting' | 'not_started' | 'progress' | 'sorted' | 'cancelled'`.
- `ListThingsToolbar` retains existing props but renders Radix `Select` controls.

- [ ] **Step 1: Add complete status-model tests**

Test each filter against explicit Things: overdue active, waiting, Not Started caught, Under Progress, Sorted, and Cancelled. `all` includes every authorized row; filters do not mutate roles or data.

- [ ] **Step 2: Make Chat a bounded flex panel**

Use this layout contract:

```tsx
<section className="flex h-[min(65vh,38rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
  <div className="shrink-0 border-b border-border p-4">...</div>
  <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">...</div>
  <form className="shrink-0 border-t border-border bg-card p-3">...</form>
</section>
```

Use a bottom sentinel and `useEffect` keyed by the last message ID to scroll only the message region. Do not use viewport `position: fixed`.

Add a three-profile source/database contract: message author gets no notification; Owner plus active Collaborator/View-only recipients each get exactly one `list_message` notification and one outbox row per active push subscription. Deleted/inaccessible/pending invitees get none.

- [ ] **Step 3: Replace status chips with a labeled Radix Select**

Render `Status` with visible `SelectItem`s for All, Due/Overdue, Waiting for Catch, Not Started, Under Progress, Sorted, Cancelled. Render `Assignee` with All people plus avatar/name options. Keep Search and Table/Board toggle.

- [ ] **Step 4: Keep member roles isolated**

Add source tests proving `ListThingsToolbar` does not import `rpcChangeListRole`, and `ListPeoplePanel` remains the only List screen component containing Collaborator/View-only role mutations.

- [ ] **Step 5: Run focused tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/list-detail-collaboration-ux.test.mjs scripts/list-board-model.test.mjs scripts/list-desktop-ui.test.mjs
git add src/features/lists/ListChatPanel.tsx src/features/lists/use-list-messages.ts src/features/lists/ListThingsToolbar.tsx src/features/lists/list-board-model.ts 'src/routes/lists.$listId.tsx' scripts/list-detail-collaboration-ux.test.mjs scripts/list-chat-notifications.test.mjs scripts/list-board-model.test.mjs scripts/list-desktop-ui.test.mjs
git commit -m "fix: stabilize List chat and filters"
```

### Task 8: Make List acknowledgement and work states glanceable

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/katalist/AcknowledgementBadge.tsx`
- Modify: `src/components/katalist/WorkStatusBadge.tsx`
- Modify: `src/features/lists/ListThingsTable.tsx`
- Modify: `src/features/things/ThingDetailSheet.tsx`
- Test: `scripts/list-detail-collaboration-ux.test.mjs`

**Interfaces:**
- `AcknowledgementBadge` always renders icon + label + semantic background.
- `WorkStatusBadge` always renders dot/icon + label + semantic background.

- [ ] **Step 1: Add distinct palette tokens in both root and existing dark-white theme blocks**

Use exact semantic pairs:

```css
--status-waiting: oklch(0.54 0.14 65);
--status-waiting-bg: oklch(0.97 0.04 85);
--status-caught: oklch(0.47 0.13 165);
--status-caught-bg: oklch(0.97 0.035 165);
--status-not-started: oklch(0.48 0.035 255);
--status-not-started-bg: oklch(0.96 0.01 255);
--status-progress: oklch(0.5 0.17 255);
--status-progress-bg: oklch(0.96 0.025 255);
--status-sorted: oklch(0.46 0.15 145);
--status-sorted-bg: oklch(0.97 0.03 145);
--status-cancelled: oklch(0.5 0.17 25);
--status-cancelled-bg: oklch(0.97 0.025 25);
```

Expose matching `--color-status-*` Tailwind tokens at the top of `src/styles.css`.

- [ ] **Step 2: Apply the shared badges in List Table**

Replace the raw two-line State text with:

```tsx
<div className="flex flex-col items-start gap-1">
  <AcknowledgementBadge value={thing.acknowledgement} />
  <WorkStatusBadge value={thing.workStatus} />
</div>
```

Use the same components in Thing Detail wherever the current status is summarized.

- [ ] **Step 3: Verify accessibility and contrast by rendered state**

Tests assert every label remains in the DOM, each status has a different semantic class, and no badge depends on color alone. Browser QA checks text remains readable at 100% and 200% zoom.

- [ ] **Step 4: Run tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/list-detail-collaboration-ux.test.mjs scripts/list-desktop-ui.test.mjs scripts/katalist-foundation.test.mjs
git add src/styles.css src/components/katalist/AcknowledgementBadge.tsx src/components/katalist/WorkStatusBadge.tsx src/features/lists/ListThingsTable.tsx src/features/things/ThingDetailSheet.tsx scripts/list-detail-collaboration-ux.test.mjs
git commit -m "fix: distinguish List Thing states at a glance"
```

### Task 9: Show the real assigner relationship and involved-person Court filters

**Files:**
- Modify: `src/domain/thing.ts`
- Modify: `src/features/things/map-thing-rows.ts`
- Modify: `src/features/lists/use-list-things.ts`
- Modify: `src/features/court/court-view-model.ts`
- Modify: `src/features/court/CourtDesktop.tsx`
- Modify: `src/features/court/CourtThingCard.tsx`
- Modify: relevant preview fixtures in `src/features/court/fixtures.ts` and `src/features/things/local-state.ts`
- Test: `scripts/court-assignment-visual.test.mjs`
- Test: `scripts/court-view-model.test.mjs`

**Interfaces:**
- `Thing.assignedBy: Person` is always populated.
- `courtPeople(lanes): Person[]` deduplicates creator, Owner, assignedBy, and assignee.
- `CourtFilterState.personId: string | null` replaces `assigneeId` and matches any involved role.

- [ ] **Step 1: Add current assignment to Thing queries**

Include `current_assignment_id` in `THING_COLUMNS`. After fetching Things, batch fetch:

```ts
supabase
  .from("thing_assignments")
  .select("id,assigned_by_actor_id")
  .in("id", currentAssignmentIds)
```

Resolve each `assigned_by_actor_id` through `resolveActorPeople`. Use Owner only as a defensive fallback when legacy data has a null/missing current assignment; never label Owner as the real assigner when an assignment row exists.

- [ ] **Step 2: Extend the domain model and preview data**

Add `assignedBy: Person` to every Thing factory/fixture. Self-toss uses the current actor. Delegated toss uses the actor performing the Toss. Reassign uses the actor performing reassignment.

- [ ] **Step 3: Replace assignee-only Court filters with involved-person filters**

The match predicate is:

```ts
const involved = [thing.creator.id, thing.owner.id, thing.assignedBy.id, thing.assignee.id];
if (filters.personId && !involved.includes(filters.personId)) return false;
```

Avatar order is current signed-in actor first when present, then alphabetical by display name/ID. Button labels use `Show Things involving <name>` and `aria-pressed`.

- [ ] **Step 4: Separate Catch from title content**

Replace the current absolute overlay and `pr-20` title compensation with a grid/flex card containing:

```tsx
<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
  <button className="min-w-0 text-left">title and metadata</button>
  <div className="flex shrink-0 items-center gap-1">Catch / star / more</div>
</div>
```

The title receives the full content-column width and Catch remains independently keyboard focusable.

- [ ] **Step 5: Render assigner-to-assignee relationship**

For delegated Things render `assignedBy avatar`, a Lucide `ArrowRight` icon, and `assignee avatar`; expose visible assigner name on focused density and a tooltip/accessible label in compact density. For self-assigned Things show one avatar and `Self-assigned`.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-assignment-visual.test.mjs scripts/court-view-model.test.mjs scripts/katalist-catch.test.mjs
git add src/domain/thing.ts src/features/things/map-thing-rows.ts src/features/lists/use-list-things.ts src/features/court src/features/things/local-state.ts scripts/court-assignment-visual.test.mjs scripts/court-view-model.test.mjs scripts/katalist-catch.test.mjs
git commit -m "fix: clarify Court assignments and Catch actions"
```

### Task 10: Implement the approved Magic Box glow and reduced motion

**Files:**
- Modify: `src/features/court/magic-box/MagicBoxComposer.tsx`
- Modify: `src/styles.css`
- Test: `scripts/magic-box-glow.test.mjs`
- Test: `tests/e2e/collaboration-repair.spec.ts`
- Create during QA: `design-qa.md`

**Interfaces:**
- Existing `data-magic-box-state` values remain `idle | engaged | busy | recovery`.
- CSS class `katalist-magic-box-frame` owns border/glow animation without adding layout elements.

- [ ] **Step 1: Add state-driven CSS animation**

Use border color and box-shadow only; do not copy the black background, watermark, or search icon from the reference. Define:

```css
@keyframes magic-box-glow {
  0%, 100% { border-color: color-mix(in oklab, white 72%, var(--primary)); box-shadow: 0 0 10px rgb(88 71 255 / 18%), 0 0 22px rgb(88 71 255 / 10%); }
  50% { border-color: white; box-shadow: 0 0 14px rgb(255 255 255 / 78%), 0 0 30px rgb(88 71 255 / 36%); }
}
```

Idle is static/faint. Engaged runs 2.4 seconds ease-in-out infinite. Busy runs 1.1 seconds. Recovery uses amber instead of violet. Do not animate transform, width, or position.

- [ ] **Step 2: Add reduced-motion behavior**

```css
@media (prefers-reduced-motion: reduce) {
  .katalist-magic-box-frame { animation: none !important; }
}
```

Keep a static visible focus ring and shadow for engaged/busy/recovery states.

- [ ] **Step 3: Verify all interaction states**

Playwright checks idle, focus, typed draft, `@` menu, `#` menu, voice/busy simulation, and reduced-motion. Assert the input and Toss button do not move between states by comparing their bounding boxes.

- [ ] **Step 4: Perform Product Design comparison QA**

Open the supplied glow reference and a local screenshot of the same focused Magic Box state. Compare border roundness, bloom width, white/violet balance, clipping, and content legibility. Write `design-qa.md`; fix all P0/P1/P2 issues until its final line is exactly:

```text
final result: passed
```

- [ ] **Step 5: Commit the visual treatment**

```bash
git add src/features/court/magic-box/MagicBoxComposer.tsx src/styles.css scripts/magic-box-glow.test.mjs tests/e2e/collaboration-repair.spec.ts design-qa.md
git commit -m "feat: animate the Magic Box focus glow"
```

### Task 11: Full local verification and review gate

**Files:**
- Modify only if a failing check identifies an in-scope defect.
- Review: all files changed by Tasks 1-10.

**Interfaces:**
- Produces: one forward-only release candidate SHA with no pending tracked changes.

- [ ] **Step 1: Run the complete unit/source suite**

```bash
npm test
```

Expected: every test passes; report exact passed/failed totals.

- [ ] **Step 2: Run static/build checks**

```bash
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: typecheck/build/diff pass; lint has zero errors and only explicitly identified pre-existing warnings.

- [ ] **Step 3: Run focused browser flows**

```bash
npx playwright test tests/e2e/magic-box.spec.ts tests/e2e/collaboration-repair.spec.ts --project=chromium
```

Required assertions: `#List` menu and selection, `@` plus `#`, List-scoped self/delegated Toss remains in the open List after reload, Chat composer remains fixed as messages append, every filter option is visible/selectable, states are distinct, Catch does not overlap title, assignment arrow is correct, avatar filter toggles, Bucket Pin/Unpin persists after reload, Magic Box glow/reduced motion do not move layout.

- [ ] **Step 4: Inspect the final diff and security boundaries**

Confirm no client file contains `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_PRIVATE_KEY`, `PUSH_DRAIN_SECRET`, raw invite token/hash, or UAT auth pepper. Confirm the migration grants no new notification/Bucket access to `anon` and no unrestricted SECURITY DEFINER function remains executable by `PUBLIC`.

- [ ] **Step 5: Push forward normally**

```bash
git status --short
git push origin codex/list-collaboration-board
git rev-parse HEAD
git rev-parse origin/codex/list-collaboration-board
```

Expected: local and origin SHAs match; no force option is used.

### Task 12: Apply the exact migration to UAT and verify database behavior

**Files:**
- Read: `docs/uat-runbook.md`
- Apply: only the CLI-generated migration from Task 1

**Interfaces:**
- Consumes: the pushed release candidate SHA from Task 11.
- Produces: UAT migration history with no pending local migrations.

- [ ] **Step 1: Verify target and pending list before mutation**

Use the Supabase CLI help-discovered commands and private access token/database password. Confirm project ref `dyxqlgnbwtbxxdfoiqva`. Abort if pending is not exactly the one collaboration repair migration.

- [ ] **Step 2: Apply using `supabase db push` outside Netlify**

Apply only to UAT. Do not use Dashboard paste, Netlify build, production, or another project.

- [ ] **Step 3: Run advisors and authz probes**

Verify:

- anon cannot read/update Buckets or notifications and cannot call pin/notification/push RPCs;
- authenticated user can pin only their Bucket;
- Team request creates one recipient notification;
- request acceptance creates one sender notification;
- registered List invite/direct add/role change/remove produce the correct recipient/path;
- List Chat notifies Owner plus every active Collaborator/View-only member except the author, exactly once per recipient;
- direct add/accept/role change/remove notify the affected profile and fan out one roster-change event to the remaining participants using the exclusion matrix from Task 2;
- unregistered invite creates no recipient notification row;
- nudge creates one notification and one delivery per active subscription;
- invalid notification paths are rejected;
- migration history has no pending entry.

- [ ] **Step 4: Verify Realtime publication without modifying the locked `realtime` schema**

Confirm `public.notifications` remains in `supabase_realtime`. Do not create/alter/drop objects in the locked `realtime` schema; current Supabase changes prohibit those modifications. Keep Postgres Changes for this bounded repair rather than introducing a Broadcast migration.

### Task 13: Verify push infrastructure, deploy Netlify UAT, and run live sign-off

**Files:**
- Modify: `docs/uat-runbook.md` with observed deploy IDs/results only.

**Interfaces:**
- Target: Netlify site `startling-frangollo-bcf845` only.
- Rollback: redeploy the previous known-good SHA; schema remains forward-compatible and is not destructively rolled back.

- [ ] **Step 1: Read Netlify environment names without printing values**

Confirm UAT has all client names `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY`; and server names `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `PUSH_DRAIN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. Missing values block push sign-off.

- [ ] **Step 2: Verify Supabase Cron/Vault and drain endpoint**

Confirm one active `katalist-push-drain` job scheduled every minute, Vault URL points to `https://startling-frangollo-bcf845.netlify.app/api/internal/notifications/drain`, and its bearer secret corresponds to Netlify `PUSH_DRAIN_SECRET` without exposing either. Because current Supabase no longer permits direct `cron.job` updates, use `cron.schedule`/`cron.unschedule` or the Dashboard integration if repair is required.

- [ ] **Step 3: Deploy the exact pushed SHA**

Deploy `origin/codex/list-collaboration-board` to Netlify UAT. Record deploy ID, commit SHA, bundle names, and publish time. Verify live `/auth`, `/team`, `/buckets`, `/lists/<accessible-id>`, and the authenticated Court load the new bundle.

- [ ] **Step 4: Run the two-user live matrix**

With dedicated UAT Owner, Collaborator, and View-only accounts:

1. Team request: recipient gets Bell/unread and browser push; `/team` deep link opens.
2. Team accept: sender gets Bell/unread and browser push.
3. List registered invite and accept: inviter and existing participants receive exactly their specified events and List deep links; acceptor receives no self-notification.
4. Direct member add, role change, remove: affected member receives exactly one direct notification and remaining participants receive one roster-change notification each; acting Owner receives no self-notification.
5. List Chat: Owner sends a message and Collaborator/View-only each receive one Bell/unread plus push; sender receives none. Collaborator replies and Owner/View-only each receive one. Deep links open the correct List.
6. List-scoped Toss: from the List Detail Magic Box, plain text creates a self-assigned Thing with that `list_id`; `@Collaborator` creates a delegated Thing with the same `list_id`; both appear immediately and remain after hard refresh.
7. Nudge: recipient receives Bell/unread and push; second nudge is blocked by cooldown.
8. Bucket: new Bucket starts unpinned; Pin/Unpin persists after hard refresh.
9. Global Magic Box: `#` lists accessible Lists; `@Person #List` Toss lands in the selected List.
10. List Chat layout: composer stays fixed while messages append above it.
11. List filters: dropdown options work and never mutate member roles.
12. List states: Waiting, Caught, Not Started, Under Progress, Sorted, Cancelled are distinguishable by text/icon/color.
13. Court: Catch never overlaps title; delegated Thing shows actual assigner arrow; top avatar filter applies across lanes.
14. Magic Box: glow matches the approved treatment and reduced-motion stays static.

- [ ] **Step 5: Declare the result honestly**

Report `READY FOR UAT/PILOT` only if database, in-app, push, navigation, and UI matrix pass. If in-app works but push cannot be proven, report `NOT READY FOR PUSH SIGN-OFF`, include the failing layer (subscription, outbox, Cron, Firebase send, service worker, or permission), and leave tester data and unrelated environments untouched.

## Current Supabase references

- Changelog: `https://supabase.com/changelog` — July 2026 locks the `realtime` schema; November change requires Cron functions rather than direct `cron.job` updates.
- Realtime Postgres Changes: `https://supabase.com/docs/guides/realtime/postgres-changes` — current bounded implementation remains valid when the table is in the publication and RLS allows the recipient row.
- Realtime authorization: `https://supabase.com/docs/guides/realtime/authorization` — Postgres Changes respect RLS.
- Cron: `https://supabase.com/docs/guides/cron` and `https://supabase.com/docs/guides/functions/schedule-functions` — use Cron/Vault/HTTP scheduling patterns and do not print secrets.
