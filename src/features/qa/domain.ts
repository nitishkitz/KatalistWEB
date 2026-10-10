/** Pure QA domain logic shared by the UI, the preview adapter and the tests. */
import { escapeSpreadsheetCell, parseDelimited, unescapeSpreadsheetCell } from "./spreadsheet";
import {
  PLATFORM_KINDS,
  PRIORITIES,
  type ImportReport,
  type ImportRow,
  type PlatformKind,
  type QaAttemptStatus,
  type QaCase,
  type QaCaseDraft,
  type QaCaseFilter,
  type QaCaseStep,
  type QaPriority,
  type QaResultStatus,
  type QaRunCase,
  type QaTotals,
} from "./types";

export const STATUS_LABEL: Record<QaResultStatus, string> = {
  not_run: "Not run",
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  not_applicable: "N/A",
};

/** Dot + text colours for result status. Colour is never the only signal: the label is always shown. */
export const STATUS_TONE: Record<QaResultStatus, { dot: string; text: string }> = {
  not_run: { dot: "#9aa3c0", text: "#6a769c" },
  pass: { dot: "#1fb25a", text: "#16803f" },
  fail: { dot: "#e5384a", text: "#c42a3b" },
  blocked: { dot: "#f08a24", text: "#b85f0a" },
  not_applicable: { dot: "#7d8bb4", text: "#56628a" },
};

export function emptyTotals(): QaTotals {
  return { total: 0, pass: 0, fail: 0, blocked: 0, notApplicable: 0, notRun: 0 };
}

/** Totals from authoritative per-case latest status (never from "loaded rows" of a paged list). */
export function totalsFromStatuses(statuses: Iterable<QaResultStatus>): QaTotals {
  const t = emptyTotals();
  for (const s of statuses) {
    t.total++;
    if (s === "pass") t.pass++;
    else if (s === "fail") t.fail++;
    else if (s === "blocked") t.blocked++;
    else if (s === "not_applicable") t.notApplicable++;
    else t.notRun++;
  }
  return t;
}

export type CompletionCheck =
  | { ok: true }
  | { ok: false; reason: "not_run_remaining" | "blocked_remaining"; message: string };

/** Mirrors qa_complete_run: Not Run and Blocked each need explicit acceptance; N/A is resolved. */
export function checkCompletion(totals: QaTotals, accept: { blocked: boolean; notRun: boolean }): CompletionCheck {
  if (totals.notRun > 0 && !accept.notRun) return { ok: false, reason: "not_run_remaining", message: `${totals.notRun} case(s) have not been run.` };
  if (totals.blocked > 0 && !accept.blocked) return { ok: false, reason: "blocked_remaining", message: `${totals.blocked} case(s) are blocked.` };
  return { ok: true };
}

export const requiresActual = (status: QaAttemptStatus) => status === "fail" || status === "blocked";

/** Whether the result detail may be submitted for this status/note combination. */
export function validateAttempt(status: QaAttemptStatus, actual: string): string | null {
  if (requiresActual(status) && actual.trim().length === 0) {
    return status === "fail" ? "Describe the actual behaviour for a failed result." : "Describe what is blocking this case.";
  }
  if (actual.length > 4000) return "Notes can be at most 4000 characters.";
  return null;
}

// ---------- case library ----------

export function emptyDraft(): QaCaseDraft {
  return { title: "", preconditions: "", steps: [{ action: "", expected: "" }], priority: "medium", module: "", platforms: [], changeNote: "" };
}

export function draftFromCase(c: QaCase): QaCaseDraft {
  return {
    id: c.id,
    title: c.title,
    preconditions: c.preconditions ?? "",
    steps: c.steps.length ? c.steps.map((s) => ({ ...s })) : [{ action: "", expected: "" }],
    priority: c.priority,
    module: c.module ?? "",
    platforms: [...c.platforms],
    changeNote: "",
  };
}

export function cleanSteps(steps: readonly QaCaseStep[]): QaCaseStep[] {
  return steps.map((s) => ({ action: s.action.trim(), expected: s.expected.trim() })).filter((s) => s.action || s.expected);
}

export function validateDraft(draft: QaCaseDraft): string | null {
  if (!draft.title.trim()) return "Give the case a title.";
  if (draft.title.trim().length > 240) return "The title is longer than 240 characters.";
  if (cleanSteps(draft.steps).length > 100) return "A case can have at most 100 steps.";
  return null;
}

export function draftChanged(draft: QaCaseDraft, current: QaCase): boolean {
  const a = JSON.stringify([draft.title.trim(), draft.preconditions.trim(), cleanSteps(draft.steps), draft.priority, draft.module.trim(), [...draft.platforms]]);
  const b = JSON.stringify([current.title, (current.preconditions ?? "").trim(), current.steps, current.priority, (current.module ?? "").trim(), [...current.platforms]]);
  return a !== b;
}

export function filterCases(cases: readonly QaCase[], filter: QaCaseFilter): QaCase[] {
  const term = filter.search.trim().toLowerCase();
  return cases.filter((c) => {
    if (c.archived !== filter.archived) return false;
    if (filter.priority !== "all" && c.priority !== filter.priority) return false;
    if (filter.module !== "all" && (c.module ?? "") !== filter.module) return false;
    if (filter.platform !== "all" && !c.platforms.includes(filter.platform)) return false;
    if (term && !`${c.caseKey} ${c.title} ${c.module ?? ""}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

export function filterRunCases(rows: readonly QaRunCase[], filter: { search: string; result: QaResultStatus | "all"; assignee: string | "all" }): QaRunCase[] {
  const term = filter.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter.result !== "all" && r.status !== filter.result) return false;
    if (filter.assignee !== "all" && r.assigneeId !== filter.assignee) return false;
    if (term && !`${r.caseKey} ${r.title} ${r.module ?? ""}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

// ---------- import / export / paste ----------

const stepsToText = (steps: readonly QaCaseStep[]) => steps.map((s) => (s.expected ? `${s.action} => ${s.expected}` : s.action)).join("\n");
export function textToSteps(text: string): QaCaseStep[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(" => ");
      return at < 0 ? { action: line, expected: "" } : { action: line.slice(0, at).trim(), expected: line.slice(at + 4).trim() };
    });
}

export const CASE_EXPORT_HEADER = ["ID", "Title", "Module", "Priority", "Platforms", "Preconditions", "Steps (action => expected)", "Version"] as const;

/** Case definitions only: no run outcomes and never any credential data. */
export function casesToRows(cases: readonly QaCase[]): string[][] {
  return [
    [...CASE_EXPORT_HEADER],
    ...cases.map((c) => [c.caseKey, c.title, c.module ?? "", c.priority, c.platforms.join(", "), c.preconditions ?? "", stepsToText(c.steps), String(c.version)]),
  ];
}

export const RESULT_EXPORT_HEADER = ["Case", "Title", "Case version", "Module", "Result", "Actual / notes", "Attempts", "Linked Things", "Last attempt"] as const;

export function runCasesToRows(rows: readonly QaRunCase[]): string[][] {
  return [
    [...RESULT_EXPORT_HEADER],
    ...rows.map((r) => [r.caseKey, r.title, String(r.version), r.module ?? "", STATUS_LABEL[r.status], r.actual ?? "", String(r.attemptCount), String(r.linkCount), r.attemptedAt ?? ""]),
  ];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const HEADER_MAP: Array<[RegExp, keyof ImportRow]> = [
  [/^(id|case id|case key|key|test case id)$/, "case_key"],
  [/^(title|test case|name|case|summary)$/, "title"],
  [/^(module|area|component|feature)$/, "module"],
  [/^(priority|severity)$/, "priority"],
  [/^(platforms?|applicable platforms?)$/, "platforms"],
  [/^(preconditions?|prerequisites?|setup)$/, "preconditions"],
  [/^(steps?|steps action expected|steps action expected|test steps)$/, "steps"],
];

export type ColumnMapping = Array<keyof ImportRow | null>;

export function guessMapping(header: readonly string[]): ColumnMapping {
  return header.map((h) => {
    const key = norm(h);
    const hit = HEADER_MAP.find(([re]) => re.test(key));
    return hit ? hit[1] : null;
  });
}

export function rowsToImport(table: readonly (readonly string[])[], mapping: ColumnMapping): { rows: ImportRow[]; errors: Array<{ row: number; message: string }> } {
  const rows: ImportRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  table.forEach((cells, i) => {
    const row: Record<string, unknown> = {};
    mapping.forEach((field, c) => {
      if (!field) return;
      const raw = unescapeSpreadsheetCell((cells[c] ?? "").trim());
      if (field === "steps") row.steps = textToSteps(raw);
      else if (field === "platforms") row.platforms = raw.split(/[,;|]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
      else if (field === "priority") row.priority = raw.toLowerCase();
      else row[field] = raw;
    });
    const rowNumber = i + 1;
    if (!String(row.title ?? "").trim()) errors.push({ row: rowNumber, message: "Title is required." });
    else if (String(row.title).length > 240) errors.push({ row: rowNumber, message: "Title is longer than 240 characters." });
    else if (row.priority && !(PRIORITIES as readonly string[]).includes(String(row.priority))) errors.push({ row: rowNumber, message: "Priority must be low, medium, high or critical." });
    else if (Array.isArray(row.platforms) && row.platforms.some((p) => !(PLATFORM_KINDS as readonly string[]).includes(String(p)))) errors.push({ row: rowNumber, message: "Platforms must be web, android, ios, iot, api, desktop or other." });
    else rows.push(row as unknown as ImportRow);
  });
  return { rows, errors };
}

/** Parses pasted/imported text (CSV, TSV or semicolon) into a header + data table. */
export function parseTable(text: string, delimiter?: "," | "\t" | ";"): { header: string[]; body: string[][] } {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? ((first.match(/\t/g)?.length ?? 0) > 0 ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",");
  const table = parseDelimited(text, d);
  return { header: table[0] ?? [], body: table.slice(1) };
}

export type PasteTarget = "title" | "module" | "priority" | "preconditions";
/** Only these columns accept pasted values; IDs, versions, timestamps and anything credential-like never do. */
export const WRITABLE_PASTE_COLUMNS: readonly PasteTarget[] = ["title", "module", "priority", "preconditions"];

export type PastePlan = {
  updates: Array<{ caseId: string; patch: Partial<Record<PasteTarget, string>> }>;
  errors: Array<{ row: number; message: string }>;
  ignoredColumns: number;
};

/** Maps a pasted block onto the visible rows starting at (startRow, startColumn) of the writable columns. */
export function planPaste(cases: readonly QaCase[], startRow: number, columns: readonly PasteTarget[], startColumn: number, text: string): PastePlan {
  const cells = parseDelimited(text.replace(/\r?\n$/, ""), "\t");
  const plan: PastePlan = { updates: [], errors: [], ignoredColumns: 0 };
  cells.forEach((line, r) => {
    const target = cases[startRow + r];
    if (!target) {
      plan.errors.push({ row: r + 1, message: "There is no row to paste into." });
      return;
    }
    const patch: Partial<Record<PasteTarget, string>> = {};
    line.forEach((raw, c) => {
      const column = columns[startColumn + c];
      if (!column) {
        if (r === 0) plan.ignoredColumns++;
        return;
      }
      const value = unescapeSpreadsheetCell(raw.trim());
      if (column === "title" && !value) return plan.errors.push({ row: r + 1, message: "Title cannot be empty." }), undefined;
      if (column === "priority") {
        const p = value.toLowerCase();
        if (!(PRIORITIES as readonly string[]).includes(p)) return plan.errors.push({ row: r + 1, message: `"${value}" is not a priority.` }), undefined;
        patch.priority = p;
        return;
      }
      patch[column] = value;
    });
    if (Object.keys(patch).length && !plan.errors.some((e) => e.row === r + 1)) plan.updates.push({ caseId: target.id, patch });
  });
  return plan;
}

export function caseWithPatch(c: QaCase, patch: Partial<Record<PasteTarget, string>>): QaCaseDraft {
  const d = draftFromCase(c);
  if (patch.title !== undefined) d.title = patch.title;
  if (patch.module !== undefined) d.module = patch.module;
  if (patch.priority !== undefined) d.priority = patch.priority as QaPriority;
  if (patch.preconditions !== undefined) d.preconditions = patch.preconditions;
  return d;
}

export function formatImportReport(report: ImportReport): string {
  const parts = [`${report.created} created`, `${report.updated} updated`, `${report.skipped} skipped`];
  if (report.errors.length) parts.push(`${report.errors.length} row${report.errors.length === 1 ? "" : "s"} with errors`);
  return report.applied ? parts.join(", ") : `Nothing was imported. ${parts.slice(-1)[0]}.`;
}

export const platformsFromText = (values: readonly string[]): PlatformKind[] =>
  values.filter((v): v is PlatformKind => (PLATFORM_KINDS as readonly string[]).includes(v));

export { escapeSpreadsheetCell };

/** Deterministic idempotency key for a mutation attempt. Distinct per user intent, stable across retries. */
export function newIdempotencyKey(prefix = "qa"): string {
  const bytes = new Uint8Array(12);
  (globalThis.crypto ?? ({ getRandomValues: (b: Uint8Array) => b.map(() => Math.floor(Math.random() * 256)) } as Crypto)).getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const EVIDENCE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "application/pdf", "text/plain", "text/csv"] as const;
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;

export function validateEvidenceFile(file: { name: string; type: string; size: number }): string | null {
  if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) return "That file type is not allowed. Use an image, MP4/WebM video, PDF, text or CSV file.";
  if (file.size < 1) return "That file is empty.";
  if (file.size > EVIDENCE_MAX_BYTES) return "Evidence files can be at most 25 MB.";
  return null;
}
