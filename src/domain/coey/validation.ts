/**
 * Validation grid (spec §5): every check returns a response level R0–R4 and
 * data-only fixes. chooseResponse (§16.5) shows at most one interruption and
 * folds the rest into chips. No check disables sending: "Keep it" is always
 * offered, and for unresolved people it means "keep privately", never a guess.
 * Coey never corrects spelling, grammar or language mixing (§5.4).
 */
import { COEY_CONFIG, type CoeyConfig } from "./config";
import { isWorkingDay, localParts, nextWorkingDay, type HolderCalendar } from "./calendar";
import type { DraftThing, ResolvedParticipant } from "./model";
import { endOfWeekChoices } from "./time";

export type Level = 0 | 1 | 2 | 3 | 4;
export type BlastRadius = 0 | 1 | 2; // small (just me), medium (a teammate), large (group)

export type Fix =
  | { type: "keep" }
  | { type: "save_private" }
  | { type: "choose_person"; mention: string; profileId: string; name: string; avatarUrl?: string | null }
  | { type: "pick_person"; mention: string }
  | { type: "keep_text"; mention: string }
  | { type: "connect"; mention: string; profileId: string; name: string }
  | { type: "set_day"; key: string; date: string; label: string }
  | { type: "pick_date"; key: string }
  | { type: "resolve_pace"; value: "pace" | "anchor" }
  | { type: "split" }
  | { type: "one" }
  | { type: "set_owner"; profileId: string; name: string }
  | { type: "kind"; kind: "task" | "note" | "question" | "thought" }
  | { type: "accept_inferred" }
  | { type: "shift_time"; which: "action" | "event"; date: string; label: string };

export type FixOption = { id: string; label: string; description?: string; fix: Fix };

export type Check = {
  id: string;
  level: Level;
  severity: "info" | "unlikely" | "ambiguous" | "impossible";
  message: string;
  detail?: string;
  fixes: FixOption[];
};

export type ValidationContext = {
  now: number;
  /** Sender's calendar; holders' calendars where the server knows them. */
  senderCal: HolderCalendar;
  holderCals?: Record<string, HolderCalendar>;
  /** Count of Now Things per holder (S1/V4.4). */
  holderNowCounts?: Record<string, number>;
  /** Open Things already with each holder, normalised titles (V4.5). */
  openTitlesByHolder?: Record<string, Array<{ thingId: string; title: string }>>;
  /** Share of the sender's sends this week marked urgent (S2). */
  senderUrgentShare?: number;
  /** Per-user dismissal counts by check id (F11) and per-draft dismissals. */
  dismissedCounts?: Record<string, number>;
  dismissedForDraft?: string[];
  config?: CoeyConfig;
};

const keep = (label = "Keep it"): FixOption => ({ id: "keep", label, fix: { type: "keep" } });
const savePrivate: FixOption = {
  id: "save-private",
  label: "Keep it to myself for now",
  description: "Saved in your Inbox. Nobody is notified.",
  fix: { type: "save_private" },
};

export function blastRadius(things: DraftThing[]): BlastRadius {
  const others = new Set<string>();
  for (const t of things)
    for (const p of t.participants)
      if (p.status !== "self" && (p.role === "doer")) others.add(p.profileId ?? p.mention.toLowerCase());
  if (others.size === 0) return 0;
  return others.size === 1 ? 1 : 2;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function personChecks(t: DraftThing): Check[] {
  const checks: Check[] = [];
  const holders = t.participants.filter((p) => p.status !== "self" && (p.role === "doer" || p.role === "tracked"));
  for (const p of holders) {
    if (p.status === "ambiguous") {
      checks.push({
        id: `V1.2:${p.mention.toLowerCase()}`,
        level: 3,
        severity: "ambiguous",
        message: `Which ${p.mention} do you mean?`,
        fixes: [
          ...(p.candidates ?? []).map((c) => ({
            id: `person:${c.profileId}`,
            label: c.name,
            fix: { type: "choose_person", mention: p.mention, profileId: c.profileId, name: c.name, avatarUrl: c.avatarUrl } as Fix,
          })),
          { id: "keep-text", label: `Keep “${p.mention}” as text`, description: "It stays with you.", fix: { type: "keep_text", mention: p.mention } },
        ],
      });
    } else if (p.status === "unknown") {
      checks.push({
        id: `V1.2u:${p.mention.toLowerCase()}`,
        level: 3,
        severity: "ambiguous",
        message: `I can't find “${p.mention}” in your connections.`,
        detail: "Choose who you mean, or keep the name as text.",
        fixes: [
          { id: "pick-person", label: "Choose a person", fix: { type: "pick_person", mention: p.mention } },
          { id: "keep-text", label: `Keep “${p.mention}” as text`, description: "It stays with you.", fix: { type: "keep_text", mention: p.mention } },
          savePrivate,
        ],
      });
    } else if (p.status === "not_connected" && p.profileId) {
      checks.push({
        id: `CONN:${p.profileId}`,
        level: 3,
        severity: "ambiguous",
        message: `You and ${p.name ?? p.mention} aren't connected yet.`,
        detail: "They can receive Things after they accept your request.",
        fixes: [
          { id: "connect", label: `Send ${p.name ?? p.mention} a request`, fix: { type: "connect", mention: p.mention, profileId: p.profileId, name: p.name ?? p.mention } },
          { id: "keep-text", label: `Keep “${p.mention}” as text`, description: "It stays with you.", fix: { type: "keep_text", mention: p.mention } },
        ],
      });
    }
  }
  return checks;
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export type TimeIssue = { key: string; phrase: string; reason: "end_of_week" | "unknown_festival" | "malformed" | "empty" };

const TIME_WORDS = new Set([
  "today", "tomorrow", "tommorow", "tomorow", "tommorrow", "tonight", "yesterday", "kal", "parso", "aaj", "repu", "ee", "roju", "now", "later", "soon",
  "morning", "afternoon", "evening", "night", "noon", "midnight", "eod", "eow", "am", "pm", "at", "by", "on", "in", "before", "after", "the", "next",
  "this", "coming", "week", "weekend", "month", "day", "days", "hours", "hour", "mins", "minutes", "of", "end", "o", "clock",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "wed", "thu", "fri", "sat", "sun",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "st", "nd", "rd", "th",
]);
/** The action has no words beyond time words ("tomorrow", "kal 5pm", "next Friday"). */
export function onlyTime(t: Pick<DraftThing, "action" | "actionTime" | "eventTime" | "textRaw">): boolean {
  const phrases = [t.actionTime?.phrase, t.eventTime?.phrase].filter(Boolean).join(" ").toLowerCase();
  const words = (t.action || t.textRaw).toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return words.every((w) => TIME_WORDS.has(w) || phrases.split(/[^\p{L}]+/u).includes(w));
}

export function runChecks(
  things: DraftThing[],
  timeIssues: TimeIssue[],
  ctx: ValidationContext,
  extras: { forwarded?: boolean; gibberish?: boolean; weekdayMismatch?: { key: string; said: string; date: string } | null; paceConflict?: boolean } = {},
): Check[] {
  const config = ctx.config ?? COEY_CONFIG;
  const checks: Check[] = [];
  const radius = blastRadius(things);

  // Lens 0: is this even a Thing?
  if (things.length > 1) {
    checks.push({
      id: "V0.1",
      level: 3,
      severity: "ambiguous",
      message: `This looks like ${things.length} separate Things.`,
      fixes: [
        { id: "split", label: `Make ${things.length} Things`, fix: { type: "split" } },
        { id: "one", label: "Keep as one", fix: { type: "one" } },
      ],
    });
  }
  if (extras.forwarded) {
    checks.push({ id: "V0.4", level: 3, severity: "ambiguous", message: "This looks like a forwarded message. Keep the actions you need.", fixes: [{ id: "split", label: "Show the actions", fix: { type: "split" } }, keep()] });
  }
  const t = things[0];
  if (!t) return checks;
  if (t.kind === "note") {
    checks.push({
      id: "V0.2",
      level: 3,
      severity: "ambiguous",
      message: "This reads like a note rather than something to do.",
      fixes: [
        { id: "note", label: "Save as a note", description: "Kept with you. Nobody is notified.", fix: { type: "kind", kind: "note" } },
        { id: "task", label: "Make it a Thing", fix: { type: "kind", kind: "task" } },
      ],
    });
  }
  if (extras.gibberish || t.confidence < 0.35) {
    checks.push({
      id: "V0.5",
      level: 1,
      severity: "unlikely",
      message: "I'm not sure what this one means.",
      detail: "It will be saved exactly as typed.",
      fixes: [savePrivate, keep("Save as typed")],
    });
  }

  // Lens 1: within a slot.
  // V1.1 missing action: only a time was typed ("tomorrow"). Ask before tossing; Keep it stays available.
  if (t.kind === "task" && onlyTime(t)) {
    const phrase = t.actionTime?.phrase ?? t.eventTime?.phrase ?? null;
    checks.push({
      id: "V1.1:action",
      level: 3,
      severity: "ambiguous",
      message: phrase ? `What should happen ${phrase}?` : "What needs doing?",
      detail: "Add what needs doing, then toss.",
      fixes: [keep("Toss anyway")],
    });
  }
  checks.push(...personChecks(t));
  for (const issue of timeIssues) {
    if (issue.reason === "end_of_week") {
      checks.push({
        id: `END_OF_WEEK:${issue.key}`,
        level: 3,
        severity: "ambiguous",
        message: "Which day is the end of your week?",
        fixes: [
          ...endOfWeekChoices(ctx.now, ctx.senderCal).map((c) => ({ id: `day:${c.date}`, label: `${c.label}, ${dayLabel(c.date)}`, fix: { type: "set_day", key: issue.key, date: c.date, label: c.label } as Fix })),
          { id: "pick-date", label: "Another day", fix: { type: "pick_date", key: issue.key } },
        ],
      });
    } else if (issue.reason === "unknown_festival") {
      checks.push({ id: `FESTIVAL:${issue.key}`, level: 3, severity: "ambiguous", message: `Which date is “${issue.phrase}”?`, detail: "I don't have that festival date in your calendar yet.", fixes: [{ id: "pick-date", label: "Choose the date", fix: { type: "pick_date", key: issue.key } }, keep("Keep without a date")] });
    } else if (issue.reason === "malformed") {
      checks.push({ id: `V1.5:${issue.key}`, level: radius >= 1 ? 4 : 2, severity: "impossible", message: `“${issue.phrase}” isn't a real date or time.`, fixes: [{ id: "pick-date", label: "Choose the date", fix: { type: "pick_date", key: issue.key } }, keep("Keep without a date")] });
    }
  }

  // Lens 2: across slots.
  if (t.actionTime && t.eventTime && t.actionTime.at > t.eventTime.at) {
    const eventDay = t.eventTime.date;
    checks.push({
      id: "V2.1",
      level: radius >= 1 ? 4 : 2,
      severity: "impossible",
      message: `The ${t.actionTime.phrase ?? "action"} is after ${t.eventTime.phrase ?? "the event"}.`,
      fixes: [
        { id: "shift-action", label: `Do it ${dayLabel(eventDay)}`, fix: { type: "shift_time", which: "action", date: eventDay, label: dayLabel(eventDay) } },
        { id: "shift-event", label: `For ${dayLabel(t.actionTime.date)}`, fix: { type: "shift_time", which: "event", date: t.actionTime.date, label: dayLabel(t.actionTime.date) } },
        keep(),
      ],
    });
  }
  if (extras.paceConflict) {
    checks.push({
      id: "V2.2",
      level: 3,
      severity: "ambiguous",
      message: t.pace === "urgent" ? `Urgent, or ${t.actionTime?.phrase ?? t.eventTime?.phrase ?? "by that date"}?` : `No rush, or ${t.actionTime?.phrase ?? t.eventTime?.phrase ?? "that date"}?`,
      detail: "It stays in Next until you choose.",
      fixes: [
        { id: "pace", label: t.pace === "urgent" ? "It's urgent" : "No rush", fix: { type: "resolve_pace", value: "pace" } },
        { id: "anchor", label: "Go by the date", fix: { type: "resolve_pace", value: "anchor" } },
      ],
    });
  }
  const doers = t.participants.filter((p) => p.role === "doer" && p.status !== "self");
  const personal = t.activityType?.startsWith("meal.") || t.activityType?.startsWith("fitness.");
  if (personal && doers.length && /\b(my|mine|meri|mera)\b/i.test(t.textRaw)) {
    checks.push({ id: "V2.4", level: 2, severity: "unlikely", message: "This looks personal. Still send it?", fixes: [keep("Send anyway"), { id: "keep-text", label: "Keep it with me", fix: { type: "keep_text", mention: doers[0]!.mention } }] });
  }
  if (t.recurrence?.weekdays.length && t.actionTime?.precision && t.actionTime.source === "typed") {
    const wd = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${t.actionTime.date}T00:00:00Z`).getUTCDay()]!;
    if (!t.recurrence.weekdays.includes(wd)) {
      checks.push({ id: "V2.5", level: 3, severity: "ambiguous", message: `${t.actionTime.phrase ?? "That date"} isn't a ${t.recurrence.weekdays.join("/")}.`, fixes: [keep("Start on that date anyway"), { id: "pick-date", label: "Choose the first date", fix: { type: "pick_date", key: "action" } }] });
    }
  }
  if (extras.weekdayMismatch) {
    const { key, said, date } = extras.weekdayMismatch;
    checks.push({ id: "V2.7", level: 3, severity: "ambiguous", message: `${dayLabel(date)} isn't a ${said}.`, fixes: [{ id: "date", label: dayLabel(date), fix: { type: "set_day", key, date, label: dayLabel(date) } }, { id: "pick-date", label: "Choose another date", fix: { type: "pick_date", key } }] });
  }

  // Lens 4: the real world.
  for (const [key, anchor] of [["action", t.actionTime], ["event", t.eventTime]] as const) {
    if (!anchor || anchor.source !== "typed") continue;
    if (anchor.at < ctx.now) {
      checks.push({
        id: `V4.1:${key}`,
        level: 3,
        severity: "impossible",
        // Name the actual moment ("9:00 am today"), not just the word the user typed.
        message: `${anchor.precision === "time" ? new Date(anchor.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: ctx.senderCal.timezone }) + (anchor.date === todayIn(ctx.senderCal, ctx.now) ? " today" : ` on ${dayLabel(anchor.date)}`) : anchor.phrase ?? "That time"} has already passed.`,
        fixes: [
          { id: "pick-date", label: "Choose a new time", fix: { type: "pick_date", key } },
          keep(),
        ],
      });
    } else if (t.mode === "work" && anchor.precision === "date" && !isWorkingDay(anchor.date, ctx.senderCal)) {
      const next = nextWorkingDay(anchor.date, ctx.senderCal);
      checks.push({ id: `V4.2:${key}`, level: 2, severity: "unlikely", message: `${dayLabel(anchor.date)} is a day off.`, fixes: [{ id: "next-working", label: `Use ${dayLabel(next)}`, fix: { type: "set_day", key, date: next, label: dayLabel(next) } }, keep()] });
    }
  }
  for (const d of doers) {
    if (!d.profileId) continue;
    const nowCount = ctx.holderNowCounts?.[d.profileId] ?? 0;
    if (nowCount >= config.F4_NOW_SOFT_CAP && t.pace === "urgent") {
      checks.push({ id: `S1:${d.profileId}`, level: 2, severity: "info", message: `${d.name ?? d.mention} has ${nowCount} in Now already. Make this Next?`, fixes: [{ id: "next", label: "Make it Next", fix: { type: "resolve_pace", value: "anchor" } }, keep()] });
    }
    const title = normalise(t.action || t.textRaw);
    const dup = ctx.openTitlesByHolder?.[d.profileId]?.find((o) => normalise(o.title) === title);
    if (dup) {
      checks.push({ id: `V4.5:${d.profileId}`, level: 3, severity: "ambiguous", message: `${d.name ?? d.mention} already has this one.`, fixes: [keep("Send another"), savePrivate] });
    }
  }

  // Lens 5: relationships.
  if (t.toneHarsh && doers.length) {
    checks.push({ id: "V5.1", level: 2, severity: "unlikely", message: "This may land harder than you mean.", detail: "They see your words as typed.", fixes: [keep("Send as is")] });
  }
  if (t.pace === "urgent" && doers.length > 3) {
    checks.push({ id: "V5.4", level: 3, severity: "ambiguous", message: `Send this urgent Thing to all ${doers.length}?`, fixes: [{ id: "one", label: "Pick one owner", fix: { type: "one" } }, keep(`Send to all ${doers.length}`)] });
  }
  if (t.pace === "urgent" && (ctx.senderUrgentShare ?? 0) > config.F15_URGENCY_INFLATION_THRESHOLD) {
    // S2: a light whisper to the sender only. The receiver sees nothing.
    checks.push({ id: "S2", level: 1, severity: "info", message: "Most of this week's sends were urgent. Next may be enough.", fixes: [{ id: "next", label: "Make it Next", fix: { type: "resolve_pace", value: "anchor" } }] });
  }
  if (t.inferredTime && !t.inferredTime.accepted) {
    checks.push({ id: "L6", level: 1, severity: "info", message: `Around ${t.inferredTime.phrase}?`, fixes: [{ id: "accept", label: `Use ${t.inferredTime.phrase}`, fix: { type: "accept_inferred" } }] });
  }

  return checks;
}

export type Response = { interrupt: Check | null; chips: Check[]; hints: Check[] };

/** §16.5: rank by blast radius then level; at most one interruption; muted checks drop out. */
export function chooseResponse(checks: Check[], things: DraftThing[], ctx: ValidationContext): Response {
  const config = ctx.config ?? COEY_CONFIG;
  const radius = blastRadius(things);
  const dismissedNow = new Set(ctx.dismissedForDraft ?? []);
  const live = checks.filter((c) => {
    if (dismissedNow.has(c.id)) return false;
    // People and connection checks are never muted: they decide who is notified.
    if (/^(V1\.2|CONN)/.test(c.id)) return true;
    return (ctx.dismissedCounts?.[c.id.split(":")[0]!] ?? 0) < config.F11_DISMISS_MUTE_COUNT;
  });
  for (const c of live) if (c.severity === "impossible" && radius >= 1 && c.level >= 2) c.level = 4;
  const ranked = [...live].sort((a, b) => b.level - a.level);
  const top = ranked[0] && ranked[0].level >= 3 ? ranked[0] : null;
  const hints = ranked.filter((c) => c !== top && c.level === 2);
  // R2 hints become the single interruption only if nothing louder fired.
  const interrupt = top ?? (hints.length ? hints.shift()! : null);
  return { interrupt, chips: live.filter((c) => c.level <= 1), hints };
}

/** Participants that block delivery until resolved (C10). */
export function unresolvedHolders(things: DraftThing[]): ResolvedParticipant[] {
  return things.flatMap((t) => t.participants.filter((p) => p.status !== "self" && p.status !== "resolved" && (p.role === "doer" || p.role === "tracked")));
}

export function todayIn(cal: HolderCalendar, now: number): string {
  return localParts(now, cal.timezone).date;
}
