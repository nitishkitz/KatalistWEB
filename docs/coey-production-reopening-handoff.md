# Sonnet 5.5 implementation handoff: reopen Katalist production

## Your assignment

Implement this plan in `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev`. The user wants the existing production application working end to end, including mobile login, Magic Box, connections, scheduled follow-ups and outbound notifications. Use the existing Supabase and Vercel projects. Do not create a UAT environment or relabel production as development to bypass authentication checks. Finish implementation and deployment, then produce evidence for Codex's independent review.

Read applicable AGENTS.md instructions, including Laya classification if available. Preserve other agents' work and pushed Git history. Do not force-push, amend pushed commits, reset the working tree, rerun the data cleanup, or restore deleted accounts.

The user explicitly requests a **temporary static OTP displayed beneath the OTP entry field in production**, until an SMS provider is supplied. Implement that choice explicitly. A displayed shared code does not verify phone ownership and permits access to a known registered number. Do not describe it as secure SMS verification or claim phone ownership is verified. Keep the real SMS replacement path ready.

## Read first and establish actual state

Read both original requirements fully:

- `/Users/nagasainathreddy/Downloads/Coey Placement Tree (Copy).md`
- `/Users/nagasainathreddy/Downloads/Katalist_Coey_Scheduling_Model_Developer_Spec (1).docx`

Then read:

- `docs/coey/requirement-register.md`, `decision-register.md`, `acceptance-report.md`
- `docs/existing-backend-reset-status.md`
- `output/coey-code-review/review.md` and `review-6437276e.md`
- `scripts/reset/fence.sql` and `unfence.sql`

Expected starting commit is `ef0845ee`, following `6437276e`. Verify HEAD; do not assume it. There are uncommitted reset controls plus newer phone-only UI changes and `scripts/phone-only-login.test.mjs`. Include needed changes deliberately after reviewing the diff; do not lose them or commit unrelated artifacts, archives, credentials or local environment files.

Expected shared target:

- Supabase project `jrdsmmiggezrhiakncwc`.
- Vercel project `katalist-web`, ID `prj_5YQ9x4FuPcuEmwJhEiCP0iHjD7Pq`, team `team_Ws7POyOe9QuJDVyHcO355b4a`.
- Last recorded production alias: `https://katalist-web-nitheshs-projects-d9732806.vercel.app`.

Verify these against the linked configurations and provider APIs without printing secrets. Local, preview and production historically share this backend. Opening its schema does not isolate access to localhost. Inventory old deployment URLs and prevent old code from serving writes during the transition.

At last inspection, production and old cron triggers were paused, Supabase signup and database access were fenced, and the data cleanup had completed. Local `.env.local` maintenance was subsequently set to false and Vite restarted; `/auth` returned 200 but database access was still denied. Recheck this state before mutations. Do not infer a successful login from HTTP 200.

## 1. Implement explicit production static-code login

1. Keep mobile number as the only sign-in method. Remove any remaining “Use email instead” responses from server handlers as well as UI. Optional profile email is contact information, not a sign-in requirement.
2. Introduce an explicit server-controlled phone-auth mode, for example `KATALIST_PHONE_AUTH_MODE=static` or `sms`. Keep `KATALIST_ENV=production`. Do not turn off the existing production guard by calling production UAT.
3. Store the configured static code server-side, outside source control. Resolve client capability and displayed code from the server's public login configuration, so the code displayed and the code accepted cannot drift across builds. Never return service credentials or tokens with this configuration. Prevent caching stale login configuration.
4. Display `Temporary sign-in code: [code]` immediately beneath the six code boxes, with “No SMS sent.” Show it only in static mode. The SMS path must never expose its verification code. Do not automatically fill or submit the displayed value.
5. Validate the submitted code on the server; a browser comparison is not authorization. Normalize phone numbers consistently. Reject invalid numbers and incorrect/missing codes. Apply persistent rate limits and bounded login attempts; do not rely on process-local counters in serverless deployments. Clearly distinguish expired request, wrong code, network failure and maintenance.
6. Ensure repeated and concurrent login attempts for one phone resolve to one account. Preserve a canonical normalized phone identity so switching to real SMS later reuses the same user and Things. Review the existing placeholder-email/admin-generated-link mechanism before extending it. Do not mark the phone as ownership-verified just because the static code matched. Avoid exposing whether another person's account exists.
7. Complete first-login profile creation with name and phone; email remains optional. Returning users go directly to Court. Refresh, logout and subsequent login must preserve the correct account.
8. Document the exact SMS cutover: configure the provider, switch server mode, verify actual Supabase SMS OTP, remove static-code exposure and acceptance, and prove existing users retain their IDs and data. Add a single server-side off switch for static login.

Do not rotate or replace unrelated credentials. Never log OTP submissions, phone numbers, access/refresh tokens, management credentials or service-role keys.

## 2. Apply database changes while traffic remains fenced

Read actual remote migration history and schema before applying anything. Nine Coey migrations are expected, but skip only versions whose application is verified:

1. `20261013120000_explicit_connections.sql`
2. `20261013121000_connect_discovery.sql`
3. `20261013130000_coey_scheduling.sql`
4. `20261013140000_coey_followups.sql`
5. `20261013150000_coey_presence.sql`
6. `20261013160000_coey_recurrence.sql`
7. `20261013170000_coey_chain_relay.sql`
8. `20261013180000_coey_review_fixes.sql`
9. `20261013190000_coey_rereview_fixes.sql`

The earlier scheduling migration was edited before its reported first application. Compare actual schema and history; if already applied remotely, use a forward repair migration instead of pretending the edit ran. Existing remote history may drift. Do not blindly `db push`, replay all historical migrations into production, or manually manufacture migration-history rows. `npm run db:migrate` targets the separate `migrations/` tree, not these Supabase migrations.

Apply reviewed pending migrations one at a time, transactionally where supported, with bounded lock/statement timeouts. Record each successful version using supported migration tooling. Stop on an error, preserve the fence, report the exact stage, and repair forward. Verify new tables/functions, RLS, private schema privileges, triggers and expected RPC signatures. Do not solve permission errors by granting ALL to every role or disabling RLS.

Keep the reset's anonymous worker/test-function privilege repair. Confirm zero unexpected user data before schema changes; if data has appeared, preserve it and account for migration effects. Do not run cleanup scripts or seed functions.

## 3. Close the remaining call impersonation gap

The current public call-lobby broadcast trusts caller identity from the payload. Membership and block checks alone do not authenticate that claim.

Replace it with an authenticated signaling path. Use appropriately authorized private Realtime channels or a server-mediated ring flow, and bind sender identity to the authenticated session. Private channel membership by itself does not prevent one authorized group member impersonating another: the receiver needs trustworthy sender identity too. Apply the same block/connection rules to both push and in-app delivery. Cover reject, join, reconnect and block-during-call behavior as applicable.

Prove that a group member cannot use another member's ID/name to reach a person who blocked them. Ordinary group members who are not blocked should remain callable. No live calls to unrelated people during verification.

## 4. Prepare and activate production services

1. Verify production's server-only Sarvam configuration and action-signing secret. Chat only; keep the microphone hidden and voice disabled.
2. Verify Firebase/push credentials and device-token registration. Never assume that setting an enable flag proves delivery.
3. Configure a durable scheduler capable of calling the rebuilt follow-up job every five minutes. Verify the current hosting plan's actual scheduling limits from official documentation and provider settings. A laptop process, browser timer or daily job is not a production solution. Prefer an existing supported scheduler/account. If a new paid service or plan change is necessary, present the specific cost and required account action before spending; complete other independent work first.
4. Authenticate the scheduled request using a server-only secret. Repeated ticks and overlapping runs must not duplicate notifications. Retire the old escalation/notification schedule rather than running it beside the new one. Review any retained housekeeping job separately so it cannot resurrect the old nudge behavior.
5. Confirm follow-ups respect work/home windows, leave, timezone, promises, snooze, blocks, schedule revision, calendar revision and daily budgets. Delivery must recheck eligibility at execution time. Inspect batch limits and pagination so an oversized holder batch cannot silently starve.
6. Ensure failed push delivery is observable and can be retried without falsely marking it sent or delivering duplicates. Keep useful operational counts without logging personal content or secrets.
7. Prepare production with maintenance enabled until schema and configuration checks complete. Deployment must contain the exact reviewed commit and current auth changes. Verify build identity through a safe commit/version marker; the user previously received an old deployment.
8. Restore only the recorded schema access and remove reset signup/storage triggers using the reviewed recovery procedure. Reopen the required Auth settings, set production site URL and redirect allow-list, and verify Auth bootstrap creates a profile and actor successfully.
9. Activate the current production deployment, remove maintenance, then enable the rebuilt background jobs and outbound delivery. The final working state must not leave these silently disabled. Verify production cron configuration and job logs, not just environment variables.

This user has requested execution, migrations, production reopening, jobs and notifications. Do not repeatedly ask routine approval for those same actions. If a tool's approval review blocks a specific operation, report that exact operation and reason, and continue unaffected work. Do not evade a rejection.

## 5. Perform a bounded real production acceptance run

Use a small, clearly identified set of verification accounts with no unrelated contacts. Developer regression tests can still use disposable fixtures; the deployed target is production, not UAT. Keep verification identities identifiable and report their IDs/counts without OTPs or tokens. Remove only fixtures created by this run when safe; preserve anything the user has started using.

Check these flows in a real browser against the deployed backend:

| Area | Required result |
| --- | --- |
| Mobile login | Code shown beneath field; incorrect code rejected; correct code creates a real session; optional email; refresh and return login work. |
| Access isolation | Account A cannot read B's private Things through UI or direct API. No schema-permission errors. |
| Connections | Sending a request does not connect users; only recipient acceptance connects; decline, disconnect and block work. Google Contacts is absent. |
| Toss interpretation | Questions switch to Ask without creation; gibberish asks/keeps privately; early Enter succeeds without duplicate requests or Things. |
| Recipient resolution | “Call Ravi about GST” stays with the sender; duplicate/near/unknown names ask instead of assigning. |
| Dates and placement | EOD uses holder hours; “end of week” asks; before/by dates preview correctly; Today/week use the user's timezone; Inbox and lane movement agree with the spec. |
| Real saves | Toss persists once; refresh preserves it; title opens the actual Thing; files and shared destinations honor privacy. |
| Ownership | Wrong person and Keep it for me update permission and Court ownership; serve-back, answer, Catch, promise and Sort work for the right person. |
| Ask | Named-person results are clickable; “other than me” excludes self; overdue and stale remain distinct; multi-turn person changes keep filters; unknown names preserve context. |
| Calls | Allowed users can ring/join; blocked or impersonated callers cannot reach recipients; remaining unblocked group members still work. |
| Follow-ups | At least one real scheduled tick reaches the endpoint; a controlled eligible Thing produces the right in-app result and an authorized later-step push; retry does not duplicate; promised/snoozed/blocked/leave items stay quiet. |
| Recurrence/relay | Sorting advances exactly once; repeat requests do not create duplicate occurrences or chain handoffs. |
| Layout | Desktop and mobile: long input wraps, compact questions fit, confirmation actions stay visible, background dims, Cmd+K does not move the chat head, microphone remains hidden. |

For timing checks, use controlled verification fixtures and normal authorized interfaces; do not alter unrelated user records or production clock. Do not send test nudges or calls to real contacts.

Run focused regressions, typecheck, lint on changed files and the production build. Run the full suite once, compare failing test names against the recorded baseline, and report new failures explicitly. A matching failure count alone is insufficient. Repeat checks only for a changed area, failure or unresolved concern.

## 6. Completion evidence and recovery

Write `output/coey-production-release/results.md` with:

- Final commit SHA, branch, pushed remote and production deployment ID/URL.
- Applied migration versions and schema/permissions verification results.
- Auth mode, static-code cutover instructions and confirmation no code is represented as phone ownership verification.
- Production maintenance/signup/jobs/outbound settings, using names/status only; no secrets.
- Scheduler provider, actual cadence and successful tick timestamps in Asia/Kolkata.
- Real browser results, screenshots and controlled notification/call evidence.
- Test totals and exact baseline/new-failure comparison.
- Any still-unbuilt requirements and genuine external blockers. Do not describe “all features complete” if the requirement register still says otherwise.
- A recovery procedure: pause new jobs/outbound delivery and re-enable maintenance if needed; preserve data; do not rerun reset or reverse schema destructively. Roll back code only when compatible with the migrated schema and auth mode.

Commit and push the reviewed changes without rewriting history, deploy the matching production build, then verify its identity at the user-facing alias. Do not commit `.env` files, provider credentials, session artifacts, uploaded private files or unrelated output archives.

## Codex's independent check afterward

Codex will verify the final diff and deployment identity, migration history and narrow grants; inspect static login's server validation and SMS migration path; rerun focused regressions; inspect authenticated call identity, calendar-aware follow-up delivery and conversational filter persistence; and independently exercise a short real-browser login/connection/Toss/Ask flow. Provide evidence rather than a percentage-complete claim.

The user can then report bugs using: page, exact input/action, expected result, actual result, and screenshot. Keep the production environment working while addressing each reproducible bug, with targeted verification rather than endless full-suite reruns.
