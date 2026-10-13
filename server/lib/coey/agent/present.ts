import type { CoeyPresentation, CoeyRecord, RecordAction, RecordGroup, ResultBlock, ResultEntry } from "../../../../src/domain/coey/presentation";
import type { Workspace, WsThing } from "./workspace";

/**
 * Builds the result blocks from authorized records. Every state and action
 * availability is decided here, from the Workspace — never by the model.
 */
const FOLLOW_UP: Record<string, string> = {
  promise_missed: "Missed its promised date",
  stale: "Past its usual follow-up time",
  not_caught: "Not caught yet",
  caught_no_date: "Caught, no date promised",
  on_track: "On track",
  blocked: "Waiting on someone else",
};
const MAX_RECORDS = 50;
const RECENT_NUDGE_MS = 2 * 60 * 60 * 1000;

export type GroupBy = "lane" | "person" | "state" | "none";

export function recordActions(t: WsThing, ws: Workspace): RecordAction[] {
  const actions: RecordAction[] = [];
  if (t.in_my_court) {
    if (t.snoozed_until && t.lane === "hidden") actions.push({ kind: "bring_back", status: "available" });
    else if (t.acknowledgement === "waiting_for_catch") actions.push({ kind: "catch", status: "available" });
    else actions.push({ kind: "mark_sorted", status: "available" });
  } else if (t.sent_by_me && t.open) {
    if (t.can_nudge_now) actions.push({ kind: "nudge", status: "available" });
    else {
      const recent = t.my_last_nudge_at && ws.now - Date.parse(t.my_last_nudge_at) < RECENT_NUDGE_MS;
      actions.push({
        kind: "nudge",
        status: "unavailable",
        reason: recent
          ? "You nudged this recently. Another nudge opens after the cooldown."
          : t.acknowledgement === "waiting_for_catch"
            ? `Too soon to nudge. ${t.holder} hasn’t caught it yet, and the follow-up window opens a few hours after it was sent or last changed.`
            : "Too soon to nudge. The follow-up window hasn’t opened yet.",
      });
    }
  }
  actions.push({ kind: "open", status: "available" });
  return actions;
}

export function toRecord(t: WsThing, ws: Workspace): CoeyRecord {
  return {
    id: t.id,
    title: t.title,
    from: t.owner,
    holder: t.holder,
    relation: t.in_my_court ? "in_your_court" : t.sent_by_me ? "you_sent" : "shared",
    lifecycle: t.status === "sorted" || t.status === "completed" ? "sorted" : t.acknowledgement === "waiting_for_catch" ? "waiting_for_catch" : "in_progress",
    lane: t.lane === "now" || t.lane === "next" || t.lane === "later" ? t.lane : null,
    due_at: t.due_at,
    promise_at: t.promise_at,
    snoozed_until: t.lane === "hidden" ? t.snoozed_until : null,
    follow_up: t.sent_by_me && t.concern ? FOLLOW_UP[t.concern] ?? null : null,
    file_count: t.files.length,
    actions: recordActions(t, ws),
  };
}

const LANE_ORDER = ["now", "next", "later", "with_others", "snoozed", "sorted", "other"] as const;
const LANE_TITLE: Record<(typeof LANE_ORDER)[number], string> = {
  now: "Now", next: "Next", later: "Later", with_others: "Waiting with others", snoozed: "Snoozed", sorted: "Sorted", other: "Outside the lanes",
};
function laneKey(t: WsThing): (typeof LANE_ORDER)[number] {
  if (!t.open) return "sorted";
  if (t.in_my_court) return t.lane === "hidden" ? "snoozed" : t.lane === "now" || t.lane === "next" || t.lane === "later" ? t.lane : "other";
  if (t.sent_by_me) return "with_others";
  return "other";
}

/** One Thing in full: its record (with the same actions), notes, files, history and comments. */
export function detailBlock(ws: Workspace, d: { thingId: string; comments: ResultEntry[]; history: ResultEntry[]; nudgedAt: string[] }): ResultBlock | null {
  const t = ws.thing(d.thingId);
  if (!t) return null;
  return { type: "thing_detail", record: toRecord(t, ws), notes: t.notes, files: t.files.map((f) => f.name), history: d.history.slice(0, 15), comments: d.comments.slice(0, 10), nudged_at: d.nudgedAt.slice(0, 10) };
}

export function buildPresentation(
  ws: Workspace,
  input: { ids: string[]; groupBy: GroupBy; heading: string; description?: string; mode: "work" | "home"; partial?: boolean; extras?: ResultBlock[]; filters?: string[] },
): CoeyPresentation {
  const seen = new Set<string>();
  const things = input.ids.map((id) => ws.thing(id)).filter((t): t is WsThing => Boolean(t) && !seen.has(t!.id) && Boolean(seen.add(t!.id)));
  const shown = things.slice(0, MAX_RECORDS);
  const blocks: ResultBlock[] = [...(input.extras ?? [])];
  let groups: RecordGroup[] = [];
  const by = input.groupBy;
  if (shown.length) {
    const keyed = new Map<string, { title: string; items: WsThing[]; order: number }>();
    for (const t of shown) {
      let key: string, title: string, order: number;
      if (by === "lane") { const k = laneKey(t); key = k; title = LANE_TITLE[k]; order = LANE_ORDER.indexOf(k); }
      else if (by === "person") { const name = t.in_my_court ? t.owner : t.holder; key = `person:${name}`; title = t.in_my_court ? `From ${name}` : `With ${name}`; order = t.in_my_court ? 0 : 1; }
      else if (by === "state") { const r = toRecord(t, ws).lifecycle; key = r; title = r === "waiting_for_catch" ? "Waiting for Catch" : r === "in_progress" ? "In progress" : "Sorted"; order = ["waiting_for_catch", "in_progress", "sorted"].indexOf(r); }
      else { key = "all"; title = ""; order = 0; }
      const g = keyed.get(key) ?? { title, items: [], order };
      g.items.push(t);
      keyed.set(key, g);
    }
    groups = [...keyed].sort(([, a], [, b]) => a.order - b.order).map(([key, g]) => ({ key, title: g.title, total: g.items.length, records: g.items.map((t) => toRecord(t, ws)) }));
    if (by === "lane" && groups.length > 1) {
      const inCourt = shown.filter((t) => t.in_my_court && t.lane !== "hidden").length;
      const others = shown.filter((t) => !t.in_my_court && t.sent_by_me && t.open).length;
      const snoozed = shown.filter((t) => t.lane === "hidden").length;
      const items = [
        ...(inCourt ? [{ label: "in your court", count: inCourt }] : []),
        ...(others ? [{ label: "with others", count: others }] : []),
        ...(snoozed ? [{ label: "snoozed", count: snoozed }] : []),
      ];
      if (items.length > 1) blocks.push({ type: "counts", items });
    }
    blocks.push({ type: "thing_list", groups });
  }
  const partial = Boolean(input.partial) || things.length > shown.length;
  if (things.length > shown.length) blocks.push({ type: "notice", tone: "info", text: `Showing the first ${shown.length} of ${things.length}.` });
  if (input.partial) blocks.push({ type: "notice", tone: "warning", text: "Coey read your most recent Things; older ones may not be counted." });
  return {
    version: 1,
    scope: { mode: input.mode, label: input.mode === "work" ? "Work court" : "Home court", ...(input.filters?.length ? { filters: input.filters } : {}) },
    summary: { heading: input.heading, ...(input.description ? { description: input.description } : {}) },
    blocks,
    completeness: { status: partial ? "partial" : "complete", matched_total: things.length, displayed: shown.length },
  };
}

/**
 * Older Ask answers (code-built lists) shown in the same view: their own group
 * titles, with records and actions from the Workspace. Ids repeat across
 * groups only once.
 */
export function presentFromGroups(
  ws: Workspace,
  input: { heading: string; description?: string; mode: "work" | "home"; groups: Array<{ key: string; title: string; thing_ids: string[] }> },
): CoeyPresentation {
  const seen = new Set<string>();
  const groups: RecordGroup[] = [];
  for (const g of input.groups) {
    const records = g.thing_ids.flatMap((id) => {
      const t = ws.thing(id);
      if (!t || seen.has(id)) return [];
      seen.add(id);
      return [toRecord(t, ws)];
    }).slice(0, MAX_RECORDS);
    if (records.length) groups.push({ key: g.key, title: g.title, total: records.length, records });
  }
  const displayed = groups.reduce((n, g) => n + g.records.length, 0);
  return {
    version: 1,
    scope: { mode: input.mode, label: input.mode === "work" ? "Work court" : "Home court" },
    summary: { heading: input.heading, ...(input.description ? { description: input.description } : {}) },
    blocks: groups.length ? [{ type: "thing_list", groups: groups.length === 1 ? [{ ...groups[0]!, title: groups[0]!.title }] : groups }] : [],
    completeness: { status: "complete", matched_total: displayed, displayed },
  };
}
