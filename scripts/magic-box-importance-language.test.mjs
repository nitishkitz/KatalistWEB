import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMagicBoxText } from "@/features/court/magic-box/parser";
import { zonedParts } from "@/features/court/magic-box/date-time";

const TZ = "Asia/Kolkata";
/** Wednesday 26 Aug 2026, 10:00 IST */
const NOW = new Date("2026-08-26T04:30:00.000Z");

function parse(raw, extra = {}) {
  return parseMagicBoxText(raw, { now: NOW, timeZone: TZ, ...extra });
}

function localParts(iso) {
  return zonedParts(new Date(iso), TZ);
}

const phraseCases = [
  ["Leave office ASAP", "now", "Leave office"],
  ["Leave office as soon as possible", "now", "Leave office"],
  ["Reply immediately", "now", "Reply"],
  ["Do this right away", "now", "Do this"],
  ["Do this right now", "now", "Do this"],
  ["Handle this this instant", "now", "Handle this"],
  ["Critical payment", "now", "payment"],
  ["Fix prod urgent", "now", "Fix prod"],
  ["Fix prod urgently", "now", "Fix prod"],
  ["Fix prod URGENT!", "now", "Fix prod"],
  ["Call emergency", "now", "Call"],
  ["File A.S.A.P.", "now", "File"],
  ["File a.s.a.p", "now", "File"],
  ["Fix prod !!!", "now", "Fix prod"],
  ["Review this soon", "next", "Review this"],
  ["Handle this shortly", "next", "Handle this"],
  ["Handle this after this", "next", "Handle this"],
  ["Review this this week", "next", "Review this"],
  ["Review this next week", "later", "Review this"],
  ["Review this next month", "later", "Review this"],
  ["This is not urgent", "later", "This is"],
  ["Read someday", "later", "Read"],
  ["Clean backlog", "later", "Clean"],
  ["Park this later", "later", "Park this"],
  ["Park this much later", "later", "Park this"],
  ["Ship eventually", "later", "Ship"],
  ["Ping whenever", "later", "Ping"],
  ["No rush", "later", ""],
  ["low priority filing", "later", "filing"],
  ["This can wait", "later", "This"],
  ["Do this when free", "later", "Do this"],
  ["Do this when you have time", "later", "Do this"],
  ["Future work", "later", "work"],
  ["Clean in a few weeks", "later", "Clean"],
  ["Read one day", "later", "Read"],
];

for (const [raw, importance, title] of phraseCases) {
  test(`${raw} maps to ${importance}`, () => {
    const parsed = parse(raw);
    assert.equal(parsed.ownerImportance, importance);
    assert.equal(parsed.importanceSource, "parser");
    assert.equal(parsed.derivedTitle, title);
  });
}

test("by end of day / by EOD are NOW with today 17:00 Due", () => {
  for (const raw of ["File by end of day", "File by EOD", "File EOD"]) {
    const parsed = parse(raw);
    assert.equal(parsed.ownerImportance, "now");
    assert.equal(parsed.importanceSource, "parser");
    assert.equal(parsed.due.status, "resolved");
    assert.equal(parsed.due.dueHasTime, true);
    assert.equal(localParts(parsed.due.dueAt).hour, 17);
    assert.equal(localParts(parsed.due.dueAt).day, 26);
    assert.equal(parsed.derivedTitle, "File");
  }
});

test("before lunch is NOW with today 12:00 Due", () => {
  const parsed = parse("Call before lunch");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  assert.equal(localParts(parsed.due.dueAt).hour, 12);
  assert.equal(parsed.derivedTitle, "Call");
});

test("in 10 minutes is NOW with exact Due", () => {
  const parsed = parse("Call the vendor in 10 minutes");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.importanceSource, "parser");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  assert.equal(new Date(parsed.due.dueAt).getTime(), NOW.getTime() + 10 * 60 * 1000);
  assert.equal(parsed.derivedTitle, "Call the vendor");
});

test("in 10 min uses the same NOW window", () => {
  const parsed = parse("Call the vendor in 10 min");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  assert.equal(new Date(parsed.due.dueAt).getTime(), NOW.getTime() + 10 * 60 * 1000);
});

test("within 1 hour is NOW with exact Due", () => {
  const parsed = parse("Ping within 1 hour");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  assert.equal(new Date(parsed.due.dueAt).getTime(), NOW.getTime() + 60 * 60 * 1000);
  assert.equal(parsed.derivedTitle, "Ping");
});

test("in 2 hours stays NOW; in 3 hours becomes NEXT", () => {
  assert.equal(parse("Ping in 2 hours").ownerImportance, "now");
  const laterHour = parse("Ping in 3 hours");
  assert.equal(laterHour.ownerImportance, "next");
  assert.equal(laterHour.due.status, "resolved");
  assert.equal(laterHour.due.dueHasTime, true);
});

test("tomorrow at 5 PM is NEXT with exact Due", () => {
  const parsed = parse("Send quote tomorrow at 5 PM");
  assert.equal(parsed.ownerImportance, "next");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  const parts = localParts(parsed.due.dueAt);
  assert.equal(parts.day, 27);
  assert.equal(parts.hour, 17);
  assert.equal(parsed.derivedTitle, "Send quote");
});

test("in 3 days is NEXT date-only; in 7 days is NEXT; in 8 days is LATER", () => {
  const three = parse("Follow up in 3 days");
  assert.equal(three.ownerImportance, "next");
  assert.equal(three.due.status, "resolved");
  assert.equal(three.due.dueHasTime, false);
  assert.equal(localParts(three.due.dueAt).day, 29);

  const seven = parse("Follow up in 7 days");
  assert.equal(seven.ownerImportance, "next");
  assert.equal(seven.due.dueHasTime, false);

  const eight = parse("Follow up in 8 days");
  assert.equal(eight.ownerImportance, "later");
  assert.equal(eight.due.dueHasTime, false);
  assert.equal(localParts(eight.due.dueAt).day, 3);
  assert.equal(localParts(eight.due.dueAt).month, 9);
});

test("week wording is LATER even when 7 days would be NEXT", () => {
  const week = parse("Revisit in 1 week");
  assert.equal(week.ownerImportance, "later");
  assert.equal(week.due.status, "resolved");
  assert.equal(week.due.dueHasTime, false);
  assert.equal(localParts(week.due.dueAt).day, 2);
  assert.equal(localParts(week.due.dueAt).month, 9);

  const two = parse("Revisit in 2 weeks");
  assert.equal(two.ownerImportance, "later");
  assert.equal(two.due.dueHasTime, false);
});

test("vague phrases set Importance only and invent no Due", () => {
  for (const raw of ["Review soon", "Review this week", "Review next week", "Review next month", "Read someday", "Clean in a few weeks"]) {
    const parsed = parse(raw);
    assert.equal(parsed.due.status, "none");
    assert.notEqual(parsed.ownerImportance, "default");
  }
});

test("Review later today is LATER with Due today", () => {
  const parsed = parse("Review later today");
  assert.equal(parsed.ownerImportance, "later");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(localParts(parsed.due.dueAt).day, 26);
  assert.equal(parsed.due.dueHasTime, false);
  assert.equal(parsed.derivedTitle, "Review");
});

test("Fix this NOW next week keeps NOW and invents no Due", () => {
  const parsed = parse("Fix this NOW next week");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.due.status, "none");
  assert.equal(parsed.derivedTitle, "Fix this next week");
});

test("This is not urgent never matches as NOW", () => {
  const parsed = parse("This is not urgent");
  assert.equal(parsed.ownerImportance, "later");
  assert.notEqual(parsed.ownerImportance, "now");
});

test("as soon as possible wins over the word soon", () => {
  const parsed = parse("Do it as soon as possible");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.derivedTitle, "Do it");
});

test("manual LATER overrides text ASAP", () => {
  const parsed = parse("Leave office ASAP", { manualImportance: "later" });
  assert.equal(parsed.ownerImportance, "later");
  assert.equal(parsed.importanceSource, "manual");
});

test("word-boundary false positives stay ordinary title text", () => {
  for (const raw of ["Meet in nowhere", "Study laterite", "Ship urgentlyNeeded"]) {
    const parsed = parse(raw);
    assert.equal(parsed.ownerImportance, "next");
    assert.equal(parsed.importanceSource, "default");
    assert.equal(parsed.derivedTitle, raw);
  }
});

test("unsupported language stays in the title and defaults to NEXT", () => {
  const parsed = parse("asdf qwerty please handle this");
  assert.equal(parsed.derivedTitle, "asdf qwerty please handle this");
  assert.equal(parsed.ownerImportance, "next");
  assert.equal(parsed.importanceSource, "default");
  assert.equal(parsed.due.status, "none");
});

test("canonical marker outside a longer phrase wins left to right", () => {
  const parsed = parse("Review NEXT ASAP");
  assert.equal(parsed.ownerImportance, "next");
  assert.equal(parsed.derivedTitle, "Review ASAP");
});
