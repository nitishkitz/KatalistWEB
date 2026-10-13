# Coey rebuild — acceptance report

13 October 2026. Branch `manus/phase1-magic-box-assistant-20261011`, local commits `7b5b2a63` … `0b38664a`. **Not pushed, not deployed, no migration applied to any hosted database.**

## What changed for users

- **Magic Box understands meaning, not keywords.** Sarvam reads the line after a 400 ms pause. Code places it in a Court and a lane, checks it, and saves only when Toss is pressed. Explicit picks (an `@person`, a chip, an answer) are kept as constraints.
- **Your reported failures:**
  - **Questions in Toss mode** open Ask and create nothing.
  - **Mentioned versus doer:** "Call Ravi about GST" stays yours; Ravi receives nothing.
  - **Duplicate names and near spellings** always ask which person.
  - **Unknown or unconnected names** are never sent anything.
  - **EOD** is the holder's work end; **end of week** asks which day.
  - **Gibberish** is kept privately as typed.
  - **Spelling is never rewritten.**
  - **The microphone is gone.**
- **One compact question at a time**, and "Keep it" is always offered. If Sarvam is unavailable, the draft stays, with *Try again* or *Keep it to myself*. No silent fallback creates a Thing.
- **Ask answers in code** from a structured query: exact names or a "which person" question, self exclusion, and "stale" only for Things you sent, judged by working-time cadence. The copy describes Things, never a person's activity.
- **Connections are explicit.** You add people by exact phone, email or a personal `/connect/<handle>` link; opening the link never connects anyone. The recipient must accept. Disconnect and block are available. Things, DMs and groups require an accepted connection, enforced in the database. Google Contacts is removed.
- **The Court reads each Thing's schedule.** Lanes move with time in the holder's working hours. With Others is ordered by how much the sender should worry. A new **Inbox** strip holds unresolved, wrong-person and parked Things.
- **Thing detail** lets the holder promise a date, say it is waiting on someone else, ask a question back, or say it is the wrong person. Only the sender changes the pace. A "Why is this here?" line shows the rule behind the lane.
- **Me → Working time** (days, hours, Saturdays off, holidays, leave, home hours) and **Me → Coey** (Full / Light / Quiet).
- **Recurring Things** create their next occurrence on Sort. **Relay chains** hand the next step to the next person.
- **Follow-ups:**
  - They run on working-time cadence: Urgent at 4, 8 and 12 working hours; Normal at 1, 2 and 3 working days; Chill never.
  - Nudge 1 is a line on the Thing only, with no push.
  - Each holder gets at most one batched message per tick, within a budget of 3 per day.
  - Every Thing is re-checked at delivery.
  - The old elapsed-hours "gone cold / escalate" job is retired.

## Evidence

| Check | Result |
| --- | --- |
| Typecheck | Pass |
| Lint on the 44 added or modified source files | 0 errors (16 warnings, all on lines not changed by this work) |
| Production build (`npm run build`) | Pass |
| Full unit suite | 1,666 tests: 1,628 pass, 38 fail. The 38 failures are identical by name to the baseline recorded before any change (`.work/coey/baseline-failures.txt`); no new failures |
| New Coey tests | Engine 24, interpretation 7, DOM flow 5, connections SQL 8, scheduling SQL 12, follow-up 9, recurrence 3, Ask 4, quality gates 4, SMS OTP 2 |
| Empty-database rehearsal | All 110 migrations (103 existing + 7 new) apply in order to an empty PGlite database with a Supabase shim; schema tests then run on it |
| Real Sarvam (`sarvam-105b-conversations`, strict JSON schema) | 29/29 labelled lines match the expected Court, lane and question; p50 491 ms, p95 643 ms, max 719 ms (synthetic people; no Katalist data sent) |

**Not verified, and why:**

- **No browser run against a real backend.** The only Supabase project is fenced and empty after the reset, and Docker is not installed, so there was no isolated backend to sign in to. The live composer path is covered by DOM tests with a mocked network, and the database behaviour by PGlite. Managed Supabase Auth, Storage and Realtime are not exercised.
- **Real SMS OTP is unverified.** No SMS provider is configured.
- **The follow-up job has not run in production.** It is gated off, and Vercel Hobby cron is daily only.
- **Accuracy is not established.** It rests on 29 synthetic lines; the spec asks for 300–500 field-labelled lines.

## Release steps that need you (P11 is done; P12 not started)

1. **Apply the seven new migrations**, in filename order (`20261013120000` … `20261013170000`), to project `jrdsmmiggezrhiakncwc` after reviewing them. Remote migration history is known to drift, so apply them one by one, not with `db push`.
2. **Configure an SMS provider** (for example Twilio) under Supabase Auth → Phone, then build with `VITE_KATALIST_PHONE_AUTH=sms`. Keep `VITE_KATALIST_FIXED_OTP` unset in production.
3. **Provide a scheduler** that calls `/api/jobs/coey-followups` every 5 minutes with `CRON_SECRET`, then set `KATALIST_BACKGROUND_JOBS_ENABLED=true` and `KATALIST_OUTBOUND_DELIVERY_ENABLED=true`. A daily cron cannot honour the Urgent cadence.
4. **Remove the reset fences, reopen signup and unpause Vercel**, following `docs/existing-backend-reset-status.md`. Set `KATALIST_MAINTENANCE=false`.
5. **Set the Supabase Auth site URL and redirect allow-list** for the production domain.
6. **Deploy** with `SARVAM_API_KEY` and `SARVAM_MODEL` set server-side. Then verify with two temporary accounts: sign up, request, accept, toss, clarify, save, open, catch, promise, ask. Remove those accounts afterwards.
7. **Push to Lovable's connected branch** only when you are ready, because pushes sync to Lovable.

## Biggest remaining gaps

These are listed in full in `requirement-register.md`:

- Part B's engagement engine and habit layer (E, K and H families).
- The grouped sender card with progress.
- The Home Mode "Can't wait" breakthrough.
- Upward (junior-to-boss) rules.
- Spring Cleaning on the new model.
- Sender state-change messages.
- Personal priors learning.
- A real labelled set.

## Review fixes (13 October 2026)

An independent review (`output/coey-code-review/review.md`) found seven defects. All seven are fixed, each with a regression test that fails on the previous code:

| # | Defect | Fix | Test |
| --- | --- | --- | --- |
| 1 | "Keep it to myself" kept a shared List | `coey_create_things` clears the List for private captures; moving one into a List is refused; no Bucket link | `coey-review-fixes-sql` |
| 2 | Blocked users could still post in an existing DM | Message-insert trigger: DMs need an accepted, unblocked connection; groups refuse a blocked pair; history stays readable | `coey-review-fixes-sql` |
| 3 | "Keep it for me" left Catch with the old assignee | Wrong person and resolve holder move the real assignment (one authority); the Court never falls back to a former holder | `coey-review-fixes-sql` |
| 4 | Early Toss cancelled its own interpretation | Send cancels the pending pause; the pause reuses a request already running for that revision | `coey-typing-race` |
| 5 | Stale follow-up plans delivered after a promise | Plans carry the schedule revision; every cadence input bumps it; cadence nudges never go out once a promise exists | `coey-review-fixes-sql` |
| 6 | Direct Ask and follow-ups used the old answer path | The turn runner interprets every Ask line (follow-ups with the earlier question as context) and answers structured questions in code | `coey-review-fixes` |
| 7 | Ask day/week used server time and a rolling 7 days | Viewer-timezone day and Monday–Sunday week | `coey-review-fixes` |

After the fixes: typecheck and production build pass; 1,675 tests, the same 38 baseline failures and no new ones; 111/111 migrations replay; the reviewer's own reproduction script reports every case fixed; live Sarvam matched 29/29 on two runs and 28/29 on one (an ambiguous "send … to Ravi" read as Ravi doing it, which correctly asked which Ravi).

Calls ride on conversation membership and were not separately audited for block enforcement.

## Re-review fixes (13 October 2026, after 6437276e)

| Gap | Fix | Test |
| --- | --- | --- |
| Blocked people could still be rung | `/api/calls/ring` pushes only to recipients `call_ring_recipients` allows (no block either way; DMs need a connection). The in-app receiver asks `can_receive_call` before showing a ring and ignores rings without a caller id | `coey-rereview-fixes-sql` |
| Calendar edits did not invalidate follow-up plans | Holder calendars have a revision (hours, days, holidays, leave, and timezone changes); plans name it; delivery also re-checks the holder's working time at the moment of delivery, under a lock | `coey-rereview-fixes-sql`; reviewer's `calendar-race.mjs` now delivers 0 |
| Follow-up chains lost filters | Each answer returns the query it resolved; the client sends it back; the interpreter sees earlier questions and the previous query, marks whether the line continues it, and code inherits every field the follow-up does not change. Unknown-name answers keep the query too | `coey-review-fixes`; live `scripts/coey-live-followups.mjs` |

Results: typecheck and build pass; 1,681 tests, the same 38 baseline failures, none new; 112/112 migrations replay; live Sarvam: 29/29 labelled lines, follow-up chains 8/8 on the final run (7/8 on one run where Sarvam returned unparseable output once — that path is safe: Ask falls back to the old answer path and the composer offers Try again).

**Remaining limitation:** the call lobby is a public Realtime broadcast channel, so a ring's caller id cannot be authenticated on the client. The receiver check stops honest clients and blocked DM partners, but a malicious group member could put another member's id on a ring. Closing that needs private Realtime channels with authorization policies.
