# Desktop Workflow Repair Design

## Scope

This design repairs the signed-in desktop experience across Court, Lists, Buckets, Thing Detail, Team-backed assignment, and Magic Box. It preserves the existing domain rule that an assignee must Catch a waiting Thing before changing Pace or Work Status. Mobile List redesign remains deferred, but shared components must remain usable at existing mobile widths.

## Decisions

### List Things

- The detailed Table is the default view when a List opens.
- Board remains available through the existing Table/Board toggle.
- The Table shows `Thing | Assignee | State | Pace | Due | Updated | Actions`.
- Pace is a dedicated column. It is never repeated below the Thing title.
- Waiting Things display their effective lane from Owner Importance; Caught Things display Personal Pace. The UI calls both simply `Pace`.
- Mine/THEIRS controls and ownership scoping are removed. All Things visible through List authorization are shown; status, search, and assignee-avatar filters remain.
- A missing Due value renders nothing, not `No due date` or a dash.

### Catch and Thing actions

- A self-created/self-assigned waiting Thing shows Catch to its current assignee.
- Before Catch, Pace and Work Status remain locked by design.
- After Catch, Pace, Work Status, and Sort unlock immediately and remain correct after refresh.
- A Caught Thing does not show Catch.
- Court, List, Bucket Detail, and Thing Detail use one current-actor identity source and one capability calculation.
- Bucket membership never changes Thing ownership or capabilities.
- An unrelated Court-query failure must not erase the current actor and lock actions on other surfaces.

### Members and permissions

- The List Owner sees a prominent `Add member` control in Members & permissions.
- The Owner can select an accepted Team connection for immediate addition or invite a validated Indian `+91` number through a secure share link.
- The Owner chooses `Collaborator` or `View only` before adding or inviting.
- Collaborator can work with List Things and chat but cannot administer membership.
- View only can read and chat but cannot mutate Thing workflow solely through List membership.
- Direct Thing-assignee rights still apply to that Thing.
- Owner is always displayed, cannot be demoted, and is not stored as a `list_members` row.
- Pending invitations persist across refresh and expose only masked phone information. The raw link is shareable only when created; after refresh the Owner can revoke it or replace it with a newly generated link.
- Accepting a List invitation also creates the already-approved mutual Team connection.

### New List

- Name is required.
- Description and cover image are optional.
- Step 2 can add accepted Team members or invite by validated `+91` number with a role.
- `Skip for now` creates the List without members.
- The creator is the Owner automatically.
- Existing private cover constraints remain: JPG/PNG/WebP, at most 5 MiB, no public URL.

### Magic Box

- One Magic Box is rendered by the authenticated AppShell, not separately by individual pages.
- It floats above the bottom edge on every signed-in AppShell page, including Court, Lists, Team, Buckets, Notifications, Nudges, Profile, and Trophy.
- It does not render on Auth, Welcome, invite acceptance, Bridge, or other public routes.
- On an editable List, Toss is scoped to that List. On a View-only List and non-List pages, Toss is global.
- Idle Magic Box has a normal border. Focus, a non-empty draft, recording, transcribing, polishing, upload/finalize, Toss, and recovery produce a visible glow.
- Async activity may pulse; `prefers-reduced-motion` receives a static glow.
- Mention and chip menus open upward when needed so the bottom placement does not clip them.
- Only one composer instance exists per page so drafts, voice, attachments, and double-Toss guards are not duplicated.

### Accepted Team mentions

- Every accepted mutual Team connection is returned by the assignable-people contract with actor ID, display name, and avatar.
- Pending, declined, removed, expired, and merely invited people are not assignable.
- In a List-scoped Magic Box, current List members rank before other accepted Team connections.
- Accepting or removing a connection invalidates Team, assignable-people, and visible-identity caches without requiring logout.
- The client never derives authorization from phone numbers and never receives private connection rows.

### Court filters and display

- Court has assignee-avatar filter chips derived from currently visible active Things.
- Selecting one avatar filters NOW, NEXT, LATER, and THEIRS consistently; selecting it again clears it.
- Court cards and Court tables do not show `Owner Pace`, `Owner Importance`, or `My Pace` labels. Lane placement communicates pace. The editable control in Thing Detail is labeled simply `Pace`.
- Court sort offers Due and Updated only; it does not expose the removed Owner/My pace wording.

### Optional metadata

- A Thing with no List has `listId = null` and `listName = null` in the frontend model.
- `Standalone` is not used as missing-data copy on Court, List, Bucket, or Thing Detail.
- Source/List UI renders only when a real List exists.
- Due UI renders only when `dueAt` exists.

## Security and data rules

- The Supabase client receives no service-role key, raw invite token, phone hash, or private connection table access.
- Any new SECURITY DEFINER function checks the caller internally, fixes `search_path`, revokes `PUBLIC`/`anon`, and grants only the required role.
- Team-connected assignability reveals actor ID, display name, and avatar only.
- Pending List invitations reveal only invitation ID, role, timestamps, optional registered profile identity, and masked last four digits.
- SQL is written and reviewed before UAT application. Netlify builds never run migrations.

## Verification and release gate

- Unit/source tests cover view models, copy removal, current-actor independence, membership permissions, invite persistence, and Team mention eligibility.
- Playwright covers self Toss → Catch → Pace/status on Court and the same Thing opened from List and Bucket; List default Table; floating Magic Box; member add/invite; and accepted Team `@` lookup.
- UAT requires two real tester accounts for the mutual Team and assignment flow plus one Owner/View-only authorization matrix.
- Code is pushed first. The reviewed migration is applied to UAT only after tests pass. The exact pushed SHA is then deployed to the UAT Netlify site.
- Production and the other Supabase/Netlify projects are out of scope.
