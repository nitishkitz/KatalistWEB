import assert from "node:assert/strict";
import { test } from "node:test";
import { findActiveMention, replaceMention, ghostSuffix, uniquePersonMatch } from "@/features/court/magic-box/mention";
import { rankAssignablePeople } from "@/features/court/magic-box/ranking";

const people = [
  { id: "a-rahul-s", name: "Rahul Sharma", initials: "RS" },
  { id: "a-rahul-v", name: "Rahul Verma", initials: "RV" },
  { id: "a-rakesh", name: "Rakesh Kumar", initials: "RK" },
  { id: "a-raj", name: "Raj Malhotra", initials: "RM" },
  { id: "a-neha", name: "Neha Rao", initials: "NR" },
];

test("active @ token is detected from the caret", () => {
  const text = "Send deck to @ra please";
  const at = text.indexOf("@");
  const mention = findActiveMention(text, at + 3);
  assert.ok(mention);
  assert.equal(mention.query, "ra");
  assert.equal(text.slice(mention.start, mention.end), "@ra");
});

test("caret outside a mention returns null", () => {
  assert.equal(findActiveMention("Send deck to @ra please", 4), null);
  assert.equal(findActiveMention("no mention here", 3), null);
});

test("replacement range stores a stable actor UUID", () => {
  const text = "Send deck to @ra";
  const mention = findActiveMention(text, text.length);
  const person = people[0];
  const next = replaceMention(text, mention, person);
  assert.equal(next.text, "Send deck to @Rahul Sharma");
  assert.equal(next.binding.actorId, "a-rahul-s");
  assert.equal(next.binding.displayName, "Rahul Sharma");
  assert.equal(next.text.slice(next.binding.start, next.binding.end), "@Rahul Sharma");
  assert.equal(next.caret, next.binding.end);
});

test("ghost suffix is the untyped remainder of the highlighted name", () => {
  assert.equal(ghostSuffix("ra", "Rahul Sharma"), "hul Sharma");
  assert.equal(ghostSuffix("", "Rahul Sharma"), "Rahul Sharma");
  assert.equal(ghostSuffix("Rahul Sharma", "Rahul Sharma"), "");
});

test("unique match is the only person; ambiguous query is not unique", () => {
  assert.equal(uniquePersonMatch("neha", people)?.id, "a-neha");
  assert.equal(uniquePersonMatch("ra", people), null);
  assert.equal(uniquePersonMatch("unknownperson", people), null);
});

test("ranking: exact and prefix dominate list/recency/frequency", () => {
  const ranked = rankAssignablePeople({
    query: "raj",
    people,
    currentListMemberIds: new Set(["a-neha"]),
    recentActorIds: ["a-neha", "a-rakesh"],
    frequencyByActorId: { "a-neha": 99, "a-rakesh": 40 },
  });
  assert.equal(ranked[0].id, "a-raj");
  assert.equal(ranked[0].reasons.includes("exact") || ranked[0].reasons.includes("prefix"), true);
});

test("ranking: list membership, recency and frequency are bounded boosts", () => {
  const ranked = rankAssignablePeople({
    query: "ra",
    people,
    currentListMemberIds: new Set(["a-rakesh"]),
    recentActorIds: ["a-rakesh"],
    frequencyByActorId: { "a-rakesh": 4 },
  });
  assert.ok(ranked.length >= 3);
  const rakesh = ranked.find((p) => p.id === "a-rakesh");
  assert.ok(rakesh);
  assert.ok(rakesh.reasons.includes("list"));
  assert.ok(rakesh.reasons.includes("recency"));
  assert.ok(rakesh.score < 1000);
});

test("ranking is deterministic on ties", () => {
  const a = rankAssignablePeople({ query: "rahul", people: [people[0], people[1]] });
  const b = rankAssignablePeople({ query: "rahul", people: [people[1], people[0]] });
  assert.deepEqual(
    a.map((p) => p.id),
    b.map((p) => p.id),
  );
  assert.equal(a[0].id, "a-rahul-s");
});

test("empty query ranks everyone without using Sarvam", () => {
  const ranked = rankAssignablePeople({
    query: "",
    people,
    recentActorIds: ["a-neha"],
  });
  assert.equal(ranked.length, people.length);
  assert.equal(ranked[0].id, "a-neha");
});

test("non-ASCII names remain matchable", () => {
  const unicode = [{ id: "a-soren", name: "Søren Nielsen", initials: "SN" }];
  const mention = findActiveMention("Ask @Sø", 6);
  assert.equal(mention?.query, "Sø");
  const ranked = rankAssignablePeople({ query: "sø", people: unicode });
  assert.equal(ranked[0].id, "a-soren");
});
