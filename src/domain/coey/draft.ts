/**
 * Turns a validated interpretation into placed, validated drafts. Shared by
 * the composer preview and the server commit, so both reach the same answer.
 *
 * Grounding: every name and time phrase the model returns must appear in the
 * text the user typed; anything else is discarded. People resolve only
 * against the authorized candidate list — the model never names an account.
 */
import { addDays, localParts, nextWorkingDay, zonedInstant, type HolderCalendar, type Mode } from "./calendar";
import type { ActivityType, ComposerSelections, Interpretation, InterpretedThing, TimeExpr } from "./contract";
import type { Anchor, CourtDecision, DraftThing, LaneDecision, ResolvedParticipant } from "./model";
import { placeCourt, placeLane } from "./placement";
import { resolveTimeExpr, weekdayMismatch, type ResolvedTime } from "./time";
import { chooseResponse, runChecks, type Response, type TimeIssue, type ValidationContext } from "./validation";

export type Candidate = {
  profileId: string;
  actorId: string;
  name: string;
  avatarUrl?: string | null;
  /** Accepted mutual connection: only these can receive Things. */
  connected: boolean;
};

export type Viewer = { profileId: string; actorId: string; name: string };

const LANE_TO_PACE = { now: "urgent", next: "normal", later: "chill" } as const;

const SELF_WORDS = new Set(["me", "myself", "i", "mujhe", "main", "khud", "self"]);

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^@/, "").replace(/[._]+/g, " ").trim();
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

/** True when `phrase` occurs in `text` (case/diacritic-insensitive, @ optional). */
export function grounded(text: string, phrase: string): boolean {
  const t = fold(text).replace(/\s+/g, " ");
  const p = fold(phrase).replace(/\s+/g, " ");
  return p.length > 0 && t.includes(p);
}

/**
 * Resolve one typed name to a person. Exact first/full-name matches resolve;
 * near spellings and duplicates are never auto-selected — the user confirms.
 */
export function resolveMention(
  mention: string,
  role: ResolvedParticipant["role"],
  candidates: Candidate[],
  viewer: Viewer,
  selections: ComposerSelections,
): ResolvedParticipant {
  const key = fold(mention);
  const chosen = selections.people?.[key];
  // A bare first name is "me" only when no other visible person shares it; otherwise ask (V1.2).
  const sharesFirstName = candidates.some((c) => c.profileId !== viewer.profileId && fold(c.name).split(" ")[0] === key);
  if (chosen === "self" || chosen === viewer.profileId || SELF_WORDS.has(key) || key === fold(viewer.name) || (!sharesFirstName && key === fold(viewer.name).split(" ")[0])) {
    return { mention, role, status: "self", profileId: viewer.profileId, actorId: viewer.actorId, name: viewer.name };
  }
  if (chosen === "keep") return { mention, role: "mentioned", status: "resolved", name: mention };
  const others = candidates.filter((c) => c.profileId !== viewer.profileId);
  const asParticipant = (c: Candidate, status: ResolvedParticipant["status"]): ResolvedParticipant => ({
    mention, role, status, profileId: c.profileId, actorId: c.actorId, name: c.name,
  });
  if (chosen) {
    const c = others.find((x) => x.profileId === chosen);
    if (c) return asParticipant(c, c.connected ? "resolved" : "not_connected");
  }
  if (sharesFirstName && key === fold(viewer.name).split(" ")[0]) {
    // "Ravi" when I am Ravi Rao and I know Ravi Kumar: ask, offering me too.
    const same = others.filter((c) => fold(c.name).split(" ")[0] === key);
    return { mention, role, status: "ambiguous", candidates: [
      { profileId: viewer.profileId, actorId: viewer.actorId, name: `${viewer.name} (you)` },
      ...same.map(({ profileId, actorId, name, avatarUrl }) => ({ profileId, actorId, name, avatarUrl })),
    ] };
  }
  const full = others.filter((c) => fold(c.name) === key);
  const first = others.filter((c) => fold(c.name).split(" ")[0] === key);
  const exact = full.length ? full : first;
  if (exact.length === 1) return asParticipant(exact[0]!, exact[0]!.connected ? "resolved" : "not_connected");
  const toCandidates = (list: Candidate[]) => list.map(({ profileId, actorId, name, avatarUrl }) => ({ profileId, actorId, name, avatarUrl }));
  if (exact.length > 1) return { mention, role, status: "ambiguous", candidates: toCandidates(exact) };
  const near = others.filter((c) => {
    const f = fold(c.name).split(" ")[0]!;
    return key.length >= 3 && (f.startsWith(key) || (key.length >= 4 && editDistance(key, f) <= 1));
  });
  if (near.length) return { mention, role, status: "ambiguous", candidates: toCandidates(near) };
  return { mention, role, status: "unknown" };
}

/** Activity priors (§4.5): window → ghost time and natural mode. */
const PRIORS: Partial<Record<ActivityType, { minutes: number | "workday_morning"; mode: Mode | null; weekdaysOnly?: boolean; label: string }>> = {
  "meal.breakfast": { minutes: 9 * 60, mode: "home", label: "9 AM" },
  "meal.lunch": { minutes: 13 * 60 + 30, mode: null, label: "1:30 PM" },
  "meal.chai_snacks": { minutes: 16 * 60 + 30, mode: null, label: "4:30 PM" },
  "meal.dinner": { minutes: 21 * 60, mode: "home", label: "9 PM" },
  "entertainment.movie": { minutes: 21 * 60, mode: "home", label: "9 PM show" },
  "fitness.gym_walk": { minutes: 6 * 60 + 30, mode: "home", label: "6:30 AM" },
  "errand.bank_govt": { minutes: 11 * 60, mode: null, weekdaysOnly: true, label: "11 AM" },
  "work.call_client_dealer": { minutes: 11 * 60, mode: "work", label: "11 AM" },
  "work.review_report": { minutes: "workday_morning", mode: "work", label: "next work morning" },
};

function inferredAnchor(activity: ActivityType | null, now: number, cal: HolderCalendar, accepted: boolean): Anchor | null {
  const prior = activity ? PRIORS[activity] : undefined;
  if (!prior) return null;
  const today = localParts(now, cal.timezone).date;
  let date = today;
  let minutes: number;
  if (prior.minutes === "workday_morning") {
    date = nextWorkingDay(addDays(today, 1), cal);
    minutes = cal.workStart;
  } else {
    minutes = prior.minutes;
    if (zonedInstant(today, minutes, cal.timezone) <= now) date = addDays(today, 1);
    if (prior.weekdaysOnly) date = nextWorkingDay(date, cal);
  }
  return { at: zonedInstant(date, minutes, cal.timezone), date, precision: "time", source: "inferred", accepted, phrase: prior.label };
}

function anchorFrom(r: ResolvedTime): Anchor | null {
  return r.ok ? { at: r.at, date: r.date, precision: r.precision, source: "typed", accepted: true, phrase: r.phrase } : null;
}

export type PlannedThing = {
  draft: DraftThing;
  court: CourtDecision;
  lane: LaneDecision;
};

export type DraftPlan = {
  /** One entry per Thing that will be created (after split/keep-as-one decisions). */
  things: PlannedThing[];
  /** The decision for the input as a whole (answer, note, split offer, or the single Thing's court). */
  court: CourtDecision;
  response: Response;
  timeIssues: TimeIssue[];
  question: InterpretedThing["question"] | null;
};

export type BuildInput = {
  text: string;
  mode: Mode;
  interpretation: Interpretation;
  selections: ComposerSelections;
  candidates: Candidate[];
  viewer: Viewer;
  now: number;
  /** The sender's calendar. Holder calendars refine lanes on the server. */
  cal: HolderCalendar;
  holderCals?: Record<string, HolderCalendar>;
  validation?: Omit<ValidationContext, "now" | "senderCal">;
};

function buildOne(thing: InterpretedThing, input: BuildInput, timeIssues: TimeIssue[], index: number) {
  const { text, selections, now, cal } = input;
  const kind = selections.kindOverride ?? thing.kind;
  const mode: Mode = thing.mode ?? (thing.activity_type && PRIORS[thing.activity_type]?.mode) ?? input.mode;
  const participants = thing.participants
    .filter((p) => grounded(text, p.mention))
    .map((p) => resolveMention(p.mention, p.role, input.candidates, input.viewer, selections));
  // Owner chosen for shared ownership (C7): that person becomes the one doer, the rest are mentioned.
  if (selections.owner) {
    for (const p of participants) {
      if (p.role === "doer" && p.profileId !== selections.owner) p.role = "mentioned";
    }
  }
  const holderCal = (() => {
    const holder = participants.find((p) => p.role === "doer" && p.status === "resolved" && p.profileId);
    return (holder?.profileId && input.holderCals?.[holder.profileId]) || cal;
  })();

  const resolveSlot = (expr: TimeExpr | null, slot: "action" | "event"): { anchor: Anchor | null; resolved: ResolvedTime | null } => {
    if (!expr || !grounded(text, expr.phrase)) return { anchor: null, resolved: null };
    const key = `${index}:${slot}`;
    const resolved = resolveTimeExpr(expr, now, holderCal, mode, selections.dayChoices?.[key]);
    if (!resolved.ok) timeIssues.push({ key, phrase: resolved.phrase, reason: resolved.reason });
    return { anchor: anchorFrom(resolved), resolved };
  };
  const action = selections.manualAction
    ? { anchor: { at: selections.manualAction.at, date: selections.manualAction.date, precision: selections.manualAction.precision, source: "typed" as const, accepted: true, phrase: selections.manualAction.label }, resolved: null }
    : resolveSlot(thing.action_time, "action");
  // A manual pick answers any question about the typed action time.
  if (selections.manualAction) for (let i = timeIssues.length - 1; i >= 0; i--) if (timeIssues[i]!.key === `${index}:action`) timeIssues.splice(i, 1);
  const event = resolveSlot(thing.event_time, "event");
  const hasTypedTime = Boolean(action.anchor || event.anchor);
  const inferredTime = hasTypedTime ? null : inferredAnchor(thing.activity_type, now, holderCal, Boolean(selections.acceptInferred));

  const draft: DraftThing = {
    kind,
    action: thing.action.trim() || text.trim(),
    textRaw: text,
    mode,
    participants,
    shape: thing.assign_shape,
    addressesGroup: thing.addresses_group,
    pace: thing.pace,
    pacePhrase: thing.pace_phrase && grounded(text, thing.pace_phrase) ? thing.pace_phrase : null,
    actionTime: action.anchor,
    eventTime: event.anchor,
    inferredTime,
    activityType: thing.activity_type,
    recurrence: thing.recurrence && grounded(text, thing.recurrence.phrase)
      ? { freq: thing.recurrence.freq, weekdays: thing.recurrence.weekdays, monthDay: thing.recurrence.month_day, phrase: thing.recurrence.phrase }
      : null,
    waitsOn: thing.waits_on,
    toneHarsh: thing.tone_harsh,
    confidence: thing.confidence,
  };
  // A model-reported pace with no grounded words is not the sender's word (L1/L2 need their word).
  if (draft.pace && !draft.pacePhrase) draft.pace = null;
  // D4: the lane chip edits the sender's pace, an explicit stored decision.
  if (selections.lane) {
    draft.pace = LANE_TO_PACE[selections.lane];
    draft.pacePhrase = null;
  }
  const mismatch = thing.action_time && action.resolved && weekdayMismatch(thing.action_time, action.resolved)
    ? { key: `${index}:action`, said: thing.action_time.said_weekday!, date: action.resolved.ok ? action.resolved.date : "" }
    : null;
  return { draft, holderCal, mismatch };
}

/** Build the full plan for one draft revision. Pure; same result on client and server. */
export function buildDraftPlan(input: BuildInput): DraftPlan {
  const timeIssues: TimeIssue[] = [];
  const split = input.selections.split;
  const source = input.interpretation.things.length > 1 && split === "one"
    ? [mergeThings(input.interpretation.things)]
    : input.interpretation.things;
  const built = source.map((t, i) => buildOne(t, input, timeIssues, i));
  const drafts = built.map((b) => b.draft);

  // Before the user answers a split offer, the input as a whole is the offer.
  let wholeCourt = drafts.length > 1 && split !== "split" ? placeCourt(drafts) : placeCourt(drafts.slice(0, 1));
  // V0.5: no clear meaning. Saved exactly as typed, privately; nobody is notified.
  const unclear = input.interpretation.gibberish && !input.selections.kindOverride;
  if (unclear) wholeCourt = { kind: "inbox", reason: "unresolved_capture", rule: "C10" };
  const things: PlannedThing[] = (drafts.length > 1 && split === "split" ? built : built.slice(0, 1)).map((b) => {
    const court = unclear ? wholeCourt : placeCourt([b.draft]);
    return { draft: b.draft, court, lane: placeLane(b.draft, court, b.holderCal, input.now, paceResolutionOf(input.selections)) };
  });

  const first = things[0];
  const paceConflict = Boolean(first && first.lane.ask === "pace_conflict" && !paceResolutionOf(input.selections));
  const ctx: ValidationContext = { now: input.now, senderCal: input.cal, ...input.validation, dismissedForDraft: input.selections.dismissed };
  const checks = wholeCourt.kind === "answer"
    ? []
    : runChecks(drafts.length > 1 && split !== "split" ? drafts : drafts.slice(0, 1), timeIssues, ctx, {
        forwarded: input.interpretation.forwarded && drafts.length > 1 && !split,
        gibberish: input.interpretation.gibberish,
        weekdayMismatch: built[0]?.mismatch ?? null,
        paceConflict,
      });
  if (wholeCourt.kind === "ask_owner") {
    const holders = wholeCourt.holders;
    checks.unshift({
      id: "C7",
      level: 3,
      severity: "ambiguous",
      message: "Who holds the pen on this one?",
      detail: "One owner keeps it moving. The others can stay in the loop.",
      fixes: holders.filter((h) => h.profileId).map((h) => ({ id: `owner:${h.profileId}`, label: h.name ?? h.mention, fix: { type: "set_owner", profileId: h.profileId!, name: h.name ?? h.mention } })),
    });
  }
  // Split already handled by the C0c offer check (V0.1); a resolved split clears it.
  const filtered = split ? checks.filter((c) => c.id !== "V0.1" && c.id !== "V0.4") : checks;
  return {
    things,
    court: wholeCourt,
    response: chooseResponse(filtered, drafts, ctx),
    timeIssues,
    question: wholeCourt.kind === "answer" ? input.interpretation.things[0]?.question ?? null : null,
  };
}

function mergeThings(things: InterpretedThing[]): InterpretedThing {
  const first = things[0]!;
  return {
    ...first,
    action: things.map((t) => t.action).join("; "),
    participants: things.flatMap((t) => t.participants),
    assign_shape: "single",
  };
}

/** A lane chosen on the chip is the sender's decision; it settles any L10 question. */
export function paceResolutionOf(selections: ComposerSelections): "pace" | "anchor" | null {
  return selections.paceConflict ?? (selections.lane ? "pace" : null);
}

/** Whether the plan can be committed now (the send button is never disabled; this picks the path). */
export function commitPath(plan: DraftPlan): "answer" | "commit" | "resolve_first" {
  if (plan.court.kind === "answer") return "answer";
  if (plan.response.interrupt && plan.response.interrupt.level >= 3) return "resolve_first";
  return "commit";
}
