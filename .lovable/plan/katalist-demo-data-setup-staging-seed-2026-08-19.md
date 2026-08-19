# Katalist — Demo Data Setup (Staging Seed)

The database is currently empty (0 users, 0 profiles, 0 things, 0 lists, 0 actors), so every demo screen has nothing to render against. This plan adds a repeatable, clearly-marked demo seed that drives the existing backend through its real RPCs — no schema, migration, RLS, RPC, enum, or lifecycle change.

## Approach

A single Bun seed script, run manually, never shipped into app code:

- `scripts/seed-demo.ts` — orchestrator, marked DEMO/STAGING ONLY
- `scripts/seed-demo/*.ts` — data definitions per area (people, things, lists, buckets, nudges, bridge, notifications)
- `scripts/reset-demo.ts` — clears all demo rows and demo auth users

Run: `bun scripts/seed-demo.ts` (and `bun scripts/reset-demo.ts` to clear). Both read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the environment, exactly like the existing test runners.

### Demo identities are phone-based

Phone is the canonical Katalist identity, so every demo person is created through the admin API with a real Supabase **phone** identity, `phone_confirm: true`, and `demo: true` in user metadata — no email/password anywhere, no UI change, no frontend demo bypass. Stable staging-only numbers are reserved for Katalist demo use:

| Person | Phone |
| --- | --- |
| Priya Sharma (primary demo login) | +91 90000 00001 |
| Arjun Mehta | +91 90000 00002 |
| Sarah Kapoor | +91 90000 00003 |
| Mike Fernandes | +91 90000 00004 |
| Neha Rao | +91 90000 00005 |
| Vikram Singh | +91 90000 00006 |

Rohan Shah and David Lee stay external identities with external actors only — never converted to authenticated users.

Each seeded user resolves through the normal Profile → Actor path (the existing `handle_new_user` trigger), so history and existing-user restoration behave exactly as for a real phone-authenticated user.

**Login experience.** Supabase supports staging "test phone numbers" with a fixed OTP, configured in Auth → Sign In / Providers → Phone. That setting lives in the hosted project's Auth config, which this seed cannot change from code. Plan: the seed creates the confirmed phone users and prints the exact list of numbers to register as test numbers plus the fixed OTP to set (e.g. `000000`). You (or I, if you grant it) add them once in the Supabase dashboard, staging only. Then the flow is exactly the product flow: open the normal phone login screen → enter +91 90000 00001 → enter the staging OTP → continue as a normal authenticated user. If you would rather not touch the dashboard, I will stop and ask before using any alternative — I will not switch the product to email/password.

### How the seed drives the backend

Signed in as each demo person, the script calls the existing RPCs (`create_thing`, `catch_thing`, `set_work_status`, `assign_thing`, `reassign_thing`, `sort_thing`, `cancel_thing`, `create_list`, `add_list_member`, `create_bucket`, `add_to_bucket`, `nudge_thing`, `shred_for_me`, `issue_bridge_grant`, comment/message inserts). Sessions for seeding are minted server-side with the service role (admin-generated session, never exposed to the browser), so seeding does not depend on OTP delivery. This keeps every invariant, trigger, and activity log authentic — no trigger disabled, no invariant bypassed.

Only where an RPC cannot produce the needed shape does the script fall back to a service-role update, kept inside the seed script and commented with the reason:

- backdating `created_at` / `assigned_at` / activity timestamps so "quiet" Things qualify for Nudges and history looks like several days of work
- backdating notification timestamps

No new SQL function, no seed RPC, no public endpoint, no destructive helper in production code.

### Idempotency and reset

The script derives stable keys from demo emails and Thing titles. On rerun it first calls the same teardown used by `reset-demo.ts` (delete demo auth users → cascade profiles/actors/things; remove demo external identities), then seeds fresh. That makes reruns safe and deterministic rather than accumulating duplicates.

## Dataset

**People (8)** — Priya Sharma (primary demo user, Operations Manager), Arjun Mehta, Sarah Kapoor, Mike Fernandes, Neha Rao, Vikram Singh as full profiles/user actors; Rohan Shah and David Lee as external identities with external actors only (no membership, no List access).

**Priya's Court** — 12–18 active Things spread across NOW / NEXT / LATER using the exact examples given, with Owner Importance and Personal Pace set independently (including importance NOW + pace NEXT, and importance NEXT + pace NOW). Coverage includes Waiting for Catch (no pace), Caught + Not Started, Caught + Under Progress, plus historical Sorted and Cancelled Things. Due dates mix today, later today, tomorrow, this week, and none.

**Their Court** — Priya-owned Things assigned to others: QA Android production build → Arjun and Review launch contract → Vikram (waiting for catch); Finalize launch email copy → Sarah and Upload product screenshots → Mike (caught, moving); Vendor pricing confirmation → Rohan and Client approval document → Neha (backdated to read as needing attention).

**Lists (4)** — Mobile App Launch, Website Relaunch, Q4 Marketing Campaign, Office Operations, with the exact membership and roles specified. Each list gets several Things; some Things stay standalone. Collaborator-created list Things keep the collaborator as Thing Owner, per the locked rule. List Chat messages are added where Priya has access, kept separate from Thing Comments, which are added to selected Things.

**Buckets (4, private to Priya)** — This Week, Launch Focus, Waiting on Others, Home Admin; each references existing Things/Lists, with at least one Thing appearing in two buckets.

**Nudges** — timings backdated so the Nudges screen can show Waiting for Catch, Needs a Tap (e.g. Vendor pricing confirmation gone quiet), Recently Nudged, Caught & Moving, and Stale / Review. No nudges against Sorted or Cancelled Things.

**Bridge** — "Review final print proof" assigned to David Lee (external actor) with a valid grant issued via `issue_bridge_grant`. The raw token is printed once to the seed console only, never written into source, seed output files, or frontend code.

**Work / Home** — both contexts populated (campaign budget, release copy, vendor contract vs. electrician, car insurance, birthday gift, home repair). One time-bound Home Thing is left in a state that produces a Ghost Card while Work context is active — same underlying Thing, no duplicate.

**Recently Shredded** — a few `shred_for_me` examples on personal Things only (an old reference task, an obsolete shopping reminder, a cancelled personal note), respecting the rule that Priya cannot shred Things where she is active Owner or Assignee.

**Activity history** — authentic sequences generated by the RPC calls themselves: created → assigned → caught → under progress → commented → nudged; created → assigned → reassigned → waiting → caught; and one full created → caught → under progress → sorted. History is never rewritten, only timestamps backdated.

**Notifications** — a small set produced by the real triggers (assigned, caught, nudged, sorted, comment received), trimmed to a believable volume.

All copy is polished business content — no lorem ipsum, no "Test Task 1", no placeholder names.

## Verification after seeding

Run in order and report results: backend test suite (`bun tests/run-backend-tests.ts`), Bridge E2E (`bun tests/run-bridge-e2e.ts`), TypeScript check, and production build. The existing suites must still pass.

## Report delivered on completion

Files added, exact seed command, demo login identity and safe sign-in instructions, counts per entity type, a mapping of which records populate each screen (Court NOW/NEXT/LATER, Their Court, Lists, Buckets, Nudges, Work/Home, Ghost Card, Recently Shredded), and any backend capability that could not be demonstrated without changing the frozen architecture.

No frontend screen implementation happens in this phase — work stops after seeding and verification.

## One dashboard step you'll need

Registering the six demo numbers as Supabase test phone numbers with a fixed OTP is an Auth-config change in the dashboard, not something the seed can do. Everything else is fully automated.
