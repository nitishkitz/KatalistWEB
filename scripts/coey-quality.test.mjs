import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { checkMessage, chooseMessage } from "../src/domain/coey/quality.ts";

const gates = (m) => checkMessage({ audience: "sender", names: ["Ravi Kumar", "Priya Shah"], ...m }).map((f) => f.gate);

test("T22 / Q1: 'Ravi hasn't done the dispatch yet' fails; the spec's rewrite passes; fallback after one regeneration", () => {
  assert.deepEqual(gates({ text: "Ravi hasn't done the dispatch yet." }), ["Q1"]);
  assert.deepEqual(gates({ text: "The dispatch is still in Ravi's court.", thingTitle: "dispatch" }), []);
  const safe = { text: "The dispatch is still in Ravi's court.", audience: "sender" };
  const r = chooseMessage([{ text: "Ravi hasn't done the dispatch yet.", audience: "sender", names: ["Ravi Kumar"] }, { text: "Ravi didn't reply about the dispatch.", audience: "sender", names: ["Ravi Kumar"] }], safe);
  assert.equal(r.usedFallback, true);
  assert.equal(r.attempts, 2);
});

test("Q3 banned words, Q4 surveillance, Q5 comparison, Q2 exits, Q7 clarity", () => {
  assert.ok(gates({ text: "The Q3 report is overdue." }).includes("Q3"));
  assert.ok(gates({ text: "Just checking in on the deck." }).includes("Q3"));
  assert.ok(gates({ text: "Ravi opened it twice but has not replied." }).includes("Q4"));
  assert.ok(gates({ text: "Priya has 7 in Now." }).includes("Q4"));
  assert.deepEqual(checkMessage({ text: "Ravi has 6 in Now already. Make this Next?", audience: "sender", names: ["Ravi Kumar"], allowOverloadWhisper: true, actions: [{ label: "Make it Next" }, { label: "Keep it", exit: true }] }), []);
  assert.ok(gates({ text: "Priya is faster than Ravi on these." }).includes("Q5"));
  assert.ok(gates({ text: "Want to move the deck to Next?", actions: [{ label: "Move" }] }).includes("Q2"));
  assert.ok(gates({ text: "Something is waiting.", thingTitle: "Kharif scheme deck" }).includes("Q7"));
});

test("Q8 upward: no imperatives, no urgency, requester never named", () => {
  const up = (text) => checkMessage({ text, audience: "upward", requester: "Suresh Babu" }).map((f) => f.gate);
  assert.ok(up("Approve the Nalgonda scheme today.").includes("Q8"));
  assert.ok(up("The Nalgonda scheme is waiting urgently.").includes("Q8"));
  assert.ok(up("Suresh asked about the Nalgonda scheme.").includes("Q8"));
  assert.deepEqual(up("The Nalgonda scheme is ready for your input when you have a moment."), []);
});

test("Coey's follow-up and composer copy shipped in this build passes the gates", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261013140000_coey_followups.sql", import.meta.url), "utf8");
  const templates = [...sql.matchAll(/'((?:A Thing is waiting in your court)|(?:“%s” is in your court whenever you are ready\.)|(?:“%s” and %s more are in your court\.)|(?:%s Things from %s %s))'/g)].map((m) => m[1].replace(/%s/g, "2"));
  assert.ok(templates.length >= 3);
  for (const text of templates) assert.deepEqual(checkMessage({ text, audience: "holder", names: ["Deva Rao"] }), [], text);
  const validation = readFileSync(new URL("../src/domain/coey/validation.ts", import.meta.url), "utf8");
  for (const [, text] of validation.matchAll(/message: `([^`$]+)`|message: "([^"]+)"/g)) {
    if (!text) continue;
    assert.deepEqual(checkMessage({ text, audience: "sender" }).filter((f) => f.gate === "Q3" || f.gate === "Q1"), [], text);
  }
});
