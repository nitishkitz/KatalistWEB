import assert from "node:assert/strict";
import { test } from "node:test";
import { isCoeyCommand } from "../src/domain/coey/command.ts";

const titles = ["Pay the electricity bill", "Review the Q3 deck", "Renew the trade licence", "Send the GST summary"];

test("instructions about an existing Thing go to Ask, not Toss", () => {
  for (const line of ["sort the electricity bill", "please snooze pay the electricity bill for 6 hours", "move renew the trade licence to now",
    "mark the GST summary sorted", "move the deck to later", "summarise the q3 deck", "comment on the electricity bill"]) {
    assert.equal(isCoeyCommand(line, titles), true, line);
  }
});

test("new work that starts with the same verbs stays a Toss", () => {
  for (const line of ["mark attendance for the new staff", "Mark the register by Friday", "move the boxes to the godown", "sort the files in the storeroom",
    "catch the 5pm train", "Ravi send the price list", "tomorrow", "open a new bank account"]) {
    assert.equal(isCoeyCommand(line, titles), false, line);
  }
});
