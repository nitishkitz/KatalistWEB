# List Collaboration Board and Bucket Reliability Design

**Status:** Approved product design; ready for implementation planning after specification review
**Date:** 2026-08-25
**Target implementation baseline:** `origin/codex/magic-box-v2` at `75d9d44d561392a52905dec7ee14c7d0fdcec9dc`
**Target environment:** UAT first; production is out of scope until UAT sign-off

## Objective

Redesign Lists into complete collaboration rooms. A List must support optional descriptive media, consent-based membership and invitations, clear roles, a responsive Mine/THEIRS Things experience, NOW/NEXT/LATER drag-and-drop for the current assignee, person and status filters, a readable table alternative, identifiable timestamped chat, and a functional People administration surface.

The same delivery must remediate the Court Thing Detail **Add to Bucket** failure. Bucket membership is private and many-to-many: one Thing may exist in multiple Buckets, and deleting a Bucket must never delete the Thing.

## Approved Product Decisions

- Use a **Board + Table** design. Board is the default; Table is a secondary view.
- Desktop Mine Board has three lanes: **NOW**, **NEXT**, and **LATER**.
- Mobile shows one lane at a time. It must never hide Things as the current implementation does.
- **THEIRS** is a separate view, not a fourth lane.
- Only a Caught Thing assigned to the current user can be dragged between NOW/NEXT/LATER.
- Waiting-for-Catch and THEIRS Things are not draggable.
- List roles are fixed presets: **Owner**, **Collaborator**, and **View only**.
- View-only members may read the List, read and add Thing comments, and send List Chat messages. They cannot create, edit, drag, assign, or administer through List membership.
- Owner and Collaborators may edit List name, description, and cover image.
- Only the Owner may invite/remove members, change roles, resend or revoke invitations, archive, or delete the List.
- The creator is always the Owner and must be visibly included in People. The database must not add a duplicate Owner row to `list_members`.
- A List invitation accepted by a non-teammate creates both the mutual Team connection and the selected List membership atomically.
- Pending invitees have no List access.
- List cover image is optional, private, removable, and replaceable.
- A Thing may be referenced by multiple private Buckets.
- Deleting a Bucket removes only Bucket references, never Things or Lists.

## Relationship to the Team Design

This design depends on the Team foundation described in `docs/superpowers/specs/2026-08-25-team-contacts-design.md`. Team is not implemented on the target branch, so implementation sequencing must build or integrate that foundation before List invite acceptance can be complete.

This specification supersedes one earlier Team-spec decision for the List-specific invite path:

- Adding an already connected teammate to a List remains an immediate List-only action.
- Inviting a person who is not yet connected creates a consent request with a pending List grant. Acceptance creates the mutual Team connection and the List membership in one transaction.
- Creating a Team connection outside a List does not automatically add the teammate to any List.

## Current-State Evidence

The target branch and live UAT were inspected without changing application or database state.

### Existing foundation to reuse

- `lists`, `list_members`, and `list_messages` already exist.
- `list_members.role` already supports `collaborator` and `view_only`.
- `create_list`, `add_list_member`, `change_list_role`, and `remove_list_member` RPCs exist.
- Owner identity is stored in `lists.owner_profile_id`; the schema intentionally forbids an Owner `list_members` row.
- List message rows already contain `created_at`.
- Things already contain `owner_importance`, `assignee_personal_pace`, acknowledgement, work status, due data, actors, and timestamps.
- `set_personal_pace` is the existing assignee-scoped lane mutation.
- `buckets` and `bucket_items` already model private references. The foreign keys delete reference rows when a Bucket is deleted without deleting the referenced Thing or List.
- Existing Katalist avatars, badges, tabs, sheets, query invalidation, Realtime, reduced-motion conventions, and responsive shell should be reused.

### Confirmed gaps

- New List accepts only a name.
- Members & Permissions contains explanatory placeholder copy but no administration controls.
- The Owner is missing from the People list because the UI renders only `list_members`.
- The live desktop List table has nine cramped columns: `Thing`, `Owner Importance`, `My Pace`, `With`, `Ack`, `Status`, `Due`, `From`, and actions.
- List Thing mapping incorrectly presents the source as `Standalone` because `listName` is not composed in the List query.
- On mobile, the desktop table is hidden and no card replacement is rendered, so the List can appear empty while Things exist.
- List chat renders plain `Name: message` lines even though timestamps exist; no avatar or time is displayed.
- Current List chat capabilities prevent View-only sending, contrary to the approved behavior.
- Current Add to Bucket UI assumes one `currentBucket`, removes that reference before adding another, and cannot represent valid multiple Bucket references.
- `domainErrorMessage` only reads `Error` or string values. Supabase/PostgREST errors are commonly plain objects, which explains why the real failure is reduced to `Something didn’t go through. Try again.` The underlying mutation failure still must be reproduced and captured before a fix is chosen.

## Domain Definitions

- **List Owner:** Profile in `lists.owner_profile_id`. Displayed as the first person in the roster; never duplicated in `list_members`.
- **Collaborator:** Active member who may collaborate on List metadata, Things, and Chat but may not administer membership or List lifecycle.
- **View-only member:** Active member with read access plus List Chat and Thing commenting. Membership alone grants no workflow mutation.
- **Invited person:** Pending List invite with no List visibility or access.
- **Mine:** Active List Things whose current assignee actor belongs to the current profile.
- **THEIRS:** Active List Things whose current assignee is another person and which the current profile may view through List access.
- **Mine lane:** For a Caught Thing, `assignee_personal_pace`. For a Waiting-for-Catch Thing with no Personal Pace, the temporary display lane is `owner_importance`.
- **Person filter:** Filters by current assignee, not creator or owner.
- **Thing timestamp:** Relative `updated_at` on cards/rows and exact Created/Last updated values in Thing Detail.
- **Bucket reference:** A private owner-scoped relation between a Bucket and one Thing or List. It does not own or copy the referenced object.

## Information Architecture

### Lists index

Retain `/lists` and the Owned by Me, Collaborating, and View Only grouping. Improve each row/card to show:

- Optional cover thumbnail or deterministic color fallback.
- List name, description excerpt, and context.
- Owner identity and member avatar stack, including the Owner.
- Thing totals, open/completed summary, unread Chat count, and latest activity timestamp.
- Responsive cards below the desktop table breakpoint.

### List detail

The page contains:

1. Compact List header with cover, name, description, context, member avatars, current role, and Owner-only settings.
2. Tabs: **Things**, **Chat**, **People**.
3. Things view controls: Mine/THEIRS, Board/Table, status filters, assignee avatars, search, sort, and clear filters.
4. Magic Box for Owner/Collaborator only.
5. Thing Detail Sheet on card/row selection.

The labels `Role: owner` and `Thing comments stay on the Thing` must not occupy primary header space. Role and explanatory copy belong in contextual help or People.

## New List Flow

`New List` opens an accessible two-step modal.

### Step 1 — Details

- Required name.
- Optional description, maximum 500 characters.
- Optional cover image: JPG, PNG, or WebP; maximum 5 MiB.
- Context inherits the active Work/Home context and is shown before creation.
- Back, Cancel, Next, and Create actions preserve entered values during the modal session.

### Step 2 — People

- The creator appears first as fixed Owner.
- Search and select accepted Team members.
- Add by validated India-first phone invite through the Team/List consent path.
- Select Collaborator or View only before adding or inviting; default is Collaborator.
- Multiple Team members may be staged before creation.
- Skip is allowed.
- The create operation must not leave a partially configured visible List. If cover upload or membership staging fails, recovery must be explicit and idempotent.

### Creation transaction and recovery

- Create the List and immediate Team-member rows in one server-controlled operation where practical.
- The Owner is represented only by `owner_profile_id`.
- Pending List invitations are created only after the List ID exists and are idempotent by List, requester, and target.
- Cover upload uses a staging/finalization pattern or compensating cleanup so a failed create does not leave an inaccessible permanent object.
- Double Create must produce one List.

## List Header and Metadata Editing

- Use the existing Katalist visual language: white surfaces, restrained borders, existing typography, purple primary action, existing avatar component, and existing icon library.
- Cover is supportive, not a large hero. It must not push Things below the fold on normal desktop or mobile screens.
- Owner and Collaborator can edit name, description, and cover.
- View-only sees the metadata without edit controls.
- Only Owner sees membership settings, archive, and delete.
- Cover replacement does not expose a public Storage URL.

## Things Board

### Controls

- Mine/THEIRS segmented control.
- Board/Table toggle.
- Status chips: All, Due, Waiting, In Progress, Completed.
- Horizontal assignee avatar filters showing the people involved in the currently visible List Things.
- Search by Thing title.
- Clear action appears when any non-default filter is active.
- Status, person, search, Mine/THEIRS, and Board/Table state compose predictably. View mode may persist per profile; destructive or workflow state must not be encoded only in local storage.

Filter semantics are fixed:

- **All** shows active, non-terminal Things.
- **Due** shows active Things with a due date, ordered overdue first and then due soon.
- **Waiting** shows active `waiting_for_catch` Things.
- **In Progress** shows active `under_progress` Things.
- **Completed** shows `sorted` Things. In Board mode they are grouped by their last Personal Pace, are visibly terminal, and are never draggable.
- Cancelled Things are excluded from the default Board and remain available through Table state filtering or Thing history; they are never draggable.

### Mine Board

- Desktop renders NOW, NEXT, and LATER as equal responsive columns.
- Mobile renders NOW/NEXT/LATER tabs with one readable lane at a time.
- Each lane displays a count and empty state.
- Card fields: title, assignee avatar/name, readable state, due date if present, and relative updated timestamp.
- Remove repeated `Owner` and `My Pace` labels and repeated matching values.
- Owner Importance may appear as a subtle priority indicator only when it adds information, especially while Waiting for Catch.
- The lane already communicates Personal Pace.

### THEIRS

- THEIRS contains active List Things assigned to another actor and visible through List access.
- It is not draggable.
- Cards always show the current assignee avatar and name.
- The same status, person, due, search, and timestamp controls apply.
- Waiting, Moving/In Progress, and Needs Attention may be represented through State and filters without duplicating the Court's separate WITH OTHERS surface.

### Drag-and-drop contract

- Eligible only when the current user is the current assignee, acknowledgement is Caught, and the Thing is non-terminal.
- Cross-lane drop maps directly to `set_personal_pace(thing_id, target_lane)`.
- Waiting-for-Catch, THEIRS, Sorted, Cancelled, and unauthorized cards have no drag affordance.
- No within-lane manual ordering in this version. Lane order is deterministic: overdue/due soon first, then `updated_at` descending, then ID as stable tie-breaker.
- Optimistic movement is allowed only with a snapshot for rollback.
- During drag, reserve the source footprint and use a separate overlay so columns do not collapse or jump.
- On success, reconcile with server data without a second visible jump.
- On failure, restore the original lane, announce failure, and provide Retry.
- Keyboard interaction provides an equivalent Move to NOW/NEXT/LATER menu or lift/move/drop controls.
- Reduced-motion mode removes nonessential transforms and spring animations.

The combined State label uses this precedence: Waiting for Catch, Cancelled, Sorted, Under Progress, then Not Started.

## Table View

Desktop table columns are limited to:

| Thing | Assignee | State | Due | Updated | Actions |
| --- | --- | --- | --- | --- | --- |

- Pace appears as a compact lane badge inside Thing, not as a separate column.
- State combines acknowledgement and work status into one human-readable value.
- Assignee uses avatar plus name.
- Due uses the existing date formatting and urgency tone.
- Updated is relative with exact date/time available on hover and keyboard focus.
- Source/From is omitted because the user is already inside the List.
- Header is sticky only inside a bounded scroll container and never overlaps global navigation.
- Sortable columns expose button semantics and current sort direction.
- On mobile, Table mode becomes compact stacked rows/cards; it never renders a horizontally crushed table and never hides the Thing collection.

## Thing Detail Timestamp and Source

- Add Created and Last updated timestamps using exact local date/time.
- Preserve activity timestamps.
- When opened from a List, display the actual List name rather than `Standalone`.
- The List query must compose `listName` safely without weakening List visibility.

## Chat

- Every message renders sender avatar, display name, timestamp, and body.
- Avatar appears before the name/message group.
- Timestamp appears beside the name and uses relative formatting for recent messages with exact time available accessibly.
- Date separators distinguish days.
- Initial history is paginated; loading older messages preserves scroll position.
- New messages arrive through Realtime and do not duplicate optimistic messages.
- Failed sends remain visible with Failed and Retry states.
- View-only members may send List Chat messages.
- List Chat remains separate from Thing comments.
- Deleted messages are omitted under the existing soft-delete behavior.

## People and Invitations

### Active roster

- Compose the Owner profile plus `list_members` rows.
- Owner is first with a fixed Owner badge.
- Active members show avatar, name, role, and join date where available.
- Owner can change Collaborator/View only or remove a member.
- Role changes and removals require confirmation when they affect currently assigned Things; existing Thing ownership/history must never be deleted.

### Add from Team

- Search accepted Team connections only.
- Already active or invited people are disabled with their current state.
- Owner selects role and adds immediately.

### Invite

- India-first input accepts a validated 10-digit mobile number and normalizes to `+91XXXXXXXXXX` using the shared Team helper.
- Use a secure opaque invite link shared through WhatsApp, SMS, or native Share; Katalist does not auto-send SMS in this version.
- Registered non-teammates also receive an in-app request.
- Pending invite shows alias/phone, role, expiry, Share again, and Cancel.
- Pending invite grants no List access and does not appear as an active member.
- Acceptance displays Team phone-sharing consent, then atomically creates the Team connection and List membership.
- Double acceptance and two-tab acceptance are idempotent.
- Expired, revoked, already accepted, wrong-number, and role-changed-before-acceptance states have explicit outcomes.

## Permission Matrix

| Capability | Owner | Collaborator | View only |
| --- | --- | --- | --- |
| View List, Things, People | Yes | Yes | Yes |
| Read/send List Chat | Yes | Yes | Yes |
| Read/add Thing comments | Yes | Yes | Yes |
| Create Thing in List | Yes | Yes | No |
| Edit/assign List Things through membership | Yes | Yes | No |
| Edit List name/description/cover | Yes | Yes | No |
| Add/invite/remove members | Yes | No | No |
| Change member role | Yes | No | No |
| Archive/delete List | Yes | No | No |

Thing-scoped rights remain independent. For example, if a View-only member is directly assigned a Thing, assignee-only Catch, Pace, Status, and Sort rights for that Thing continue to apply. List membership must not silently remove a valid direct Thing capability.

## Bucket Reliability

### Required behavior

- Thing Detail shows a multi-select list of the current profile's private Buckets in the active context.
- Checked state is derived from all Bucket references, not a single `currentBucket`.
- Checking creates one reference; unchecking removes only that reference.
- The same Thing may be checked in multiple Buckets.
- Duplicate Add is idempotent and returns the existing/success state.
- Deleting a Bucket cascades only its `bucket_items`; referenced Things and Lists remain.
- Successful mutation invalidates Bucket list counts, Bucket contents, Thing Detail reference state, and any affected private activity queries.

### Investigation-first remediation

Before changing the RPC or schema:

1. Add a failing test that reproduces Court → open Thing → Add to Bucket.
2. Capture the actual Supabase/PostgREST error object and response code.
3. Extend error normalization to read safe `message`, `code`, `details`, and `hint` fields from plain Supabase error objects for diagnostics while retaining user-safe copy.
4. State and verify one root-cause hypothesis.
5. Implement only the confirmed fix.

The final implementation must also remove the single-Bucket remove-then-add behavior because it violates the approved many-to-many model and can lose the previous reference if the subsequent add fails.

### Bucket acceptance tests

- Add a new Thing reference.
- Add the same reference twice.
- Add one Thing to two Buckets.
- Remove it from one Bucket and verify it remains in the other.
- Delete one Bucket and verify the Thing still exists and remains in other Buckets.
- Refresh and verify checked state and counts.
- Simulate network/RPC failure and verify rollback plus Retry.
- Verify anonymous and another authenticated profile cannot list or mutate the owner's Bucket references.

## Data Model Changes

Exact migration names are chosen with `supabase migration new` during implementation.

### Lists

Add nullable metadata:

- `description text` with a 500-character check.
- `cover_storage_path text` or equivalent private object reference.

Do not store a public cover URL.

### List cover Storage

- Provision a private `list-covers` Bucket through the Storage API or Dashboard, not direct migration DML against `storage.buckets`.
- Maximum file size 5 MiB; allow JPG, PNG, WebP.
- Validate declared MIME type, decoded file signature, and actual byte length on the trusted upload/finalization path.
- Object naming is scoped by List ID and immutable upload attempt ID/version.
- Active Owner/Collaborator may write or replace.
- Active List viewers may read signed content.
- Removed members and pending invitees cannot read.
- Cleanup handles abandoned staging objects and replaced covers.

### List invitations

Extend or reference the private Team request architecture with a pending List grant containing:

- List ID.
- Inviter/Owner profile ID.
- Target registered profile or normalized invited phone.
- Selected List role.
- Hashed high-entropy token, expiry, accepted/revoked state, and timestamps.
- Unique active-request protection for List plus target.

Only reviewed server/RPC paths may read or mutate private invitation rows.

### Thing timestamps

- Include `created_at` and `updated_at` in List Thing reads and frontend domain mapping.
- Use server timestamps as authoritative.

## RPC and API Contract

Existing functions may be safely extended or wrapped, but client-side sequences must not be the authority for multi-step security-sensitive operations.

Required operations:

- Create List with metadata and immediate accepted-Team members idempotently.
- Update List metadata with Owner/Collaborator authorization.
- Create, list, resend, revoke, and accept List invitations with Owner/recipient authorization.
- Accept pending Team + List invitation atomically.
- Return a composed List roster including Owner and pending invites without exposing unrelated phone numbers.
- Return List Things with exact actors, List label, created time, and updated time.
- Add/remove Bucket reference idempotently while preserving private ownership.

Every `SECURITY DEFINER` function must:

- Set a fixed `search_path`.
- Check `auth.uid()` and object-level authorization internally.
- Revoke `PUBLIC` and `anon` execute.
- Grant only the minimum authenticated/server role.
- Avoid user-editable JWT metadata for authorization.
- Pass Supabase security advisors and explicit authorization tests.

## Invitation Notifications and Deep Links

- Create allowlisted notification events for List invite received, invite accepted, role changed, and membership removed.
- Registered recipients receive an in-app request and existing push delivery where enabled.
- Notification payloads contain only allowlisted relative paths such as `/lists/<list-id>?tab=people`; never include a raw phone number, invite token, private Storage path, or secret.
- Unregistered invite tokens travel only in the user-shared invite URL.
- Accepting, revoking, changing role, or removing membership invalidates List, Team, identities, assignable people, mentions, and notification queries.

## Realtime and Cache Reconciliation

- List metadata changes invalidate List index and List detail.
- Member/invite acceptance invalidates Lists, roster, Team, identity visibility, assignable people, mentions, and notifications.
- Thing creation, status, Catch, Pace, due, assignment, and deletion events update both Board and Table without duplicate cards.
- Chat uses a stable optimistic client ID to reconcile Realtime echoes.
- Bucket reference changes invalidate all Bucket-derived surfaces.
- A Realtime event received during a drag must not overwrite a newer local mutation; compare server version/timestamp and reconcile deterministically.

## Error and Recovery States

- Never clear a List form, chat draft, drag state, or pending Bucket selection before mutation success or recoverable optimistic snapshot.
- Map known authorization, validation, duplicate/idempotent, expired invite, storage, size/type, offline, timeout, and server errors to clear actions.
- Preserve underlying error code/message in development diagnostics without exposing secrets or raw internal details to testers.
- All double-click-sensitive actions disable while pending and remain server-idempotent.
- Partial invite batches show a per-person result and allow retry only for failed entries.

## Accessibility

- Modal and sheets have labelled title/description, focus trap, Escape close, and focus return.
- Tabs, segmented controls, filters, avatar chips, sort headers, role controls, and Bucket multi-select are fully keyboard operable.
- Avatar-only filters have accessible names such as `Filter by Things assigned to Priya` and a visible selected state.
- Drag has a keyboard equivalent and polite live-region announcements for lift, target, success, rollback, and invalid moves.
- Touch targets are at least 44 px on mobile.
- Color is never the only indicator for lane, role, state, due risk, or selection.
- Relative timestamps expose exact time to assistive technology.
- Reduced motion removes nonessential dragging and lane transitions.

## Responsive Requirements

Verify at minimum:

- 320 px mobile.
- 390 px mobile.
- Tablet portrait and landscape.
- 1280 px desktop.
- 1440 px desktop.

At every width:

- Things remain visible.
- Controls wrap or scroll without clipping.
- Header does not dominate the viewport.
- Board cards remain readable.
- Table alternative does not force unreadable horizontal compression.
- Chat composer remains reachable above mobile navigation and the on-screen keyboard.
- People role actions remain understandable and do not rely on hover.

## Feature Flags and Rollout

Use fail-closed UAT flags for the new List collaboration surface and List invitations. Bucket reliability fixes that restore existing intended behavior may ship without a separate feature flag after regression verification.

Safe sequence:

1. Implement Team dependency and List changes with flags false.
2. Provision private List cover Storage in UAT.
3. Apply UAT migrations in timestamp order outside Netlify build.
4. Run migration list, advisors, Storage policy tests, and authorization matrix.
5. Enable server flag first, then client flag, and deploy UAT.
6. Run live four-user and responsive acceptance flows.
7. Roll back UI by disabling flags and redeploying; do not drop applied schema.

Production remains untouched until explicit approval after UAT sign-off.

## Acceptance Criteria

### List creation and people

- Create a List with name only.
- Create a List with description, cover, accepted Team members, roles, and an unregistered invite.
- Creator appears as Owner without a duplicate member row.
- Collaborator can edit metadata but cannot administer People.
- View-only can read, comment, and chat but cannot mutate List workflow through membership.
- Invite acceptance creates mutual Team and selected List access once.
- Pending, expired, revoked, and wrong-recipient invites never grant access.

### Board and table

- Mine shows correct NOW/NEXT/LATER derivation.
- THEIRS shows other assignees with avatars.
- Status plus person filters compose and clear correctly.
- Eligible drag changes Personal Pace once, survives refresh, and does not jump visually.
- Waiting/THEIRS/terminal/unauthorized drag is unavailable.
- Table has only six clear columns and displays correct List source and timestamps.
- Mobile displays Things in both Board and Table modes.

### Chat

- Avatar, name, timestamp, date separator, message body, pending, failed, and Retry states display correctly.
- View-only can send Chat.
- Realtime does not duplicate optimistic messages.

### Buckets

- Court Thing Detail Add to Bucket succeeds with clear feedback.
- Multiple Bucket membership works.
- Duplicate add is idempotent.
- Removing/deleting one Bucket reference never deletes the Thing or other references.
- Generic Supabase object errors no longer collapse without actionable diagnostics.

### Security and quality

- Owner, Collaborator, View-only, Assignee, removed member, pending invitee, Stranger, and anon authorization tests pass.
- Supabase advisors introduce no new errors.
- Unit, integration, typecheck, targeted lint, build, accessibility, responsive, and real UAT browser flows pass.
- No migration runs from Netlify build.
- No service-role key, invite token, phone list, or private Storage path is exposed in client logs or committed files.

## Four-User UAT Matrix

Use dedicated consented UAT profiles:

1. List Owner/inviter.
2. Collaborator/assignee.
3. View-only member/chat participant.
4. Stranger/wrong invite recipient.

Verify desktop and 390 px mobile for create, accept, roster, role change, Mine/THEIRS, filters, drag, refresh, Table, Chat, Thing Detail, Bucket add/remove, notifications, and deep links. The Stranger and pending invitee must be unable to enumerate, view, chat, mutate, accept another person's invite, read a cover, or access Bucket references.

## Non-Goals

- Arbitrary custom permission checkboxes beyond the three approved role presets.
- Background device-contact sync.
- Automatic SMS delivery.
- Public List covers.
- Manual within-lane ordering.
- Dragging THEIRS or Waiting-for-Catch Things.
- Production migration or deployment in the implementation task unless separately approved.
