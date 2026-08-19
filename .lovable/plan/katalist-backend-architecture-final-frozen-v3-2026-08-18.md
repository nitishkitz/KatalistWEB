# Katalist Backend Architecture — FINAL FROZEN (v3)

Backend only. No frontend work. BRD v2.1 authoritative. No migrations run until you say go.

> Pre-flight note: `@supabase/supabase-js` is missing from `package.json` while `src/integrations/supabase/*` already exists, so typecheck currently fails. Installing it is the first action of Phase 1 (build mode), not a schema change.

---

## A. Final table list

**Identity**
| Table | Responsibility |
|---|---|
| `profiles` | Registered user domain record (id = auth.users.id). phone_e164, display_name, avatar_url, active_context, timezone |
| `external_identities` | Non-Katalist people. phone_e164, email, display_name, claimed_profile_id, claimed_at |
| `actors` | One permanent participant id for both kinds. Never re-created on claim |
| `contacts` | Per-user address book for @resolution |

**Work**
| Table | Responsibility |
|---|---|
| `things` | The single canonical Thing row |
| `thing_assignments` | Append-only handoff history |
| `thing_activity` | Immutable **shared-visible** audit trail |
| `thing_comments` | Thing conversation |
| `thing_attachments` | Metadata for Storage objects |

**Lists**
| Table | Responsibility |
|---|---|
| `lists` | name, `owner_profile_id` (sole owner source, immutable), `context` NOT NULL, archived_at |
| `list_members` | collaborator / view_only only — never owner |
| `list_messages` | List Chat |

**Private / personal**
| Table | Responsibility |
|---|---|
| `buckets` | Private grouping owned by one profile |
| `bucket_items` | thing_id XOR list_id reference rows |
| `private_activity` | Owner-private audit (bucket add/remove, shred, restore, doorman) |
| `profile_object_state` | Per-user personal shred/restore visibility state |
| `doorman_state` | Private breakthrough interaction state |

**Nudges**
`nudge_policies` (config thresholds) · `nudges` (history) · `nudge_state` (derived per-Thing follow-up state)

**Bridge**
`bridge_grants` · `bridge_sessions`

**System**
`notification_events` (outbox) · `notification_deliveries` · `channel_entitlements` · `app_config`

**Enums**
`context_kind` · `importance` · `pace` · `acknowledgement_state` · `work_status` · `list_role` (collaborator, view_only) · `actor_kind` · `nudge_reason` · `activity_event` · `private_activity_event` (bucket_ref_added, bucket_ref_removed, shredded, restored, breakthrough_snoozed, breakthrough_dismissed) · `notification_channel` · `delivery_status` · `object_type`.

**Key `things` columns**
`id, title, notes, creator_actor_id, owner_actor_id, current_assignee_actor_id, current_assignment_id, list_id, context, owner_importance, assignee_personal_pace, acknowledgement, work_status, caught_at, due_at, due_has_time, sorted_at, cancelled_at, created_at, updated_at`. No `deleted_at`.

**`doorman_state`**: `profile_id, thing_id, breakthrough_reason, last_presented_at, snoozed_until, dismissed_at, created_at, updated_at`, UNIQUE(profile_id, thing_id). Private; never touches the Thing.

---

## B. Final constraints and invariants

**Actors (revised per correction 1)**
```
CHECK (
  (kind = 'external' AND profile_id IS NULL     AND external_identity_id IS NOT NULL) OR
  (kind = 'user'     AND profile_id IS NOT NULL)   -- external_identity_id may stay populated
)
UNIQUE (profile_id)              -- partial, WHERE profile_id IS NOT NULL
UNIQUE (external_identity_id)    -- partial, WHERE external_identity_id IS NOT NULL
```
`actors.id` is permanent. A claim flips `kind` to `user` and sets `profile_id`, retaining `external_identity_id` as provenance. Trigger blocks any change of `actors.id`, any un-set of `external_identity_id`, and any re-point of `profile_id` once set.

**Immutability (correction 8)** — enforced by BEFORE UPDATE triggers that raise:
- `things.creator_actor_id` immutable
- `things.owner_actor_id` immutable after insert
- `lists.owner_profile_id` immutable after insert
- `things.created_at`, `thing_activity` and `thing_assignments` rows immutable (no UPDATE/DELETE)

**Things (row-local CHECKs only)**
- terminal state ⇒ matching timestamp (`sorted_at` / `cancelled_at`)
- `acknowledgement = 'waiting_for_catch'` ⇒ `assignee_personal_pace IS NULL`
- `context NOT NULL`, `owner_importance NOT NULL DEFAULT 'next'`
- **No cross-table CHECK.** "external assignee ⇒ pace NULL" is enforced in `validate_thing_transition` and the RPCs.

**Pace determinism (correction 5)** — trigger-enforced:
| State | pace |
|---|---|
| waiting_for_catch | NULL |
| caught, user assignee | selected value, else `next` (never NULL) |
| any external/Bridge assignee | NULL |

**Lists** — `context` NOT NULL (work|home); `list_members.role IN (collaborator, view_only)`; UNIQUE(list_id, profile_id); a member row for `lists.owner_profile_id` is rejected by trigger.

**Bucket items** — `num_nonnulls(thing_id, list_id) = 1`; UNIQUE per bucket per object.

**profile_object_state** — UNIQUE(profile_id, object_type, object_id); **no client GRANTs for INSERT/UPDATE/DELETE** (RPC-only).

**Bridge grants** — UNIQUE token_hash; `assignment_id` NOT NULL; expiry/revocation validated in functions, not CHECKs.

**Others** — `notification_events.dedupe_key` UNIQUE; `external_identities.phone_e164` and `.email` UNIQUE.

**Lifecycle invariants (trigger `validate_thing_transition`)**
1. Terminal (`sorted`, `cancelled`) is absorbing: no status change, catch, reassign, pace, importance, due edit, or nudge.
2. Only the current Assignee may Catch.
3. Execution transitions `not_started → under_progress → sorted` only by the **current Assignee**, only after Caught. Owner has no execution authority unless Owner == Assignee.
4. Only the Thing Owner may Cancel.
5. Reassignment preserves creator, owner, importance, due, context, list; resets acknowledgement to waiting_for_catch; clears pace; appends a `thing_assignments` row; **atomically revokes Bridge grants/sessions tied to the superseded assignment**.
6. Self-assigned creation (creator == owner == assignee): `acknowledgement = caught`, `caught_at = created_at`, `work_status = not_started`, pace = selected or `next`, importance = selected or `next` (independent).
7. Assignment to another person: `waiting_for_catch`, pace NULL.

---

## C. Final RLS matrix

Helpers live in private schema `katalist_priv` (not exposed to PostgREST), all `SECURITY DEFINER`, `SET search_path = pg_catalog, public, katalist_priv`, schema-qualified relations, `REVOKE EXECUTE FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated` (+ `service_role` only where a worker needs it), with internal authorization checks: `current_actor_id()`, `can_view_thing()`, `is_thing_owner()`, `is_current_assignee()`, `is_list_member(list_id, roles[])`, `is_list_owner(list_id)`, `bridge_thing_id()`, `bridge_can_write()`.

**Thing visibility derives ONLY from:** Thing Owner · **current** Assignee · current member of the Thing's List (incl. List Owner via `lists.owner_profile_id`) · a valid non-revoked Bridge grant/session for that Thing.
**Not** from Creator. **Not** from past assignment (correction 3) — historical rows persist but grant nothing.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| things | `can_view_thing()` | RPC only (`create_thing`) | RPC only | none |
| thing_assignments | thing viewers | trigger/RPC only | never | never |
| thing_activity | thing viewers | trigger/RPC only | never | never |
| thing_comments | thing viewers (incl. view_only, bridge) | thing viewers | own body only | soft-delete own |
| thing_attachments | thing viewers | owner/assignee/collaborator | none | uploader or thing owner |
| lists | members or owner | **RPC only (`create_list`)** | owner (name/archive only) | owner (archive) |
| list_members | members of that list | list owner only | list owner | list owner or self-leave |
| list_messages | members or owner | collaborator/owner | own | own |
| buckets, bucket_items | owner only | owner only (+ referenced object must be visible) | owner | owner |
| private_activity | owner only | RPC only | never | never |
| profile_object_state | self SELECT only | **RPC only** | **RPC only** | **RPC only** |
| doorman_state | self | RPC only | RPC only | self |
| nudges, nudge_state | thing viewers | RPC only | RPC only | never |
| bridge_grants | thing owner only | **service/lifecycle only** | RPC only (revoke) | never |
| bridge_sessions | none (server-side only) | server only | server only | none |
| notification_events/deliveries | own rows | service only | service only | none |
| channel_entitlements, app_config, nudge_policies | authenticated read | service only | service only | none |
| profiles | self full; others via limited `public_profiles` view | self | self | none |
| external_identities | none direct | RPC only | RPC only | none |

**Thing-only List label** — `thing_list_label` (`security_invoker = on`) exposing only `list_id`, `list_name`, `list_context`, plus `get_thing_list_label(thing_id)` (definer, gated on `can_view_thing()` / `bridge_thing_id()`) for Bridge callers. No other Things, members, chat, huddle, permissions or list activity.

**Trophy/analytics** — RLS-safe normal views and RPCs scoped to `auth.uid()` only. No cross-user materialized view, no ranking, no surveillance metrics.

**Attachments** — Storage bucket private, keys `things/<thing_id>/<uuid>`; Storage policies call `katalist_priv.can_view_thing()` on the parsed path; downloads via short-lived server-issued signed URLs. Metadata RLS alone is not relied on.

---

## D. Final RPC list

**Things**
`create_thing` · `assign_thing` · `reassign_thing` · `catch_thing(pace default 'next')` · `set_personal_pace` · `set_work_status` (assignee-only, post-Catch) · `set_owner_importance` (owner-only) · `set_due` · `sort_thing` (assignee-only) · `cancel_thing` (owner-only)

**Lists**
`create_list` (atomic: owner + NOT NULL context defaulted from creator's active context) · `add_list_member` · `change_list_role` · `remove_list_member` · `promote_thing_person_to_list` (list owner only) · `get_thing_list_label`

**Private**
`shred_for_me` · `restore_for_me` · `doorman_snooze` · `doorman_dismiss` · `doorman_mark_presented`

`shred_for_me` rejects when the Thing is active (`not_started` / `under_progress` / `waiting_for_catch`) **and** the caller is the current Assignee or the Thing Owner. Sorted and Cancelled Things may be shredded personally without lifecycle change. Every shred/restore writes `private_activity` in the same transaction.

**Nudges**
`send_nudge` (cooldown + terminal-state checked, policy-driven)

**Identity**
`claim_external_identity(phone_e164)` — after Supabase Auth verifies phone ownership: `SELECT … FOR UPDATE` the matching `external_identities` row, assert unclaimed, **rebind the existing `actors` row** (`kind='user'`, `profile_id=<new>`, keep `external_identity_id`), set `claimed_profile_id/claimed_at`. Same `actor_id` forever; no second actor; no merge. Concurrent claims serialize on the row lock.

**Bridge**
`issue_bridge_grant` — **internal/service-only**, callable only from `create_thing` / `assign_thing` / `reassign_thing` when the new assignee is an external actor. List ownership grants no Bridge-issuance authority.
`revoke_bridge_grant` (thing owner or lifecycle) · `bridge_catch` · `bridge_set_work_status` · `bridge_comment` · `bridge_sort` — all resolve authority from the server-held Bridge session, are Thing-scoped, and cannot set pace or reassign.

**Removed:** `move_thing_to_list`, owner-transfer RPCs, past-assignee read grants.

**Server routes (TanStack; no Supabase Edge Functions)**
`POST /api/public/bridge/redeem` — magic-link token → validate grant (hash, expiry, revocation, assignment still current, Thing non-terminal) → HttpOnly / Secure / SameSite=Lax short-lived Bridge session cookie. No custom Supabase JWT, no service-role in the browser.
Bridge action routes → scoped Bridge RPCs. Notification outbox worker. Coey nudge evaluator. Magic Box parse (AI Gateway, parse-only).

**Bridge lifecycle (correction 4, default OFF):** reassignment, Cancel and Sort each revoke the grant and kill its sessions atomically. No read-after-revocation.

**Realtime:** narrow filtered channels only — open Thing by id, per-list by `list_id`, per-user inbox via `notification_events`, comments/messages by parent, `nudge_state` by thing. Publication limited to those tables; RLS applies.

**Notifications:** transactional outbox written inside each lifecycle RPC (dedupe_key), worker fans out per `channel_entitlements` with fallback; channel choice never affects Thing state.

**Same-object principle:** one `things` row; Court, Their Court, List, Bucket, Nudges, Search, Bridge and Ghost Card are lenses. `bucket_items`, `nudge_state`, `profile_object_state` and `doorman_state` reference the Thing and copy no fields.

**Sorted ≠ Cancelled ≠ Shredded:** Sorted = completed; Cancelled = owner-terminated, terminal; Shredded = per-user visibility only, other participants unaffected, restore never alters lifecycle.

---

## E. Final migration order

1. `katalist_priv` schema, enums, `app_config`, `profiles`, `external_identities`, `actors` (+ claim constraints/uniques), helper functions with hardened grants
2. `things`, `thing_assignments`, `thing_activity`, `thing_comments` + row-local constraints, immutability triggers, indexes
3. RLS + GRANTs for phases 1–2
4. `validate_thing_transition` + core Thing RPCs (create/assign/reassign/catch/pace/status/importance/due/sort/cancel)
5. `lists`, `list_members`, `list_messages`, `create_list()` + membership/promotion RPCs, `thing_list_label` + `get_thing_list_label`
6. `buckets`, `bucket_items`, `private_activity`, `profile_object_state`, `doorman_state`, shred/restore + doorman RPCs
7. `nudge_policies`, `nudges`, `nudge_state`, `send_nudge`, evaluator
8. `bridge_grants`, `bridge_sessions`, redeem route, Bridge RPCs, lifecycle revocation coupling
9. Realtime publication, `notification_events`/`deliveries`/`channel_entitlements`, outbox worker
10. Trophy views, `thing_attachments` + Storage bucket/policies, `claim_external_identity` wiring into signup

**Testing per phase (pgTAP-style + server integration):** full role matrix (owner / assignee / creator-only / list owner / collaborator / view_only / bridge / past assignee / stranger × every action), with explicit negative tests that creator-only and past-assignee see nothing; work-status authority (owner-not-assignee blocked from under_progress and sort; only owner cancels); terminal absorption; reassignment invariants incl. atomic Bridge revocation; pace determinism on Catch; shred rejection for active responsibility and cross-user invisibility of shreds; bucket references absent from shared `thing_activity`; doorman state never mutating the Thing; concurrent `claim_external_identity` with actor-id stability; direct INSERT into `lists`, `bridge_grants` and `profile_object_state` denied; Storage signed-URL denial for a non-viewer.

---

## F. Product-semantic status

**Zero remaining product-semantic questions block Phase 1.** All previously open items are now locked:

| Decision | Locked value |
|---|---|
| List Thing created by Collaborator | Creator becomes Thing Owner; List Owner does not |
| Owner transfer | Not supported in this baseline; owner fields immutable |
| Past Assignee access | None automatic; ends with the assignment |
| Bridge read after revocation | Off |
| Personal Shred of active responsibility | Rejected for current Assignee and Thing Owner |
| Pace after Catch (full user) | Selected value, else NEXT; never NULL once Caught |
| Pace for Bridge/external | Always NULL |
| Huddle | Outside backend baseline |
| List context | work|home, NOT NULL, defaults to creator's active context |
| Work Status authority | Current Assignee only, post-Catch; Owner cannot change another assignee's status |
| Cancel authority | Thing Owner only |
| Ghost Card "Later" | Private persisted snooze in `doorman_state` |
| Bridge grant issuance | Internal/lifecycle only; never List-Owner authority |

Configuration-only (non-blocking, supplied at release): Recently Shredded retention, Nudge cooldown/stale/escalation thresholds, Doorman breakthrough timing.

### Changes applied in this final pass
1. `actors` CHECK relaxed to the claim-compatible form; partial uniques retained; actor_id permanent.
2. List Thing owner default locked to Creator; owner-transfer removed; ownership fields made immutable at DB level.
3. Past-assignee read access removed from the visibility model and from tests.
4. Bridge read-after-revocation set to Off and coupled to reassign / cancel / sort.
5. Catch now yields a deterministic pace (NEXT default) for full users; external stays NULL.
6. `shred_for_me` gains the active-responsibility rejection; `profile_object_state` is RPC-only with no client write GRANTs.
7. `doorman_state` table added, private, with snooze/dismiss RPCs and a hard rule that it never mutates the Thing.
8. Immutability triggers added for `things.creator_actor_id`, `things.owner_actor_id`, `lists.owner_profile_id`.
9. `issue_bridge_grant` restricted to internal/lifecycle callers; List Owner authority removed.
10. Open-questions list retired; all decisions recorded as locked.
