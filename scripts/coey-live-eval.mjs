// Live Sarvam evaluation of the Coey interpretation path against a labelled set.
// Usage: node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs scripts/coey-live-eval.mjs
// Needs SARVAM_API_KEY in the environment. Synthetic people only; no Katalist data is sent.
import { interpretLine } from "../server/lib/coey/interpret.ts";
import { buildDraftPlan } from "../src/domain/coey/draft.ts";
import { defaultCalendar, zonedInstant } from "../src/domain/coey/calendar.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const TZ = "Asia/Kolkata";
const now = zonedInstant("2026-10-13", 14 * 60 + 30, TZ); // Tuesday 14:30 IST
const cal = defaultCalendar(TZ);
const viewer = { profileId: "me", actorId: "a-me", name: "Deva Rao" };
const candidates = [
  { profileId: "ravi", actorId: "a-ravi", name: "Ravi Kumar", connected: true },
  { profileId: "ravi2", actorId: "a-ravi2", name: "Ravi Teja", connected: true },
  { profileId: "priya", actorId: "a-priya", name: "Priya Shah", connected: true },
  { profileId: "suresh", actorId: "a-suresh", name: "Suresh Babu", connected: true },
];
const single = candidates.filter((c) => c.profileId !== "ravi2");

// [input, expected court kind, expected lane or null, expected interrupt prefix or null, people set]
const CASES = [
  ["Call CA about GST", "my_court", "next", null],
  ["Call Ravi about GST", "my_court", "next", null, single],
  ["Ravi dispatch 40 bags DAP to Suryapet dealer kal urgent", "with_others", "now", null, single],
  ["Remind me to follow up with Ravi on dispatch tomorrow", "my_court", "next", null, single],
  ["Waiting for Ravi's stock numbers", "with_others", "next", null, single],
  ["Ravi's new number is 9876543210", "note", null, "V0.2", single],
  ["What's pending with Ravi?", "answer", null, null, single],
  ["Whos on stale other than me", "answer", null, null],
  ["anything for me today", "answer", null, null],
  ["Maybe a new scheme for Kharif dealers?", "inbox", "later", null],
  ["Ravi and Priya finish the scheme deck", "ask_owner", null, "C7", single],
  ["Call Ravi and send invoice to Priya", "split", null, "V0.1", single],
  ["Send the price list to Ravi", "my_court", "next", null, candidates],
  ["Ravi send the price list", "inbox", "none", "V1.2", candidates],
  ["Book movie ticket day after tomorrow for today", "my_court", null, "V2.1"],
  ["Breakfast with Ravi", "my_court", "next", null, single],
  ["Send the report EOD", "my_court", "now", null],
  ["Urgent, Kharif scheme deck by November 30", "my_court", "next", "V2.2"],
  ["Every Monday send invoice", "my_court", "later", null],
  ["Send the deck before Friday's review", "my_court", "next", null],
  ["Send the report by end of week", "my_court", null, "END_OF_WEEK"],
  ["Ask Ravi to get Priya to approve", "chain", null, null, single],
  ["Suresh send payment confirmation aaj hi", "with_others", "now", null, single],
  ["Priya pls check the dealer list aaram se", "with_others", "later", null, single],
  ["Zubin send the GST file", "inbox", "none", "V1.2u", single],
  ["@Priya review the Q3 numbers by Friday", "with_others", "next", null, single],
  ["asdfgh jkl qwer", "inbox", "none", null],
  ["kal subah 10 baje bank jaana hai", "my_court", "now", null],
  ["Renew insurance, expires 30th", "my_court", null, null],
];

const results = [];
let pass = 0;
const latencies = [];
for (const [text, court, lane, interrupt, people = candidates] of CASES) {
  const r = await interpretLine(text, { now, timezone: TZ, mode: "work", requestId: "eval", draftRevision: 1, timeoutMs: 4000 });
  latencies.push(r.latency_ms);
  if (!r.ok) {
    results.push({ text, ok: false, reason: r.reason, latency: r.latency_ms });
    console.log(`FAIL  ${text}  — provider ${r.reason} (${r.latency_ms} ms)`);
    continue;
  }
  const plan = buildDraftPlan({ text, mode: "work", interpretation: r.interpretation, selections: {}, candidates: people, viewer, now, cal });
  const got = { court: plan.court.kind, lane: plan.things[0]?.lane.lane ?? null, interrupt: plan.response.interrupt?.id ?? null };
  const okCourt = court === null || got.court === court;
  const okLane = lane === null || got.lane === lane;
  const okInterrupt = interrupt === null ? !got.interrupt || got.interrupt.startsWith("L6") : (got.interrupt ?? "").startsWith(interrupt);
  const ok = okCourt && okLane && okInterrupt;
  if (ok) pass++;
  results.push({ text, ok, expected: { court, lane, interrupt }, got, latency: r.latency_ms, interpretation: r.interpretation });
  console.log(`${ok ? "PASS" : "FAIL"}  ${text}  → ${got.court}/${got.lane}/${got.interrupt ?? "-"}  (${r.latency_ms} ms)${ok ? "" : `  expected ${court}/${lane}/${interrupt ?? "-"}`}`);
}
const sorted = [...latencies].sort((a, b) => a - b);
const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
console.log(`\n${pass}/${CASES.length} matched. Latency p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${sorted.at(-1)} ms.`);
mkdirSync("output/coey-live-eval", { recursive: true });
writeFileSync(`output/coey-live-eval/run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ model: process.env.SARVAM_MODEL, pass, total: CASES.length, latencies, results }, null, 2));
