# Coey requirement register

Status of every rule family in the Coey Scheduling and Behaviour Model spec v1.1 and the user's overrides, as of 13 October 2026. **Done** means implemented and covered by an automated test. **Partial** means part of the behaviour exists; the gap is stated. **Not done** means no implementation. **Superseded** means a user decision replaces it (see `decision-register.md`).

Evidence key: `engine` = `scripts/coey-engine.test.mjs`, `sql` = `scripts/coey-scheduling-sql.test.mjs`, `conn` = `scripts/explicit-connections-sql.test.mjs`, `fu` = `scripts/coey-followup*.test.mjs`, `ask` = `scripts/coey-ask.test.mjs`, `dom` = `scripts/magic-box-coey-flow.test.mjs`, `live` = `scripts/coey-live-eval.mjs` (real Sarvam), `rec` = `scripts/coey-recurrence-sql.test.mjs`, `q` = `scripts/coey-quality.test.mjs`.

## User overrides

| Requirement | Status | Evidence |
| --- | --- | --- |
| Zero users / content in the live project | Done by the earlier reset (not this work) | `docs/existing-backend-reset-status.md` |
| Either party requests; only the recipient's Accept connects | Done | conn |
| Google Contacts removed (UI, SDK, routes, SQL, tests, env) | Done | conn; files deleted |
| One Sarvam-led semantic path; no keyword intent/recipient decisions | Done | dom, live; regex parser, spelling rewrite and keyword router removed from the composer |
| Voice off, microphone hidden | Done | dom (no mic control); no remaining UI entry point |
| Nudges need an on-screen send | Done (unchanged assistant nudge preview + confirm) | existing assistant tests |
| Compact clarification, wrapping input, stationary chat head, dimmed backdrop | Done (kept) | dom, existing Magic Box tests |
| End of week asks which day | Done | engine, live |
| Real phone OTP | Partial — code path done; needs an SMS provider configured in Supabase and the build flag | `scripts/phone-sms-otp.test.mjs` |

## Part A

| Rules | Status | Notes / evidence |
| --- | --- | --- |
| §3.1 Thing record | Done except `watchers`, `breakthrough_used` (stored, unused) | sql |
| §3.3 Holder calendar (timezone, hours, offs, holidays, leave, home window) | Done; festival list is a small maintained table | Me → Working time; engine |
| §3.4 Transition log with rule ids | Done | sql |
| §4.2 Stage 1 lexicon as data | Partial — Hindi/Telugu terms are taught to Sarvam in the prompt, not a separately shipped data file | live |
| §4.3 Stage 2 strict schema, 400 ms debounce, 1.2 s deadline | Done; p95 643 ms on 29 lines | live, `scripts/coey-interpret.test.mjs` |
| §4.4 Code resolves times | Done | engine |
| §4.5 Activity priors | Done (defaults). Personal learning from corrections (F16) Not done | engine T4 |
| §4.6 Solid / ghost / pulsing / lane chips, one Coey line | Done (long-press to change Not done) | dom |
| V0.1–V0.5 | Done (V0.4 offers split; per-action picking is the split list) | engine, live |
| V1.1 missing value | Not done | — |
| V1.2 ambiguous / unknown / unconnected person | Done | engine, dom |
| V1.3 ambiguous reference | Not done | — |
| V1.4, V1.5 | Done | engine |
| V2.1, V2.2, V2.3, V2.4, V2.5, V2.7 | Done | engine |
| V2.6 dependency loop | Not done | — |
| V3.1–V3.4 plausibility | Not done | — |
| V4.1, V4.2 | Done | engine |
| V4.3 holder unavailable (tell the sender) | Partial — lanes and cadence use the holder calendar; the sender-facing "they'll see it Monday" line is not shown | — |
| V4.4 / S1 overload, V4.5 duplicate, S2 urgency inflation | Partial — checks exist; the composer does not yet supply holder Now counts, open titles or weekly urgent share, so they never fire | validation.ts |
| V4.6 calendar clash | Not applicable (no calendar integration) | — |
| V5.1 harsh tone | Done (hint) | — |
| V5.2 / S3 upward | Not done — no organisation hierarchy data | — |
| V5.3 / C4 / S5 Bridge | Superseded (D10) | — |
| V5.4 group blast | Done | — |
| §5.4 one interruption, Keep it, mute after 3 dismissals, never correct spelling | Done | engine, dom |
| C0a–C3, C5–C16 | Done | engine, sql |
| C8 grouped sender card with progress (5/8) | Partial — one Thing per person with a shared group id; the aggregated card is not built | sql |
| C9 relay | Done | sql |
| L0–L11 | Done | engine, rec |
| S4 Home Mode / leave + Can't wait breakthrough (F2) | Not done (F2 configured only) | — |
| §7.4 working time | Done | engine, fu |
| M1–M4, M6–M11, M15, M16 | Done | engine, sql |
| M5 promise missed | Partial — holder Now + sender PROMISE_MISSED; the "ask for more time on your behalf" offer is not built | engine |
| M12 mode switch / Ghost Card | Not done | — |
| M13 "Still need this?" | Not done | — |
| M14 Spring Cleaning for Later, 30 days | Not done — legacy daily maintenance still uses its old rule | — |
| M17 group progress | Not done (see C8) | — |
| M18 manual nudge, F26 one per Thing per working day | Partial — existing manual nudge with its cooldown | — |
| §8.2 sender concern + With Others order | Done | engine, Court |
| §8.3 My Court order | Not done (legacy sort) | — |
| §8.4 who may move | Done | sql |
| §9.1 cadence, §9.2 ladder (WhatsApp → push), §9.4 windows, festivals, batching, budget | Done in planner + delivery; needs a frequent scheduler to run | fu |
| §9.3 sender hears state changes; upward via brief | Partial — existing activity notifications only | — |

## Part B

| Rules | Status |
| --- | --- |
| §11 engagement engine, E1–E28, value score, fatigue, surface ladder | Not done |
| §12.1–12.4 emotional states, grammar, wit dial | Not done |
| §12.5 Q1–Q8, §12.6 banned words | Done as gate functions with fallback; shipped follow-up and validation copy pass. Not yet wired into a model-paraphrase path (none exists) |
| §12.9 Quiet Coey | Partial — Full/Light/Quiet saved; Quiet stops Morning Brief auto-open. Light has no effect yet (no celebrations exist) |
| §13 coordination K1–K9, §13.6 speaking for someone | Not done (K3 relay and K6 wrong person exist through C9/C14) |
| §14 habit H1–H8, streaks, celebration ladder | Not done |
| §17.1 labelled set of 300–500 field lines | Not done — 29 synthetic lines only |
| §18 central config F1–F29 | Done (`src/domain/coey/config.ts`) |
