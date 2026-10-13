/**
 * Coey's reusable result format (docs/design/coey-results-implementation-plan.md).
 * The server decides every fact here — records, counts, states and whether an
 * action is available and why. Coey (the model) only writes the heading and
 * the short explanation. The client renders blocks; it never infers state.
 */

export type RecordActionKind = "catch" | "mark_sorted" | "nudge" | "bring_back" | "open";

export type RecordAction = {
  kind: RecordActionKind;
  status: "available" | "unavailable";
  /** Why it is unavailable, in plain words. Never a guessed time. */
  reason?: string;
};

export type CoeyRecord = {
  id: string;
  title: string;
  /** Who sent it ("You" for the viewer). */
  from: string;
  /** Who holds it now ("You" for the viewer). */
  holder: string;
  relation: "in_your_court" | "you_sent" | "shared";
  lifecycle: "waiting_for_catch" | "in_progress" | "sorted";
  /** The viewer's lane, for Things in their court. */
  lane: "now" | "next" | "later" | null;
  due_at: string | null;
  promise_at: string | null;
  /** Hidden from the viewer's Court until then. */
  snoozed_until: string | null;
  /** Sender-side follow-up, in words, for Things the viewer sent. */
  follow_up: string | null;
  file_count: number;
  actions: RecordAction[];
};

export type RecordGroup = { key: string; title: string; total: number; records: CoeyRecord[] };

/** A history line or a comment. `text` from people is plain text, never markup. */
export type ResultEntry = { at: string; by: string; text: string; thing_id: string; thing_title: string };

export type ResultBlock =
  | { type: "counts"; items: Array<{ label: string; count: number }> }
  | { type: "thing_list"; groups: RecordGroup[] }
  | { type: "thing_detail"; record: CoeyRecord; notes: string | null; files: string[]; history: ResultEntry[]; comments: ResultEntry[]; nudged_at: string[] }
  | { type: "timeline"; title: string; entries: ResultEntry[] }
  | { type: "comments"; title: string; entries: ResultEntry[] }
  | { type: "text"; markdown: string }
  | { type: "notice"; tone: "info" | "warning"; text: string };

export type CoeyPresentation = {
  version: 1;
  /** What the shown results cover, as plain chips ("Waiting for Catch", "With Bharat"). */
  scope: { mode: "work" | "home"; label: string; filters?: string[] };
  summary: { heading: string; description?: string };
  blocks: ResultBlock[];
  completeness: { status: "complete" | "partial"; matched_total: number; displayed: number };
};

const isStr = (v: unknown): v is string => typeof v === "string";
const isRecord = (r: unknown): r is CoeyRecord => {
  const x = r as CoeyRecord;
  return Boolean(x) && isStr(x.id) && isStr(x.title) && isStr(x.from) && isStr(x.holder) && Array.isArray(x.actions)
    && ["waiting_for_catch", "in_progress", "sorted"].includes(x.lifecycle);
};

/** Runtime check before rendering: a malformed presentation falls back to the plain answer. */
export function validPresentation(p: unknown): p is CoeyPresentation {
  const x = p as CoeyPresentation;
  if (!x || x.version !== 1 || !x.summary || !isStr(x.summary.heading) || !Array.isArray(x.blocks)) return false;
  const ids = new Set<string>();
  for (const b of x.blocks) {
    if (b.type === "thing_list") {
      if (!Array.isArray(b.groups)) return false;
      for (const g of b.groups) {
        if (!isStr(g.title) || !Array.isArray(g.records)) return false;
        for (const r of g.records) {
          if (!isRecord(r) || ids.has(r.id)) return false;
          ids.add(r.id);
        }
      }
    } else if (b.type === "counts") {
      if (!Array.isArray(b.items)) return false;
    } else if (b.type === "thing_detail") {
      if (!isRecord(b.record) || !Array.isArray(b.history) || !Array.isArray(b.comments) || !Array.isArray(b.files)) return false;
    } else if (b.type === "timeline" || b.type === "comments") {
      if (!Array.isArray(b.entries) || !b.entries.every((e) => isStr(e.at) && isStr(e.text) && isStr(e.thing_id))) return false;
    } else if (b.type === "text") {
      if (!isStr(b.markdown)) return false;
    } else if (b.type !== "notice") return false;
  }
  return true;
}
