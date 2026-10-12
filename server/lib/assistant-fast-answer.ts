import {
  buildAnswerGroups,
  type AnswerGroup,
  type AssistantAnswer,
  type AssistantFacts,
  type AssistantIntent,
} from "./assistant";
import { normalizeQuestion } from "./assistant-routing";
import { startOfDayInZone } from "./assistant-activity";

type FactThing = AssistantFacts["things"][number];

const CLOSED = new Set(["sorted", "cancelled", "completed"]);
const HOUR = 60 * 60 * 1000;

const emptyFreshness: AssistantFacts["freshness"] = {
  source_max_updated_at: null,
  timezone: "UTC",
  is_partial: false,
};

const base = {
  schema_version: "katalist.assistant.answer.v1" as const,
  confidence: "high" as const,
  citations: [],
  actions: [],
};

/** Conversational reply that needs no facts. Wording follows the greeting, never a capability list. */
export function buildGreetingAnswer(question: string, displayName?: string): AssistantAnswer {
  const q = normalizeQuestion(question);
  const first = displayName && displayName !== "You" ? displayName.split(" ")[0] : "";
  const name = first ? `, ${first}` : "";
  const text = /^(thanks|thank you|thx)/.test(q)
    ? "You are welcome. Ask me anything about your Court whenever you like."
    : /^how are you|^hows it going/.test(q)
      ? "Doing well, thank you. What would you like to look at in your Court?"
      : q.startsWith("good morning")
        ? `Good morning${name}. What would you like to look at first?`
        : q.startsWith("good afternoon")
          ? `Good afternoon${name}. What would you like to look at?`
          : q.startsWith("good evening")
            ? `Good evening${name}. What would you like to look at?`
            : `Hi${name}. What would you like to look at in your Court?`;
  return {
    ...base,
    intent: "clarification",
    answer_markdown: text,
    freshness: emptyFreshness,
  };
}

/** Honest reply for a request that has nothing to do with Katalist. It never claims a check happened. */
export function buildOutOfScopeAnswer(question: string): AssistantAnswer {
  const empty = !/\p{L}/u.test(question);
  return {
    ...base,
    intent: empty ? "clarification" : "unsupported",
    answer_markdown: empty
      ? "I did not catch that. Try asking about your Things, for example what is overdue."
      : "That is outside what I can see in Katalist. I can look at your Things, due dates, teammates and recent changes.",
    freshness: emptyFreshness,
  };
}

function dueWindow(facts: AssistantFacts, now = Date.now()) {
  const tz = facts.freshness.timezone;
  const start = startOfDayInZone(now, tz);
  const end = startOfDayInZone(start + 36 * HOUR, tz);
  return { start, end };
}

/** Ranks for "what matters most": overdue, then due today, then waiting; the viewer's own Things first. */
export function rankAttention(facts: AssistantFacts, now = Date.now()) {
  const { start, end } = dueWindow(facts, now);
  const mine = facts.viewer.actor_id ?? null;
  const open = facts.things.filter((thing) => !CLOSED.has(thing.status));
  const scored = open
    .map((thing) => {
      const due = thing.due_at ? Date.parse(thing.due_at) : null;
      const overdue = thing.is_overdue;
      const dueToday = !overdue && due !== null && due >= start && due < end;
      const waiting = thing.acknowledgement === "waiting_for_catch";
      const isMine = Boolean(mine && thing.assignee_actor_id === mine);
      const reasons: string[] = [];
      if (overdue) reasons.push("overdue");
      if (dueToday) reasons.push("due today");
      if (waiting) reasons.push(isMine ? "waiting for you to catch" : "waiting for a response");
      const score = (overdue ? 100 : 0) + (dueToday ? 60 : 0) + (waiting ? 40 : 0) + (isMine ? 10 : 0);
      return { thing, overdue, dueToday, waiting, isMine, reasons, score, due };
    })
    .filter((row) => row.score >= 40)
    .sort((a, b) => b.score - a.score || (a.due ?? Infinity) - (b.due ?? Infinity));
  return scored;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function citationsFor(rows: ReturnType<typeof rankAttention>, limit = 3) {
  return rows.slice(0, limit).map((row) => ({
    type: "thing" as const,
    id: row.thing.id,
    label: row.thing.citation_label,
  }));
}

function reasonLine(rows: ReturnType<typeof rankAttention>, limit = 3) {
  return rows
    .slice(0, limit)
    .map((row) => `**${row.thing.citation_label}** (${row.reasons.join(", ")})`)
    .join("; ");
}

function scopeSuffix(facts: AssistantFacts) {
  return facts.scope.type === "list" || facts.scope.type === "bucket" ? ` in ${facts.scope.label}` : "";
}

function openActions(rows: ReturnType<typeof rankAttention>, limit = 3): AssistantAnswer["actions"] {
  return rows.slice(0, limit).map((row) => ({
    id: `open-${row.thing.id}`,
    type: "open_thing" as const,
    label: `Open ${row.thing.citation_label}`,
    requires_confirmation: false,
    target_ids: [row.thing.id],
  }));
}

function todayGroups(rows: ReturnType<typeof rankAttention>): AnswerGroup[] {
  const pick = (filter: (row: (typeof rows)[number]) => boolean) => rows.filter(filter);
  const make = (key: AnswerGroup["key"], title: string, list: typeof rows): AnswerGroup => ({
    key,
    title,
    thing_ids: list.map((row) => row.thing.id),
    total: list.length,
  });
  const overdue = pick((row) => row.overdue);
  const dueToday = pick((row) => row.dueToday);
  const waiting = pick((row) => row.waiting && !row.overdue && !row.dueToday);
  return [
    make("overdue", "Overdue", overdue),
    make("due_today", "Due today", dueToday),
    make("waiting", "Waiting for a response", waiting),
  ].filter((group) => group.total > 0);
}

/**
 * Deterministic answer from authenticated facts. Every cited Thing exists in
 * `facts`, and day boundaries follow `facts.freshness.timezone`.
 */
export function buildFastAnswer(
  intent: AssistantIntent,
  facts: AssistantFacts,
  question: string,
  options: { today?: boolean; now?: number } = {},
): AssistantAnswer {
  const now = options.now ?? Date.now();
  const rows = rankAttention(facts, now);
  const where = scopeSuffix(facts);
  const make = (patch: Partial<AssistantAnswer> & Pick<AssistantAnswer, "answer_markdown">) => ({
    ...base,
    intent,
    freshness: facts.freshness,
    ...patch,
  });
  const noOpen = facts.summary.active_count === 0;

  if (intent === "stale_items") {
    const groups = buildAnswerGroups(intent, facts, question);
    return make({
      answer_markdown: groups.length
        ? `**${plural(groups.length, "person", "people")} ${groups.length === 1 ? "has" : "have"} active Things with no recorded update for 3+ days.**`
        : "No assigned active Things have gone without an update for 3+ days.",
      groups,
      citations: groups.flatMap((group) => group.thing_ids).slice(0, 20).map((id) => ({
        type: "thing" as const, id, label: facts.things.find((thing) => thing.id === id)!.citation_label,
      })),
    });
  }

  if (options.today || intent === "attention_items") {
    if (noOpen)
      return make({
        answer_markdown: `Nothing is active${where} right now, so there is nothing that needs you.`,
      });
    if (!rows.length)
      return make({
        answer_markdown: `Nothing needs attention${where} right now. ${plural(facts.summary.active_count, "Thing")} active, none overdue or due today.`,
      });
    const overdue = rows.filter((row) => row.overdue).length;
    const dueToday = rows.filter((row) => row.dueToday).length;
    const waiting = rows.filter((row) => row.waiting).length;
    const parts = [
      overdue ? `${overdue} overdue` : "",
      dueToday ? `${dueToday} due today` : "",
      waiting ? `${waiting} waiting for a response` : "",
    ].filter(Boolean);
    const lead = options.today ? `Today${where}: ${parts.join(", ")}.` : `${parts.join(", ")}${where}.`;
    return make({
      answer_markdown: `${lead} Start with ${reasonLine(rows, 2)}.`,
      citations: citationsFor(rows),
      actions: openActions(rows),
      groups: options.today ? todayGroups(rows) : buildAnswerGroups("attention_items", facts),
    });
  }

  if (intent === "overdue_items") {
    const overdue = rows.filter((row) => row.overdue);
    if (!overdue.length) return make({ answer_markdown: `Nothing is overdue${where}.` });
    return make({
      answer_markdown: `${plural(overdue.length, "Thing")} overdue${where}. Oldest due date first: ${reasonLine(overdue, 2)}.`,
      citations: citationsFor(overdue),
      actions: openActions(overdue),
      groups: buildAnswerGroups("overdue_items", facts),
    });
  }

  if (intent === "nudge_recommendation") {
    const top = facts.nudge_recommendations.filter((row) => row.can_nudge).slice(0, 3);
    return make({
      answer_markdown: top.length
        ? top
            .map(
              (row) =>
                `**${row.display_name}** has ${plural(row.eligible_thing_count, "eligible Thing")} to follow up on${row.overdue_thing_count ? `, ${row.overdue_thing_count} overdue` : ""}.`,
            )
            .join("\n\n")
        : "No teammate has an eligible nudge right now.",
      citations: top.map((row) => ({ type: "person" as const, id: row.actor_id, label: row.display_name })),
      actions: top.map((row) => ({
        id: `nudge-${row.actor_id}`,
        type: "prepare_nudge" as const,
        label: `Prepare nudge for ${row.display_name}`,
        requires_confirmation: true,
        target_ids: row.eligible_thing_ids,
      })),
    });
  }

  if (intent === "recent_activity" && facts.activity) {
    const titles = new Map(facts.things.map((thing: FactThing) => [thing.id, thing.title]));
    const latest = facts.activity.events.filter((event) => titles.has(event.thing_id)).slice(0, 5);
    const label = facts.activity.window.label;
    return make({
      answer_markdown: latest.length
        ? `${plural(facts.activity.events.length, "change")}${where} during ${label}.`
        : `No recorded changes${where} during ${label}.`,
      citations: latest.map((event) => ({
        type: "thing" as const,
        id: event.thing_id,
        label: titles.get(event.thing_id) ?? "Thing",
      })),
      groups: buildAnswerGroups("recent_activity", facts),
    });
  }

  // Summary (and recent activity when no activity facts were loaded).
  const s = facts.summary;
  return make({
    intent: intent === "recent_activity" ? "scope_summary" : intent,
    answer_markdown: `${facts.scope.type === "list" || facts.scope.type === "bucket" ? `**${facts.scope.label}** has` : "You have"} ${plural(s.active_count, "active Thing")}, ${s.completed_count} completed, ${s.overdue_count} overdue, and ${s.waiting_for_catch_count} waiting for a response.`,
    citations: citationsFor(rows),
    actions: openActions(rows),
  });
}
