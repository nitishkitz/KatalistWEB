# Coey Hybrid Conversation and Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Primary executor: Sonnet 5.5 Medium. Codex owns the final independent acceptance pass after the primary executor reports completion. Do not create a new Codex thread or delegate work merely because this plan names an executor.

**Goal:** Deliver fast, grounded Coey text and interruptible voice with truthful progress and UI actions that match server state.

**Architecture:** A shared assistant turn controller routes clear requests to deterministic answers and open-ended requests to Sarvam. A typed event stream drives the text panel; a server-held Sarvam STT/TTS voice bridge uses the same turn controller and existing action preview/confirm or confirmed-nudge endpoints. A deployment gate validates WebSocket support before the bridge is chosen.

**Tech Stack:** TypeScript, React, TanStack Start/Query, Nitro deployment, Supabase, Sarvam chat/STT/TTS, Web Streams/SSE, WebSocket voice relay, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-coey-conversation-voice-design.md`

## Global constraints

- Preserve all pre-existing worktree edits. This checkout contains many modified and untracked files. Inspect diffs before editing, stage only owned hunks, never reset/clean/force-push/rebase published Lovable history.
- Keep Sarvam credentials server-only. Do not print values in logs, tests, plans, browser responses, or screenshots. Do not infer deployed key presence from local `.env.local`.
- Use authenticated, scoped facts and the current action preview/confirm endpoints as the authority. Model output is untrusted and cannot directly mutate Court state.
- No model-generated progress theater. Status events follow actual lifecycle transitions; no hidden reasoning or private transcript logging.
- Do not ship browser `SpeechRecognition` as the primary voice path; MDN documents incomplete browser support. Text remains available throughout.
- Make no production deployment or real nudge without the user's existing authorization for that action. Use test fixtures and preview/confirm mocks during implementation.
- Keep each task reviewable and working. Feature-flag voice until the deployed bridge and interruption tests pass. Preserve the old query route until migration is verified.

## File map and interfaces

| Unit | Files | Responsibility |
|---|---|---|
| Turn types/state | `server/lib/assistant-turn.ts` (new), `src/features/court/assistant/turn-state.ts` (new) | Typed event envelope, active-turn reducer, stale-event rejection |
| Hybrid answer | `server/lib/assistant-routing.ts` (new), `server/lib/assistant-fast-answer.ts` (new), `server/lib/assistant.ts` | Intent normalization, grounded ranking, model selection, answer assembly |
| Stream transport | `src/routes/api/assistant/stream.ts` (new), `server/lib/assistant-stream.ts` (new) | Authenticated SSE, abort, backpressure, timing; leave `query.ts` compatible |
| Text surface | `src/features/court/MagicBoxAssistant.tsx`, `MagicBox.tsx`, `AssistantActionCard.tsx`, `src/features/court/assistant/*` | Transcript, status, suggestions, action-result alignment, stable answers |
| Voice transport | `server/lib/assistant-voice-protocol.ts` (new), `server/lib/assistant-voice-bridge.ts` (new), voice route selected by deployment spike | Authenticated microphone frames, Sarvam STT/TTS, interruption and cleanup |
| Voice surface | `src/features/court/assistant/use-coey-voice.ts` (new), `CoeyVoiceControls.tsx` (new), `MagicBox.tsx` | Mic permission, captions, playback, stop/mute, text fallback |
| Tests/telemetry | `scripts/assistant-*.test.mjs`, `tests/e2e/preview/coey-conversation.spec.ts` (new), `tests/e2e/preview/coey-voice.spec.ts` (new), `src/lib/telemetry.ts` | Truthfulness, event/order, latency, a11y, voice simulation and pilot data |

**Shared contracts to keep stable across tasks:**

```ts
type CoeyEvent =
  | { turnId: string; seq: number; type: "accepted" }
  | { turnId: string; seq: number; type: "status"; stage: "reading_facts" | "calling_model" | "preparing_action"; text: string }
  | { turnId: string; seq: number; type: "facts_ready"; summary: AssistantFacts["summary"] }
  | { turnId: string; seq: number; type: "text_delta"; text: string }
  | { turnId: string; seq: number; type: "answer"; answer: AssistantAnswer }
  | { turnId: string; seq: number; type: "action_proposed"; action: AssistantAnswer["actions"][number] }
  | { turnId: string; seq: number; type: "completed" }
  | { turnId: string; seq: number; type: "error"; code: string; message: string };
```

The `answer` event is authoritative. Use `text_delta` only for already-grounded deterministic text; the current Sarvam response is JSON, so buffer and validate its full response before showing any model prose. Never stream raw JSON tokens into the panel or TTS. `turnId` is a server-generated UUID, `seq` increases within one turn, and `completed` or `error` is terminal. Do not send raw `AssistantFacts` to the browser beyond the existing authorized result fields. Voice frames use a separate versioned binary/control protocol, not JSON-encoded raw audio inside `CoeyEvent`.

## Review focus

1. “hi” and “whats up today” with and without a Sarvam key must never show the canned capability sentence or unrelated task count. Task 2 tests both.
2. Two quick questions, a 30-second refresh, or Work→Home switch must never display an older turn or change its final answer. Tasks 1 and 5 test this.
3. A spoken “yes” after a proposal expires, context changes, or the target changes must not execute a write. Tasks 6 and 9 test this.
4. A denied mic, disconnected voice socket, or unsupported device must leave typed Ask working and clean up mic/audio resources. Tasks 7 and 8 test this.
5. A model response containing invented Thing IDs or action text must not create a clickable target or announce completion. Tasks 3, 5, and 9 test this.

---

### Task 1: Baseline, event contract, and turn isolation

**Files:** Create `server/lib/assistant-turn.ts`, `src/features/court/assistant/turn-state.ts`, `scripts/assistant-turn.test.mjs`. Modify `src/lib/telemetry.ts` only for names/timings supported by existing telemetry. Do not change production behavior yet.

**Interfaces:** `makeTurnId(): string`, `encodeCoeyEvent(event: CoeyEvent): string`, `applyCoeyEvent(state: CoeyTurnState, event: CoeyEvent): CoeyTurnState`. Track `turnId`, last `seq`, status, draft text, final answer, terminal state. `startTurn` resets state; older turn IDs and non-increasing sequence numbers are ignored.

- [ ] Add failing tests for ordered events, duplicate events, late prior-turn events, terminal-after-terminal events, and context reset; run the targeted Node test command from the verification section and see failures.
- [ ] Implement the smallest codec and reducer; make the tests pass.
- [ ] Add server timing points for auth/scope/facts/model/total without recording private content. Measure the current text path on a fixed authorized fixture or mocked delays and record the baseline in `output/coey-acceptance/baseline.md` (create directory). If no live credential is available, label the measurement as synthetic.
- [ ] Review and commit only owned files with `feat(coey): define streamed turn events` if a clean isolated staging set is possible; otherwise leave changes uncommitted and list them in the handoff.

### Task 2: Grounded fast answers and natural phrasing

**Files:** Create `server/lib/assistant-routing.ts`, `server/lib/assistant-fast-answer.ts`, `scripts/assistant-hybrid.test.mjs`. Modify `server/lib/assistant.ts` and existing assistant tests only where behavior intentionally changes.

**Interfaces:** `routeCoeyQuestion(question: string, history: AssistantConversationTurn[]): { kind: "greeting" | "fast" | "model" | "clarify"; intent: AssistantIntent }`; `buildFastAnswer(intent: AssistantIntent, facts: AssistantFacts, question: string): AssistantAnswer`. Normalize contractions/apostrophes and common misspellings but never treat all `what` questions as summaries. Rank relevant Things by overdue, due today, waiting state, and the viewer's role; return up to three real Thing citations with short reasons. For greeting, use a conversational response without loading facts when no scope-dependent content is needed.

- [ ] Write failing cases using the screenshot phrases: `whats up today`, `What needs my attention?`, `hi`, `Who needs a nudge?`, `What is overdue?`, `What changed this week?`; include spelling variants, empty scope, and a question outside Katalist. Assert cited IDs exist in facts and dates respect `facts.freshness.timezone`.
- [ ] Implement fast routing and response construction. Preserve the current eligibility checks for nudges and existing `buildAnswerGroups` row semantics. No fixed task-count string for greetings.
- [ ] Run targeted tests with and without a mocked Sarvam key; compare outputs to the six screenshots and write before/after examples in the acceptance record.
- [ ] Commit owned files as `feat(coey): answer common Court questions from facts` if safe.

### Task 3: Model path, useful fallbacks, and answer validation

**Files:** Modify `server/lib/assistant.ts`; create `scripts/assistant-model-path.test.mjs`.

**Interfaces:** Keep `answerAssistantQuestion(facts, question, history, signal)` stable. Route open-ended/follow-up requests to Sarvam; preserve bounded history, prompt-injection handling, citation validation, and action sanitization. For model failure, return the best grounded answer available for the classified intent and a visible `notice`; do not fabricate a successful model call. Allow substantive answers to be longer than the current one-or-two-sentence cap when needed, while enforcing the existing output size limit.

- [ ] Add failing tests for a first-turn open question reaching the mocked model, `hi` not reaching it, 429/timeout/invalid JSON fallback, invented citations/actions being stripped, and abort not converting to a stale fallback.
- [ ] Implement routing with one server-side source of truth for the chosen path. Make fallback distinct from out-of-scope guidance; keep model/provider error text honest.
- [ ] Run phase 1/2/6 assistant tests and the new test; commit owned files if safe.

### Task 4: Truthful streaming text transport

**Files:** Create `server/lib/assistant-stream.ts`, `src/routes/api/assistant/stream.ts`, `scripts/assistant-stream.test.mjs`. Keep `src/routes/api/assistant/query.ts` as a compatible fallback until Task 5 passes.

**Interfaces:** Authenticated `POST /api/assistant/stream` accepts the same bounded body as `/api/assistant/query`, returns `text/event-stream`, and uses the Task 1 envelope. Emit `accepted`; emit `status(reading_facts)` at actual facts-read start; emit `facts_ready` after scope/facts validation; emit `status(calling_model)` only when Sarvam is called. A fast answer may send grounded `text_delta`; a Sarvam JSON response is buffered and validated before its `answer` event. Finally emit `completed`. Close upstream fetch on client abort. Emit an `error` event for post-header errors. Respect rate and payload limits and `Cache-Control: no-store`.

- [ ] Write failing stream tests for event order, fast path without `calling_model`, no raw model JSON deltas, 401/429/413, abort, malformed provider chunks, and exactly one terminal event.
- [ ] Implement the route by reusing auth/scope/facts helpers instead of duplicating permission rules. Document any unavoidable shared-handler extraction in the same task.
- [ ] Run targeted tests and local HTTP stream smoke test. If the chosen TanStack/Nitro runtime buffers SSE, capture evidence and use the supported streaming primitive before moving on.
- [ ] Commit owned files if safe.

### Task 5: Text conversation and synchronized Court UI

**Files:** Modify `src/features/court/MagicBoxAssistant.tsx`, `src/features/court/MagicBox.tsx`, `src/features/court/AssistantActionCard.tsx` only as needed; create `src/features/court/assistant/use-coey-turn.ts`, `scripts/assistant-turn-ui.test.mjs`, `tests/e2e/preview/coey-conversation.spec.ts`.

**Interfaces:** `useCoeyTurn` starts/cancels a turn, parses SSE, calls `applyCoeyEvent`, exposes a single final answer, live status, draft text, and typed error. Preserve the existing scope-selection card, nudge card, source rows, and action preview/confirm. The UI may show draft text but cannot show clickable model actions until the authoritative `answer` event. Replace the 30-second answer refetch with explicit Refresh; data invalidation may show “Court changed—refresh answer” without rewriting the transcript.

- [ ] Write failing UI tests for truthful stage labels, no preamble on instant greeting, stale turn ignored after rapid asks or context switch, no answer replacement after timer, and pending suggestions disabled until final validation.
- [ ] Implement a compact transcript/status panel that leaves Court usable on desktop and mobile; show the actual matched rows/options as the answer appears. Keep error, retry, close, and keyboard focus paths.
- [ ] Run component tests, Playwright desktop/mobile scenario, axe, and `npm run typecheck`; commit owned files if safe.

### Task 6: Voice protocol and deployed transport gate

**Files:** Create `server/lib/assistant-voice-protocol.ts`, `scripts/assistant-voice-protocol.test.mjs`, and a small temporary proof route or script under `scripts/coey-voice-transport-*`. Record outcome in `output/coey-acceptance/transport.md`. Modify deployment config only if verified necessary.

**Interfaces:** Versioned control messages `start`, `audio_frame`, `speech_end`, `interrupt`, `stop`, `ack`, `transcript_partial`, `transcript_final`, `audio_chunk`, `voice_state`, `error`; carry session and turn IDs. Audio frame size, session duration, concurrency, and rate limits are explicit constants in this file. No client-supplied provider key or user ID. Reauthenticate at connection start and close on identity loss.

- [ ] Write failing protocol tests for oversized frames, out-of-order turns, duplicate final transcripts, unsupported codec, old-session confirmations, and interruption after terminal state.
- [ ] Implement validation and state transitions without opening provider connections.
- [ ] Deploy a minimal authenticated WebSocket echo/close probe to the actual preview target and test Chrome and Safari connection, binary frame, reconnect, and duration. Do not use local success as proof of deployed support. Record exact runtime/preset and result.
- [ ] If this TanStack/Nitro deployment supports the bridge, choose the in-app route. Otherwise choose a dedicated Node voice bridge with the same protocol and existing authentication; document its host, auth handoff, and deployment steps before Task 7. If neither is available, stop voice work and report a concrete external hosting requirement; text tasks remain shippable.
- [ ] Commit only durable protocol/config files if safe; remove temporary probe code after recording evidence.

### Task 7: Sarvam STT/TTS bridge

**Files:** Create `server/lib/assistant-voice-bridge.ts`, `scripts/assistant-voice-bridge.test.mjs`, plus the route/service chosen in Task 6. Add only server-side voice environment names to `.env.example`; never add a real key.

**Interfaces:** Realtime STT accepts browser audio, relays Sarvam `transcript.partial` and final results; only a final transcript invokes the shared Task 4 turn controller. TTS consumes validated response text and returns playable audio chunks with turn IDs. `interrupt` stops playback and cancels uncommitted upstream work; `stop` closes mic/provider/session resources. Reuse the server's Sarvam secret. Configure model IDs and supported language through server env with documented defaults, verifying endpoint/model compatibility in the official Sarvam docs and a live test before hard-coding them.

- [ ] Write failing mocked-provider tests for partial versus final transcript, bilingual input, provider close, reconnect, no-speech, cancellation, output chunk order, and no audio after interrupt. Assert no key or raw audio appears in telemetry.
- [ ] Implement the bridge with bounded queues and abort propagation. Keep action confirmation outside provider inference and route it through Task 9.
- [ ] Run tests and a manual end-to-end voice session on the chosen preview host. Record speech-end-to-first-audio and interruption-stop timings; compare them with the product bar in the spec.
- [ ] Commit owned files if safe.

### Task 8: Voice surface and accessibility

**Files:** Create `src/features/court/assistant/use-coey-voice.ts`, `CoeyVoiceControls.tsx`, `scripts/assistant-voice-ui.test.mjs`, `tests/e2e/preview/coey-voice.spec.ts`. Modify `src/features/court/MagicBox.tsx` to mount controls under a server-provided feature flag.

**Interfaces:** `useCoeyVoice` owns microphone, connection, audio playback queue, transcript, and state machine from the spec. Explicit user gesture starts listening; mic indicator persists while active. `stop()` releases media tracks, socket, and audio buffers; context/logout/unmount invokes `stop()`. A spoken interruption clears queued audio before accepting the next utterance. Text input and action cards remain operable.

- [ ] Write failing UI tests for all eight visible states, mic denial, device loss, stop during speech, logout/context switch, captions, keyboard, reduced motion, and typed fallback.
- [ ] Implement controls using the bridge protocol. Borrow only permission/cleanup patterns from `src/features/calls/use-list-call.ts`; do not join the call room.
- [ ] Run Playwright with simulated media and a real-device manual check on Chrome and Safari where available. Record unsupported browsers clearly; do not present an inactive voice control as functional.
- [ ] Commit owned files if safe.

### Task 9: Spoken actions and UI truthfulness

**Files:** Modify `server/lib/assistant-actions.ts` only if a missing invariant is proven, `src/features/court/AssistantActionCard.tsx`, `src/features/court/assistant/use-coey-voice.ts`; create `scripts/assistant-voice-actions.test.mjs` and extend both Playwright specs.

**Interfaces:** Voice references only a currently visible proposal ID/turn ID. A read-only `open_thing/list/bucket` command can dispatch immediately through existing navigation. A write command first calls `/api/assistant/action/preview`; the UI and speech read back target/recipient/change; explicit confirmation calls `/api/assistant/action/confirm` with the existing signed token and idempotency key. Nudge uses its existing eligible-target confirmation flow. Server response determines `Done`, partial success, or failure; Court queries invalidate on success.

- [ ] Write failing tests for “open it”, “nudge Ajju about the line chart”, “yes” after expiration, generic “yes” with no visible proposal, changed target, denied permission, double confirm, Work→Home switch, and partial success. Assert speech, card, and Court state agree.
- [ ] Implement proposal binding and confirm/cancel dispatch. Never parse an arbitrary “yes” into a new action. Do not call a mutation merely because a model emits natural-language success text.
- [ ] Run action tests and Playwright with mocked writes; perform real read-only UAT. Do not send a real nudge just to test this task.
- [ ] Commit owned files if safe.

### Task 10: Performance, resilience, and Sonnet handoff

**Files:** Modify only measured bottlenecks from the preceding tasks. Create `output/coey-acceptance/results.md` and update `docs/coey-test-evidence.md` with results and limitations.

**Interfaces:** Capture route choice, facts/model/STT/TTS/total timing, first meaningful text/audio, interruption stop, and error category. Use aggregate IDs/timings, no content. If first answer remains slow, optimize the measured facts read (e.g. defer nudge-only RPC for questions that cannot propose nudges), retaining permission semantics and test coverage. Do not claim latency improvement from a mocked benchmark.

- [ ] Run the six screenshot prompts plus at least twelve paraphrases through live text; record expected versus actual usefulness and grounding. Run voice turn-taking, barge-in, captions, action preview, mobile layout, and network-loss UAT.
- [ ] Run targeted assistant tests, `npm run typecheck`, `npm run lint`, `npm run build`, and relevant Playwright specs. For broad `npm test`, compare failures to the documented baseline; do not label pre-existing failures as new regressions or silently ignore new ones.
- [ ] Check built client files for server-only key names/values without printing secrets, inspect `git diff --check`, and list exact changed files, test results, measured latency, deployment evidence, known limits, and open issues in `results.md`.
- [ ] Stop at a 95%-complete handoff only if all implementation and relevant tests are done. Do not mark unverified voice, deployed transport, or action flows “done” to meet a numeric target. Leave the final independent acceptance and small corrective fixes for Codex.

## Verification commands

Use the repository's Node flags for focused tests (replace the file path per task):

```bash
node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/alias-loader.mjs --test scripts/assistant-turn.test.mjs
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/preview/coey-conversation.spec.ts tests/e2e/preview/coey-voice.spec.ts
```

## Codex final 5% acceptance pass

Codex independently reviews the final diff and Sonnet's evidence, reruns the focused tests plus typecheck/build, exercises the six screenshot prompts in the actual app, verifies visible status against server events, checks key isolation and action confirmation, and fixes small remaining defects. If the bridge is unverified, credentials unavailable, or a serious behavior gap remains, Codex reports that gap honestly rather than describing the project as 95% complete. Only after passing these gates should voice be enabled beyond the test environment.

## Ready-to-use Sonnet 5.5 Medium handoff

> Implement `docs/superpowers/plans/2026-10-12-coey-hybrid-conversation-voice.md` task by task, using `docs/superpowers/specs/2026-10-12-coey-conversation-voice-design.md` as the product contract. You own Tasks 1–10, including tests and preview verification. Preserve the existing dirty worktree and Lovable history; inspect each file before editing and stage only your own changes. Keep Sarvam keys server-side. Do not show raw model JSON or unvalidated action proposals in the UI. Verify the deployed voice transport before building the bridge, and stop with a concrete blocker if no authenticated bridge can be hosted. Do not send real nudges during testing. Finish with `output/coey-acceptance/results.md` listing files changed, exact test results, live versus mocked evidence, latency measurements, screenshots or recordings, and every open issue. Leave Codex the independent final acceptance and small corrective fixes. Do not call the work 95% complete unless the text and voice acceptance gates have actually passed.
