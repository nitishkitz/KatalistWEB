import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDate, clockParts, dateTimeValue } from "../src/components/ui/date-time-value.ts";

test("calendar dates stay local and reject rollover dates", () => {
  const date = calendarDate("2028-02-29T18:30");
  assert.equal(date.getFullYear(), 2028);
  assert.equal(date.getMonth(), 1);
  assert.equal(date.getDate(), 29);
  for (const invalid of ["2026-02-29", "2026-13-01", "2026-04-31", "", "not a date"]) assert.equal(calendarDate(invalid), undefined);
});

test("12-hour controls preserve midnight, noon and arbitrary minutes", () => {
  assert.equal(dateTimeValue(undefined, "12", "00", "AM", "time"), "00:00");
  assert.equal(dateTimeValue(undefined, "12", "00", "PM", "time"), "12:00");
  assert.equal(dateTimeValue(undefined, "6", "37", "PM", "time"), "18:37");
  assert.deepEqual(clockParts("2026-10-15T00:05"), { hour: "12", minute: "05", period: "AM" });
  assert.deepEqual(clockParts("12:59"), { hour: "12", minute: "59", period: "PM" });
});

test("date-only and combined values retain existing caller formats", () => {
  const date = new Date(2026, 9, 15);
  assert.equal(dateTimeValue(date, "", "", "AM", "date"), "2026-10-15");
  assert.equal(dateTimeValue(date, "06", "30", "PM", "datetime-local"), "2026-10-15T18:30");
  for (const [hour, minute] of [["0", "00"], ["13", "00"], ["6", "60"], ["", "30"], ["x", "00"]]) assert.equal(dateTimeValue(date, hour, minute, "AM", "datetime-local"), "");
  assert.equal(dateTimeValue(undefined, "09", "00", "AM", "datetime-local"), "");
});
