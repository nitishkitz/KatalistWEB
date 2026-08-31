# Team Contacts and Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a consent-based Team directory with manual Indian-phone add, selected-device-contact sync, secure share invitations, mutual connections, List member tools, Magic Box assignment, notifications, and a fail-closed UAT rollout.

**Architecture:** Keep public.contacts as an owner-private address book and add protected request/connection tables in katalist_priv. All discovery and mutation go through authenticated, column-limited RPCs or injected server handlers. Only accepted Team connections extend existing identity and assignment RPCs.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, Supabase Postgres/Auth/RLS, TanStack Start server routes, Playwright, Node test runner, Netlify, Web Contact Picker and Share APIs.

**Spec:** docs/superpowers/specs/2026-08-25-team-contacts-design.md

## Global Constraints

- Start from origin/codex/magic-box-v2 at or after f93b53f7c715ed35f5a30b798888afcc461c3144 in an isolated worktree.
- Read AGENTS.md. Use forward commits only; never rebase, amend, squash, or force-push published history.
- Do not touch dirty dev or untracked src/hooks/demo-session.ts.
- Create the migration with supabase migration new team_contacts. Never invent a timestamp or edit an applied migration.
- Do not apply SQL, change Netlify, enable flags, or touch production until Task 12.
- Never expose or log phone batches, invite tokens, JWTs, service-role keys, database URLs, auth peppers, or Firebase secrets.
- India-only v1: canonical +91 plus exactly 10 digits.
- Selected-contact sync only; no background sync, CSV/vCard, automatic SMS, blocking, or suggested contacts.
- A saved contact is never assignable. Only an accepted mutual connection changes visibility and assignment.
- Acceptance explicitly shares both verified phone numbers.
- Removing a connection never deletes Things, Catch history, external actors, or List memberships.
- TEAM_CONTACTS_ENABLED and VITE_TEAM_CONTACTS_ENABLED default false.
- npm run build remains vite build only.

## File Map

**Create:**

- src/features/team/types.ts
- src/features/team/phone.ts
- src/features/team/flags.ts
- src/features/team/team-api.server.ts
- src/features/team/queries.ts
- src/features/team/contact-picker.ts
- src/features/team/share-invite.ts
- src/features/team/TeamDirectory.tsx
- src/features/team/AddContactDialog.tsx
- src/features/team/SyncContactsDialog.tsx
- src/features/team/TeamPersonRow.tsx
- src/features/team/AddTeamMemberToListDialog.tsx
- src/features/team/demo.ts
- src/features/lists/use-list-members.ts
- src/features/lists/AddListMemberDialog.tsx
- src/routes/team.tsx
- src/routes/join-team.$token.tsx
- src/routes/api/team/requests.ts
- scripts/katalist-team.test.mjs
- scripts/katalist-team-api.test.mjs
- scripts/katalist-team-migration.test.mjs
- scripts/uat-team-authz.mjs
- tests/e2e/team.spec.ts
- one CLI-generated supabase/migrations/*_team_contacts.sql

**Modify:**

- src/components/layout/Sidebar.tsx
- src/domain/query-keys.ts
- src/features/people/directory.ts
- src/features/people/use-assignable.ts
- src/features/realtime/use-realtime.ts
- src/features/notifications/use-notifications.ts
- src/features/notifications/push-delivery.ts
- src/features/notifications/NotificationPanel.tsx
- src/routes/auth.tsx
- src/routes/lists.$listId.tsx
- src/integrations/supabase/types.ts
- src/routeTree.gen.ts
- .env.example
- netlify.toml
- playwright.config.ts
- docs/uat-runbook.md

---

### Task 1: Contracts, Indian phone normalization, and fail-closed flags

**Files:** Create types.ts, phone.ts, flags.ts, and scripts/katalist-team.test.mjs; modify .env.example and netlify.toml.

**Produces:** TeamDirectoryEntry, TeamRequestInput, TeamRequestResult, normalizeIndiaPhone, normalizeSelectedContacts, teamServerEnabled, teamUiEnabled.

- [ ] **Write failing tests**

Exact normalization cases:

~~~js
assert.equal(normalizeIndiaPhone("98765 43210"), "+919876543210");
assert.equal(normalizeIndiaPhone("09876543210"), "+919876543210");
assert.equal(normalizeIndiaPhone("+91-98765-43210"), "+919876543210");
assert.equal(normalizeIndiaPhone("12345"), null);
assert.equal(normalizeIndiaPhone("+1 202 555 0100"), null);
~~~

Assert duplicate selected numbers collapse to one row, aliases collapse whitespace, batches over 50 fail, and flags require exact string true.

- [ ] **Run and confirm failure**

~~~bash
npm test -- --test-name-pattern='team|India phone|contact batch|team flag'
~~~

- [ ] **Implement stable contracts**

~~~ts
export type TeamDirectoryState =
  | "connected"
  | "incoming"
  | "outgoing"
  | "invited"
  | "saved";

export type ContactSource = "manual" | "device";

export type TeamDirectoryEntry = {
  contactId: string | null;
  requestId: string | null;
  profileId: string | null;
  actorId: string | null;
  displayName: string;
  avatarUrl: string | null;
  phoneE164: string;
  source: ContactSource | null;
  state: TeamDirectoryState;
  inviteExpiresAt: string | null;
};

export type TeamRequestInput = {
  alias: string;
  phoneE164: string;
  source: ContactSource;
};

export type TeamRequestResult = {
  phoneE164: string;
  state: "outgoing" | "invited" | "connected";
  requestId: string | null;
  shareUrl?: string;
  error?: "invalid" | "self" | "rate_limited" | "unavailable";
};
~~~

normalizeIndiaPhone removes spaces, hyphens and parentheses; accepts optional 0 or +91; rejects all other prefixes; returns +91 plus 10 digits.

- [ ] **Implement flags**

~~~ts
export function teamServerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.TEAM_CONTACTS_ENABLED === "true";
}

export function teamUiEnabled() {
  return import.meta.env.VITE_TEAM_CONTACTS_ENABLED === "true";
}
~~~

Add both variables as false in .env.example and netlify.toml. Add no values that are secrets.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='team|India phone|contact batch|team flag'
npm run typecheck
git add src/features/team scripts/katalist-team.test.mjs .env.example netlify.toml
git commit -m "feat: define private Team contact contracts"
~~~

---

### Task 2: Protected Team schema and RPC state machine

**Files:** Generate supabase/migrations/*_team_contacts.sql; create scripts/katalist-team-migration.test.mjs; update Supabase types.

**Produces RPCs:** create_team_requests, list_team_directory, accept_team_request, decline_team_request, cancel_team_request, remove_team_connection, claim_team_invite, regenerate_team_invite.

- [ ] **Generate the migration only through the CLI**

~~~bash
supabase --version
supabase migration new team_contacts
~~~

Record the exact generated filename. Do not apply it.

- [ ] **Write failing migration assertions**

Assert contacts.source and owner-phone uniqueness; Team tables are private; no grants to anon/authenticated; each public definer RPC fixes search_path, checks auth.uid(), and revokes PUBLIC/anon; no DML touches auth.users or storage tables; token hashes are stored but raw tokens are not; canonical pair and active request uniqueness exist.

- [ ] **Add the schema**

~~~sql
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'device'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_owner_phone
  ON public.contacts(owner_profile_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE TABLE katalist_priv.team_connection_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_phone_e164 text,
  requester_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (
    status IN ('pending','invited','accepted','declined','cancelled','expired')
  ),
  invite_token_hash text,
  invite_expires_at timestamptz,
  accepted_at timestamptz,
  resolved_at timestamptz,
  last_shared_at timestamptz,
  share_window_started_at timestamptz,
  share_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((recipient_profile_id IS NULL) <> (invite_phone_e164 IS NULL)),
  CHECK (recipient_profile_id IS NULL OR recipient_profile_id <> requester_profile_id)
);

CREATE TABLE katalist_priv.team_connections (
  profile_low uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_high uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accepted_request_id uuid NOT NULL
    REFERENCES katalist_priv.team_connection_requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_low, profile_high),
  CHECK (profile_low < profile_high)
);
~~~

Add indexes for requester, recipient, status, invited phone, token hash, and both connection endpoints. Revoke all from PUBLIC, anon, authenticated; grant private-table access only to service_role.

- [ ] **Add rate limiting and active-request uniqueness**

Use a private fixed-window counter keyed by SHA-256 of requester profile and window kind. Lock counters FOR UPDATE. Enforce 5 new requests per 15 minutes, 20 per day, and at most one active request per requester/target. Resend is limited to 3 per day and at least 60 seconds apart. Duplicate active requests return existing state and create no duplicate notification.

- [ ] **Implement exact RPC authorization**

~~~sql
public.create_team_requests(p_entries jsonb)
public.list_team_directory()
public.accept_team_request(p_request_id uuid)
public.decline_team_request(p_request_id uuid)
public.cancel_team_request(p_request_id uuid)
public.remove_team_connection(p_other_profile_id uuid)
public.claim_team_invite(p_token_hash text)
public.regenerate_team_invite(p_request_id uuid, p_token_hash text)
~~~

Requirements:

1. create_team_requests accepts 1–50 canonical entries, rejects self, upserts only caller-owned contacts, matches profiles privately, and returns one result per entry.
2. list_team_directory returns only caller-related rows. Another registered user's phone is returned only for connected rows; incoming rows expose requester name/avatar plus consent copy, never the phone.
3. accept requires recipient_profile_id = auth.uid(), locks the request, inserts least/greatest pair once, and marks accepted once.
4. claim requires the caller verified profile phone to equal invite_phone_e164, binds recipient, changes invited to pending, and never auto-accepts.
5. cancel applies only to caller outgoing/invited; decline only to recipient incoming; remove only to an edge containing caller.
6. All mutations are idempotent and reject missing auth.uid() before reading private rows.

- [ ] **Extend identity and assignment RPCs in this same unapplied migration**

Add accepted-Team branches to:

~~~text
list_assignable_people
list_visible_profile_identities
resolve_profile_identities
resolve_actor_identities
~~~

No saved, invited, outgoing, declined, cancelled, expired, or removed state qualifies.

- [ ] **Add notifications transactionally**

Registered request inserts team_request. Acceptance inserts team_accepted. Payload contains only an allowlisted relative path such as /team?request=<uuid>; no phone or token.

- [ ] **Regenerate and review Supabase TypeScript types**

Use the repository-established CLI command. Review that the diff adds only intended columns/RPCs.

- [ ] **Verify and commit without applying SQL**

~~~bash
npm test -- --test-name-pattern='Team migration|Team grants|Team RLS|Team state'
npm run typecheck
git diff --check
git add supabase/migrations scripts/katalist-team-migration.test.mjs src/integrations/supabase/types.ts
git commit -m "feat: add consent-based Team connection schema"
~~~

Report explicitly: migration created, not applied.

---

### Task 3: Authenticated request API and secure invitation tokens

**Files:** Create team-api.server.ts, api/team/requests.ts, scripts/katalist-team-api.test.mjs; regenerate route tree.

**Produces:** createTeamRequestHandler(deps) and POST /api/team/requests.

- [ ] **Write injected-handler tests**

Cover flag false 404 before auth/RPC; missing or invalid bearer 401; body over 32 KiB; empty/over-50 batch; invalid/self entries; registered result without share URL; unregistered result with one-time URL; duplicate active request without new notification/token; no phone/JWT/token logs.

- [ ] **Define injected dependencies**

~~~ts
export type TeamApiDeps = {
  authenticate(request: Request): Promise<{ userId: string }>;
  createRequests(
    input: Array<TeamRequestInput & { tokenHash: string }>,
  ): Promise<TeamRequestResult[]>;
  origin(request: Request): string;
  randomToken(): string;
  hashToken(token: string): string;
};

export function createTeamRequestHandler(deps: TeamApiDeps) {
  return async (request: Request): Promise<Response> => {
    // flag, size, auth, parse, normalize, hash, RPC, no-store response
  };
}
~~~

Use randomBytes(32).toString("base64url") and SHA-256. Store/pass only the hash. Build /join-team/<raw-token> only for a new invited result.

- [ ] **Wire live route with user-scoped authorization**

Build a user-scoped Supabase client from the verified bearer. Do not use service_role as the caller authorization source. Responses are cache-control: no-store.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='Team request API'
npm run typecheck
npm run lint -- src/features/team src/routes/api/team
git add src/features/team/team-api.server.ts src/routes/api/team scripts/katalist-team-api.test.mjs src/routeTree.gen.ts
git commit -m "feat: add secure Team invitation API"
~~~

---

### Task 4: Query layer and deterministic preview state

**Files:** Create queries.ts and demo.ts; modify query-keys.ts and team tests.

**Produces hooks:** useTeamDirectory, useCreateTeamRequests, useAcceptTeamRequest, useDeclineTeamRequest, useCancelTeamRequest, useRemoveTeamConnection, useRemoveSavedContact.

- [ ] **Write failing mapping/state tests**

Assert all five states, stable sort order incoming/connected/outgoing/invited/saved, normalized search, and preview/live selection.

- [ ] **Add query keys**

~~~ts
team: (profileId: string | undefined) => ["team", profileId] as const,
teamInvite: (tokenHash: string) => ["team-invite", tokenHash] as const,
~~~

- [ ] **Implement hooks**

Real sessions call the Team RPCs. Demo sessions use deterministic local state. Every successful mutation invalidates team, profile-directory, assignable-people, lists, list, notifications, and notifications-unread. Failures keep UI state and map to safe domain copy.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='Team query|Team directory|Team preview'
npm run typecheck
git add src/features/team/queries.ts src/features/team/demo.ts src/domain/query-keys.ts scripts/katalist-team.test.mjs
git commit -m "feat: add Team directory state hooks"
~~~

---

### Task 5: Team page, navigation, manual add, and row actions

**Files:** Create team route, TeamDirectory, TeamPersonRow, AddContactDialog; modify Sidebar and route tree.

- [ ] **Write failing UI/source tests**

Assert Team appears on desktop/mobile only when enabled; filters and search exist; fixed +91 field and error association; connected/incoming/outgoing/invited/saved actions match the spec; invite token never appears in DOM text/accessibility names.

- [ ] **Implement navigation**

Add Team with Users icon between Lists and Buckets. Preserve every destination. Verify six mobile items at 320 px and 390 px; do not hide another feature.

- [ ] **Implement Team page**

Header actions: Add by number and Sync contacts. Filters: All, Connected, Requests, Invited. Rows are responsive list items. Include explicit loading, retry, offline, empty, expired, and rate-limited states.

- [ ] **Implement manual add**

Fixed +91 plus 10-digit input; optional alias, required when unregistered; canonical review before send. Handle connected, outgoing, invited, self, invalid, duplicate, and rate-limited results. Announce success and return focus.

- [ ] **Make actions idempotent**

One active row action at a time. Double clicks call once. Remove connection confirmation says Things and Lists remain. Incoming acceptance repeats the phone-sharing consent.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='Team UI|manual contact|Team navigation'
npm run typecheck
npm run lint -- src/features/team src/routes/team.tsx src/components/layout/Sidebar.tsx
git add src/routes/team.tsx src/features/team src/components/layout/Sidebar.tsx src/routeTree.gen.ts scripts/katalist-team.test.mjs
git commit -m "feat: add Team directory and manual requests"
~~~

---

### Task 6: Selected-device-contact sync and share actions

**Files:** Create contact-picker.ts, SyncContactsDialog.tsx, share-invite.ts; modify Team page/rows and tests.

- [ ] **Write failing adapter tests**

Cover unsupported/insecure browser, user cancellation, duplicate/multiple numbers, invalid India numbers, 50 cap, native Share success/cancel, Copy fallback, and WhatsApp/SMS links containing only approved text and opaque invite URL.

- [ ] **Implement only the selected Contact Picker contract**

~~~ts
export type ContactsNavigator = Navigator & {
  contacts?: {
    select(
      properties: Array<"name" | "tel">,
      options: { multiple: boolean },
    ): Promise<SelectedDeviceContact[]>;
  };
};
~~~

Call only navigator.contacts.select(["name", "tel"], { multiple: true }). Never request or persist the full address book.

- [ ] **Implement review and partial-batch recovery**

Normalize/deduplicate, show review rows, cap at 50, allow removal before send. Successful entries clear/change state; failed entries remain with Retry/Remove. Unsupported browser says Add by number instead.

- [ ] **Implement Share**

Prefer navigator.share. Fall back to Copy Link plus WhatsApp/SMS actions. No raw phone in URL, analytics, or console.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='Contact Picker|selected contacts|share invite'
npm run typecheck
npm run lint -- src/features/team
git add src/features/team scripts/katalist-team.test.mjs
git commit -m "feat: add privacy-first selected contact sync"
~~~

---

### Task 7: Invite deep-link, safe auth return, and explicit consent

**Files:** Create join-team.$token.tsx; modify auth route, queries, route tree, tests.

- [ ] **Write failing invite/auth tests**

Cover unauthenticated return to invite; reject external, protocol-relative, encoded, and JavaScript return URLs; wrong verified phone; correct phone binds but does not auto-accept; exact consent; idempotent accept; expired/cancelled/accepted/malformed token states.

- [ ] **Add safe return parser**

~~~ts
export function safeAuthReturnPath(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  return value.startsWith("/join-team/") ? value : "/";
}
~~~

Do not accept origins or protocols.

- [ ] **Implement invite resolution**

Hash raw URL token before RPC. Never persist/log raw token. claim_team_invite binds the verified matching profile. Render requester identity and exact consent: “Accepting connects you both in Team and shares your verified phone numbers with each other.” Accept calls accept_team_request.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='Team invite|safe auth return|phone consent'
npm run typecheck
npm run lint -- src/routes/join-team.\$token.tsx src/routes/auth.tsx src/features/team
git add src/routes/join-team.\$token.tsx src/routes/auth.tsx src/routeTree.gen.ts src/features/team/queries.ts scripts/katalist-team.test.mjs
git commit -m "feat: add consent-bound Team invite acceptance"
~~~

---

### Task 8: Magic Box identity and assignment integration

**Files:** Modify people directory/use-assignable; optionally ranking; update ranking/team tests.

- [ ] **Write failing relationship tests**

For saved, outgoing, invited, declined, connected, removed: only connected adds identity/assignable actor. Existing Thing/List relation still grants its independent access after Team removal.

- [ ] **Keep phone out of Magic Box**

Person remains actor ID, display name, initials, avatar. Do not add phone to mention components, analytics, history, or accessible labels.

- [ ] **Add deterministic Team ranking only if needed**

If RPC ordering is insufficient, pass connectedTeamActorIds into rankAssignablePeople. Exact/prefix text relevance remains first, current List membership second, Team next, then recency/frequency/context. Team rank never beats exact text.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='Team assignable|Magic Box ranking|mention'
npm run typecheck
git add src/features/people src/features/court/magic-box scripts/magic-box-ranking.test.mjs scripts/katalist-team.test.mjs
git commit -m "feat: make accepted teammates assignable"
~~~

---

### Task 9: Functional List membership controls

**Files:** Create use-list-members.ts, AddListMemberDialog.tsx, AddTeamMemberToListDialog.tsx; modify lists.$listId.tsx and tests.

- [ ] **Write failing permission tests**

Only List Owner sees administration; candidates are accepted Team connections not already owner/member; collaborator/view-only cannot administer; owner cannot be inserted as member; Team removal preserves List membership and List removal preserves Team.

- [ ] **Wrap existing RPCs**

Use add_list_member, update_list_member_role, remove_list_member with role union collaborator/view_only. On success invalidate list, lists, profile-directory, assignable-people.

- [ ] **Replace placeholder Owner tools**

Add Team picker, role selector, Add, role change, and Remove confirmation. Preserve copy that Thing assignment does not create membership.

- [ ] **Add Add to List from connected Team rows**

List only Lists owned by caller. Reuse the same membership hook; do not duplicate logic.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='Team List|List member administration'
npm run typecheck
npm run lint -- src/features/lists src/features/team src/routes/lists.\$listId.tsx
git add src/features/lists src/features/team/AddTeamMemberToListDialog.tsx src/routes/lists.\$listId.tsx scripts/katalist-team.test.mjs
git commit -m "feat: add teammates to Lists with owner controls"
~~~

---

### Task 10: Notifications, deep-links, push, and realtime

**Files:** Modify unapplied Team migration, notifications, push delivery, notification panel, realtime, tests.

- [ ] **Write failing navigation tests**

team_request opens /team?request=<uuid>; team_accepted opens /team; malformed/unknown payload falls back to /; no phone/token in title, body, payload.

- [ ] **Extend mapping safely**

Select kind and payload. Allow only /?thing=<uuid>, /lists/<uuid>, /team, /team?request=<uuid>. Validate UUID before navigation.

- [ ] **Add Team navigation and realtime**

Notification click marks read, closes panel, navigates/highlights request. Notification changes invalidate team, profile-directory, assignable-people, and notifications. Do not subscribe directly to private Team tables.

- [ ] **Verify and commit**

~~~bash
npm test -- --test-name-pattern='Team notification|notification navigation|push'
npm run typecheck
git add supabase/migrations src/features/notifications src/features/realtime scripts/notification-navigation.test.mjs scripts/katalist-team.test.mjs
git commit -m "feat: notify and refresh Team connections"
~~~

Migration remains unapplied.

---

### Task 11: Real-app browser coverage, accessibility, and release gate

**Files:** Create tests/e2e/team.spec.ts; modify preview demo, Playwright config, tests.

- [ ] **Add deterministic preview data**

One connected, incoming, outgoing, invited, saved entry. Preview mutations are local/idempotent and never claimed as database authorization proof.

- [ ] **Write real-component Playwright tests**

Cover keyboard filters/search/dialog focus/Escape/focus return; manual outcomes; incoming consent/double Accept; picker supported/unsupported; Share fallback; List add; connected teammate in Magic Box while invited absent; remove preserving List/Thing; 320/390 px no overflow; reduced motion/live region.

- [ ] **Run complete verification**

~~~bash
npm test
npm run typecheck
npm run lint
npx playwright test tests/e2e/team.spec.ts --project=chromium
npm run build
git diff --check
~~~

Scan tracked files and built client assets for service-role JWTs, sb_secret_, sbp_, peppers, Firebase private keys, raw tokens, and VITE_ server secrets. Variable names alone are allowed.

- [ ] **Commit and request review**

~~~bash
git add tests/e2e/team.spec.ts playwright.config.ts src/features/team/demo.ts scripts/katalist-team.test.mjs
git commit -m "test: verify Team contacts in the real application"
~~~

Review the full forward range for phone privacy, BOLA/IDOR, open redirects, token leaks, idempotency, notification payloads, and build/migration isolation. Fix only through forward commits. Push normally and record final SHA.

---

### Task 12: UAT-only migration, four-user authorization, rollout, and pilot gate

**Files:** Create scripts/uat-team-authz.mjs; update docs/uat-runbook.md.

- [ ] **Freeze UAT target**

Confirm Supabase dyxqlgnbwtbxxdfoiqva, Netlify startling-frangollo-bcf845, both Team flags false, production untouched, and exact reviewed Git SHA. Read remote migration list; abort if unrelated migrations are pending.

- [ ] **Apply only reviewed Team migration**

Use migration-aware Supabase CLI from isolated checkout. Never Dashboard SQL or Netlify build. Record migration list before/after. Never edit after application.

- [ ] **Run advisors and structural checks**

Verify grants, contacts RLS, fixed search paths, constraints, indexes, idempotency, and no new security errors.

- [ ] **Run four-session matrix with redacted output**

Use ignored variables:

~~~text
UAT_TEST_OWNER_PHONE
UAT_TEST_ASSIGNEE_PHONE
UAT_TEST_VIEWER_PHONE
UAT_TEST_STRANGER_PHONE
~~~

Prove owner-only saved contacts; recipient-only accept/decline; requester-only cancel/regenerate; same-phone invite claim; mutual connection and post-accept phone sharing; stranger denial for enumerate/list/read/claim/mutate; double operations idempotent; removal removes Team assignment but preserves independent List/Thing access. Clean only uniquely prefixed artifacts through authorized APIs.

- [ ] **Enable flags and deploy exact SHA**

Set TEAM_CONTACTS_ENABLED=true and VITE_TEAM_CONTACTS_ENABLED=true on the UAT site only. Deploy. Confirm client contains only public flag and no secrets.

- [ ] **Run live UAT**

Using OTP 111111, prove manual add, device selection and fallback, registered request notification, unregistered share link, same-phone registration/claim, consent, mutual phone visibility, Magic Box @ assignment, Toss/Catch, List add/change/remove, Team removal, notification deep-link, refresh/realtime, desktop, and 390 px mobile.

- [ ] **Exercise fail-closed rollback**

Set both flags false and redeploy same SHA. Verify Team nav hidden and request API 404. Re-enable only if every test passed. Do not drop tables/functions.

- [ ] **Commit runbook and report**

~~~bash
git add scripts/uat-team-authz.mjs docs/uat-runbook.md
git commit -m "docs: add Team contacts UAT acceptance gate"
git push origin codex/magic-box-v2
~~~

Report final SHA, target, migration, advisors, authorization matrix, live flows, browser fallback, test counts, secret scan, flags, rollback proof, and remaining issues. Never include phone values/tokens/secrets.

Use exactly one conclusion:

~~~text
READY FOR TESTERS AND LIMITED PILOT
~~~

or:

~~~text
NOT READY — TEAM FLAGS RESTORED TO FALSE
~~~

## Completion Checklist

- [ ] Private saved contacts and mutual Team connections remain separate.
- [ ] Manual India phone add and selected-contact picker work.
- [ ] Unsupported browsers have manual fallback.
- [ ] Registered requests and unregistered secure links work.
- [ ] Acceptance is explicit, idempotent, phone-bound, and shares verified numbers.
- [ ] Only accepted teammates extend visibility and assignment.
- [ ] Team-to-List administration works through existing owner RPCs.
- [ ] Notifications, push navigation, and realtime invalidation work.
- [ ] Remove is mutual and preserves independent history/access.
- [ ] Flags fail closed before migration and during rollback.
- [ ] Four-user UAT authorization and real flows pass.
- [ ] No new security errors, secret exposure, migration-in-build, or production change exists.
