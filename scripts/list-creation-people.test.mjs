import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const dialog = await readFile(new URL("../src/features/lists/NewListDialog.tsx", import.meta.url), "utf8").catch(() => "");
const picker = await readFile(new URL("../src/features/lists/ListMemberPicker.tsx", import.meta.url), "utf8").catch(() => "");
const panel = await readFile(new URL("../src/features/lists/ListPeoplePanel.tsx", import.meta.url), "utf8").catch(() => "");

test("List creation captures optional description, image, and People", () => {
  assert.match(dialog, /List details/);
  assert.match(dialog, /Description \(optional\)/);
  assert.match(dialog, /Cover image \(optional\)/);
  assert.match(dialog, /Add people/);
  assert.match(dialog, /Collaborator/);
  assert.match(dialog, /View only/);
});

test("creator is displayed as Owner and form guards duplicate submit", () => {
  assert.match(dialog, /You · Owner/);
  assert.match(dialog, /isPending/);
  assert.match(dialog, /Skip people for now/);
  assert.match(dialog, /submit\(true\)/);
});

test("post-create retries reuse the same List instead of creating duplicates", () => {
  assert.match(dialog, /createdListId/);
  assert.match(dialog, /completedMemberIds/);
  assert.match(dialog, /uploadedCover/);
  assert.match(dialog, /for \(const pending of phones\)/);
});

test("existing List Owners can add Team members or invite by phone with a selected role", () => {
  assert.match(panel, /Add member/);
  assert.match(panel, /useListInvitations/);
  assert.match(panel, /Owner/);
  assert.match(panel, /Remove/);
  assert.match(panel, /Revoke/);
  assert.match(panel, /Replace link/);
  assert.match(picker, /useTeamDirectory/);
  assert.match(picker, /Collaborator/);
  assert.match(picker, /View only/);
  assert.match(picker, /10-digit Indian mobile number/);
});

test("phone roles are retained during List creation", () => {
  assert.match(dialog, /type PendingPhone/);
  assert.match(dialog, /pending\.role/);
  assert.doesNotMatch(dialog, /invitePhone\(list\.id,\s*number,\s*"collaborator"\)/);
});
