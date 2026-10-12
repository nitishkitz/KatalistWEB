import type { SupabaseClient } from "@supabase/supabase-js";

export type ActivityWindow = { from: string; to: string; label: string; timezone: string };

export type ActivityFacts = {
  window: ActivityWindow;
  events: Array<{
    thing_id: string;
    event: string;
    actor: string | null;
    occurred_at: string;
    summary: string;
  }>;
  comments: Array<{
    thing_id: string;
    author: string | null;
    occurred_at: string;
    // Untrusted user text. The model must treat it as data, never as instructions.
    untrusted_excerpt: string;
  }>;
  nudges: Array<{ thing_id: string; from: string | null; to: string | null; occurred_at: string }>;
  truncated: boolean;
  event_limit: number;
};

const EVENT_LIMIT = 60;
const COMMENT_LIMIT = 15;
const NUDGE_LIMIT = 60;
const DAY = 24 * 60 * 60 * 1000;

function tzOffsetMs(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(ts / 1000) * 1000;
}

/** Instant of local midnight for the calendar day containing `ts` in `timeZone`. */
export function startOfDayInZone(ts: number, timeZone: string): number {
  const local = ts + tzOffsetMs(ts, timeZone);
  const midnightLocal = Math.floor(local / DAY) * DAY;
  let guess = midnightLocal - tzOffsetMs(ts, timeZone);
  // Re-evaluate the offset at the guess so a DST change inside the day is honored.
  guess = midnightLocal - tzOffsetMs(guess, timeZone);
  return guess;
}

export function safeTimezone(value: unknown): string {
  if (typeof value !== "string" || !value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/** Relative dates resolve in the viewer's timezone. Default window: last 7 days. */
export function parseActivityWindow(question: string, timezone: string, now = Date.now()): ActivityWindow {
  const q = question.toLowerCase();
  const today = startOfDayInZone(now, timezone);
  const make = (from: number, to: number, label: string): ActivityWindow => ({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    label,
    timezone,
  });
  if (/\byesterday\b/.test(q)) return make(startOfDayInZone(today - 1, timezone), today, "yesterday");
  if (/\btoday\b/.test(q)) return make(today, now, "today");
  if (/\blast 24 hours?\b/.test(q)) return make(now - DAY, now, "the last 24 hours");
  const days = /\blast (\d{1,2}) days?\b/.exec(q);
  if (days) {
    const n = Math.min(30, Math.max(1, Number(days[1])));
    return make(now - n * DAY, now, `the last ${n} days`);
  }
  if (/\bthis week\b/.test(q)) {
    const weekday = new Date(today + tzOffsetMs(today, timezone)).getUTCDay(); // 0 = Sunday
    const sinceMonday = (weekday + 6) % 7;
    return make(startOfDayInZone(today - sinceMonday * DAY + DAY / 2, timezone), now, "this week");
  }
  return make(now - 7 * DAY, now, "the last 7 days");
}

export function wantsActivity(question: string, intent: string): boolean {
  if (intent === "stale_items") return false;
  return (
    intent === "recent_activity" ||
    /\b(comment|commented|nudged|moved|reassign\w*|history|latest|last|changed|activity)\b/i.test(question)
  );
}

type Detail = Record<string, unknown> | null;
const STATUS_TEXT: Record<string, string> = {
  not_started: "Not Started",
  under_progress: "In Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

export function summarizeEvent(event: string, detail: Detail, name: (id: unknown) => string): string {
  const d = (detail ?? {}) as Record<string, unknown>;
  switch (event) {
    case "created":
      return "Thing created";
    case "assigned":
      return `Assigned to ${name(d.assignee_actor_id)}`;
    case "reassigned":
      return `Reassigned from ${name(d.from_actor_id)} to ${name(d.to_actor_id)}`;
    case "caught":
      return "Caught by the assignee";
    case "work_status_changed":
      return `Status set to ${STATUS_TEXT[String(d.work_status)] ?? "a new status"}`;
    case "due_changed":
      return d.due_at ? `Due date set to ${String(d.due_at).slice(0, 10)}` : "Due date cleared";
    case "nudged":
      return "Nudged";
    case "commented":
      return "Comment added";
    case "sorted":
      return "Marked Sorted";
    case "cancelled":
      return "Cancelled";
    case "importance_changed":
      return "Importance changed";
    case "promoted_to_list":
      return "Promoted to a List";
    default:
      return "Activity recorded";
  }
}

/**
 * Bounded, permission-scoped activity read. Only Things already present in the
 * facts payload are queried, through the caller's own client, so RLS applies and
 * deleted or inaccessible records cannot appear.
 */
export async function loadActivityFacts(
  client: SupabaseClient,
  thingIds: string[],
  window: ActivityWindow,
  displayName: (actorId: unknown) => string | null,
): Promise<ActivityFacts> {
  const empty: ActivityFacts = { window, events: [], comments: [], nudges: [], truncated: false, event_limit: EVENT_LIMIT };
  if (!thingIds.length) return empty;
  const name = (id: unknown) => displayName(id) ?? "a teammate";
  const [events, comments, nudges] = await Promise.all([
    client
      .from("thing_activity")
      .select("thing_id,actor_id,event,detail,created_at")
      .in("thing_id", thingIds)
      .gte("created_at", window.from)
      .lt("created_at", window.to)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT + 1),
    client
      .from("thing_comments")
      .select("thing_id,author_actor_id,body,created_at")
      .in("thing_id", thingIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(COMMENT_LIMIT * 3),
    client
      .from("nudges")
      .select("thing_id,from_actor_id,to_actor_id,created_at")
      .in("thing_id", thingIds)
      .order("created_at", { ascending: false })
      .limit(NUDGE_LIMIT),
  ]);
  if (events.error) throw events.error;
  const eventRows = events.data ?? [];
  const seenComment = new Set<string>();
  const commentFacts: ActivityFacts["comments"] = [];
  for (const row of comments.data ?? []) {
    if (seenComment.has(row.thing_id) || commentFacts.length >= COMMENT_LIMIT) continue;
    seenComment.add(row.thing_id);
    commentFacts.push({
      thing_id: row.thing_id,
      author: displayName(row.author_actor_id),
      occurred_at: row.created_at,
      untrusted_excerpt: String(row.body ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    });
  }
  return {
    window,
    events: eventRows.slice(0, EVENT_LIMIT).map((row) => ({
      thing_id: row.thing_id,
      event: row.event,
      actor: displayName(row.actor_id),
      occurred_at: row.created_at,
      summary: summarizeEvent(row.event, row.detail as Detail, name),
    })),
    comments: commentFacts,
    nudges: (nudges.data ?? []).map((row) => ({
      thing_id: row.thing_id,
      from: displayName(row.from_actor_id),
      to: displayName(row.to_actor_id),
      occurred_at: row.created_at,
    })),
    truncated: eventRows.length > EVENT_LIMIT,
    event_limit: EVENT_LIMIT,
  };
}
