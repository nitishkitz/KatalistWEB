# Natural Pace Language and Catch Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make natural urgency and scheduling language select NOW, NEXT, or LATER deterministically and preserve that lane through Toss, Waiting for Catch, Catch, and refresh.

**Architecture:** Extend the authoritative Magic Box v2 local parser with a focused phrase lexicon and due-window inference. Keep parsing pure and injectable by time/timezone. Change the shared Court lane rule and shared Catch action, then add a forward-only `catch_thing` migration so preview, UI, and database defaults agree.

**Tech Stack:** TypeScript, React, TanStack Query, Node test runner, Playwright, Supabase/Postgres RPCs, Vite.

**Spec:** `docs/superpowers/specs/2026-08-25-natural-pace-language-design.md`

## Global Constraints

- Implement from a clean worktree based on `origin/codex/magic-box-v2`; do not alter the dirty `dev` checkout.
- Use forward commits only. Never rebase, amend, squash, or force-push published history.
- The local parser is authoritative. Do not introduce an AI/network dependency.
- Manual chip selection overrides text parsing.
- Default Importance remains NEXT when nothing matches.
- Waiting Things keep `personalPace=NULL`; lane display uses Owner Importance until Catch.
- Catch copies Owner Importance into Personal Pace only on the first Catch unless an explicit Pace is supplied.
- Do not apply SQL or change Netlify flags until the code range has passed local review.
- `npm run build` runs migrations in this repository. Use `npm run build:dev` or `npx vite build`; never use `npm run build` during local verification.

---

## File Map

**Create**

- `src/features/court/magic-box/importance-language.ts` — fixed phrase lexicon, safe matching, duration-to-Importance inference.
- `scripts/magic-box-importance-language.test.mjs` — table-driven vocabulary, precedence, and false-positive tests.
- `supabase/migrations/` — one CLI-generated migration whose suffix is `catch_inherits_owner_importance.sql`; record the exact generated filename before editing.

**Modify**

- `src/features/court/magic-box/parser.ts` — combine manual, canonical, phrase, and Due-window inference; strip selected metadata spans.
- `src/features/court/magic-box/date-time.ts` — only add the reusable duration helpers needed for `within` and boundary classification.
- `src/domain/thing.ts` — waiting lane uses Owner Importance.
- `src/features/things/CatchActionButton.tsx` — send the Thing's Owner Importance as the default Catch Pace.
- `src/features/things/rpc.ts` — make omitted Pace reach the database fallback instead of forcing NEXT.
- `src/features/things/local-state.ts` — preview fallback matches SQL.
- `scripts/magic-box-parser.test.mjs` — integration coverage for parser output and Due.
- `scripts/katalist-state.test.mjs` — new waiting-lane contract.
- `scripts/katalist-catch.test.mjs` and `scripts/katalist-freeze.test.mjs` — Catch inheritance and idempotency.
- `tests/e2e/magic-box.spec.ts` — real composer and Court flow.
- `src/integrations/supabase/types.ts` — regenerate only if Supabase CLI output changes.

## Task 1: Freeze the Vocabulary Contract with Failing Tests

**Files:**

- Create: `scripts/magic-box-importance-language.test.mjs`
- Modify: `scripts/magic-box-parser.test.mjs`

**Interfaces:**

- Consumes: `parseMagicBoxText(rawText, { now, timeZone, manualImportance?, manualDue? })`.
- Produces: executable examples for every approved fixed phrase and duration boundary.

- [ ] **Step 1: Add table-driven fixed-phrase tests**

Use injected `NOW = new Date("2026-08-26T04:30:00.000Z")` and `TZ = "Asia/Kolkata"`. Add this shape:

```js
const cases = [
  ["Leave office ASAP", "now", "Leave office"],
  ["Leave office as soon as possible", "now", "Leave office"],
  ["Reply immediately", "now", "Reply"],
  ["Do this right away", "now", "Do this"],
  ["Critical payment", "now", "payment"],
  ["Review this soon", "next", "Review this"],
  ["Handle this after this", "next", "Handle this"],
  ["Review this next week", "later", "Review this"],
  ["This is not urgent", "later", "This is"],
  ["Read someday", "later", "Read"],
  ["Clean backlog", "later", "Clean"],
];

for (const [raw, importance, title] of cases) {
  test(`${raw} maps to ${importance}`, () => {
    const parsed = parse(raw);
    assert.equal(parsed.ownerImportance, importance);
    assert.equal(parsed.importanceSource, "parser");
    assert.equal(parsed.derivedTitle, title);
  });
}
```

Expand the table to include every fixed phrase in the spec, including punctuation/case forms `A.S.A.P.`, `URGENT!`, `No rush`, and `by end of day`.

- [ ] **Step 2: Add duration boundary tests**

Assert all of these exact outcomes:

```js
[
  ["in 10 min", "now", 10 * 60_000, true],
  ["within 23 hours", "now", 23 * 60 * 60_000, true],
  ["in 24 hours", "next", 24 * 60 * 60_000, true],
  ["in 7 days", "next", 7 * 24 * 60 * 60_000, false],
  ["in 8 days", "later", 8 * 24 * 60 * 60_000, false],
  ["in 1 week", "later", 7 * 24 * 60 * 60_000, false],
]
```

For date-only values, compare local calendar parts rather than raw milliseconds across timezone/DST boundaries.

- [ ] **Step 3: Add precedence and false-positive tests**

Cover:

```js
assert.equal(parse("Do it as soon as possible").ownerImportance, "now");
assert.equal(parse("This is not urgent").ownerImportance, "later");
assert.equal(parse("Review later today").ownerImportance, "later");
assert.equal(parse("Fix NOW someday").ownerImportance, "now");
assert.equal(parse("nowhere near ready").ownerImportance, "next");
assert.equal(parse("laterite sample").ownerImportance, "next");
assert.equal(parse("urgentlyNeeded field").ownerImportance, "next");
assert.equal(parse("ASAP", { manualImportance: "later" }).ownerImportance, "later");
```

Also assert a manual override reports source `manual`, the selected phrase is removed only when used, and unknown wording stays in the title.

- [ ] **Step 4: Run the new tests and confirm failure**

Run:

```bash
npm test -- --test-name-pattern='importance language|ASAP|duration boundary|precedence'
```

Expected: new vocabulary cases fail because the current v2 detector only accepts `NOW|NEXT|LATER|!!!`; existing tests remain green.

- [ ] **Step 5: Commit tests**

```bash
git add scripts/magic-box-importance-language.test.mjs scripts/magic-box-parser.test.mjs
git commit -m "test: define natural pace language contract"
```

## Task 2: Implement the Deterministic Importance Language Module

**Files:**

- Create: `src/features/court/magic-box/importance-language.ts`
- Modify: `src/features/court/magic-box/parser.ts`
- Test: `scripts/magic-box-importance-language.test.mjs`

**Interfaces:**

- Produces:

```ts
export type TextSpan = { start: number; end: number };
export type ImportanceLanguageMatch = {
  importance: Importance;
  spans: TextSpan[];
  source: "parser" | "default";
};

export function detectImportanceLanguage(input: {
  text: string;
  due: DueResolution;
  dueSpan: TextSpan | null;
  now: Date;
}): ImportanceLanguageMatch;
```

- [ ] **Step 1: Define longest-first phrase groups**

Store phrases as readonly data grouped by Importance. Escape regex characters before building matchers. Normalize whitespace, but return spans against the original string. Include all fixed phrases from the spec.

Required collision ordering:

```ts
const LATER_PHRASES = ["when you have time", "in a few weeks", "much later", "not urgent", "low priority", "next month", "next week", "no rush", "can wait", "when free", "eventually", "whenever", "someday", "future", "backlog", "one day", "later"];
const NOW_PHRASES = ["as soon as possible", "by end of day", "straight away", "top priority", "this afternoon", "this evening", "this morning", "before lunch", "immediately", "right away", "right now", "first thing", "end of day", "at once", "do first", "critical", "urgently", "urgent", "tonight", "today", "asap"];
const NEXT_PHRASES = ["as soon as convenient", "day after tomorrow", "next few days", "when possible", "after this", "this week", "up next", "tomorrow", "shortly", "soon"];
```

Handle `a.s.a.p.` with a dedicated punctuation-tolerant expression. Single-word entries require letter/digit boundaries, not substring matching.

- [ ] **Step 2: Implement deterministic selection**

The function must:

1. preserve legacy `!!!` as NOW;
2. find canonical standalone `now|next|later` tokens that are not inside a longer recognized phrase;
3. prefer the first canonical token;
4. otherwise choose the earliest phrase, breaking same-position ties by longest span;
5. otherwise infer from the resolved Due and the exact relative-duration unit;
6. return NEXT/default when nothing matches.

Do not use fuzzy matching, locale-dependent lowercasing, AI, or external libraries.

- [ ] **Step 3: Integrate it into `parseMagicBoxText`**

Refactor `detectDue` to return its existing private `DateHit` to the orchestration layer before Importance selection. Feed `due` and `span` into `detectImportanceLanguage`, then push both selected Importance spans and resolved Due span into the existing `stripSpans` flow.

Keep manual behavior exact:

```ts
if (options.manualImportance) {
  ownerImportance = options.manualImportance;
  importanceSource = "manual";
} else {
  const detected = detectImportanceLanguage({ text: rawText, due, dueSpan, now });
  ownerImportance = detected.importance;
  importanceSource = detected.source;
  detected.spans.forEach((span) => pushSpan(spans, span.start, span.end));
}
```

When Importance is manual, do not strip a textual synonym as though it controlled the result. Existing mention and manual-Due behavior must remain unchanged.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- --test-name-pattern='importance language|ASAP|precedence|explicit NEXT|legacy !!!'
```

Expected: all fixed vocabulary, canonical marker, manual override, and legacy `!!!` cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/court/magic-box/importance-language.ts src/features/court/magic-box/parser.ts scripts/magic-box-importance-language.test.mjs scripts/magic-box-parser.test.mjs
git commit -m "feat: parse natural pace language"
```

## Task 3: Complete Relative-Time Due Parsing and Importance Windows

**Files:**

- Modify: `src/features/court/magic-box/parser.ts`
- Modify: `src/features/court/magic-box/date-time.ts`
- Test: `scripts/magic-box-parser.test.mjs`
- Test: `scripts/magic-box-importance-language.test.mjs`

**Interfaces:**

- Consumes: `detectImportanceLanguage()` from Task 2.
- Produces: resolved Due plus NOW/NEXT/LATER inference for exact relative durations.

- [ ] **Step 1: Add failing tests for missing Due forms**

Cover `within 10 minutes`, `within 1 hour`, `before lunch`, and `by EOD`. For the injected 10:00 IST clock, assert exact local/UTC timestamps and `dueHasTime=true`.

Assert vague `soon`, `this week`, `next week`, `next month`, and `in a few weeks` produce `due.status === "none"`.

- [ ] **Step 2: Extend the exact-duration matcher**

Change the current expression to accept `in` or `within`:

```ts
/\b(?:in|within)\s+(\d+)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/gi
```

Reject values that are non-finite, negative, or greater than these safety caps: 10,080 minutes, 168 hours, 365 days, or 52 weeks. Out-of-range text remains in the title and produces no Due.

- [ ] **Step 3: Add `before lunch` without changing canonical period times**

Resolve `before lunch` as today 12:00 in the injected timezone. Reuse `fromZonedLocal()`/`applyPeriod(..., "noon", ...)`; do not introduce a second noon constant.

The existing `EOD=17:00`, `evening=19:00`, `tonight=20:00`, and `morning=09:00` values remain unchanged.

- [ ] **Step 4: Verify time-window Importance inference**

Infer by the exact semantic duration and unit, not by formatted labels:

- below 24 hours → NOW;
- 24 through 168 hours → NEXT;
- 1 through 7 days → NEXT;
- 8 or more days → LATER;
- any exact `week`/`weeks` unit → LATER, so `in 1 week` is intentionally different from `in 7 days`.

Same-day phrases (`today`, `tonight`, EOD, before lunch, this morning/afternoon/evening) → NOW. Tomorrow/day-after-tomorrow/resolved weekday → NEXT unless a canonical or synonym phrase already won. An explicit text rule such as `later today` remains LATER.

- [ ] **Step 5: Run parser regression tests**

```bash
npm test -- --test-name-pattern='Magic Box parser|importance language|Due|EOD|weekday|ambiguous'
```

Expected: new tests pass; ISO dates, `3/5`, Saturday/Sunday, timezone conversion, and existing periods remain green.

- [ ] **Step 6: Commit**

```bash
git add src/features/court/magic-box/parser.ts src/features/court/magic-box/date-time.ts scripts/magic-box-parser.test.mjs scripts/magic-box-importance-language.test.mjs
git commit -m "feat: infer pace from relative due language"
```

## Task 4: Preserve the Intended Lane Before Catch

**Files:**

- Modify: `src/domain/thing.ts`
- Modify: `scripts/katalist-state.test.mjs`
- Modify: `scripts/katalist-catch.test.mjs`
- Modify: `scripts/katalist-freeze.test.mjs`

**Interfaces:**

- Produces: `laneOf(thing: Thing): CourtLane` using Owner Importance only while waiting and Personal Pace after Catch.

- [ ] **Step 1: Replace the old failing expectations**

Delete tests asserting all waiting Things are NOW. Add:

```js
for (const pace of ["now", "next", "later"]) {
  const waiting = thing({ acknowledgement: "waiting_for_catch", personalPace: null, ownerImportance: pace });
  assert.equal(laneOf(waiting), pace);
}
```

Keep the caught contract:

```js
assert.equal(laneOf(thing({ acknowledgement: "caught", personalPace: "later", ownerImportance: "now" })), "later");
```

Assert waiting Things still have `personalPace === null`, are Catch-eligible only for the assignee, and remain excluded from the owner's personal lanes when delegated.

- [ ] **Step 2: Run tests and confirm the intended failure**

```bash
npm test -- --test-name-pattern='waiting lane|Self Toss lands|Waiting for Catch'
```

Expected: failures point to `laneOf()` returning NOW.

- [ ] **Step 3: Implement the minimal lane rule**

```ts
export function laneOf(thing: Thing): CourtLane {
  if (thing.acknowledgement === "waiting_for_catch") return thing.ownerImportance;
  return thing.personalPace ?? "next";
}
```

Do not change acknowledgement, capabilities, sorting, THEIRS grouping, or database fields.

- [ ] **Step 4: Run Court/domain tests**

```bash
npm test -- --test-name-pattern='lane|Court|Waiting for Catch|Catch eligibility'
```

Expected: NOW/NEXT/LATER waiting placement passes; permissions and THEIRS remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/domain/thing.ts scripts/katalist-state.test.mjs scripts/katalist-catch.test.mjs scripts/katalist-freeze.test.mjs
git commit -m "fix: keep waiting things in intended lane"
```

## Task 5: Preserve the Lane Through Catch in Preview and UI

**Files:**

- Modify: `src/features/things/CatchActionButton.tsx`
- Modify: `src/features/things/rpc.ts`
- Modify: `src/features/things/local-state.ts`
- Modify: `scripts/katalist-catch.test.mjs`
- Modify: `scripts/katalist-freeze.test.mjs`

**Interfaces:**

- Produces:

```ts
rpcCatchThing(thingId: string, pace?: Pace): Promise<unknown>;
catchLocal(id: string, pace?: Pace): void;
```

- [ ] **Step 1: Add failing Catch preservation tests**

For each `ownerImportance` NOW/NEXT/LATER:

1. Toss a self Thing with that Importance.
2. Assert the waiting lane matches.
3. Call `catchLocal(id)` with no explicit Pace.
4. Assert `personalPace`, caught lane, Owner Importance, Due, status, assignee, and context are preserved.

Add a separate assertion that `catchLocal(id, "now")` explicitly overrides an Owner Importance of LATER. Repeat Catch and verify the first Pace and first `caughtAt` are unchanged with one activity event.

- [ ] **Step 2: Change preview Catch fallback**

Resolve the Pace after retrieving the Thing:

```ts
const resolvedPace = pace ?? existing?.ownerImportance ?? "next";
patchThing(id, {
  acknowledgement: "caught",
  personalPace: resolvedPace,
  caughtAt: new Date().toISOString(),
}, "caught");
```

Keep authorization and idempotent early return before mutation.

- [ ] **Step 3: Change the shared Catch action**

In `CatchActionButton`, replace:

```ts
await rpcCatchThing(thing.id);
```

with:

```ts
await rpcCatchThing(thing.id, thing.ownerImportance);
```

All existing Court card, mobile card, List row, and Detail surfaces reuse this button, so do not duplicate Catch logic in those components.

- [ ] **Step 4: Stop the RPC client from inventing NEXT when omitted**

Change the client default from `pace: Pace = "next"` to `pace?: Pace`. When Pace is absent, omit `p_personal_pace` from the RPC argument object so the database function owns its fallback. Preview calls `catchLocal(thingId, pace)`.

- [ ] **Step 5: Run Catch and permission tests**

```bash
npm test -- --test-name-pattern='Catch|idempotent|permissions|freeze'
```

Expected: all Catch surfaces still use capabilities; NOW/NEXT/LATER inheritance passes; double Catch remains one event.

- [ ] **Step 6: Commit**

```bash
git add src/features/things/CatchActionButton.tsx src/features/things/rpc.ts src/features/things/local-state.ts scripts/katalist-catch.test.mjs scripts/katalist-freeze.test.mjs
git commit -m "fix: preserve owner pace when catching"
```

## Task 6: Make the Database Catch Fallback Match the UI

**Files:**

- Create through the CLI: the single new file under `supabase/migrations/` ending in `_catch_inherits_owner_importance.sql`; use and report the exact filename emitted by the command.
- Modify only if generated output changes: `src/integrations/supabase/types.ts`
- Test: `scripts/katalist-catch.test.mjs`

**Interfaces:**

- Keeps public signature: `public.catch_thing(uuid, public.pace)`.
- Changes only the default/fallback Pace, not authorization or grants.

- [ ] **Step 1: Add migration source tests before SQL**

Assert the newest migration:

- replaces `public.catch_thing(uuid, public.pace)`;
- sets `p_personal_pace public.pace DEFAULT NULL`;
- uses `COALESCE(p_personal_pace, v_thing.owner_importance, 'next')`;
- retains `FOR UPDATE`, current-assignee authorization, terminal guards, caught idempotency, assignment update, activity log, fixed `search_path`, revokes, and authenticated grant;
- contains no table drops, destructive DML, storage DML, or direct `auth.users` access.

- [ ] **Step 2: Generate the migration using the CLI**

```bash
supabase migration new catch_inherits_owner_importance
```

Never edit `20260818143455_a9a31e3a-cb16-4f25-85ce-8b3044885eba.sql` or any applied migration.

- [ ] **Step 3: Copy the complete current function and change only two expressions**

Use the complete deployed function body as the base. Make exactly these semantic changes:

```sql
p_personal_pace public.pace DEFAULT NULL
```

and:

```sql
assignee_personal_pace = COALESCE(
  p_personal_pace,
  v_thing.owner_importance,
  'next'::public.pace
)
```

Reapply the existing `REVOKE ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO authenticated` statements for the exact signature.

- [ ] **Step 4: Verify locally without applying SQL**

```bash
npm test -- --test-name-pattern='Catch|migration'
npm run typecheck
git diff --check
```

Expected: source-contract tests pass; no database command runs.

- [ ] **Step 5: Regenerate types only if the CLI reports a signature difference**

The argument remains optional and the return type is unchanged, so normally no type diff is expected. If regeneration changes unrelated types, stop and investigate rather than commit noise.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_catch_inherits_owner_importance.sql scripts/katalist-catch.test.mjs src/integrations/supabase/types.ts
git commit -m "fix: inherit owner importance on default catch"
```

## Task 7: Prove the Composer-to-Court Flow in Playwright

**Files:**

- Modify: `tests/e2e/magic-box.spec.ts`
- Modify only if necessary for accessible assertions: `src/features/court/CourtDesktop.tsx`, `src/features/court/CourtThingCard.tsx`

**Interfaces:**

- Consumes: Magic Box combobox/chips, Toss pipeline, Court lanes, shared Catch button.
- Produces: browser proof of chip inference and lane preservation.

- [ ] **Step 1: Add a reusable lane assertion**

Locate the Court section by accessible NOW/NEXT/LATER heading, then assert the Thing title within that section. If current markup lacks a stable section label, add `aria-labelledby` to `CourtLane`; do not rely on CSS class names or fixed list indexes.

- [ ] **Step 2: Add the five required flows**

Use unique titles and the real demo composer:

1. `I need to get out of the office ASAP <unique>` → NOW chip, clean title, NOW waiting, Catch, NOW caught.
2. `Call the vendor in 10 min <unique>` → NOW chip and Due chip, NOW before/after Catch.
3. `Review this next week <unique>` → LATER chip, Due button still says `Due`, LATER before/after Catch.
4. `Send quote tomorrow at 5 PM <unique>` → NEXT plus Due, NEXT before/after Catch.
5. `This is not urgent <unique>` → LATER and never NOW.

After each Catch, reload, re-search, and reassert the lane. Keep the existing rapid-Enter, mention menu, reduced-motion, recovery, and Catch tests.

- [ ] **Step 3: Verify editable chip precedence**

Type an ASAP example, change the Importance chip manually to LATER, Toss, and assert LATER before/after Catch. This proves manual selection overrides the parser.

- [ ] **Step 4: Verify 390 px mobile**

At `{ width: 390, height: 844 }`, prove the NOW and LATER examples show the correct chip, remain Tossable, expose Catch, and do not overflow horizontally.

- [ ] **Step 5: Run targeted Playwright**

```bash
npx playwright test tests/e2e/magic-box.spec.ts --grep 'natural pace|ASAP|relative time|not urgent'
```

Expected: all new browser tests pass against the real demo app, with zero Sarvam calls.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/magic-box.spec.ts src/features/court/CourtDesktop.tsx src/features/court/CourtThingCard.tsx
git commit -m "test: verify natural pace through catch"
```

## Task 8: Full Verification, Review, and Forward Push

**Files:** All files changed in Tasks 1–7.

- [ ] **Step 1: Run the complete local gate**

```bash
npm test
npm run typecheck
npx eslint src/features/court/magic-box/importance-language.ts src/features/court/magic-box/parser.ts src/features/court/magic-box/date-time.ts src/domain/thing.ts src/features/things/CatchActionButton.tsx src/features/things/rpc.ts src/features/things/local-state.ts tests/e2e/magic-box.spec.ts
npx playwright test tests/e2e/magic-box.spec.ts
npx vite build
git diff --check
```

Expected: all pass. Confirm `npm run build` was not run.

- [ ] **Step 2: Review the forward range**

Review from the starting SHA through HEAD for parser false positives, title loss, timezone mistakes, manual override regressions, mention regression, double Toss/Catch, attachment recovery, authorization, SQL safety, and unintended changes. Fix findings only with forward commits.

- [ ] **Step 3: Push normally**

```bash
git push origin codex/magic-box-v2
```

Record starting SHA, final SHA, forward commits, tests, and confirmation that no SQL or Netlify mutation occurred.

## Task 9: UAT-Only Migration and Live Flow Gate

**Precondition:** Tasks 1–8 reviewed and approved. Use only Supabase project `dyxqlgnbwtbxxdfoiqva` and Netlify site `startling-frangollo-bcf845`.

- [ ] **Step 1: Preflight target and migration history read-only**

Verify HEAD, project ref, site ID, existing remote migration list, and that pending is exactly the new Catch migration. Stop if any other migration is pending or either target differs.

- [ ] **Step 2: Apply only the new migration to UAT**

Use Supabase CLI/database credentials, never Netlify build. Read back the remote migration list and run security advisors. The function signature and grants must remain unchanged.

- [ ] **Step 3: Run the live authorization matrix**

Using dedicated UAT Owner, Assignee, and Stranger accounts, prove:

- Assignee Catch inherits Owner Importance when no Pace is supplied.
- An explicit Pace overrides inheritance.
- Owner/Stranger cannot Catch a delegated Thing.
- Double Catch is idempotent and does not change Pace or duplicate activity.
- No unrelated Thing can be read or mutated.

Delete only uniquely prefixed test Things through authorized product APIs.

- [ ] **Step 4: Deploy the reviewed SHA and run live UX smoke**

With fixed OTP `111111`, verify the five spec examples on desktop and 390 px mobile. For each: inspect chips before Toss, Toss, verify waiting lane, Catch, refresh, and verify caught lane. Also verify List composer, notification deep-link, manual chip override, attachments, and mention keyboard flow.

- [ ] **Step 5: Pilot decision and rollback**

Mark READY only if all automated and live checks pass. If any regression appears, redeploy the previous known-good SHA. Do not roll back by dropping functions or editing migration history; the database fallback is backward-compatible.

## Final Completion Checklist

- [ ] Every approved fixed phrase has an automated assertion.
- [ ] Duration boundaries at 23h/24h and 7d/8d are proven.
- [ ] `not urgent`, `as soon as possible`, and substring false positives are proven.
- [ ] Due and Importance chips are correct before Toss.
- [ ] Waiting NOW/NEXT/LATER lane matches Owner Importance.
- [ ] Catch preserves the lane in preview and live UAT.
- [ ] Manual chip override wins and survives Catch.
- [ ] Double Toss and double Catch remain idempotent.
- [ ] Mention, voice, attachments, List context, and ambiguous dates do not regress.
- [ ] No paid AI call is needed for parsing or tests.
- [ ] Full tests, typecheck, targeted lint, Playwright, `npx vite build`, and whitespace checks pass.
- [ ] SQL is applied only to the confirmed UAT project after review.
- [ ] Final SHA, deploy ID, migration, advisor results, auth matrix, and rollback are reported without secrets.
