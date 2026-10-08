import { parsePatch } from "../format";
import type { DiffLine } from "../format";

/**
 * Split view over the SAME patch the unified view shows. Line numbers come from the hunk headers. Within a hunk a run of
 * removals is paired with the run of additions that follows it, in order; extra lines on either side face a blank
 * placeholder. Nothing is invented: omitted context between hunks stays omitted, and text is never altered.
 */
export type SplitCell = { no: number; text: string } | null;
export type SplitRow =
  | { type: "hunk"; text: string }
  | { type: "meta"; text: string }
  | { type: "ctx"; left: { no: number; text: string }; right: { no: number; text: string } }
  | { type: "change"; left: SplitCell; right: SplitCell };

export function toSplitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    const height = Math.max(removed.length, added.length);
    for (let i = 0; i < height; i += 1) {
      const l = removed[i];
      const r = added[i];
      rows.push({
        type: "change",
        left: l ? { no: l.oldNo as number, text: l.text } : null,
        right: r ? { no: r.newNo as number, text: r.text } : null,
      });
    }
    removed = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === "del") {
      // A removal after additions begins a new pairing group.
      if (added.length > 0) flush();
      removed.push(line);
    } else if (line.kind === "add") {
      added.push(line);
    } else {
      flush();
      if (line.kind === "hunk") rows.push({ type: "hunk", text: line.text });
      else if (line.kind === "meta") rows.push({ type: "meta", text: line.text });
      else rows.push({ type: "ctx", left: { no: line.oldNo as number, text: line.text }, right: { no: line.newNo as number, text: line.text } });
    }
  }
  flush();
  return rows;
}

export const splitFromPatch = (patch: string): SplitRow[] => toSplitRows(parsePatch(patch));

/** Counts for a file when the provider did not give them: only from the patch actually held, and only when it is complete. */
export function countFromPatch(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of parsePatch(patch)) {
    if (line.kind === "add") additions += 1;
    else if (line.kind === "del") deletions += 1;
  }
  return { additions, deletions };
}
