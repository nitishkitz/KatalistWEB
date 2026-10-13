/**
 * Grounded Ask for questions the Magic Box recognised (C0a). The question is
 * a structured read query from interpretation, executed in code over the
 * permission-scoped facts — no keyword routing, no model prose for counts.
 * Copy speaks about Things' states, never about a person's activity (Q4, §13.2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnswerGroup, AssistantAnswer, AssistantFacts } from "../assistant";
import { computeSenderConcern } from "../../../src/domain/coey/placement";
import { addDays, defaultCalendar, localParts, safeTimezone, weekdayOf, zonedInstant, type HolderCalendar } from "../../../src/domain/coey/calendar";

/**
 * Today and this calendar week (Monday–Sunday) in the viewer's timezone,
 * as epoch-ms half-open intervals.
 */
export function localWindows(now: number, timezone: string) {
  const tz = safeTimezone(timezone);
  const today = localParts(now, tz).date;
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  return {
    today: [zonedInstant(today, 0, tz), zonedInstant(addDays(today, 1), 0, tz)] as const,
    week: [zonedInstant(monday, 0, tz), zonedInstant(addDays(monday, 7), 0, tz)] as const,
  };
}
import type { ThingSchedule } from "../../../src/domain/coey/model";

export type StructuredQuery = {
  about_person: string | null;
  exclude_self: boolean;
  state: "any" | "pending" | "waiting_on_others" | "waiting_on_me" | "stale" | "sorted";
  window: "any" | "today" | "this_week" | "overdue";
};

export function parseStructuredQuery(raw: unknown): StructuredQuery | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const states = ["any", "pending", "waiting_on_others", "waiting_on_me", "stale", "sorted"];
  const windows = ["any", "today", "this_week", "overdue"];
  if (typeof q.state !== "string" || !states.includes(q.state)) return null;
  if (typeof q.window !== "string" || !windows.includes(q.window)) return null;
  return {
    about_person: typeof q.about_person === "string" && q.about_person.trim() ? q.about_person.trim().slice(0, 60) : null,
    exclude_self: q.exclude_self === true,
    state: q.state as StructuredQuery["state"],
    window: q.window as StructuredQuery["window"],
  };
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]s\b/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const CLOSED = new Set(["sorted", "completed", "cancelled"]);

type Schedules = Map<string, { schedule: ThingSchedule; cal: HolderCalendar }>;

/** Sender-side schedules and holder calendars for the facts' Things (RLS applies). */
export async function loadSchedulesForFacts(client: SupabaseClient, facts: AssistantFacts): Promise<Schedules> {
  const out: Schedules = new Map();
  const ids = facts.things.map((t) => t.id);
  if (!ids.length) return out;
  try {
    const { data } = await client.from("thing_schedules").select("*").in("thing_id", ids.slice(0, 300));
    const { scheduleFromRow } = await import("../../../src/features/court/coey/schedules");
    const rows = ((data ?? []) as Parameters<typeof scheduleFromRow>[0][]).map(scheduleFromRow);
    const holders = [...new Set(rows.map((r) => r.holderProfileId).filter((x): x is string => Boolean(x)))];
    const cals = new Map<string, HolderCalendar>();
    if (holders.length) {
      const { data: calRows } = await client.rpc("get_calendars", { p_profile_ids: holders });
      const { calendarFromRow } = await import("../../../src/features/court/coey/use-coey-context");
      for (const row of (calRows ?? []) as Parameters<typeof calendarFromRow>[0][]) cals.set(row.profile_id, calendarFromRow(row));
    }
    const fallback = defaultCalendar(safeTimezone(facts.freshness.timezone));
    for (const s of rows) out.set(s.thingId, { schedule: s, cal: (s.holderProfileId && cals.get(s.holderProfileId)) || fallback });
  } catch {
    // No schedules: stale questions answer from what is known, honestly marked below.
  }
  return out;
}

export function structuredAnswer(
  facts: AssistantFacts,
  query: StructuredQuery,
  schedules: Schedules,
  confirmedActorId?: string,
  now = Date.parse(facts.generated_at) || Date.now(),
): AssistantAnswer {
  const base = { schema_version: "katalist.assistant.answer.v1" as const, confidence: "high" as const, actions: [], citations: [], freshness: facts.freshness };
  const me = facts.viewer.actor_id ?? "";
  const people = new Map(facts.people.map((p) => [p.actor_id, p.display_name]));
  for (const t of facts.things) if (t.assignee_actor_id && t.assignee_name && !people.has(t.assignee_actor_id)) people.set(t.assignee_actor_id, t.assignee_name);

  // A named person resolves exactly; near names ask, never guess (V1.2).
  let personId: string | null = null;
  if (confirmedActorId) {
    if (!people.has(confirmedActorId)) return { ...base, intent: "person_not_found", answer_markdown: "That person is no longer available here.", groups: [] };
    personId = confirmedActorId;
  } else if (query.about_person) {
    const wanted = fold(query.about_person);
    const named = [...people].filter(([id]) => id !== me);
    const exact = named.filter(([, name]) => fold(name) === wanted || fold(name).split(" ")[0] === wanted);
    if (exact.length === 1) personId = exact[0]![0];
    else {
      const candidates = exact.length ? exact : named.filter(([, name]) => fold(name).split(" ")[0]!.startsWith(wanted.slice(0, 3)) && wanted.length >= 3);
      if (!candidates.length) {
        return { ...base, intent: "person_not_found", groups: [], answer_markdown: `I can’t find “${query.about_person}” among the people in this view.` };
      }
      return {
        ...base, intent: "person_selection_required", groups: [],
        answer_markdown: candidates.length === 1 ? `Do you mean **${candidates[0]![1]}**?` : "Which person do you mean?",
        person_candidates: candidates.slice(0, 8).map(([actor_id, display_name]) => ({ actor_id, display_name })),
      };
    }
  }

  const windows = localWindows(now, facts.freshness.timezone);
  let staleKnown = true;
  const things = facts.things.filter((t) => {
    const open = !CLOSED.has(t.status);
    if (query.state === "sorted" ? open : !open) return false;
    if (query.exclude_self && t.assignee_actor_id === me) return false;
    if (personId && t.assignee_actor_id !== personId) return false;
    if (query.state === "waiting_on_others" && !(t.owner_actor_id === me && t.assignee_actor_id !== me)) return false;
    if (query.state === "waiting_on_me" && t.assignee_actor_id !== me) return false;
    if (query.state === "stale") {
      // Only Things the viewer sent can be "past their follow-up" (§8.2 sender concern).
      if (t.owner_actor_id !== me || t.assignee_actor_id === me) return false;
      const s = schedules.get(t.id);
      if (!s) { staleKnown = false; return false; }
      if (computeSenderConcern(s.schedule, s.cal, now) !== "stale" && computeSenderConcern(s.schedule, s.cal, now) !== "promise_missed") return false;
    }
    const due = t.due_at ? Date.parse(t.due_at) : null;
    const within = (w: readonly [number, number]) => due !== null && due >= w[0] && due < w[1];
    if (query.window === "today" && !within(windows.today)) return false;
    if (query.window === "this_week" && !within(windows.week)) return false;
    if (query.window === "overdue" && !(due !== null && due < now)) return false;
    return true;
  });

  const byHolder = new Map<string, string[]>();
  for (const t of things) {
    const key = t.assignee_actor_id ?? "unassigned";
    byHolder.set(key, [...(byHolder.get(key) ?? []), t.id]);
  }
  const groups: AnswerGroup[] = [...byHolder].map(([actor, ids]) => ({
    key: `person:${actor}`,
    title: actor === me ? "In your court" : `In ${people.get(actor) ?? "someone’s"}’s court`,
    thing_ids: ids,
    total: ids.length,
  }));
  const n = things.length;
  const noun = n === 1 ? "Thing" : "Things";
  const who = personId ? ` with ${people.get(personId)}` : query.exclude_self ? " with others" : "";
  const answer_markdown =
    query.state === "stale"
      ? n
        ? `${n} ${noun} you sent ${n === 1 ? "is" : "are"} past ${n === 1 ? "its" : "their"} usual follow-up time${who}.`
        : staleKnown ? `Nothing you sent is past its follow-up time${who}.` : `I can only tell this for Things sent through the Magic Box, and none of those are waiting${who}.`
      : query.state === "sorted"
        ? `${n} sorted ${noun}${who}.`
        : query.state === "waiting_on_me"
          ? n ? `${n} ${noun} ${n === 1 ? "is" : "are"} in your court.` : "Nothing is waiting on you right now."
          : query.window === "overdue"
            ? n ? `${n} ${noun}${who} ${n === 1 ? "is" : "are"} past ${n === 1 ? "its" : "their"} date.` : `Nothing${who} is past its date.`
            : n ? `${n} open ${noun}${who}.` : `No open Things${who}.`;
  return {
    ...base,
    intent: personId ? "person_items" : query.state === "stale" ? "stale_items" : "scope_summary",
    answer_markdown,
    groups,
    citations: things.slice(0, 20).map((t) => ({ type: "thing" as const, id: t.id, label: t.citation_label })),
  };
}
