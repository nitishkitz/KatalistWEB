# Coey decision register

Resolves the contradictions and gaps in the Coey Scheduling and Behaviour Model spec v1.1 (11 Oct 2026) and the Placement Tree. Code cites these IDs. A user decision overrides the spec; a "proposed" default can change without a code rewrite because it lives in one module.

| ID | Topic | Decision | Source | Where |
| --- | --- | --- | --- | --- |
| D1 | Open decisions M8 / S4 / L6 | Staleness changes tone and sender concern only (F1 false). "Can't wait" breakthroughs capped at 3 per sender per month (F2 3). Inferred times are not anchors until the ghost chip is tapped (F3 false). F27 false, F29 false. | User, 13 Oct 2026 | `src/domain/coey/config.ts` |
| D2 | Two typed anchors | An explicit action time is the anchor for the action. The event time is stored separately and checked (V2.1). With only an event, the anchor is event minus lead (1 working day for bookings, else 0). | Proposed; §4.1 vs §7.2 | `placement.ts: effectiveAnchor` |
| D3 | Pace vs anchor on creation and runtime | One lane policy for both: promise, then the sender's pace word, then accepted anchor, then Next. Urgent + anchor > 5 wd, or calm + anchor ≤ 1 wd, is L10: shown as Next until the user picks, and the answer is stored (`pace_resolution`) so ticks never flip it. | Proposed; §7.2 vs §16.3 | `placement.ts: laneFromSignals` |
| D4 | Lane chip edits | The lane chip edits the sender's pace (Now = urgent, Next = normal, Later = chill), an explicit stored decision. The lane itself is never written. | Proposed; §4.6 vs §3.2 | composer |
| D5 | WITH_SENDER | Serve back / blocker on sender moves the holder to the sender; their lane is computed normally. NONE applies to the former holder only. | Proposed; C12/C13 vs §16.3 | movement engine |
| D6 | Frequency factors (F12, F23) | Lower frequency means a longer interval: `interval / factor`. | Proposed | follow-up orchestrator |
| D7 | Shared ownership (C7) | No Thing is delegated until one owner is chosen; the others become mentioned. "Keep it" saves a private unresolved capture in the sender's Inbox. | Proposed; §1.2 vs T6 | `draft.ts`, `validation.ts` |
| D8 | End of week | Coey asks which day (Friday, Saturday, Sunday or another date). Month and quarter end use the last working day. | User | `time.ts` |
| D9 | Unknown or ambiguous people | Never guessed. Near spellings and duplicate names always need confirmation. "Keep it" means the name stays as text with the sender, or a private Inbox capture. | Spec C10 + user | `draft.ts: resolveMention` |
| D10 | Bridge (C4, S5, V5.3) and connections | Superseded. Only accepted mutual connections can receive Things, mentions, nudges, chats or calls. Non-users can be tracked privately; no external delivery. | User | `config.ts BRIDGE_DELIVERY_ENABLED` |
| D11 | Notes (C0b) | Saved as a private note Thing in the sender's own Court; no person-note store exists. | Proposed | composer |
| D12 | Interpretation path | One Sarvam-led semantic path. Stage 1 code handles typing, @-selection, grounding and calendar maths only; it never decides intent or recipients. On provider failure the draft stays; the user may retry or keep a private capture. No regex fallback creates or sends a Thing. | User | `server/lib/coey/interpret.ts` |
| D13 | Spelling | Never rewritten. Informal spelling is understood; `text_raw` is stored exactly as typed. | Spec §5.4 + user | composer |
| D14 | Timezone of delegated times | Typed words are interpreted in the sender's calendar; lanes and cadence use the holder's calendar. A time without a zone stays the sender's wall-clock time and the preview shows it. | Proposed; §4.4 vs §7.4 | `draft.ts` |
| D15 | Voice and nudges | Voice services off and microphone hidden. Nudges always need an on-screen send. | User | composer |
| D16 | Quiet | Quiet stops optional appearances (celebrations, surprises). Functional moments — validation, nudges, relays — continue. | Spec §12.9 | engagement engine |
| D17 | Qualified holder activity | Catch, promise, comment by the holder, status change, snooze, blocker, serve back. Sender edits and arbitrary row writes do not reset the follow-up clock. | Proposed; §3.2 | movement engine |
| D18 | "Overdue" wording | Never used in Coey copy (§12.6). Scenario labels are diagnostic only. | Spec | engagement copy |
