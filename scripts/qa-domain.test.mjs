import assert from "node:assert/strict";
import { test } from "node:test";
import {
  caseWithPatch,
  checkCompletion,
  casesToRows,
  guessMapping,
  parseTable,
  planPaste,
  rowsToImport,
  totalsFromStatuses,
  validateAttempt,
  validateEvidenceFile,
  filterCases,
} from "../src/features/qa/domain.ts";
import { crc32, escapeSpreadsheetCell, parseDelimited, readXlsx, toCsv, unescapeSpreadsheetCell, writeXlsx } from "../src/features/qa/spreadsheet.ts";
import { buildQaCursorFilter, toQaError, toQaHttpError } from "../src/features/qa/qa-queries.ts";

const c = (n, over = {}) => ({
  id: `00000000-0000-0000-0000-00000000000${n}`, number: n, caseKey: `TC-00${n}`, version: 1, versionId: "v", title: `Case ${n}`,
  preconditions: null, steps: [{ action: "Open", expected: "Opens" }], priority: "medium", module: "Auth", platforms: ["web"], changeNote: null, archived: false, updatedAt: "2026-10-09T00:00:00Z", ...over,
});

test("totals and completion rules come from per-case latest status", () => {
  const t = totalsFromStatuses(["pass", "pass", "fail", "blocked", "not_applicable", "not_run"]);
  assert.deepEqual(t, { total: 6, pass: 2, fail: 1, blocked: 1, notApplicable: 1, notRun: 1 });
  assert.equal(checkCompletion(t, { blocked: true, notRun: false }).reason, "not_run_remaining");
  assert.equal(checkCompletion(t, { blocked: false, notRun: true }).reason, "blocked_remaining");
  assert.equal(checkCompletion(t, { blocked: true, notRun: true }).ok, true);
  assert.equal(checkCompletion(totalsFromStatuses(["pass", "not_applicable"]), { blocked: false, notRun: false }).ok, true);
});

test("fail and blocked require an actual-result note; pass and N/A do not", () => {
  assert.match(validateAttempt("fail", "  "), /actual behaviour/);
  assert.match(validateAttempt("blocked", ""), /blocking/);
  assert.equal(validateAttempt("pass", ""), null);
  assert.equal(validateAttempt("not_applicable", ""), null);
  assert.equal(validateAttempt("fail", "Title is editable"), null);
});

test("CSV parsing handles quotes, embedded newlines, BOM, CRLF and unterminated quotes", () => {
  const rows = parseDelimited('﻿a,b\r\n"x, y","line1\nline2"\r\n"he said ""hi""",\r\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", "line1\nline2"], ['he said "hi"', ""]]);
  assert.throws(() => parseDelimited('a,"unterminated'), /not closed/);
  assert.deepEqual(parseDelimited("a;b\n1;2", ";"), [["a", "b"], ["1", "2"]]);
});

test("exports neutralise formula injection and imports undo exactly that", () => {
  for (const lead of ["=", "+", "-", "@"]) {
    const dangerous = `${lead}HYPERLINK("http://x")`;
    assert.equal(escapeSpreadsheetCell(dangerous), `'${dangerous}`);
    assert.equal(unescapeSpreadsheetCell(escapeSpreadsheetCell(dangerous)), dangerous);
  }
  assert.equal(escapeSpreadsheetCell("Normal text"), "Normal text");
  assert.equal(unescapeSpreadsheetCell("'quoted"), "'quoted");
  const csv = toCsv([["Title"], ['=cmd|" /C calc"!A0']]);
  assert.ok(csv.includes("'=cmd"));
  assert.deepEqual(parseDelimited(csv)[1], [`'=cmd|" /C calc"!A0`]);
});

test("XLSX is a real workbook: ZIP signature, valid CRCs, and a lossless round trip including unicode and formulas as text", async () => {
  const rows = [["ID", "Title", "Notes"], ["TC-001", "Login ✓ & <tags>", "line1\nline2"], ["TC-002", "=1+1", ""]];
  const bytes = writeXlsx("Cases", rows);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  assert.notEqual(crc32(new TextEncoder().encode("hello")), 0);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const back = await readXlsx(bytes);
  assert.deepEqual(back[0], ["ID", "Title", "Notes"]);
  assert.equal(back[1][1], "Login ✓ & <tags>");
  assert.equal(back[1][2], "line1\nline2");
  assert.equal(unescapeSpreadsheetCell(back[2][1]), "=1+1"); // stored as text with the neutralising apostrophe
  assert.ok(!new TextDecoder().decode(bytes).includes("<f>"));
});

test("cursor filter validates its inputs instead of interpolating them", () => {
  const ok = buildQaCursorFilter({ createdAt: "2026-10-09T10:00:00.000Z", id: "11111111-1111-1111-1111-111111111111" });
  assert.match(ok, /created_at\.lt\./);
  assert.throws(() => buildQaCursorFilter({ createdAt: '2026-10-09T10:00:00Z"),id.gt.0', id: "11111111-1111-1111-1111-111111111111" }));
  assert.throws(() => buildQaCursorFilter({ createdAt: "2026-10-09T10:00:00Z", id: "x,or(true)" }));
});

test("database and HTTP errors map to typed codes; access loss is distinct from transient failure", () => {
  assert.equal(toQaError({ code: "PGRST202", message: "x" }).code, "migration_missing");
  assert.equal(toQaError({ code: "P0001", hint: "same_build", message: "x" }).code, "same_build");
  assert.equal(toQaError({ code: "42501", message: "x" }).isAccessLoss, true);
  assert.equal(toQaError({ code: "XX000", message: "x" }).isAccessLoss, false);
  assert.equal(toQaHttpError(503, { message: "m", data: { code: "vault_unavailable" } }).code, "vault_unavailable");
  assert.equal(toQaHttpError(403, null).code, "forbidden");
});

test("import maps headers, validates every row and reports row numbers", () => {
  const { header, body } = parseTable("ID,Test case,Priority,Steps\nTC-001,Login,HIGH,\"Open => Opens\nType => Typed\"\n,,low,\nTC-003,Bad prio,urgent,\n");
  const mapping = guessMapping(header);
  assert.deepEqual(mapping, ["case_key", "title", "priority", "steps"]);
  const { rows, errors } = rowsToImport(body, mapping);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].steps, [{ action: "Open", expected: "Opens" }, { action: "Type", expected: "Typed" }]);
  assert.equal(rows[0].priority, "high");
  assert.deepEqual(errors.map((e) => e.row), [2, 3]);
});

test("case export contains definitions only and round-trips through import", () => {
  const rows = casesToRows([c(1, { title: "Login, with comma", steps: [{ action: "A", expected: "B" }] })]);
  assert.ok(!rows.flat().join(" ").toLowerCase().includes("password"));
  const csv = toCsv(rows);
  const { header, body } = parseTable(csv);
  const { rows: imported, errors } = rowsToImport(body, guessMapping(header));
  assert.equal(errors.length, 0);
  assert.equal(imported[0].title, "Login, with comma");
  assert.equal(imported[0].case_key, "TC-001");
});

test("paste plans only writable columns, validates each row, and ignores extra columns", () => {
  const cases = [c(1), c(2), c(3)];
  const plan = planPaste(cases, 0, ["title", "module", "priority"], 0, "New A\tPerm\thigh\tIGNORED\nNew B\tChat\turgent\nNew C\t\tlow");
  assert.equal(plan.ignoredColumns, 1);
  assert.deepEqual(plan.errors.map((e) => e.row), [2]);
  assert.deepEqual(plan.updates.map((u) => u.caseId), [cases[0].id, cases[2].id]);
  assert.equal(caseWithPatch(cases[0], plan.updates[0].patch).title, "New A");
  assert.equal(planPaste(cases, 2, ["title"], 0, "a\nb").errors[0].row, 2); // runs off the end
});

test("filters combine and keep archived cases out of the default view", () => {
  const list = [c(1), c(2, { priority: "high", module: "Chat" }), c(3, { archived: true })];
  const base = { search: "", priority: "all", module: "all", platform: "all", archived: false };
  assert.equal(filterCases(list, base).length, 2);
  assert.equal(filterCases(list, { ...base, priority: "high" }).length, 1);
  assert.equal(filterCases(list, { ...base, search: "tc-002" }).length, 1);
  assert.equal(filterCases(list, { ...base, archived: true }).length, 1);
});

test("evidence validation enforces type and size before any upload starts", () => {
  assert.equal(validateEvidenceFile({ name: "a.png", type: "image/png", size: 100 }), null);
  assert.match(validateEvidenceFile({ name: "a.exe", type: "application/x-msdownload", size: 100 }), /not allowed/);
  assert.match(validateEvidenceFile({ name: "a.png", type: "image/png", size: 26 * 1024 * 1024 }), /25 MB/);
  assert.match(validateEvidenceFile({ name: "a.png", type: "image/png", size: 0 }), /empty/);
});
