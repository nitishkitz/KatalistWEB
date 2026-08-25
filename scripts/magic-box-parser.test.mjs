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

test("explicit NEXT is parsed and removed from title", () => {
  const parsed = parse("Review deck NEXT");
  assert.equal(parsed.ownerImportance, "next");
  assert.equal(parsed.importanceSource, "parser");
  assert.equal(parsed.derivedTitle, "Review deck");
});

test("Saturday and Sunday are supported", () => {
  const sat = parse("Ship build Saturday");
  assert.equal(sat.due.status, "resolved");
  assert.equal(localParts(sat.due.dueAt).weekday, "Saturday");
  assert.equal(sat.derivedTitle, "Ship build");

  const sun = parse("Rest Sunday");
  assert.equal(sun.due.status, "resolved");
  assert.equal(localParts(sun.due.dueAt).weekday, "Sunday");
});

test("3/5 is ambiguous with no due timestamp", () => {
  const parsed = parse("Finish the deck 3/5");
  assert.equal(parsed.due.status, "ambiguous");
  assert.equal(parsed.due.label, "Check date");
  assert.equal("dueAt" in parsed.due, false);
  assert.equal(parsed.derivedTitle.includes("Finish the deck"), true);
});

test("tomorrow at 4 PM sets dueHasTime true", () => {
  const parsed = parse("Send quote tomorrow at 4 PM");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  const parts = localParts(parsed.due.dueAt);
  assert.equal(parts.day, 27);
  assert.equal(parts.month, 8);
  assert.equal(parts.hour, 16);
  assert.equal(parts.minute, 0);
  assert.equal(parsed.derivedTitle, "Send quote");
});

test("tomorrow morning resolves 09:00 local", () => {
  const parsed = parse("Walkthrough tomorrow morning");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  const parts = localParts(parsed.due.dueAt);
  assert.equal(parts.day, 27);
  assert.equal(parts.hour, 9);
  assert.equal(parts.minute, 0);
});

test("in 2 hours resolves from injected now", () => {
  const parsed = parse("Ping me in 2 hours");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  assert.equal(new Date(parsed.due.dueAt).getTime(), NOW.getTime() + 2 * 60 * 60 * 1000);
});

test("next Friday follows next-calendar-week rule", () => {
  const parsed = parse("Review next Friday");
  assert.equal(parsed.due.status, "resolved");
  const parts = localParts(parsed.due.dueAt);
  assert.equal(parts.weekday, "Friday");
  assert.equal(parts.day, 4);
  assert.equal(parts.month, 9);
  assert.equal(parts.year, 2026);
  assert.equal(parsed.due.dueHasTime, false);
});

test("broad parse failure preserves raw work text", () => {
  const parsed = parse("asdf qwerty please handle this");
  assert.equal(parsed.derivedTitle, "asdf qwerty please handle this");
  assert.equal(parsed.due.status, "none");
  assert.equal(parsed.ownerImportance, "next");
});

test("NOW is parsed case-insensitively and removed", () => {
  const parsed = parse("Send quote NOW");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.derivedTitle, "Send quote");
});

test("legacy !!! maps to NOW", () => {
  const parsed = parse("Fix prod !!!");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.derivedTitle, "Fix prod");
});

test("today / tomorrow / day after tomorrow resolve local dates", () => {
  assert.equal(localParts(parse("Do it today").due.dueAt).day, 26);
  assert.equal(localParts(parse("Do it tomorrow").due.dueAt).day, 27);
  assert.equal(localParts(parse("Do it day after tomorrow").due.dueAt).day, 28);
  assert.equal(parse("Do it today").due.dueHasTime, false);
});

test("bare weekday is the next strictly future occurrence", () => {
  const friday = parse("Call Friday");
  const parts = localParts(friday.due.dueAt);
  assert.equal(parts.weekday, "Friday");
  assert.equal(parts.day, 28);
});

test("this Friday still ahead this week resolves; passed Friday is Check date", () => {
  const ahead = parse("Ship this Friday");
  assert.equal(ahead.due.status, "resolved");
  assert.equal(localParts(ahead.due.dueAt).day, 28);

  const saturday = new Date("2026-08-29T04:30:00.000Z");
  const passed = parseMagicBoxText("Ship this Friday", { now: saturday, timeZone: TZ });
  assert.equal(passed.due.status, "ambiguous");
  assert.equal(passed.due.label, "Check date");
});

test("ISO date is exact and timezone converted", () => {
  const parsed = parse("Lock 2026-09-03");
  assert.equal(parsed.due.status, "resolved");
  const parts = localParts(parsed.due.dueAt);
  assert.equal(parts.year, 2026);
  assert.equal(parts.month, 9);
  assert.equal(parts.day, 3);
  assert.equal(parsed.due.dueHasTime, false);
});

test("EOD, evening, tonight use canonical local times", () => {
  assert.equal(localParts(parse("File EOD").due.dueAt).hour, 17);
  assert.equal(localParts(parse("Call this evening").due.dueAt).hour, 19);
  assert.equal(localParts(parse("Ping tonight").due.dueAt).hour, 20);
  assert.equal(parse("File EOD").due.dueHasTime, true);
});

test("in 3 days and in 2 weeks stay date-only", () => {
  const days = parse("Follow up in 3 days");
  assert.equal(days.due.status, "resolved");
  assert.equal(days.due.dueHasTime, false);
  assert.equal(localParts(days.due.dueAt).day, 29);
  const weeks = parse("Revisit in 2 weeks");
  assert.equal(localParts(weeks.due.dueAt).day, 9);
  assert.equal(localParts(weeks.due.dueAt).month, 9);
});

test("manual Due and Importance override parser", () => {
  const parsed = parse("Send quote tomorrow NOW", {
    manualImportance: "later",
    manualDue: { dueAt: "2026-09-01T12:00:00.000Z", dueHasTime: true, label: "1 Sep 5:30 PM" },
  });
  assert.equal(parsed.ownerImportance, "later");
  assert.equal(parsed.importanceSource, "manual");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.source, "manual");
  assert.equal(parsed.due.dueAt, "2026-09-01T12:00:00.000Z");
});

test("empty derived title when the input is only metadata", () => {
  const parsed = parse("tomorrow NOW");
  assert.equal(parsed.derivedTitle, "");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.due.status, "resolved");
});

test("natural language ASAP maps to NOW and is stripped from the title", () => {
  const parsed = parse("I need to get out of the office ASAP");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.importanceSource, "parser");
  assert.equal(parsed.derivedTitle, "I need to get out of the office");
  assert.equal(parsed.due.status, "none");
});

test("Call the vendor in 10 min is NOW with exact Due", () => {
  const parsed = parse("Call the vendor in 10 min");
  assert.equal(parsed.ownerImportance, "now");
  assert.equal(parsed.due.status, "resolved");
  assert.equal(parsed.due.dueHasTime, true);
  assert.equal(new Date(parsed.due.dueAt).getTime(), NOW.getTime() + 10 * 60 * 1000);
});

test("Review this next week is LATER with no invented Due", () => {
  const parsed = parse("Review this next week");
  assert.equal(parsed.ownerImportance, "later");
  assert.equal(parsed.due.status, "none");
  assert.equal(parsed.derivedTitle, "Review this");
});
