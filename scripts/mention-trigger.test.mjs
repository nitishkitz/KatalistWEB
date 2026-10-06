import assert from "node:assert/strict";
import { test } from "node:test";
import { filterMentionPeople, findMentionTrigger, mergeMentionPeople } from "@/features/mentions/mention-trigger";

const people = [
  { id: "1", name: "Nithesh Kumar", initials: "NK" },
  { id: "2", name: "Ajjju Reddy", initials: "AR" },
  { id: "3", name: "Priya Anand", initials: "PA" },
];

test("trigger opens on a bare @ and on a partial name, not inside emails", () => {
  assert.deepEqual(findMentionTrigger("@", 1), { start: 0, query: "" });
  assert.deepEqual(findMentionTrigger("hi @aj", 6), { start: 3, query: "aj" });
  assert.equal(findMentionTrigger("mail me at a@b.com", 18), null);
  assert.equal(findMentionTrigger("hi @Ajjju thanks", 16), null);
});

test("filtering ranks name prefixes before word prefixes before substrings", () => {
  assert.deepEqual(filterMentionPeople(people, "a").map((p) => p.name), ["Ajjju Reddy", "Priya Anand", "Nithesh Kumar"]);
  assert.deepEqual(filterMentionPeople(people, "ajj").map((p) => p.name), ["Ajjju Reddy"]);
  assert.deepEqual(filterMentionPeople(people, "anand").map((p) => p.name), ["Priya Anand"]);
  assert.equal(filterMentionPeople(people, "zzz").length, 0);
  assert.equal(filterMentionPeople(people, "").length, 3);
});

test("merging dedupes by name and keeps a known avatar", () => {
  const merged = mergeMentionPeople(people, [{ id: "9", name: "ajjju reddy", initials: "AR", avatarUrl: "x.png" }]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((p) => p.id === "2")?.avatarUrl, "x.png");
});
