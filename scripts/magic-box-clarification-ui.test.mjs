import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { MagicBoxClarification } = await import("@/features/court/MagicBoxClarification");
const choices = [
  { id: "assign", label: "Assign to Rahul Mehta", description: "Your contact will receive this Thing." },
  { id: "title", label: "Keep Rahul in the title", description: "Leave this Thing with you." },
];

test("a choice is reviewed before Continue, and merely selecting it performs no action", () => {
  const selected = [];
  const ui = render(h(MagicBoxClarification, { id: "question", questionKey: "draft-a", question: "Who should receive this?", choices, onContinue: (id) => selected.push(id), onEdit() {} }));
  try {
    const continueButton = ui.getByRole("button", { name: "Continue" });
    assert.equal(continueButton.disabled, true);
    fireEvent.click(ui.getByRole("radio", { name: /Assign to Rahul Mehta/ }));
    assert.deepEqual(selected, []);
    assert.equal(continueButton.disabled, false);
    fireEvent.click(continueButton);
    assert.deepEqual(selected, ["assign"]);
  } finally { cleanup(); }
});

test("editing the draft retires an earlier selected answer", () => {
  const props = { id: "question", question: "Who should receive this?", choices, onContinue() {}, onEdit() {} };
  const ui = render(h(MagicBoxClarification, { ...props, questionKey: "draft-a" }));
  try {
    fireEvent.click(ui.getByRole("radio", { name: /Keep Rahul in the title/ }));
    ui.rerender(h(MagicBoxClarification, { ...props, questionKey: "draft-b" }));
    assert.equal(ui.getByRole("button", { name: "Continue" }).disabled, true);
    assert.equal(ui.getByRole("radio", { name: /Keep Rahul in the title/ }).checked, false);
  } finally { cleanup(); }
});

test("a clarification with no choices offers an explicit way to edit the message", () => {
  let edits = 0;
  const ui = render(h(MagicBoxClarification, { id: "question", questionKey: "draft-a", question: "What needs to be done?", detail: "Could you briefly describe the task?", choices: [], onContinue() {}, onEdit: () => edits++ }));
  try {
    assert.equal(ui.queryByRole("button", { name: "Continue" }), null);
    fireEvent.click(ui.getByRole("button", { name: "Edit message" }));
    assert.equal(edits, 1);
  } finally { cleanup(); }
});

test("expired date choices cannot enable Continue", () => {
  const ui = render(h(MagicBoxClarification, { id: "question", questionKey: "draft-a", question: "Which deadline?", choices: [{ id: "past", label: "Friday, October 9", disabled: true }], onContinue() {}, onEdit() {} }));
  try {
    assert.equal(ui.getByRole("radio").disabled, true);
    assert.equal(ui.getByRole("button", { name: "Continue" }).disabled, true);
  } finally { cleanup(); }
});
