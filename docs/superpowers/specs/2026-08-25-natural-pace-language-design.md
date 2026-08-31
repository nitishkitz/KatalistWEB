# Natural Pace Language and Catch Preservation Design

**Status:** Approved in conversation on 2026-08-25
**Target branch:** `codex/magic-box-v2` at or after `f93b53f7c715ed35f5a30b798888afcc461c3144`

## Objective

When a person Tosses natural language such as “I need to get out of the office ASAP” or “Call them in 10 minutes,” Magic Box must infer the intended NOW, NEXT, or LATER Owner Importance, show the result before Toss, save it, place the waiting Thing in that same Court lane, and preserve that lane when Catch is pressed.

The local deterministic parser remains authoritative. Sarvam/Coey may polish text only when the user explicitly requests and accepts it; AI must not silently set Importance, Due, Toss, or Catch.

## Current Gap

- Magic Box v2 recognizes only standalone `NOW`, `NEXT`, `LATER`, and legacy `!!!` for Importance.
- Relative dates already resolve Due, but they normally leave Importance at the default NEXT.
- `laneOf()` forces every `waiting_for_catch` Thing into NOW, ignoring Owner Importance.
- `CatchActionButton` calls `rpcCatchThing()` without a Pace; client, preview, and SQL all default Catch to NEXT.

Consequently, `ASAP` defaults to NEXT, waiting LATER Things appear in NOW, and Catch changes the effective lane to NEXT.

## Approved Vocabulary

Matching is case-insensitive and punctuation-tolerant. Multi-word phrases are matched before their contained single words so `not urgent` is LATER and `as soon as possible` is NOW.

### NOW

- `now`
- `right now`
- `asap`
- `a.s.a.p.`
- `as soon as possible`
- `immediately`
- `right away`
- `straight away`
- `at once`
- `urgent`
- `urgently`
- `critical`
- `top priority`
- `do first`
- `first thing`
- `today`
- `tonight`
- `eod`, `end of day`, `by eod`, `by end of day`
- `before lunch`
- `this morning`, `this afternoon`, `this evening`
- exact relative durations under 24 hours, such as `in 10 min`, `in 30 minutes`, `within 1 hour`

### NEXT

- standalone `next`
- `soon`
- `shortly`
- `after this`
- `up next`
- `when possible`
- `as soon as convenient`
- `tomorrow`
- `day after tomorrow`
- `this week`
- `next few days`
- a bare, `this`, or `next` weekday when it resolves to a date
- exact relative durations from 24 hours through 7 days, including `in 1 day` and `within 7 days`
- unmatched text remains NEXT by default, but its `importanceSource` remains `default`

### LATER

- `later`
- `much later`
- `someday`
- `eventually`
- `whenever`
- `no rush`
- `not urgent`
- `low priority`
- `can wait`
- `when free`
- `when you have time`
- `future`
- `backlog`
- `next week`
- `next month`
- `in a few weeks`
- `one day`
- week-based durations such as `in 1 week`, plus day-based durations beyond 7 days such as `in 8 days`

## Due-Time Rules

Importance inference and Due extraction are related but separate:

- `in 10 minutes` → NOW and Due at injected `now + 10 minutes`, with `dueHasTime=true`.
- `within 1 hour` → NOW and Due at injected `now + 1 hour`, with `dueHasTime=true`.
- `tomorrow at 5 PM` → NEXT and an exact local Due timestamp, with `dueHasTime=true`.
- `in 3 days` → NEXT and a date-only Due at the existing canonical 09:00 local storage time.
- `in 1 week` or `in 2 weeks` → LATER and a date-only Due. Week-based wording is intentionally LATER even though `in 7 days` is NEXT.
- `before lunch` → NOW and Due today at 12:00 local.
- `by EOD` → NOW and Due today at 17:00 local.
- Vague phrases such as `soon`, `this week`, `next week`, `next month`, `someday`, and `in a few weeks` set Importance only and do not invent a Due date.
- Existing ISO dates, weekdays, day periods, clocks, and ambiguous numeric date behavior remain supported.
- `3/5` remains `Check date`, creates no Due timestamp, and does not block Toss.

## Precedence

Apply rules in this order:

1. A manual Importance chip selection wins over all text.
2. A standalone canonical marker (`NOW`, `NEXT`, `LATER`) outside a longer recognized phrase wins over synonyms and time inference. The first such marker from left to right wins.
3. The earliest recognized natural-language phrase wins. At the same start position, the longest phrase wins.
4. If there is no phrase, an exact Due duration/date infers Importance using the time windows above.
5. Otherwise default to NEXT with source `default`.

Examples:

- `Review later today` → LATER, Due today.
- `Fix this NOW next week` → NOW; `next week` is not assigned an invented exact Due.
- `This is not urgent` → LATER, never NOW.
- `Do it as soon as possible` → NOW, not NEXT from the word `soon`.
- Manual LATER plus text `ASAP` → LATER.

## Title Cleanup

- Remove only metadata spans that were actually recognized: selected Importance phrase, resolved Due phrase, and mentions under existing rules.
- Preserve ordinary words and unsupported phrases.
- Collapse repeated whitespace and trim leading/trailing whitespace.
- Never remove substrings from larger words: `nowhere`, `laterite`, and `urgentlyNeeded` are ordinary title text.
- If only metadata remains, the existing empty-title gate continues to block Toss.

## Court and Catch Behavior

For Things assigned to the signed-in person:

- While `acknowledgement=waiting_for_catch` and `personalPace=NULL`, the Court lane is `ownerImportance`.
- The Catch action remains visible in NOW, NEXT, or LATER.
- Catch initializes `personalPace` from the Thing's `ownerImportance` unless a caller explicitly supplies another Pace.
- After Catch, the Thing stays in the same lane.
- The assignee may change Personal Pace after Catch using existing controls.
- Double Catch remains idempotent and must not overwrite the Pace from the first successful Catch.

For Things delegated to someone else, the owner's WITH OTHERS grouping remains unchanged. The recipient sees the waiting Thing in the lane matching Owner Importance.

## Data and API Behavior

No new table or column is required. A forward Supabase migration replaces `public.catch_thing(uuid, public.pace)` without changing its signature:

- parameter default becomes `NULL`;
- on the first Catch, Pace resolves as `COALESCE(p_personal_pace, v_thing.owner_importance, 'next')`;
- existing authorization, row lock, terminal guards, activity logging, grants, and idempotency remain unchanged.

Never edit the previously applied migration. Generate and apply a new forward migration only after review.

## Error and Safety Rules

- Parsing never performs network calls.
- Invalid or unsupported language remains in the title and defaults to NEXT.
- No fuzzy matching or arbitrary typo correction is added; it risks silent false positives.
- No secret, raw thought text, phone, or identity is added to analytics.
- Existing unresolved-person blocking, attachment recovery, double-Toss guard, voice cancellation, and AI budgets remain unchanged.

## Test Contract

Automated tests must cover every fixed phrase, dynamic duration boundary, punctuation/case variation, collision/negation, title cleanup, manual override, existing Due behavior, waiting lane placement, Catch Pace inheritance, idempotency, UI chips, Toss persistence, and refresh behavior.

Required end-to-end examples:

1. `I need to get out of the office ASAP` → title cleaned, NOW chip, Toss, waiting in NOW, Catch, still NOW after refresh.
2. `Call the vendor in 10 min` → NOW chip plus exact Due chip, Toss, Catch, still NOW.
3. `Review this next week` → LATER chip, no invented Due, Toss, waiting in LATER, Catch, still LATER.
4. `Send quote tomorrow at 5 PM` → NEXT chip plus exact Due, Toss, Catch, still NEXT.
5. `This is not urgent` → LATER, never matched as NOW.

## Acceptance Criteria

- All approved phrases map deterministically to the documented Importance.
- Exact relative times create the documented Due without relying on AI.
- The confirmation chips show the result before Toss and remain editable.
- Saved `owner_importance` matches the chip.
- Waiting and caught lane placement preserve the inferred/manual value.
- Parser, foundation, Catch, Court, typecheck, lint, build-without-migration, and Playwright checks pass.
- UAT verification succeeds on desktop and 390 px mobile before pilot sign-off.
