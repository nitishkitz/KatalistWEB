# Magic Box v2 Gap and Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Magic Box proof of concept with the complete deterministic, editable, accessible, tested Magic Box v2 while preserving the existing Katalist Thing lifecycle.

**Architecture:** Deterministic Katalist code owns parsing, actor binding, structured fields, validation, and the final Toss payload. Sarvam is optional and server-only, limited to text correction, transcription, and Coey wording. The existing `create_thing` RPC remains the only Thing-creation path.

**Tech Stack:** React 19, TypeScript, TanStack Router/Start, TanStack Query, Supabase/Postgres/Storage, Zod, Sonner, existing Katalist UI components.

**Specs:**

- `/Users/nagasainathreddy/Downloads/Katalist_Magic_Box_v2_Complete_BRD_and_Behaviour_Contract.docx`
- `/Users/nagasainathreddy/Downloads/Katalist_Magic_Box_v2_Exact_Implementation_Plan.docx`

## Global Constraints

- Preserve React 19, TanStack Query, Supabase, Sonner, and the existing design system.
- Preserve the existing `create_thing` lifecycle and assignment history.
- Creator and Owner are the current user.
- Default Assignee is Self; default Owner Importance is NEXT; Due is optional.
- List context overrides the active Work/Home context.
- New Things start Not Started, Waiting for Catch, with Personal Pace unset until Catch.
- Unresolved or ambiguous person blocks Toss.
- Ambiguous date displays “Check date” but may Toss with no Due.
- Manual chip choices override parser results; parser results override AI hints.
- Sarvam must never choose actor IDs, List IDs, Due, or other structured authority.
- Never expose `SARVAM_API_KEY` in browser or `VITE_` variables.
- Attachments must use private storage and inherit Thing-view authorization.
- Failed Toss retains the complete draft. Reset only after confirmed success.
- Do not rewrite pushed Lovable history; no force-push, rebase, amend, or squash of published commits.
- Correct document spelling errors before using identifiers. Use `thing_attachments`, not `thing_attaachments`.

---

## 1. Audit Snapshot

- Current local branch: `dev`
- Current local commit: `9ff8ec4`
- Latest recorded `origin/dev`: `232ba67`
- Local `dev` is four commits behind `origin/dev`.
- The four later commits contain UAT authentication, Netlify, and notification changes.
- `MagicBox.tsx`, `parse-toss.ts`, and `rpcCreateThing` are identical between the two commits.
- The local checkout contains pre-existing uncommitted user changes.
- TypeScript typecheck passes.
- The only focused Magic Box test passes (`1/1`).

## 2. What Exists Today

### Working or substantially correct

- Single-line Magic Box input.
- Enter triggers Toss when not blocked.
- Desktop Clear and Toss buttons.
- Pending mutation prevents duplicate clicks.
- Backend failure retains raw draft text.
- Minimal NOW/LATER/default NEXT detection.
- Minimal today/tomorrow/Monday-Friday detection.
- One simple `@person` token can be matched.
- Unknown or ambiguous person blocks Toss.
- Numeric date such as `3/5` shows “Check date” without blocking Toss.
- Existing `rpcCreateThing` and `create_thing` paths are used.
- Backend correctly applies Self, NEXT, List context, Waiting for Catch, Not Started, and null Personal Pace defaults.
- Backend creates assignment history.

### Partial or missing

| Area | Status | Main gap |
|---|---|---|
| Existing `create_thing` lifecycle | Ready | Preserve it |
| Basic composer | Partial | Missing complete controls and structured state |
| Importance parsing | Partial | Only NOW/LATER/default NEXT |
| Date parsing | Very partial | No time, period, duration, ISO, or complete weekday rules |
| Person mentions | Very partial | No autocomplete, binding, ranking, or selection flow |
| Confirmation chips | Missing | Existing chips are static spans |
| Manual overrides | Missing | No editable structured state |
| Sarvam correction | Missing | No endpoint, validation, or UI |
| Coey completion copy | Missing | Generic “Tossed” toast only |
| Voice input | Missing | Mic is decorative |
| Attachments | Missing | No schema, storage, authorization, or UI |
| Toss orchestration | Partial | Basic mutation only |
| Motion | Missing | Only opacity feedback |
| Accessibility | Partial | Basic labels only |
| Analytics | Missing | No Magic Box events |
| Automated tests | Very incomplete | Only two contract assertions |

## 3. Target File Map

Create under `src/features/court/magic-box/`:

- `types.ts` — draft and resolution types.
- `date-time.ts` — deterministic local date/time resolution.
- `parser.ts` — deterministic metadata extraction and derived title.
- `mention.ts` — caret-aware mention detection and stable bindings.
- `ranking.ts` — deterministic people ranking.
- `reducer.ts` — draft transitions and precedence.
- `useMagicBoxController.ts` — composer orchestration and Toss mutation.
- `MagicBoxComposer.tsx` — complete composer shell.
- `MentionAutocomplete.tsx` — popup, keyboard control, and ghost suffix.
- `ConfirmationChips.tsx` — interactive structured fields.
- `DueChipEditor.tsx` — date/time correction.
- `ImportanceChipEditor.tsx` — NOW/NEXT/LATER selection.
- `AttachmentTray.tsx` — attachment state and controls.
- `useMagicBoxVoice.ts` — recording and transcription lifecycle.
- `useMagicBoxAttachments.ts` — staging, retry, removal, and finalization.
- `useSarvamAssist.ts` — optional correction state.
- `toss-motion.ts` — success motion and reduced-motion handling.
- `coey-copy.ts` — validated AI copy and deterministic fallback.
- `analytics.ts` — wrapper around existing analytics infrastructure.

Create server/AI modules:

- `src/features/ai/schemas.ts`
- `src/features/ai/sarvam-client.server.ts`
- `src/routes/api/magic-box/correct.ts`
- `src/routes/api/magic-box/coey.ts`
- `src/routes/api/magic-box/transcribe.ts`

Create tests and database work:

- `scripts/magic-box-parser.test.mjs`
- `scripts/magic-box-ranking.test.mjs`
- `scripts/magic-box-contract.test.mjs`
- `supabase/migrations/<timestamp>_thing_attachments.sql`
- Supabase database/storage authorization tests for Thing attachments.

Keep `src/features/court/parse-toss.ts` temporarily as a compatibility wrapper. Remove it only after all call sites and regression tests migrate.

---

## Task 0: Protect the Baseline

**Files:** No product files should change in this task.

- [ ] Create `codex/magic-box-v2` from `origin/dev` commit `232ba67` or the newer verified `origin/dev` head.
- [ ] Use an isolated worktree because the current checkout is dirty.
- [ ] Confirm UAT authentication, Netlify, notifications, Court, Lists, Bridge, and current tests are present.
- [ ] Run `git status --short` and record the clean baseline.
- [ ] Run `npm test` and `npm run typecheck` before implementation.
- [ ] Commit nothing in this baseline task.

**Done when:** implementation can begin from the latest clean forward-only branch without touching the user’s local changes.

## Task 1: Draft Types, Reducer, and Controller

**Files:**

- Create `src/features/court/magic-box/types.ts`
- Create `src/features/court/magic-box/reducer.ts`
- Create `src/features/court/magic-box/useMagicBoxController.ts`
- Test in `scripts/magic-box-contract.test.mjs`

**Required interfaces:**

- `MagicBoxFieldSource = "default" | "parser" | "mention" | "manual" | "ai-suggestion"`
- `DueResolution` with `none`, `resolved`, and `ambiguous` states.
- `PersonResolution` with `self`, `resolved`, and `unresolved` states.
- `DraftAttachment` with `queued`, `uploading`, `ready`, and `failed` states.
- `MagicBoxDraft` with raw text, derived title, Assignee, Importance, Due, List, context, attachments, and AI suggestion.

- [ ] Write failing reducer tests for every precedence rule.
- [ ] Track the source of each structured value.
- [ ] Make manual Assignee, Due, and Importance override parser values.
- [ ] Make parser values override AI hints.
- [ ] Invalidate a resolved mention binding when its text range changes.
- [ ] Retain raw text, manual chips, mentions, and attachments after failure.
- [ ] Reset only through `RESET_AFTER_SUCCESS`.
- [ ] Keep reducer code deterministic and independent from React.
- [ ] Run focused tests, then the full suite.
- [ ] Commit as `feat: add magic box draft controller`.

**Done when:** final structured state no longer depends on reparsing raw text during each submit.

## Task 2: Deterministic Parser and Date/Time Rules

**Files:**

- Create `src/features/court/magic-box/date-time.ts`
- Create `src/features/court/magic-box/parser.ts`
- Create `scripts/magic-box-parser.test.mjs`
- Modify `src/features/court/parse-toss.ts` into a compatibility wrapper

**Required interface:**

`parseMagicBoxText(rawText, { now, timeZone, manualImportance, manualDue }): ParsedMagicBoxText`

- [ ] Write failing tests before implementation.
- [ ] Inject `now` and `timeZone`; never use an uncontrolled test clock.
- [ ] Support today, tomorrow, and day after tomorrow.
- [ ] Support all seven weekdays, including Saturday and Sunday.
- [ ] Bare weekday means the next strictly future occurrence.
- [ ] Apply the agreed “this Friday” ambiguity rule.
- [ ] Make “next Friday” mean the following calendar week.
- [ ] Support `in 2 hours`, `in 3 days`, and `in 2 weeks`.
- [ ] Support explicit times such as `4 PM` and `16:30`.
- [ ] Support combined date/time expressions.
- [ ] Resolve morning to 09:00, noon to 12:00, afternoon to 15:00, evening to 19:00, tonight to 20:00, and EOD to 17:00.
- [ ] Support unambiguous ISO dates.
- [ ] Convert user-local values to ISO timestamps.
- [ ] Set `dueHasTime=true` only when the user supplies or manually selects a time.
- [ ] Treat ambiguous numeric dates as “Check date” with no timestamp.
- [ ] Do not block Toss for ambiguous date.
- [ ] Recognize explicit NOW, NEXT, and LATER.
- [ ] Optionally preserve legacy `!!!` as NOW if current compatibility requires it.
- [ ] Remove only confidently recognized metadata from the derived title.
- [ ] Preserve original work text when parsing is uncertain.
- [ ] Block when the final derived title is empty.
- [ ] Run focused tests and `npm test`.
- [ ] Commit as `feat: add deterministic magic box parser`.

**Done when:** all required expressions, precedence, timezone, ambiguity, and fallback tests pass.

## Task 3: Mention Detection and Ranking

**Files:**

- Create `src/features/court/magic-box/mention.ts`
- Create `src/features/court/magic-box/ranking.ts`
- Create `scripts/magic-box-ranking.test.mjs`

**Required interfaces:**

- `findActiveMention(text, caret): MentionQuery | null`
- `replaceMention(text, mention, person): { text, caret, binding }`
- `rankAssignablePeople({ query, people, currentListMemberIds, recentActorIds, frequencyByActorId }): RankedPerson[]`

- [ ] Detect the active `@` token from the caret position.
- [ ] Support names with spaces and non-ASCII characters.
- [ ] Store actor UUID separately from visible text.
- [ ] Track the selected mention range.
- [ ] Invalidate the binding when that range is edited.
- [ ] Never resolve an actor from visible text during Toss.
- [ ] Rank exact matches first and prefix matches second.
- [ ] Give moderate weight to current List members.
- [ ] Add bounded recency and frequency signals.
- [ ] Use Work/Home context only as a small signal.
- [ ] Make ties deterministic.
- [ ] Do not use Sarvam for ranking.
- [ ] Never auto-select the first ambiguous result.
- [ ] Keep unknown or ambiguous person blocked until selected or removed.
- [ ] Return to Self when the mention is removed.
- [ ] Run focused tests and `npm test`.
- [ ] Commit as `feat: add magic box mention ranking`.

**Done when:** the selected actor is always a stable UUID binding and all ranking tests are deterministic.

## Task 4: Mention Autocomplete and Ghost Completion

**Files:**

- Create `src/features/court/magic-box/MentionAutocomplete.tsx`
- Modify `src/features/court/magic-box/useMagicBoxController.ts`
- Test in `scripts/magic-box-contract.test.mjs`

- [ ] Anchor the popup to the active mention/caret.
- [ ] Show avatar, full name, and relevant context.
- [ ] Show a grey ghost suffix only when alignment is reliable.
- [ ] Mark ghost text `aria-hidden` and keep it out of the input value.
- [ ] Make Arrow Up/Down move through and wrap results.
- [ ] Make Enter and Tab select the highlighted actor.
- [ ] Ensure Enter does not Toss while the popup is open.
- [ ] Make Escape close only the topmost popup.
- [ ] Show loading and empty-result states.
- [ ] Cache suggestions so cached results appear within 100 ms.
- [ ] Run component/contract tests and `npm test`.
- [ ] Commit as `feat: add magic box autocomplete`.

**Done when:** MB-002 through MB-004 pass with keyboard and stable actor binding.

## Task 5: Editable Confirmation Chips

**Files:**

- Create `src/features/court/magic-box/ConfirmationChips.tsx`
- Create `src/features/court/magic-box/DueChipEditor.tsx`
- Create `src/features/court/magic-box/ImportanceChipEditor.tsx`
- Modify `src/features/court/magic-box/useMagicBoxController.ts`

- [ ] Add Assignee chip showing Self or the selected actor.
- [ ] Add Due chip showing the resolved date/time or “Check date”.
- [ ] Add Importance chip showing NOW, NEXT, or LATER.
- [ ] Add List chip showing exact List name and UUID-backed context.
- [ ] Render chips as buttons, not static spans.
- [ ] Make chip changes update structured state without rewriting the sentence.
- [ ] Make manual Assignee override parsed mention.
- [ ] Make manual Due override parsed Due.
- [ ] Make manual Importance override parsed Importance.
- [ ] Clearing Due produces no Due.
- [ ] Clearing Importance returns to NEXT.
- [ ] Clearing Assignee returns to Self.
- [ ] Keep List context authoritative over global Work/Home context.
- [ ] Ensure final chip state maps exactly to the final Toss payload.
- [ ] Run reducer, component, and full tests.
- [ ] Commit as `feat: add editable magic box chips`.

**Done when:** MB-007 through MB-009 pass and no confirmation chip remains static.

## Task 6: Complete Composer Shell and Keyboard Behavior

**Files:**

- Create `src/features/court/magic-box/MagicBoxComposer.tsx`
- Modify `src/features/court/MagicBox.tsx` into a compatibility/export wrapper
- Modify current Court and List call sites only as required

- [ ] Use existing Katalist colors, typography, icons, buttons, popovers, and spacing.
- [ ] Keep a compact messaging-composer form, not a chatbot or large form.
- [ ] Show Clear, Attachment, Mic, and Toss on desktop and mobile.
- [ ] Add a visible mobile Toss button.
- [ ] Make Mic functional; do not leave it decorative.
- [ ] Make Cmd/Ctrl+K focus Magic Box where non-conflicting.
- [ ] Make Enter Toss only when no popup or chip editor owns Enter.
- [ ] Keep focus predictable after selecting mentions and chips.
- [ ] Show pending, error, correction, recording, transcription, and attachment states without nested card clutter.
- [ ] Preserve the draft when closing popups or editors.
- [ ] Run keyboard/component tests and `npm test`.
- [ ] Commit as `feat: rebuild magic box composer`.

**Done when:** the main flow works on desktop, mobile, and keyboard-only input.

## Task 7: Reliable Toss Orchestration

**Files:**

- Modify `src/features/court/magic-box/useMagicBoxController.ts`
- Modify `src/features/things/rpc.ts`
- Modify `src/domain/query-keys.ts`
- Test in `scripts/magic-box-contract.test.mjs`

- [ ] Block empty derived title.
- [ ] Block unresolved person.
- [ ] Allow ambiguous date with no Due.
- [ ] Block while any attachment is uploading.
- [ ] Require Retry or Remove for a failed attachment.
- [ ] Block duplicate submit while pending.
- [ ] Build one immutable payload from final structured draft state.
- [ ] Do not freshly reparse raw text during submission.
- [ ] Continue using the existing `create_thing` RPC.
- [ ] Do not set Personal Pace during creation.
- [ ] Keep backend permissions authoritative.
- [ ] Use the returned Thing ID for attachments and success feedback.
- [ ] Invalidate Court, `list-things`, the relevant List, and affected cache keys.
- [ ] Explicitly invalidate `["list-things", listId]` after creation inside a List.
- [ ] Reset only after confirmed success.
- [ ] Preserve the entire draft after any failure.
- [ ] Maintain preview/live parity where possible.
- [ ] Test double-submit and backend-failure cases.
- [ ] Commit as `feat: harden magic box toss orchestration`.

**Done when:** MB-016 and MB-017 pass and List creation refreshes immediately.

## Task 8: Optional Sarvam Correction and Coey Copy

**Files:**

- Create `src/features/ai/schemas.ts`
- Create `src/features/ai/sarvam-client.server.ts`
- Create `src/features/court/magic-box/useSarvamAssist.ts`
- Create `src/features/court/magic-box/coey-copy.ts`
- Create `src/routes/api/magic-box/correct.ts`
- Create `src/routes/api/magic-box/coey.ts`

- [ ] Verify the current official Sarvam API, model, and authentication documentation before coding.
- [ ] Keep `SARVAM_API_KEY` server-only.
- [ ] Debounce correction requests by 700-1000 ms.
- [ ] Cancel or ignore stale responses.
- [ ] Present an explicit “Use corrected text” action.
- [ ] Never silently replace the user’s draft.
- [ ] Preserve mentions, names, numbers, URLs, filenames, and quoted text.
- [ ] Prevent Sarvam from choosing actor IDs, List IDs, Due, Importance, or final payload fields.
- [ ] Rerun deterministic parsing after the user accepts corrected text.
- [ ] Validate server responses with Zod.
- [ ] Limit Coey copy to 18 words.
- [ ] Keep Coey warm, brief, precise, and nonjudgmental.
- [ ] Keep permanent deterministic fallback copy.
- [ ] Make Magic Box fully functional when Sarvam is disabled or unavailable.
- [ ] Test stale response, malformed JSON, timeout, disabled, and unavailable cases.
- [ ] Commit as `feat: add optional sarvam magic box assist`.

**Done when:** MB-010 and MB-011 pass without giving AI structured authority.

## Task 9: Functional Voice Input

**Files:**

- Create `src/features/court/magic-box/useMagicBoxVoice.ts`
- Create `src/routes/api/magic-box/transcribe.ts`
- Modify `src/features/court/magic-box/MagicBoxComposer.tsx`

- [ ] Request permission only after the user taps Mic.
- [ ] Start recording immediately after permission.
- [ ] Provide Stop and Cancel actions.
- [ ] Enforce a 30-second maximum recording.
- [ ] Send audio only to an authenticated server endpoint.
- [ ] Validate audio type and size server-side.
- [ ] Insert the transcript into the editable draft.
- [ ] Run the same deterministic parser on the transcript.
- [ ] Never auto-Toss after transcription.
- [ ] Announce permission, recording, transcription, and failure states.
- [ ] Preserve the previous draft on permission, recording, upload, and transcription failure.
- [ ] Test desktop Chrome, Android Chrome, and iPhone Safari manually before rollout.
- [ ] Commit as `feat: add sarvam voice input to magic box`.

**Done when:** MB-012 and MB-013 pass and Mic is functional on all supported surfaces.

## Task 10: Private Thing Attachments

**Files:**

- Create `src/features/court/magic-box/AttachmentTray.tsx`
- Create `src/features/court/magic-box/useMagicBoxAttachments.ts`
- Create `supabase/migrations/<timestamp>_thing_attachments.sql`
- Add database and storage authorization tests
- Update generated Supabase types after schema changes

- [ ] Use canonical table name `thing_attachments`.
- [ ] Limit each draft to five attachments.
- [ ] Limit each file to 20 MB, using configurable constants.
- [ ] Use a private Supabase Storage bucket.
- [ ] Never use public object URLs.
- [ ] Stage uploads under authenticated, user-scoped temporary keys.
- [ ] Track queued, uploading, ready, and failed states.
- [ ] Show file name, size, status, Retry, and Remove.
- [ ] Create the Thing first, then finalize and associate staged files.
- [ ] Make finalization idempotent.
- [ ] If finalization partially fails, keep the created Thing and expose attachment retry state.
- [ ] Clean up abandoned staged files.
- [ ] Authorize downloads through `can_view_thing`.
- [ ] Generate short-lived signed URLs only after authorization.
- [ ] Test owner, assignee, List member, unauthorized user, and Bridge access.
- [ ] Test partial upload/finalization failure and retry.
- [ ] Commit as `feat: add private thing attachments to magic box`.

**Done when:** MB-014 and MB-015 pass and no attachment is publicly accessible.

## Task 11: Motion, Accessibility, Performance, and Analytics

**Files:**

- Create `src/features/court/magic-box/toss-motion.ts`
- Create `src/features/court/magic-box/analytics.ts`
- Modify composer, autocomplete, chips, voice, and attachment components

- [ ] Use restrained 220-320 ms motion for delegated Toss.
- [ ] Use a subtle settle confirmation for Self assignment.
- [ ] Do not fake landing on a specific Court lane.
- [ ] Remove flight motion under reduced-motion preference while retaining success feedback.
- [ ] Add combobox/listbox roles.
- [ ] Add `aria-expanded`, `aria-controls`, and `aria-activedescendant`.
- [ ] Keep ghost text hidden from assistive technology.
- [ ] Make chip labels state their value and action.
- [ ] Announce recording, transcription, upload, validation, and success states.
- [ ] Make the complete flow keyboard accessible.
- [ ] Keep normal local parsing below 16 ms.
- [ ] Keep cached suggestion display below 100 ms.
- [ ] Use existing analytics infrastructure only.
- [ ] Do not install a new analytics vendor only for Magic Box.
- [ ] Commit as `feat: polish magic box accessibility and motion`.

**Done when:** MB-018 and MB-019 pass and performance budgets are measured.

## Task 12: Contract Tests and Rollout Gate

**Files:**

- Complete `scripts/magic-box-parser.test.mjs`
- Complete `scripts/magic-box-ranking.test.mjs`
- Complete `scripts/magic-box-contract.test.mjs`
- Update existing regression tests only when behavior intentionally changes

### Exact QA cases

- [ ] MB-001: Plain title produces Self, NEXT, and no Due.
- [ ] MB-002: Ambiguous `@ra` opens popup; arrows and Tab select a stable actor ID.
- [ ] MB-003: Enter with popup selects only and does not Toss.
- [ ] MB-004: Unknown person blocks until resolved or removed.
- [ ] MB-005: `tomorrow 4 PM NOW` produces resolved time and NOW.
- [ ] MB-006: `3/5` displays “Check date” and may Toss with no Due.
- [ ] MB-007: Manual Due wins over parser.
- [ ] MB-008: Manual LATER wins over parser.
- [ ] MB-009: Inside a List, exact List UUID and List context win.
- [ ] MB-010: Sarvam unavailable; core Toss still works.
- [ ] MB-011: Accepted correction reruns deterministic parsing.
- [ ] MB-012: Voice transcript parses and never auto-Tosses.
- [ ] MB-013: Voice failure retains the previous draft.
- [ ] MB-014: Attachment is accessible only to authorized Thing viewers.
- [ ] MB-015: Attachment failure displays Retry/Remove and no false success.
- [ ] MB-016: Double Toss creates exactly one Thing.
- [ ] MB-017: Backend failure retains raw draft and manual chips.
- [ ] MB-018: Reduced motion removes flight while keeping success feedback.
- [ ] MB-019: Complete flow works using keyboard only.
- [ ] MB-020: Wrong assignee is corrected using Reassign with history preserved.

### Mandatory completion commands

- [ ] Run `npm test` and confirm PASS.
- [ ] Run `npm run typecheck` and confirm PASS.
- [ ] Run `npm run lint` and confirm PASS.
- [ ] Run `npm run build` and confirm PASS.
- [ ] Run manual keyboard smoke test.
- [ ] Run manual voice/device smoke test.
- [ ] Run manual attachment authorization smoke test.
- [ ] Run manual reduced-motion smoke test.
- [ ] Confirm no UAT authentication, notification, Netlify, Court, List, Bridge, or lifecycle regression.
- [ ] Remove the old `parse-toss.ts` wrapper only after all call sites and tests pass.

**Done when:** every automated command and manual smoke test passes on the final branch.

---

## 4. Recommended Rollout

### Phase 1: Deterministic core

1. Draft types/reducer/controller.
2. Deterministic parser.
3. Mention binding and ranking.
4. Autocomplete and editable chips.
5. Reliable Toss orchestration.
6. Internal tester rollout.

### Phase 2: Optional intelligence and voice

1. Sarvam correction behind a separate switch.
2. Coey copy with permanent fallback.
3. Voice behind a separate switch after device testing.

### Phase 3: Attachments and final polish

1. Private attachment schema and storage authorization.
2. Attachment UI and finalization/retry flow.
3. Motion, accessibility, analytics, and complete acceptance testing.

## 5. Non-Negotiable Prohibitions

- Do not expose `SARVAM_API_KEY` in client code.
- Do not let Sarvam choose actor IDs or structured payload values.
- Do not replace `create_thing`.
- Do not auto-select an ambiguous person.
- Do not block Toss for an ambiguous date.
- Do not clear the draft after a failed Toss.
- Do not leave confirmation chips static.
- Do not leave the Mic decorative.
- Do not use public attachment storage.
- Do not infer List membership from assignment.
- Do not set Personal Pace during creation.
- Do not add NOW/NEXT/LATER lanes inside Lists.
- Do not copy corrupted document identifiers literally.
- Do not rewrite published Lovable git history.

## 6. Product Decisions to Confirm Before Implementation

1. Whether Phase 1 excludes Sarvam, voice, and attachments as recommended.
2. Whether AI correction is shown only through an explicit “Use corrected text” action.
3. Whether date-period defaults remain 09:00/12:00/15:00/19:00/20:00 and EOD 17:00 for every user.
4. How “this Friday” should behave when Friday has already passed in the current week.
5. Whether attachment finalization failure keeps the Thing and exposes retry, as recommended.
6. Which existing data supplies mention recency and frequency ranking.
7. Which existing analytics wrapper Magic Box should use, or whether analytics remains disabled until one exists.
