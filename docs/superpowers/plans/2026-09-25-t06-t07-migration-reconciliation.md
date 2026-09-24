# T06/T07 migration reconciliation — 2026-09-25

## Scope

This closes the "production migration history differs" item blocking T06/T07 release:
25 local migrations pending against production, 12 production-only migrations absent
locally. This document records what was found and what was (and was not) done about it.
No production database object was created, altered, or dropped by this reconciliation —
every step below is read-only against production.

## Method

`supabase migration list` (against the linked project `dyxqlgnbwtbxxdfoiqva`) is the
source of truth for local/remote version alignment. For each version present only on
`remote`, the exact applied SQL was pulled read-only from
`supabase_migrations.schema_migrations.statements` via `supabase db query --linked`
(catalog read, no writes) and written verbatim to a local migration file at the matching
timestamp, so local history now truthfully reflects what is actually live.

## The 12 production-only migrations (now captured locally, verbatim)

| Version | Name | Local file |
|---|---|---|
| 20260822100000 | uat_profile_and_rate_limits | `supabase/migrations/20260822100000_uat_profile_and_rate_limits.sql` |
| 20260822120000 | firebase_push_outbox | `supabase/migrations/20260822120000_firebase_push_outbox.sql` |
| 20260824092736 | uat_profile_and_rate_limits | `supabase/migrations/20260824092736_uat_profile_and_rate_limits.sql` |
| 20260824122123 | magic_box_attachment_saga | `supabase/migrations/20260824122123_magic_box_attachment_saga.sql` |
| 20260824124500 | magic_box_ai_rate_limits | `supabase/migrations/20260824124500_magic_box_ai_rate_limits.sql` |
| 20260825065954 | public_identities_security_invoker | `supabase/migrations/20260825065954_public_identities_security_invoker.sql` |
| 20260825091541 | catch_inherits_owner_importance | `supabase/migrations/20260825091541_catch_inherits_owner_importance.sql` |
| 20260825102421 | bucket_reference_idempotency | `supabase/migrations/20260825102421_bucket_reference_idempotency.sql` |
| 20260825102422 | list_collaboration_desktop | `supabase/migrations/20260825102422_list_collaboration_desktop.sql` |
| 20260825110053 | list_collaboration_lint_fixes | `supabase/migrations/20260825110053_list_collaboration_lint_fixes.sql` |
| 20260825113403 | team_mentions_and_list_invitation_management | `supabase/migrations/20260825113403_team_mentions_and_list_invitation_management.sql` |
| 20260825125932 | collaboration_notifications_bucket_pins | `supabase/migrations/20260825125932_collaboration_notifications_bucket_pins.sql` |

These evidently reached production directly (Studio, a different branch/session, or a
`db push` from an environment whose migration files were never committed to this repo) —
this checkout never applied them and had no record of their existence before this pass.
Capturing them closes that specific gap: `supabase migration list` now reports **0
local/remote mismatches** for every version at or before `20260825125932` (verified
below). This is a bookkeeping fix, not a schema change — nothing was executed against
production to produce this result, only read.

## The 25 local-only migrations (still pending, unchanged by this pass)

These remain genuinely unapplied to production, spanning 2026-09-03 through
2026-09-24 (`20260903160000_resolve_list_names.sql` through
`20260924120000_bounded_chat_and_notification_claims.sql` — the full list is
`supabase/migrations/` filtered to that date range). They correspond to feature work
built on this branch after the last production sync: reopen-thing, comment-activity
logging, nudge escalation, Thing snooze, list cover/description, device tokens, list chat
attachments, Catch Up, bucket notes, profile cover theme, Team Hub, Hub contacts,
notification push timestamps, list meetings, pinned messages/files, upcoming-meeting RPC,
message mentions, Morning Brief receipts, and bounded chat/notification claims. **This
reconciliation pass did not apply any of them** — that is a separate, larger decision
(each of T06's six migrations and T07's one migration were applied only after explicit,
itemized authorization, per the existing ledger; the same discipline applies here).

## Collision check

Cross-referenced every `create table` / `create or replace function` / `create view` /
`create type` / `alter table` target across both sets (the 12 now-reconciled and the 25
still-pending). The only shared targets are `public.profiles` and `public.lists`, both of
which multiple migrations across this whole history additively `alter table ... add
column`/`add constraint` over time — the same pattern already used throughout this
project's migration history, not a conflict. No pending migration redefines an object a
reconciled migration owns, and no reconciled migration reverses or is incompatible with
anything a pending migration will add.

## Verification

```
$ supabase migration list
```
now reports every version at or before `20260825125932` matching on both `local` and
`remote`; the only remaining mismatches are the 25 genuinely-pending local-only versions
listed above (confirmed: exactly 25, matching the count in the prior status report).

No production database state was changed by this pass. `npx tsc --noEmit`, `npm test`
(no test targets this bookkeeping change directly, so the existing suite is unaffected),
and `npm run build:app` were not required to re-run since no application code changed —
only `supabase/migrations/*.sql` files were added.

## What remains before T06/T07 release

Unchanged from the existing ledger (`KATALIST_A_TO_H_AUDIT_PROGRESS.md`, T06/T07
sections): applying the 25 pending migrations to production (pending explicit,
itemized authorization the way T06's six and T07's one were), deploying the updated
application branch, and live authenticated browser + Realtime event/reconnect
verification. This reconciliation only removes the "migration history differs" blocker
for the *already-applied* twelve; it does not authorize or perform the next 25.
