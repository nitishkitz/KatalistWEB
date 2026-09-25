# T06/T07 migration reconciliation — 2026-09-25

## Scope

This closes the "production migration history differs" item blocking T06/T07 release:
25 local migrations pending against production, 12 production-only migrations absent
locally. This document records what was found and what was (and was not) done about it.
The initial 12-version reconciliation was read-only against production. The
later closure phase, explicitly authorized by the user, repaired and applied
the 25 history-pending migrations and deployed the application. The sections
below distinguish those two phases.

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

## The 25 formerly local-only migrations (applied 2026-09-25)

These versions were absent from production migration history, spanning 2026-09-03 through
2026-09-24 (`20260903160000_resolve_list_names.sql` through
`20260924120000_bounded_chat_and_notification_claims.sql` — the full list is
`supabase/migrations/` filtered to that date range). They correspond to feature work
built on this branch after the last production sync: reopen-thing, comment-activity
logging, nudge escalation, Thing snooze, list cover/description, device tokens, list chat
attachments, Catch Up, bucket notes, profile cover theme, Team Hub, Hub contacts,
notification push timestamps, list meetings, pinned messages/files, upcoming-meeting RPC,
message mentions, Morning Brief receipts, and bounded chat/notification claims. **This
the initial reconciliation pass did not apply or mark any of them. The later
T06/T07 closure pass reviewed and applied all 25 after the user explicitly
directed production completion.
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

### Live catalog preflight after reconciliation

The collision check above compared migration *files*; it did not establish that
the 25 pending versions are absent from the **live schema**. A subsequent
read-only production catalog check found substantial schema drift despite the
missing migration-history rows:

- `public.create_list(text, context_kind, text, text)` already exists, as do
  all four `list covers ...` policies on `storage.objects`. Applying
  `20260916130000_list_cover_and_description.sql` unchanged would attempt to
  create those policies again and fail.
- Eleven of the twelve queried new feature tables already exist, including
  `thing_snooze`, `catchup_receipts`, `bucket_notes`, `hub_files`,
  `contact_requests`, `invitations`, and `list_meetings`. The two queried
  tables that are genuinely absent are `morning_brief_presentations` and
  `message_push_claims`.
- Many functions from the pending migrations already exist, including
  `snooze_thing`, `get_or_create_dm`, contact-request functions, meeting
  functions and `run_nudge_escalation`. Other functions are absent, including
  `resolve_list_names`, `reopen_thing`, `claim_morning_brief`,
  `dismiss_morning_brief` and `claim_list_message_push`.
- Columns added by several pending files are also already present:
  `lists.description`, `lists.cover_storage_path`, `lists.kind`,
  `profiles.cover_theme`, `list_messages.attachment`,
  `list_messages.mentioned_profile_ids`, `list_messages.pinned_at`,
  `hub_files.pinned_at`, and `notifications.pushed_at`.
- Production also already has the `list chat ...` and `hub files ...` storage
  policies and feature-table RLS policies for Bucket notes, Catch Up receipts,
  List meetings, contacts and invitations. Several pending SQL files use
  unconditional `CREATE POLICY`, so the collision is not confined to List
  covers.

Consequently, `supabase db push --linked --include-all --dry-run` listing 25
files meant only that their **version records** were missing. Before the
production push, the colliding DDL was made repeat-safe, the malformed
`reopen_thing` SQL was corrected, and the access expansion described below
was removed. The complete ordered push then succeeded without changing any
customer row.

### Access change requiring a product decision

The first pending file, `20260903160000_resolve_list_names.sql`, adds the
targeted `resolve_list_names(uuid[])` RPC **and** replaces
`katalist_priv.can_view_list(uuid)`. The production predicate currently allows
only the List owner or member. The pending definition would also allow any
profile whose actor owns, created, or is assigned one Thing in that List.
`can_view_list` is used by List, member, message, file and meeting access
policies; `can_view_thing` also delegates to `can_view_list`, so the broadened
predicate can expose **other Things in the same List** as well. Applying this
file unchanged therefore grants substantially more
than the List-name lookup named by the migration. Decide whether a Thing
participant should gain access to the whole List and its conversations. A
narrow alternative is to add only `resolve_list_names` and keep the existing
`can_view_list` predicate, but this changes the checked-in migration and must
be tested against the intended product access model before deployment.

## Verification

```
$ supabase migration list
```
reports every local version matching its remote version: **zero mismatches**.
After the closure edits and production application, `npm test` passes 632/632,
typecheck and `build:app` pass, and lint reports zero errors / 75 established
warnings.

## Production closure outcome

The closure pass completed the remaining release work:

- all 25 versions applied successfully with `supabase db push --linked
  --include-all --yes`;
- `supabase migration list --linked` reports zero local/remote mismatches;
- production retains the owner/member-only `katalist_priv.can_view_list`
  predicate;
- `morning_brief_presentations`, `message_push_claims`, and their required
  RPCs exist; all 15 watched tables are in `supabase_realtime`;
- 632/632 tests pass, typecheck and build pass, and lint has zero errors (75
  established warnings);
- the prebuilt application deployed to the production alias
  `https://katalist-web.vercel.app` (Vercel deployment
  `dpl_2SFofTKCoGJYtKHzdFY1gyhoyz3f`, status `Ready`);
- an existing authenticated account loaded the production List and Chat
  surfaces with real data and no browser warnings/errors; and
- a read-only production Realtime smoke subscription reached `SUBSCRIBED`.

No customer record was created, edited, or deleted. A committed database-row
change was deliberately not generated solely to manufacture a Realtime event;
payload routing, batching, reconnect, stale-channel rejection, and catch-up
remain covered by the deterministic local suite, while the production check
proves publication coverage, WebSocket subscription, deployed-client loading,
and authenticated data access.
