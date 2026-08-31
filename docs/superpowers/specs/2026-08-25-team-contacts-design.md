# Team Contacts and Consent Design

**Status:** Approved design input for implementation planning
**Date:** 2026-08-25
**Target branch baseline:** `origin/codex/magic-box-v2` at `f93b53f7c715ed35f5a30b798888afcc461c3144`

## Objective

Add a first-class **Team** section where a signed-in user can see saved contacts and accepted teammates, add a person manually by Indian phone number, select contacts from a supported device contact picker, invite people who are not registered, approve incoming requests, remove mutual connections, add connected people to Lists, and use accepted teammates in Magic Box `@` mentions and assignment.

The feature must be consent-based, private by default, fail closed before its migration is applied, and safe for UAT and a limited pilot.

## Approved Product Decisions

- A contact becomes a teammate only through **Request + Accept**.
- Unregistered numbers remain **Invited** until the person registers and accepts.
- Contact sync is **selected-contact only**. There is no background address-book sync and no CSV/vCard import in v1.
- An unregistered invite is delivered through a secure link that the requester shares through WhatsApp, SMS, or the native Share sheet. Katalist does not send automatic SMS in v1.
- Acceptance creates a **mutual Team connection**. Both users become assignable to each other.
- v1 supports **Remove only**, not Block. Request rate limits still apply.
- Accepted teammates can see each other's verified phone numbers. The acceptance screen must state this before confirmation.
- v1 is **India-first**: inputs accept a validated 10-digit Indian mobile number and normalize it to `+91XXXXXXXXXX`.

## Existing Foundation to Reuse

- `public.contacts` already stores owner-scoped contacts and is protected by `owner_profile_id = auth.uid()` RLS.
- `public.profiles.phone_e164` stores the verified account number.
- `public.actors` maps registered profiles to assignable actor IDs.
- `public.list_assignable_people()`, `public.list_visible_profile_identities()`, and `public.resolve_profile_identities()` already restrict identity discovery to existing Thing/List relationships.
- `public.add_list_member`, `update_list_member_role`, and `remove_list_member` already enforce List-owner administration.
- Notifications, Firebase delivery, realtime invalidation, UAT fixed-OTP authentication, and Magic Box mention ranking already exist.
- External actors and Bridge grants remain Thing-scoped and must not be repurposed as the Team directory.

## Domain Definitions

- **Saved contact:** A row owned by one profile, created manually or through device selection. It is not a relationship and grants no visibility or assignment permission.
- **Incoming request:** A registered user has asked the current user to connect.
- **Outgoing request:** The current user has requested a registered user and is waiting for acceptance.
- **Invited:** The selected phone number is not registered. A secure invite link exists and may be shared again until expiry or cancellation.
- **Connected teammate:** A request was accepted and a canonical mutual connection exists.
- **Removed:** Either teammate deleted the mutual connection. Existing Things, Catch history, and List memberships are not changed.

## State Model

```text
saved -> outgoing -> connected
saved -> invited -> connected       # recipient registers with the same verified phone and accepts
incoming -> connected
incoming -> declined
outgoing -> cancelled
invited -> cancelled
connected -> removed                # returns to saved only for users who kept a private contact row
```

Only `connected` changes identity visibility and assignment eligibility.

## Database Architecture

### Extend `public.contacts`

Keep the existing owner-only RLS and add:

- `source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','device'))`
- a unique normalized-phone index per owner for rows with `phone_e164 IS NOT NULL`

The table remains a private address book. Direct contact CRUD must never create a Team connection.

### `katalist_priv.team_connection_requests`

Private table, accessible only through reviewed functions:

- `id uuid PRIMARY KEY`
- `requester_profile_id uuid NOT NULL`
- `recipient_profile_id uuid NULL`
- `invite_phone_e164 text NULL`
- `requester_contact_id uuid NULL`
- `status text CHECK (status IN ('pending','invited','accepted','declined','cancelled','expired'))`
- `invite_token_hash text NULL`
- `invite_expires_at timestamptz NULL`
- `accepted_at`, `resolved_at`, `created_at`, `updated_at`

Constraints must enforce exactly one target: registered `recipient_profile_id` or unregistered `invite_phone_e164`. Self-requests are forbidden. Only one active request may exist for the same requester and target.

### `katalist_priv.team_connections`

Private canonical undirected edge:

- `profile_low uuid NOT NULL`
- `profile_high uuid NOT NULL`
- `accepted_request_id uuid NOT NULL`
- `created_at timestamptz NOT NULL`
- primary key `(profile_low, profile_high)`
- check `profile_low < profile_high`

Both profiles can remove the edge. No direct Data API grants are given to `anon` or `authenticated` on either private table.

## Server and RPC Contract

### Phone normalization

One shared TypeScript helper accepts spaces, hyphens, optional leading `0`, or optional `+91`, then returns `+91` plus exactly 10 digits. Invalid and self numbers are rejected before mutation. The database function repeats canonical validation.

### Request creation

`POST /api/team/requests` accepts one manual entry or a selected-contact batch of at most 50 entries. The server authenticates the bearer session, generates 32 random bytes for each possible invite, stores only a SHA-256 token hash, and calls a user-scoped RPC.

The RPC:

1. Enforces per-profile and per-target rate limits.
2. Upserts the requester's private contact.
3. Compares the canonical phone against `profiles.phone_e164` without exposing a public phone-search RPC.
4. Creates an outgoing registered request and an in-app notification, or an unregistered invitation with a seven-day expiry.
5. Returns a per-entry state and, only for a newly created unregistered invitation, the one-time share URL.

Limits:

- 50 entries per HTTP request.
- 5 new connection requests per requester per 15 minutes.
- 20 new connection requests per requester per day.
- 3 invite-link regenerations per invitation per day, at least 60 seconds apart.
- Duplicate active requests return the existing state without another notification.

### Directory and mutations

Expose authenticated, column-limited RPCs:

- `list_team_directory()` returns `connected`, `incoming`, `outgoing`, `invited`, and `saved` rows for the caller.
- `accept_team_request(p_request_id)` atomically validates the recipient, records explicit acceptance, creates the canonical connection, marks the request accepted, and notifies the requester.
- `decline_team_request(p_request_id)` resolves only an incoming request.
- `cancel_team_request(p_request_id)` resolves only the caller's outgoing/invited request.
- `remove_team_connection(p_other_profile_id)` removes only an edge containing the caller.
- `claim_team_invite(p_token_hash)` is used after authentication and succeeds only when the caller's verified `profiles.phone_e164` equals the invited number.

All `SECURITY DEFINER` functions must set a fixed `search_path`, check `auth.uid()`, revoke `PUBLIC`/`anon`, grant only the minimum role, and pass Supabase security advisors.

## Identity and Assignment Integration

Accepted Team connections extend, rather than replace, current visibility:

- `list_assignable_people()` includes the actor of every accepted teammate.
- `list_visible_profile_identities()` includes accepted teammates.
- `resolve_profile_identities()` and `resolve_actor_identities()` allow accepted teammates.
- Saved, pending, declined, cancelled, expired, or removed entries never become assignable.
- Removing a Team connection does not remove existing List membership or historical Thing access. Those independent relationships may continue to make the person visible or assignable.

## User Experience

### Navigation

- Add **Team** with a `Users` icon to desktop and mobile navigation.
- Preserve all current destinations. Six mobile items are allowed in v1 and must be verified at 320 px and 390 px widths.

### Team page

Route: `/team`

- Header actions: **Add by number** and **Sync contacts**.
- Search by visible name or phone.
- Filters: **All**, **Connected**, **Requests**, **Invited**.
- Connected row: avatar, display name, shared phone, Add to List, Remove.
- Incoming row: requester name/avatar and phone-sharing consent copy, Accept, Decline. Do not reveal either phone before acceptance.
- Outgoing row: Pending badge, Cancel.
- Invited row: saved alias/phone, Share again, Cancel.
- Saved row: alias/phone, Connect, Remove contact.
- Empty, loading, offline, partial-batch, expired-link, and rate-limited states have explicit copy and recovery actions.

### Manual add

- Default non-editable country prefix `+91` and a 10-digit mobile field.
- Optional local name/alias; required when the number is not registered.
- Review normalized number before sending.
- Existing connected, self, duplicate pending, invalid, and rate-limited results are explained without leaking unrelated identity data.

### Selected-contact sync

- Feature-detect `navigator.contacts.select` in a secure context.
- Request only `name` and `tel`; `multiple: true`.
- The device picker decides which contacts are shared. Katalist never reads the complete address book.
- Normalize and deduplicate locally, cap at 50, then show a review dialog before network submission.
- Unsupported browsers show manual-add guidance, not a broken permission prompt.

### Share invite

- Prefer `navigator.share` with a secure `/join-team/<token>` URL.
- Fall back to Copy Link and explicit WhatsApp/SMS links.
- The page never embeds a raw phone number in the URL.
- Invite tokens expire after seven days and may be regenerated within rate limits.

### Acceptance

- Registered recipient sees an in-app Team request and notification deep-link.
- Unregistered recipient opens the invite link, signs in or creates a profile, and returns to the invite.
- Before Accept, copy states: “Accepting connects you both in Team and shares your verified phone numbers with each other.”
- Acceptance is idempotent and safe across double clicks or two open tabs.

## List Integration

- Replace the placeholder Owner tools copy in **Members & permissions** with functional Add people, role change, and remove controls.
- Add people searches accepted Team connections only.
- List Owner chooses `collaborator` or `view_only` and calls existing List RPCs.
- Connecting does not automatically add someone to a List; adding to a List does not automatically create a Team connection.

## Notifications and Realtime

- Create `team_request` and `team_accepted` notification kinds using the existing notifications and push outbox path.
- Notification payload contains an allowlisted relative path such as `/team?request=<uuid>`; no phone number or invite token is placed in notification content.
- A notification realtime event invalidates Team, identity-directory, assignable-people, and notification queries.
- Client mutations invalidate the same query families immediately.

## Feature Flags and Rollout

- Server flag: `TEAM_CONTACTS_ENABLED=false` by default.
- Public flag: `VITE_TEAM_CONTACTS_ENABLED=false` by default.
- Hidden navigation and `404` server routes when disabled.
- Apply the new migration to UAT with both flags false.
- Run advisors and the four-user authorization matrix.
- Enable both flags and redeploy only after database checks pass.
- Roll back by setting both flags false and redeploying. Do not drop tables or edit applied migrations.

## Security Requirements

- No unauthenticated contact lookup, request creation, acceptance, directory listing, phone read, or invite claim.
- No arbitrary authenticated phone enumeration endpoint.
- A caller sees a connected user's phone only after mutual acceptance.
- A request recipient does not see the requester's verified phone before acceptance. The acceptance surface explains that both verified numbers become visible only after acceptance.
- Contact rows remain owner-only.
- Invite URLs contain high-entropy opaque tokens; database stores hashes only.
- Tokens, phone lists, and JWTs are never logged.
- Request bodies are size-limited; normalized batch length is capped at 50.
- Requests, resend, accept, decline, cancel, remove, and claim are idempotent.
- Existing `public_identities` restrictions remain intact.

## Accessibility and Responsive Requirements

- All dialogs use labelled title/description, trapped focus, Escape close, and focus return.
- Contact and request actions are keyboard-operable with visible focus.
- Status changes announce through a polite live region.
- Phone errors are associated with the input.
- Touch targets are at least 44 px on mobile.
- Team navigation and rows work at 320 px, 390 px, tablet, and desktop widths.
- Reduced motion removes nonessential transition movement.

## Test Matrix

Automated tests must cover normalization, duplicate batching, unsupported picker fallback, token hashing, request authorization, idempotency, rate limits, explicit phone-sharing consent, invite claim, mutual connection, removal, identity visibility, mentions, List membership, notifications, deep-links, realtime invalidation, flags, accessibility, and mobile layout.

Live UAT requires four dedicated consented accounts:

1. Requester/Owner
2. Registered recipient/Assignee
3. Accepted Team member and List viewer
4. Stranger

The stranger must be unable to enumerate phone numbers, view requests, accept/decline/cancel another request, claim another phone's invite, list Team members, or assign a Thing through the Team relationship.

## Non-Goals for v1

- Automatic SMS delivery
- Background or continuous address-book sync
- CSV/vCard import
- International phone-number support
- Blocking/reporting
- Suggested contacts or social graph recommendations
- Organization-wide directory administration
- Automatic List membership
- Deleting historical Things or Catch activity when a connection is removed

## UAT-Ready Gate

The feature is ready for testers only when:

- Manual add and selected-contact sync work in supported browsers with manual fallback elsewhere.
- Request/accept is proven with real UAT sessions.
- Only accepted teammates see shared phone numbers and become assignable.
- Invite claim is bound to the same verified phone.
- List member tools and Magic Box mentions use accepted Team connections.
- Notifications and deep-links work.
- Four-user authorization tests and Supabase advisors pass without new security errors.
- Unit, typecheck, lint, build, Playwright, secret scan, and real UAT smoke tests pass.
- Both feature flags provide a tested fail-closed rollback.
