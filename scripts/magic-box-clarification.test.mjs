import assert from "node:assert/strict";
import { test } from "node:test";
import { parseToss, tossBlockedByPerson } from "@/features/court/parse-toss";

const now = new Date(2026, 9, 12, 15);
const rahul = { id: "actor-rahul", name: "Rahul Sharma", initials: "RS" };

test("an unreadable draft requests a brief description before Toss", () => {
  const parsed = parseToss("jksrgkjrhkfkwrcwt", [], now);
  assert.ok(parsed.chips.some((c) => c.kind === "unresolved" && c.value === "content"));
  assert.match(parsed.clarificationMessage, /unclear.*brief/i);
  assert.equal(parsed.title, "jksrgkjrhkfkwrcwt", "clarification preserves the draft");
});

test("short tasks, technical terms, URLs and non-Latin tasks are not mistaken for unreadable text", () => {
  for (const text of ["CSS", "JWT", "Buy milk", "PostgreSQL", "Fix XMLHttpRequest", "https://example.com/jksrgkjrhkfkwrcwt", "రేపు పత్రాలు పంపించాలి", "कल दस्तावेज़ भेजना", "test_project_identifier"]) {
    assert.ok(!parseToss(text, [], now).chips.some((c) => c.kind === "unresolved" && c.value === "content"), text);
  }
});

test("an unknown @mention blocks Toss and explains that no contact was found", () => {
  const parsed = parseToss("@ydj submit your docs", [rahul], now);
  assert.equal(tossBlockedByPerson(parsed.chips), true);
  assert.match(parsed.clarificationMessage, /couldn't find.*@ydj.*choose/i);
  assert.deepEqual(parsed.assigneeIds, []);
});

test("a name written as plain text must be confirmed or explicitly kept as title text", () => {
  const parsed = parseToss("rahul submit your docs", [rahul], now);
  assert.equal(parsed.suggestedPerson.person.id, rahul.id);
  assert.deepEqual(parsed.assigneeIds, [], "no implicit assignment");
  assert.equal(tossBlockedByPerson(parsed.chips), true);
  const dismissed = parsed.chips.filter((c) => c.kind !== "suggestion");
  assert.equal(tossBlockedByPerson(dismissed), false);
  const accepted = parseToss("@Rahul submit your docs", [rahul], now);
  assert.deepEqual(accepted.assigneeIds, [rahul.id]);
  assert.equal(accepted.title, "submit your docs");
});

test("several contacts with the same first name are offered instead of guessing the first", () => {
  const second = { id: "actor-other", name: "Rahul Patel", initials: "RP" };
  const parsed = parseToss("rahul submit your docs", [rahul, second], now);
  assert.equal(parsed.suggestedPerson, undefined);
  assert.deepEqual(parsed.suggestedPeople.people.map((p) => p.id), [rahul.id, second.id]);
  assert.equal(tossBlockedByPerson(parsed.chips), true);
  assert.deepEqual(parseToss("@Rahul.Patel submit your docs", [rahul, second], now).assigneeIds, [second.id]);
});

test("metadata alone asks for a description rather than becoming the task title", () => {
  const parsed = parseToss("@Rahul tomorrow", [rahul], now);
  assert.ok(parsed.chips.some((c) => c.value === "content-empty"));
  assert.match(parsed.clarificationMessage, /what.*do/i);
  assert.equal(parsed.title, "", "metadata never becomes an attachment-only Thing's title");
});

test("an addressed instruction with an unknown plain-text name asks whether it is a contact", () => {
  const parsed = parseToss("rahul submit your docs", [], now);
  assert.equal(parsed.unmatchedPerson.name, "rahul");
  assert.equal(tossBlockedByPerson(parsed.chips), true);
  assert.deepEqual(parsed.assigneeIds, []);
  assert.equal(parseToss("Review submit button", [], now).unmatchedPerson, undefined);
});

test('Rohit and a missing-letter typo inside a task require contact confirmation', () => {
  const rohit={id:'actor-rohit',name:'Rohit',initials:'R'};
  for(const name of ['rhit','rohit']) {
    const p=parseToss(`get all the docs ${name}`,[rohit],now);
    assert.equal(p.suggestedPerson.person.id,'actor-rohit');
    assert.equal(tossBlockedByPerson(p.chips),true);
    assert.deepEqual(p.assigneeIds,[], 'a near match must never assign automatically');
  }
  const unknown=parseToss('get all the docs rohit',[],now);
  assert.equal(unknown.unmatchedPerson.name,'rohit');
  assert.equal(tossBlockedByPerson(unknown.chips),true);
  assert.equal(parseToss('get all the docs ready',[],now).unmatchedPerson,undefined);
});

test('multiple keyboard-mash words pause Toss, while normal task wording remains valid',()=>{
  for(const text of ['sdfgh hshjd','asdfghjk qwertyuiop','ajndqlndqndqn jksrgkjrhkfkwrcwt']) {
    assert.ok(parseToss(text,[],now).chips.some(c=>c.value==='content'),text);
  }
  for(const text of ['Get all the docs','Fix PostgreSQL connection','Review the QWERTY keyboard','CSS JWT']) {
    assert.ok(!parseToss(text,[],now).chips.some(c=>c.value==='content'),text);
  }
});
