# Collaboration Notifications and Court Polish Design

## Scope

This repair makes collaboration observable and controllable across Team, Lists, Buckets, Nudges, Court, and the global Magic Box. It includes persistent in-app notifications, browser push verification, explicit Bucket pinning, `#List` Magic Box selection, stable List Chat and filters, clearer Court assignment relationships, animated Magic Box focus treatment, and glanceable List-state colors.

## Product decisions

### Notifications and nudges

- A toast confirms the current user's action; it is never treated as the recipient's notification.
- Every registered recipient receives a persistent `notifications` row for Team requests, registered-user Team/List invitations, Team/List acceptance, direct List membership, List-role change, membership removal, Thing movement, comments, List messages, and nudges.
- Every List Chat message notifies the List Owner and every active Collaborator/View-only member except the author. One message creates at most one notification per recipient even if the Owner is also represented elsewhere.
- Adding a Collaborator or View-only member notifies the added person. Existing List participants other than the acting Owner and added person receive one roster-change notification.
- Accepting a List invitation notifies the inviter and the other existing List participants; the accepting person does not receive a notification for their own action.
- Changing a List role notifies the affected person and the other existing List participants. Removing a member notifies the removed person and the remaining participants. The acting user is always excluded.
- An unregistered phone cannot receive an in-app or browser notification. The secure invite link remains the delivery mechanism until that person registers and accepts.
- Accepting an invite notifies the inviter. Accepting one's own action does not create a duplicate self-notification.
- Notification payloads may contain only a trusted app-relative path: `/team`, `/lists/<uuid>`, `/?thing=<uuid>`, or `/`.
- Nudges remain Owner-only, cannot target oneself, cannot target Sorted/Cancelled Things, and retain the existing two-hour cooldown.
- A successful nudge must atomically create the nudge, activity event, recipient notification, and push-outbox fan-out when the recipient has an active subscription.
- The notification bell and unread count update through Realtime without refresh.

### Browser push

- In-app notifications work even when browser push is disabled or unavailable.
- Browser push remains opt-in and requires the existing Firebase client registration.
- The existing private outbox and authenticated drain endpoint remain authoritative.
- UAT release verifies Firebase server credentials, all `VITE_FIREBASE_*` client values, `PUSH_DRAIN_SECRET`, the Supabase Vault secret, and the one-minute Cron job without printing their values.
- Retry/dead-token behavior remains unchanged.

### Bucket pinning

- New Buckets are unpinned.
- Pin state is persisted on the private Bucket row, not inferred from array position or local order.
- Pin and Unpin are available from each Bucket card menu and Bucket Detail settings.
- Pinned Buckets appear first; unpinned Buckets remain under All Buckets.
- Pinning changes only organization. It never changes the Bucket's Things, Lists, ownership, or permissions.

### Magic Box `#List`

- Typing `#` in any global Magic Box opens accessible Lists for the active Work/Home context.
- Search, arrow keys, Tab, Enter, Escape, click, combobox semantics, active descendant, and live-region announcements match `@` people autocomplete.
- Selecting a List replaces the active token with `#List Name`, stores the List UUID, and Tosses into that List.
- A Magic Box already scoped to a List keeps that List authoritative and does not offer a competing `#` selector.
- An unresolved active `#token` blocks Toss with `Choose a List`, preventing accidental creation in the wrong context.
- `@Person` and `#List` may appear in the same draft; both selected bindings must survive text edits only while their exact token remains valid.

### List-scoped Toss

- On an editable List Detail screen, the floating Magic Box is hard-scoped to that List UUID. The current List wins even if draft text contains another `#List` token.
- Toss without `@` assigns the new Thing to the signed-in user and stores the current `list_id`.
- Toss with a resolved `@Person` assigns the new Thing to that actor and stores the same current `list_id`.
- The created Thing appears in that List's Table/Board immediately after success and remains there after hard refresh.
- View-only List users cannot Toss into the List. Owner and Collaborator permissions remain unchanged.

### List Chat and filters

- List Chat uses a bounded panel. Messages alone scroll; the composer remains fixed at the bottom of that panel.
- New messages scroll into view without moving the composer.
- Sending a message invalidates List messages locally, while the recipient notification/unread state arrives through the database notification trigger and Realtime.
- List Things uses explicit Status and Assignee dropdowns with visible labels and options.
- Status options are All, Due/Overdue, Waiting for Catch, Not Started, Under Progress, Sorted, and Cancelled.
- Assignee options are All people plus every visible assignee with avatar and name.
- Member-role controls remain only inside Members & permissions and cannot be changed by a List filter.

### List Detail state colors

- Acknowledgement and Work Status are two labeled badges, never a single ambiguous text block.
- Waiting for Catch: amber icon/text on pale amber.
- Caught: teal/green icon/text on pale teal.
- Not Started: slate icon/text on pale slate.
- Under Progress: blue icon/text on pale blue.
- Sorted: emerald icon/text on pale emerald.
- Cancelled: red icon/text on pale red.
- Text and icons remain present so color is not the only signal.

### Court tiles and people filters

- Catch has its own right-side action area and never overlays or reduces the Thing-title hit target.
- A Thing assigned to the signed-in user shows the current assignment relationship using the actual latest `thing_assignments.assigned_by_actor_id`: `assigner avatar -> assignee avatar` with accessible text `Assigned by <name> to <name>`.
- Self-assignment collapses to one avatar and `Self-assigned`.
- Court's top avatar filters include all involved people from visible NOW/NEXT/LATER/THEIRS Things: creator, Owner, current assigner, and assignee, deduplicated by actor ID.
- Selecting an avatar filters Things where that actor is involved; selecting it again clears the filter.
- The filter applies consistently to every Court lane.

### Magic Box visual treatment

- The supplied visual reference controls only the luminous rounded-border treatment, not its black background, watermark, or search icon.
- Katalist keeps its current typography, white/card surfaces, controls, and Toss icon.
- Idle uses a restrained border and faint violet bloom.
- Focus/draft uses a bright white-violet border and a slow glow animation.
- Voice, upload, AI work, Toss, and recovery intensify the bloom without moving layout.
- `prefers-reduced-motion: reduce` disables animation and keeps a static high-contrast border/glow.

## Data and security

- UAT Supabase project is only `dyxqlgnbwtbxxdfoiqva`.
- UAT Netlify site is only `startling-frangollo-bcf845`.
- Production and all other Supabase/Netlify projects are out of scope.
- The client never receives service-role credentials, Firebase private keys, phone hashes, invite token hashes, or Cron secrets.
- New or replaced `SECURITY DEFINER` functions fix `search_path`, check the caller/target, revoke `PUBLIC` and `anon`, and grant only the required role.
- Notification inserts occur inside the same database transaction as the domain mutation.
- SQL is created with `supabase migration new`, reviewed, tested, pushed to git, and only then applied to UAT. Netlify builds never run migrations.

## Release gate

- Unit/source tests cover notification recipients, List Chat and roster fan-out, trusted paths, nudge cooldown/authz, Bucket persistence, `#List` parsing/keyboard behavior, List-scoped self/delegated Toss, Chat layout, dropdown filters, status semantics, assignment mapping, Court filters, and reduced motion.
- Playwright covers `@` plus `#`, List-scoped self/delegated Toss, Catch without title overlap, assignment arrows, avatar filtering, fixed Chat composer, filter dropdown options, Bucket Pin/Unpin, and Magic Box states.
- UAT Owner/Collaborator/View-only checks prove Team request/accept, List invite/accept, Chat and roster notifications, List-scoped Toss, nudge, in-app unread updates, browser push, and deep-link navigation.
- If browser push cannot be proven, in-app notifications may be accepted separately, but the release is reported as `NOT READY FOR PUSH SIGN-OFF` rather than silently treating toasts as delivery.
