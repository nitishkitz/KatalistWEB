import { CODE_ACTIVITY_LIMITS } from "./limits";
import type { ChangeFile, CheckRun, CheckState, PatchState } from "./types";

/** "2 hours ago" style label. `now` is injectable so output is deterministic in tests. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "time unknown";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(then).toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** Day group label used by the feed. */
export function dayGroup(iso: string, now: number = Date.now()): "Today" | "Yesterday" | "Earlier" {
  const start = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diffDays = Math.round((start(now) - start(Date.parse(iso))) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return "Earlier";
}

/** Never an invented zero: unknown counts say so. */
export function sizeLabel(additions: number | null, deletions: number | null, files: number | null): string {
  if (additions === null || deletions === null) return files === null ? "size not available" : `${files} ${files === 1 ? "file" : "files"}`;
  const base = `+${additions} −${deletions}`;
  if (files === null) return base;
  return `${base} · ${files} ${files === 1 ? "file" : "files"}`;
}

export function initialsOf(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface CheckCounts {
  failing: number;
  pending: number;
  passed: number;
  other: number;
  total: number;
}

function runOutcome(run: CheckRun): "failing" | "pending" | "passed" | "other" {
  if (run.status !== "completed") return "pending";
  switch (run.conclusion) {
    case "success":
      return "passed";
    case "failure":
    case "timed_out":
    case "cancelled":
    case "action_required":
      return "failing";
    default:
      return "other"; // neutral, skipped, or a completed run with no conclusion
  }
}

export function countChecks(runs: readonly CheckRun[]): CheckCounts {
  const counts: CheckCounts = { failing: 0, pending: 0, passed: 0, other: 0, total: runs.length };
  for (const run of runs) counts[runOutcome(run)] += 1;
  return counts;
}

/**
 * Derive the aggregate check state for a revision.
 * `reachable` is false when the provider could not be asked, which is "unavailable", never "none".
 */
export function deriveCheckState(runs: readonly CheckRun[], reachable = true): CheckState {
  if (!reachable) return "unavailable";
  if (runs.length === 0) return "none";
  const c = countChecks(runs);
  if (c.failing > 0) return "failing";
  if (c.pending > 0) return "pending";
  return "passed";
}

export function checkRunOutcome(run: CheckRun): "failing" | "pending" | "passed" | "other" {
  return runOutcome(run);
}

export function checkSummaryText(runs: readonly CheckRun[]): string {
  const c = countChecks(runs);
  const parts: string[] = [];
  if (c.failing) parts.push(`${c.failing} failing`);
  if (c.pending) parts.push(`${c.pending} running`);
  if (c.passed) parts.push(`${c.passed} passed`);
  if (c.other) parts.push(`${c.other} other`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Patches. Patch text is data. It is parsed to plain strings and rendered as
// text nodes only, so provider-supplied markup can never execute.
// ---------------------------------------------------------------------------

export type DiffLineKind = "hunk" | "add" | "del" | "ctx" | "meta";
export interface DiffLine {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      out.push({ kind: "hunk", oldNo: null, newNo: null, text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", oldNo: null, newNo: newNo++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", oldNo: oldNo++, newNo: null, text: raw.slice(1) });
    } else if (raw.startsWith("\\")) {
      out.push({ kind: "meta", oldNo: null, newNo: null, text: raw });
    } else {
      out.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return out;
}

export interface BoundedPatch {
  state: PatchState;
  text: string | null;
}

const encoder = new TextEncoder();

/** Apply the byte and line limits. Cuts on a line boundary and never exceeds either limit. */
export function boundPatch(
  patch: string | null | undefined,
  limits: { maxBytes: number; maxLines: number } = {
    maxBytes: CODE_ACTIVITY_LIMITS.patchMaxBytes,
    maxLines: CODE_ACTIVITY_LIMITS.patchMaxLines,
  },
): BoundedPatch {
  if (patch === null || patch === undefined) return { state: "unavailable", text: null };
  if (patch.length === 0) return { state: "empty", text: null };
  const lines = patch.split("\n");
  let kept = 0;
  let bytes = 0;
  for (const line of lines) {
    const lineBytes = encoder.encode(line).length + 1;
    if (kept >= limits.maxLines || bytes + lineBytes > limits.maxBytes) break;
    bytes += lineBytes;
    kept += 1;
  }
  if (kept >= lines.length) return { state: "available", text: patch };
  if (kept === 0) return { state: "omitted", text: null };
  return { state: "truncated", text: lines.slice(0, kept).join("\n") };
}

export function fileCountLabel(file: ChangeFile): string {
  if (file.patchState === "binary") return "binary";
  if (file.patchState === "truncated") return "truncated";
  if (file.additions === null || file.deletions === null) return "size n/a";
  return `+${file.additions} −${file.deletions}`;
}

/** Middle-ellipsis for long paths: keeps the file name and the leading directory. */
export function middleEllipsis(path: string, max = 34): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  if (name.length >= max - 2) return `…${name.slice(-(max - 1))}`;
  const head = parts[0];
  const room = max - name.length - 2;
  if (parts.length === 1 || room < 1) return `…/${name}`;
  return `${head.slice(0, Math.max(1, room))}…/${name}`;
}
