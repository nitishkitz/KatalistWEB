export type TossDueChoice = { label: string; dueAt: string };
export type TossDue = { phrase: string; phrases?: string[]; dueAt?: string; dueChoices?: TossDueChoice[]; message?: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_PATTERN = "january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_PATTERN = "today|tomorrow|this day|(?:(?:this|next|coming)\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const PREFIX = "(?:(?<relation>by|on|before|until|in|due)\\s+)?";
const TIME = "(?:\\s+(?:at\\s+)?(?<time>\\d{1,2}(?::\\d{1,3})?\\s*(?:am|pm)?|noon|midnight))?";

function atTime(day: Date, time?: string): Date | null {
  const date = new Date(day);
  let hour = 22, minute = 0;
  if (time) {
    if (/^noon$/i.test(time)) hour = 12;
    else if (/^midnight$/i.test(time)) hour = 0;
    else {
      const match = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
      if (!match) return null;
      hour = Number(match[1]);
      minute = Number(match[2] ?? 0);
      if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
      if (match[3]) hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
    }
  }
  date.setHours(hour, minute, 0, 0);
  return date;
}

function dayDate(token: string, now: Date, time?: string): Date | null {
  const day = atTime(now, time);
  if (!day) return null;
  const normalized = token.toLowerCase();
  if (normalized === "today" || normalized === "this day") return day;
  if (normalized === "tomorrow") { day.setDate(day.getDate() + 1); return day; }
  const modifier = normalized.match(/^(this|next|coming)\s+/)?.[1];
  const target = DAYS.indexOf(normalized.replace(/^(this|next|coming)\s+/, ""));
  if (target < 0) return null;
  if (modifier === "this" || modifier === "next") {
    // Calendar weeks start on Monday. Explicit "this" dates never roll forward.
    const currentMondayOffset = (now.getDay() + 6) % 7;
    day.setDate(day.getDate() - currentMondayOffset + (target + 6) % 7 + (modifier === "next" ? 7 : 0));
  } else {
    let delta = (target - now.getDay() + 7) % 7;
    if (delta === 0 && day.getTime() < now.getTime()) delta = 7;
    day.setDate(day.getDate() + delta);
  }
  return day;
}

function finish(date: Date | null, groups: Record<string, string | undefined>): Date | null {
  if (date && groups.relation?.toLowerCase() === "before" && !groups.time) date.setDate(date.getDate() - 1);
  return date;
}

function choice(date: Date): TossDueChoice {
  return { label: new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date), dueAt: date.toISOString() };
}

type Candidate = TossDue & { start: number; end: number };

/** Deterministic calendar rules; ambiguous phrases yield visible choices, never a guessed date. */
export function parseTossDue(text: string, now: Date): TossDue | null {
  const candidates: Candidate[] = [];
  const collect = (pattern: string, resolve: (g: Record<string, string | undefined>) => Omit<TossDue, "phrase">) => {
    for (const match of text.matchAll(new RegExp(`\\b${pattern}\\b`, "gi"))) {
      const groups = match.groups ?? {};
      const end = match.index! + match[0].length;
      // An explicit but unreadable time must not become the untimed default.
      const unreadTime = text.slice(end).match(/^\s+at\s+(?!(?:any cost|all|least|once|work|home|the)\b)\S+/i);
      const result = unreadTime
        ? { message: "That time is unclear. Choose a date and time before tossing." }
        : resolve(groups);
      candidates.push({ phrase: match[0] + (unreadTime?.[0] ?? ""), start: match.index!, end: end + (unreadTime?.[0].length ?? 0), ...result });
    }
  };
  const resolved = (date: Date | null, g: Record<string, string | undefined>) => {
    const due = finish(date, g);
    return due ? { dueAt: due.toISOString() } : { message: "That date or time isn't valid. Choose a date and time before tossing." };
  };

  collect(`${PREFIX}(?=(?:the\\s+)?(?:end\\s+(?:of|opf)\\s+|(?:this|next|upcoming|coming)\\s+))(?:the\\s+)?(?:end\\s+(?:of|opf)\\s+(?:the\\s+)?)?(?<modifier>this|next|upcoming|coming)?\\s*(?<period>week|month|year|yr)${TIME}`, (g) => {
    const offset = /next|upcoming|coming/i.test(g.modifier ?? "") ? 1 : 0;
    if (g.period?.toLowerCase() === "week") {
      const monday = new Date(now);
      if (!atTime(monday, g.time)) return resolved(null, g);
      monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7 + offset * 7);
      const dueChoices = [4, 6].map((delta) => {
        const day = atTime(monday, g.time)!;
        day.setDate(day.getDate() + delta);
        return choice(finish(day, g)!);
      });
      return { dueChoices, message: "Do you mean Friday or Sunday for the end of the week? Choose a date, or enter your own." };
    }
    // Don't treat an ordinary standalone "month" or "year" as a deadline.
    const month = g.period?.toLowerCase() === "month" ? now.getMonth() + offset : 11;
    const year = now.getFullYear() + (g.period?.toLowerCase() === "month" ? 0 : offset);
    return resolved(atTime(new Date(year, month + 1, 0), g.time), g);
  });

  collect(`${PREFIX}(?:the\\s+)?(?:end\\s+(?:of|opf)\\s+(?:the\\s+)?(?<day>day|${DAY_PATTERN})|(?<eod>e\\.?o\\.?d)(?:\\s+(?<eodDay>${DAY_PATTERN}))?)${TIME}`, (g) => {
    const token = g.day === "day" ? "today" : g.day ?? g.eodDay ?? "today";
    const day = dayDate(token, now);
    if (!day) return resolved(null, g);
    if (g.time) return resolved(atTime(day, g.time), g);
    const dueChoices = ["5 PM", "10 PM", "23:59"].map((time) => choice(finish(atTime(day, time), g)!));
    return { dueChoices, message: "What time do you mean by end of day? Choose a time, or enter your own." };
  });

  const calendar = (g: Record<string, string | undefined>) => {
    const month = MONTHS.findIndex((m) => m.startsWith((g.month ?? "").toLowerCase().slice(0, 3)));
    const day = Number(g.day?.replace(/st|nd|rd|th/gi, ""));
    const year = Number(g.year ?? now.getFullYear());
    const date = atTime(new Date(year, month, day), g.time);
    if (!date || year < 1000 || date.getMonth() !== month || date.getDate() !== day) return resolved(null, g);
    if (!g.year && g.modifier?.toLowerCase() !== "this" && date.getTime() < now.getTime()) {
      // Find the next valid calendar occurrence (including leap day).
      let nextYear = year + 1;
      while (nextYear <= year + 8) {
        const next = atTime(new Date(nextYear, month, day), g.time)!;
        if (next.getMonth() === month && next.getDate() === day) return resolved(next, g);
        nextYear += 1;
      }
      return resolved(null, g);
    }
    return resolved(date, g);
  };
  collect(`${PREFIX}(?:(?<modifier>this|next)\\s+)?(?:the\\s+)?(?<month>${MONTH_PATTERN})\\s+(?<day>\\d{1,2}(?:st|nd|rd|th)?)(?:,?\\s+(?<year>\\d{4}))?${TIME}`, calendar);
  collect(`${PREFIX}(?:(?<modifier>this|next)\\s+)?(?:the\\s+)?(?<day>\\d{1,2}(?:st|nd|rd|th)?)\\s+(?:of\\s+)?(?<month>${MONTH_PATTERN})(?:,?\\s+(?<year>\\d{4}))?${TIME}`, calendar);
  collect(`${PREFIX}(?<day>${DAY_PATTERN})${TIME}`, (g) => resolved(dayDate(g.day!, now, g.time), g));
  collect(`(?:due\\s+)?in\\s+(?<count>\\d+|a|an|one|two)\\s+(?<unit>days?|weeks?)${TIME}`, (g) => {
    const count = /^(a|an|one)$/i.test(g.count ?? "") ? 1 : g.count?.toLowerCase() === "two" ? 2 : Number(g.count);
    const day = atTime(now, g.time);
    if (!day || !Number.isFinite(count) || count < 1 || count > 3650) return resolved(null, g);
    day.setDate(day.getDate() + count * (g.unit?.toLowerCase().startsWith("week") ? 7 : 1));
    return resolved(day, g);
  });

  // Longest overlapping phrase wins: "end of today" is one deadline, not EOD plus "today".
  const selected: Candidate[] = [];
  for (const candidate of candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    if (selected.every((other) => candidate.end <= other.start || candidate.start >= other.end)) selected.push(candidate);
  }
  selected.sort((a, b) => a.start - b.start);
  if (selected.length > 1) return { phrase: text.slice(selected[0]!.start, selected.at(-1)!.end), phrases: selected.map((candidate) => candidate.phrase), message: "I found more than one date. Which date should I use? Choose one before tossing." };
  if (selected.length) {
    const { start: _start, end: _end, ...result } = selected[0]!;
    return result;
  }
  const numeric = text.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);
  if (numeric) return { phrase: numeric[0], message: "The date format is unclear. Choose a date, or write the month name, such as 5 March." };
  return null;
}
