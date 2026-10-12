# Coey Conversation and Voice Design

**Status:** Product intent approved in chat on 2026-10-12; implementation details below are the contract for the handoff plan.

## Outcome

Coey should feel like an active, trustworthy Katalist collaborator in text and voice. A user can ask a natural question, hear a brief truthful progress update when work takes noticeable time, see the matching Court items and options, interrupt a spoken response, and complete an authorized action through the same preview and confirmation flow available by touch or keyboard. It must answer greetings and ordinary phrasing such as “whats up today” naturally. The target is a coherent interaction, not a claim that Coey uses the same model as Codex.

## Product contract

1. One conversation model serves typed and spoken turns. The transcript, cited Things, action proposals, and final result stay in sync. Work/Home, List/Bucket, identity, and request changes cannot leak or replay an earlier turn.
2. Fast, deterministic answers handle greetings, clear status, overdue, due-today, attention, nudge recommendation, and recent-activity questions from authenticated Katalist facts. Sarvam handles open-ended synthesis and follow-ups over those same facts. “Unsupported” is reserved for a genuinely out-of-scope request; ordinary wording must not become a canned capability message.
3. The server emits typed events: `accepted`, `status`, `facts_ready`, `text_delta`, `answer`, `action_proposed`, `completed`, and `error`. Each carries a turn ID. Status text describes a real operation: e.g. “Checking your Court” only after the facts read begins. No status reveals hidden reasoning or claims a check that has not happened. Brief answers need no preamble. A turn produces one stable final answer; background freshness changes prompt an explicit refresh instead of silently replacing it.
4. A spoken turn has visible states `idle`, `connecting`, `listening`, `transcribing`, `checking`, `speaking`, `action_ready`, `error`. Show partial and final transcripts, a microphone indicator, mute/stop, text fallback, and captions. The user can interrupt output; interruption stops playback and cancels or supersedes the active answer, never a committed action.
5. Voice and touch operate the same action proposal. Read-only navigation may proceed directly. Assignment, due-date, and status writes use the existing authenticated preview/confirm endpoints; nudges use the existing eligible-target selection and confirmed nudge endpoint. Each proposal displays recipient, target Things, and consequences. Spoken “yes” confirms only the currently visible, unexpired proposal after explicit readback; generic “yes” cannot confirm an unseen or stale proposal. Actual Court state changes only after server success, followed by query invalidation and a result message.
6. Text and voice quality are tested with the six user screenshots’ prompts and additional paraphrases, ambiguity, no data, network loss, interruption, permission change, stale action, and Work/Home switching. No invented counts, people, or actions. A model outage has an honest, useful data-backed fallback.

## Architecture

The existing TanStack assistant route remains the authority for scope, facts, citations, and actions. Add a shared turn controller and a streaming HTTP endpoint for text status and validated answer events. The current Sarvam prompt expects JSON; raw JSON token deltas must never be displayed as user-facing answer text. The old JSON query route remains during migration and is removed only when callers and tests have moved. The client owns a single active turn ID and ignores later events from older IDs. The existing action engine and confirmed nudge endpoint remain the only mutation paths.

Voice uses a chained pipeline: browser microphone → authenticated Katalist voice bridge → Sarvam realtime STT → shared turn controller → Sarvam streaming TTS → browser playback. The provider key stays server-side. STT partials are captions only; only a final transcript starts an assistant turn. Keep an output playback queue that can be cleared on interruption. Do not couple this bridge to the human call-room signaling code. Reuse only its proven microphone permission and cleanup patterns.

Before implementing the persistent bridge, verify that the actual deployment target supports the required WebSocket upgrade and session duration for this TanStack/Nitro route. Vercel's June 2026 [WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections) describes support, while its older [limits page](https://vercel.com/docs/limits) conflicts. A deployed spike, not documentation alone, decides. If the configured deployment cannot host the relay, use a small dedicated Node bridge with the same protocol and authentication; do not expose the Sarvam key or silently downgrade the product to a browser-specific SpeechRecognition dependency. The voice UI may ship behind a server flag only after the bridge passes deployed tests.

Sarvam documents [realtime partial transcription](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming), [chat SSE streaming](https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/overview), and [TTS WebSocket streaming](https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/streaming-api/web-socket). OpenAI's [voice architecture comparison](https://developers.openai.com/api/docs/guides/voice-agents) is the reason for retaining separable STT, assistant, and TTS stages in the first release. A GPT-Live or other speech-to-speech provider can be benchmarked later through the same turn/action contract if the chained pipeline fails latency or interruption targets.

## Quality bars

- Measure `accepted→first visible status`, `accepted→first meaningful text`, `speech end→first audio`, facts read, provider wait, TTS, interruption stop, and total turn time in an authorized test environment. Do not invent baseline numbers. Set release thresholds after measuring baseline and a small pilot; require the hybrid path to beat the current median and p95 text turn time on the same fixture and network.
- At every point, spoken words, transcript, progress label, highlighted rows, proposed action, and server state agree. A stage can be skipped, but never fabricated.
- Browser and mobile tests cover Chrome and Safari where available, microphone denial, device loss, network reconnect, overlapping speech, keyboard-only operation, captions, reduced motion, and audio cleanup on route/logout/context change.
- Log timings, route choice, error class, and turn ID; never log raw audio, full transcripts, private Thing content, or API keys by default. Bound audio frame size, turn duration, rate, and concurrent sessions per authenticated user.

## Boundaries and non-goals

The first release supports Court, and inherits existing Work/Home/List/Bucket scope. It does not autonomously send nudges, change tasks, join human calls, transcribe meetings, or promise general web knowledge. It does not move authorization decisions into a model prompt. The user can always type instead of speaking.
