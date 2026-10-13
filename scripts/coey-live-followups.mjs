// Live Sarvam check: follow-up chains keep the filters of the previous query. Synthetic text only.
import { interpretLine } from "../server/lib/coey/interpret.ts";
import { mergeFollowUp, parseStructuredQuery } from "../server/lib/coey/ask.ts";

const CHAINS = [
  [["show Ravi's overdue Things", { about_person: "Ravi", window: "overdue" }], ["and Priya?", { about_person: "Priya", window: "overdue" }], ["and Ajjju?", { about_person: "Ajjju", window: "overdue" }]],
  [["whos on stale other than me", { state: "stale", exclude_self: true }], ["what about Suresh?", { about_person: "Suresh", state: "stale" }], ["and Priya?", { about_person: "Priya", state: "stale" }]],
  [["what's due today with Ravi", { about_person: "Ravi", window: "today" }], ["and this week?", { about_person: "Ravi", window: "this_week" }]],
];
let pass = 0, total = 0;
for (const chain of CHAINS) {
  const earlierQuestions = [];
  let previousQuery = null;
  for (const [text, expected] of chain) {
    total++;
    const r = await interpretLine(text, { timezone: "Asia/Kolkata", mode: "work", requestId: "live", draftRevision: 0, timeoutMs: 4000, askContext: { earlierQuestions: [...earlierQuestions], previousQuery } });
    const raw = r.ok && r.interpretation.things[0]?.kind === "question" ? r.interpretation.things[0].question : null;
    const parsed = raw ? parseStructuredQuery(raw) : null;
    // Same merge the Ask turn runner applies.
    const q = parsed ? mergeFollowUp(previousQuery, parsed, raw.continues_previous === true) : null;
    const ok = q && Object.entries(expected).every(([k, v]) => (k === "about_person" ? (q[k] ?? "").toLowerCase() === v.toLowerCase() : q[k] === v));
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${text}  → ${JSON.stringify(q)}${r.ok ? "" : ` (${r.reason})`}`);
    earlierQuestions.push(text);
    previousQuery = q ?? previousQuery;
  }
}
console.log(`${pass}/${total} follow-ups kept their filters.`);
