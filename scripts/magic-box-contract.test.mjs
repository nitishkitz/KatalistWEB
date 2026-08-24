import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { demoDirectory } from "@/features/demo/identities";
import {
  canTossDraft,
  emptyMagicBoxState,
  reduceMagicBox,
  selectDraft,
  tossBlockReason,
} from "@/features/court/magic-box/reducer";
import { buildFinalCreateThingInput } from "@/features/court/magic-box/payload";
import { parseMagicBoxText } from "@/features/court/magic-box/parser";
import { findActiveMention, replaceMention } from "@/features/court/magic-box/mention";
import { resolveComposerKey, wrapIndex } from "@/features/court/magic-box/keyboard";
import { sanitizeCoeyCopy, coeyFallback, wordCount } from "@/features/court/magic-box/coey-copy";
import { parseToss, tossBlockedByPerson } from "@/features/court/parse-toss";

const TZ = "Asia/Kolkata";
const NOW = new Date("2026-08-26T04:30:00.000Z");
const people = [
  { id: "a-rahul-s", name: "Rahul Sharma", initials: "RS" },
  { id: "a-rahul-v", name: "Rahul Verma", initials: "RV" },
  { id: "a-rakesh", name: "Rakesh Kumar", initials: "RK" },
  { id: "a-raj", name: "Raj Malhotra", initials: "RM" },
];
const ctx = { now: NOW, timeZone: TZ, people, context: "work" };

function run(actions, listCtx = {}) {
  let state = emptyMagicBoxState();
  const reduceCtx = { ...ctx, ...listCtx };
  for (const action of actions) state = reduceMagicBox(state, action, reduceCtx);
  return { state, draft: selectDraft(state, reduceCtx) };
}

test("MB-001 plain title is Self, NEXT, no Due", () => {
  const { draft } = run([{ type: "TEXT_CHANGED", text: "Buy printer paper", caret: 17 }]);
  assert.equal(draft.derivedTitle, "Buy printer paper");
  assert.equal(draft.assignee.status, "self");
  assert.equal(draft.ownerImportance, "next");
  assert.equal(draft.due.status, "none");
  const payload = buildFinalCreateThingInput(draft);
  assert.equal("error" in payload, false);
  assert.equal(payload.assigneeActorId, undefined);
  assert.equal(payload.dueAt, undefined);
  assert.equal(payload.ownerImportance, "next");
});

test("MB-002/003 keyboard: Tab/Enter accept mention and Enter does not Toss while popup is open", () => {
  const accept = resolveComposerKey("Enter", { mentionMenuOpen: true, chipEditorOpen: false, canToss: true });
  const tab = resolveComposerKey("Tab", { mentionMenuOpen: true, chipEditorOpen: false, canToss: true });
  const toss = resolveComposerKey("Enter", { mentionMenuOpen: false, chipEditorOpen: false, canToss: true });
  assert.equal(accept.type, "mention-accept");
  assert.equal(tab.type, "mention-accept");
  assert.equal(toss.type, "toss");
  assert.equal(wrapIndex(0, 1, 4), 1);
  assert.equal(wrapIndex(3, 1, 4), 0);
  assert.equal(wrapIndex(0, -1, 4), 3);

  const text = "Send deck to @ra";
  const mention = findActiveMention(text, text.length);
  const replaced = replaceMention(text, mention, people[0]);
  const { draft } = run([
    { type: "TEXT_CHANGED", text, caret: text.length },
    {
      type: "ASSIGNEE_SELECTED",
      person: people[0],
      source: "mention",
      binding: replaced.binding,
      text: replaced.text,
      caret: replaced.caret,
    },
  ]);
  assert.equal(draft.assignee.status, "resolved");
  assert.equal(draft.assignee.person.id, "a-rahul-s");
  assert.equal(draft.rawText.includes("@Rahul Sharma"), true);
});

test("MB-004 unknown person blocks Toss until resolved or removed", () => {
  const { draft } = run([{ type: "TEXT_CHANGED", text: "Deck for @unknownperson", caret: 23 }]);
  assert.equal(draft.assignee.status, "unresolved");
  assert.equal(canTossDraft(draft, false), false);
  assert.equal(tossBlockReason(draft, false), "unresolved-person");
  const cleared = run([
    { type: "TEXT_CHANGED", text: "Deck for @unknownperson", caret: 23 },
    { type: "TEXT_CHANGED", text: "Deck for", caret: 8 },
  ]);
  assert.equal(cleared.draft.assignee.status, "self");
  assert.equal(canTossDraft(cleared.draft, false), true);
});

test("MB-005 tomorrow 4 PM NOW produces resolved time and NOW", () => {
  const { draft } = run([{ type: "TEXT_CHANGED", text: "Send quote tomorrow 4 PM NOW", caret: 28 }]);
  assert.equal(draft.ownerImportance, "now");
  assert.equal(draft.due.status, "resolved");
  assert.equal(draft.due.dueHasTime, true);
  assert.equal(draft.derivedTitle, "Send quote");
});

test("MB-006 3/5 is Check date and may Toss with no Due", () => {
  const { draft } = run([{ type: "TEXT_CHANGED", text: "Review 3/5", caret: 10 }]);
  assert.equal(draft.due.status, "ambiguous");
  assert.equal(draft.due.label, "Check date");
  assert.equal(canTossDraft(draft, false), true);
  const payload = buildFinalCreateThingInput(draft);
  assert.equal(payload.dueAt, undefined);
});

test("MB-007 manual Due wins over parser and does not rewrite raw text", () => {
  const { draft } = run([
    { type: "TEXT_CHANGED", text: "Send quote tomorrow", caret: 19 },
    { type: "DUE_SET", dueAt: "2026-09-01T10:30:00.000Z", dueHasTime: true, label: "1 Sep 4:00 PM" },
  ]);
  assert.equal(draft.rawText, "Send quote tomorrow");
  assert.equal(draft.due.status, "resolved");
  assert.equal(draft.due.source, "manual");
  assert.equal(draft.due.dueAt, "2026-09-01T10:30:00.000Z");
});

test("MB-008 manual LATER wins over parser", () => {
  const { draft } = run([
    { type: "TEXT_CHANGED", text: "Review deck NOW", caret: 15 },
    { type: "IMPORTANCE_SET", importance: "later" },
  ]);
  assert.equal(draft.rawText, "Review deck NOW");
  assert.equal(draft.ownerImportance, "later");
  assert.equal(draft.importanceSource, "manual");
});

test("MB-009 List UUID and List context win", () => {
  const { draft } = run([{ type: "TEXT_CHANGED", text: "Add launch copy", caret: 15 }], {
    listId: "list-uuid-marketing",
    listName: "Marketing",
    context: "home",
  });
  assert.equal(draft.listId, "list-uuid-marketing");
  assert.equal(draft.listName, "Marketing");
  assert.equal(draft.context, "home");
  const payload = buildFinalCreateThingInput(draft);
  assert.equal(payload.listId, "list-uuid-marketing");
  assert.equal(payload.context, "home");
});

test("MB-010/011 AI is non-authoritative; accepted correction re-parses; disabled path still tosses", () => {
  const offered = run([
    { type: "TEXT_CHANGED", text: "snd qoutation tmw", caret: 17 },
    { type: "AI_CORRECTION_RECEIVED", text: "Send quotation tomorrow", requestId: "r1" },
  ]);
  assert.equal(offered.draft.rawText, "snd qoutation tmw");
  assert.equal(offered.draft.aiCorrection.text, "Send quotation tomorrow");
  assert.equal(canTossDraft(offered.draft, false), true);

  const accepted = run([
    { type: "TEXT_CHANGED", text: "snd qoutation tmw", caret: 17 },
    { type: "AI_CORRECTION_RECEIVED", text: "Send quotation tomorrow", requestId: "r1" },
    { type: "AI_CORRECTION_ACCEPTED" },
  ]);
  assert.equal(accepted.draft.rawText, "Send quotation tomorrow");
  assert.equal(accepted.draft.due.status, "resolved");
  assert.equal(accepted.draft.aiCorrection, null);
});

test("MB-013/017 failure retains raw text, chips, mentions, attachments", () => {
  const file = { name: "brief.pdf", type: "application/pdf", size: 1200 };
  const { state, draft } = run([
    { type: "TEXT_CHANGED", text: "Send quote tomorrow LATER", caret: 25 },
    { type: "IMPORTANCE_SET", importance: "now" },
    { type: "ATTACHMENT_ADDED", attachment: { clientId: "c1", file, status: "ready" } },
  ]);
  assert.equal(draft.ownerImportance, "now");
  const afterFail = reduceMagicBox(state, { type: "TEXT_CHANGED", text: state.rawText, caret: state.caret }, ctx);
  const kept = selectDraft(afterFail, ctx);
  assert.equal(kept.rawText, "Send quote tomorrow LATER");
  assert.equal(kept.ownerImportance, "now");
  assert.equal(kept.attachments.length, 1);
  const reset = selectDraft(reduceMagicBox(afterFail, { type: "RESET_AFTER_SUCCESS" }, ctx), ctx);
  assert.equal(reset.rawText, "");
});

test("MB-015 failed attachment blocks Toss until retry or remove", () => {
  const file = { name: "x.pdf", type: "application/pdf", size: 12 };
  const failed = run([
    { type: "TEXT_CHANGED", text: "Attach this", caret: 11 },
    { type: "ATTACHMENT_ADDED", attachment: { clientId: "c1", file, status: "failed", error: "upload" } },
  ]);
  assert.equal(tossBlockReason(failed.draft, false), "attachment-failed");
  const uploading = run([
    { type: "TEXT_CHANGED", text: "Attach this", caret: 11 },
    { type: "ATTACHMENT_ADDED", attachment: { clientId: "c1", file, status: "uploading" } },
  ]);
  assert.equal(tossBlockReason(uploading.draft, false), "attachment-pending");
});

test("MB-016 pending mutation blocks a second Toss", () => {
  const { draft } = run([{ type: "TEXT_CHANGED", text: "Buy paper", caret: 9 }]);
  assert.equal(canTossDraft(draft, true), false);
  assert.equal(tossBlockReason(draft, true), "pending");
  assert.equal(canTossDraft(draft, false), true);
});

test("resolved mention invalidates when its range is edited", () => {
  const text = "Ask @ra";
  const mention = findActiveMention(text, text.length);
  const replaced = replaceMention(text, mention, people[0]);
  const selected = run([
    { type: "TEXT_CHANGED", text, caret: text.length },
    {
      type: "ASSIGNEE_SELECTED",
      person: people[0],
      source: "mention",
      binding: replaced.binding,
      text: replaced.text,
      caret: replaced.caret,
    },
  ]);
  assert.equal(selected.draft.assignee.status, "resolved");
  const edited = run([
    { type: "TEXT_CHANGED", text, caret: text.length },
    {
      type: "ASSIGNEE_SELECTED",
      person: people[0],
      source: "mention",
      binding: replaced.binding,
      text: replaced.text,
      caret: replaced.caret,
    },
    { type: "TEXT_CHANGED", text: "Ask @Ra", caret: 7 },
  ]);
  assert.equal(edited.draft.assignee.status === "resolved" && edited.draft.assignee.person.id === "a-rahul-s", false);
});

test("ambiguous date never blocks Toss; unresolved person does", () => {
  const peopleDemo = demoDirectory();
  const blocked = parseToss("Deck for @unknownperson", peopleDemo);
  assert.equal(tossBlockedByPerson(blocked.chips), true);
  const ambiguous = parseToss("Finish the deck 3/5", peopleDemo);
  assert.equal(tossBlockedByPerson(ambiguous.chips), false);
  assert.ok(ambiguous.chips.some((c) => c.label === "Check date" && c.value === "ambiguous"));
  assert.equal(ambiguous.dueAt, undefined);
});

test("Coey copy is capped, non-judgmental, and falls back", () => {
  assert.ok(wordCount(coeyFallback("THING_TOSSED_SELF")) <= 18);
  assert.equal(sanitizeCoeyCopy("You are lazy and late", "TOSS_FAILED"), coeyFallback("TOSS_FAILED"));
  assert.equal(
    sanitizeCoeyCopy("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen", "THING_TOSSED_SELF"),
    coeyFallback("THING_TOSSED_SELF"),
  );
  assert.equal(sanitizeCoeyCopy("Tossed to Rahul. Court’s lighter.", "THING_TOSSED_OTHER", "Rahul"), "Tossed to Rahul. Court’s lighter.");
});

test("source contract: keyboard, create_thing, no client Sarvam secret, chips are buttons", () => {
  const composer = readFileSync(new URL("../src/features/court/magic-box/MagicBoxComposer.tsx", import.meta.url), "utf8");
  const box = readFileSync(new URL("../src/features/court/MagicBox.tsx", import.meta.url), "utf8");
  const keyboard = readFileSync(new URL("../src/features/court/magic-box/keyboard.ts", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../src/features/court/magic-box/useMagicBoxController.ts", import.meta.url), "utf8");
  const chips = readFileSync(new URL("../src/features/court/magic-box/ConfirmationChips.tsx", import.meta.url), "utf8");
  const assist = readFileSync(new URL("../src/features/court/magic-box/useSarvamAssist.ts", import.meta.url), "utf8");
  const sarvam = readFileSync(new URL("../src/features/ai/sarvam-client.server.ts", import.meta.url), "utf8");
  const rpc = readFileSync(new URL("../src/features/things/rpc.ts", import.meta.url), "utf8");
  const clientTree = [
    composer,
    box,
    assist,
    readFileSync(new URL("../src/features/court/magic-box/useMagicBoxVoice.ts", import.meta.url), "utf8"),
  ].join("\n");

  assert.match(keyboard, /mentionMenuOpen/);
  assert.match(keyboard, /mention-accept/);
  assert.match(controller, /rpcCreateThing/);
  assert.match(rpc, /create_thing/);
  assert.match(chips, /type="button"/);
  assert.match(box, /tossBlockedByPerson/);
  assert.match(box, /Pick a person/);
  assert.equal(box.includes('throw new Error("Check date")'), false);
  assert.equal(clientTree.includes("VITE_SARVAM"), false);
  assert.equal(clientTree.includes("SARVAM_API_KEY"), false);
  assert.match(sarvam, /SARVAM_API_KEY/);
  assert.match(assist, /Use corrected text/);
});

test("parser timezone is injected and not an uncontrolled clock", () => {
  const a = parseMagicBoxText("tomorrow morning", { now: NOW, timeZone: "Asia/Kolkata" });
  const b = parseMagicBoxText("tomorrow morning", { now: NOW, timeZone: "America/Los_Angeles" });
  assert.equal(a.due.status, "resolved");
  assert.equal(b.due.status, "resolved");
  assert.notEqual(a.due.dueAt, b.due.dueAt);
});
