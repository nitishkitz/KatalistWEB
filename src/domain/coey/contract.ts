/**
 * Versioned contract between the Magic Box and Coey's interpretation step
 * (spec §4.3). Sarvam labels meaning with this schema; it never returns IDs,
 * timestamps or anything the app executes directly. Code validates every
 * response against the original text before using it.
 */
import { z } from "zod";

export const INTERPRETATION_SCHEMA_VERSION = "coey.interpretation.v1" as const;

export const KINDS = ["task", "note", "question", "thought"] as const;
export const ROLES = ["doer", "mentioned", "tracked"] as const;
export const SHAPES = ["none", "single", "each", "shared", "chain"] as const;
export const PACES = ["urgent", "normal", "chill"] as const;
export const BOUNDARIES = ["at", "by", "before", "after"] as const;
export const ACTIVITY_TYPES = [
  "meal.breakfast",
  "meal.lunch",
  "meal.chai_snacks",
  "meal.dinner",
  "entertainment.movie",
  "fitness.gym_walk",
  "errand.bank_govt",
  "work.call_client_dealer",
  "work.review_report",
  "other",
] as const;

export type ThingKind = (typeof KINDS)[number];
export type ParticipantRole = (typeof ROLES)[number];
export type AssignShape = (typeof SHAPES)[number];
export type Pace = (typeof PACES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * Closed day grammar. Code resolves these in the holder calendar:
 * today | tomorrow | day_after_tomorrow | weekday:mon..sun | nextweekday:mon..sun |
 * date:YYYY-MM-DD | monthday:1..31 | in_days:N | in_weeks:N | monthend | quarterend |
 * end_of_week | weekend | festival:<name>
 */
export const DAY_EXPR = /^(?:today|tomorrow|day_after_tomorrow|weekday:(?:mon|tue|wed|thu|fri|sat|sun)|nextweekday:(?:mon|tue|wed|thu|fri|sat|sun)|date:\d{4}-\d{2}-\d{2}|monthday:\d{1,2}|in_days:\d{1,3}|in_weeks:\d{1,2}|monthend|quarterend|end_of_week|weekend|festival:[a-z_]{2,24})$/;
/** HH:MM (24h) | eod | partofday:morning|afternoon|evening|night */
export const TIME_EXPR = /^(?:\d{1,2}:\d{2}|eod|partofday:(?:morning|afternoon|evening|night))$/;

export const timeExprSchema = z.object({
  /** The words in the input this time came from, copied exactly. */
  phrase: z.string().min(1).max(80),
  day: z.string().regex(DAY_EXPR).nullable(),
  time: z.string().regex(TIME_EXPR).nullable(),
  boundary: z.enum(BOUNDARIES).nullable(),
  /** Festival offset in days, e.g. "after Diwali" = +1. */
  offset_days: z.number().int().min(-60).max(60).nullable(),
  /** A weekday the user also said next to an explicit date (V2.7). */
  said_weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]).nullable(),
});
export type TimeExpr = z.infer<typeof timeExprSchema>;

export const participantSchema = z.object({
  /** The name exactly as typed (without @). */
  mention: z.string().min(1).max(60),
  role: z.enum(ROLES),
});

export const recurrenceSchema = z.object({
  phrase: z.string().min(1).max(80),
  freq: z.enum(["daily", "weekly", "monthly"]),
  weekdays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).max(7),
  month_day: z.number().int().min(1).max(31).nullable(),
});

export const thingSchema = z.object({
  kind: z.enum(KINDS),
  /** What has to happen, in the user's own words; no names of the doer, no time words. */
  action: z.string().max(280),
  participants: z.array(participantSchema).max(12),
  assign_shape: z.enum(SHAPES),
  action_time: timeExprSchema.nullable(),
  event_time: timeExprSchema.nullable(),
  recurrence: recurrenceSchema.nullable(),
  pace: z.enum(PACES).nullable(),
  pace_phrase: z.string().max(60).nullable(),
  activity_type: z.enum(ACTIVITY_TYPES).nullable(),
  mode: z.enum(["work", "home"]).nullable(),
  /** Free text of what this waits on, e.g. "Priya sends numbers". */
  waits_on: z.string().max(120).nullable(),
  tone_harsh: z.boolean(),
  /** A team/group addressed as a whole ("Team, …") with no names. */
  addresses_group: z.boolean(),
  /** For questions: a structured read query for Coey's Ask path. */
  question: z
    .object({
      about_person: z.string().max(60).nullable(),
      exclude_self: z.boolean(),
      state: z.enum(["any", "pending", "waiting_on_others", "waiting_on_me", "stale", "sorted"]),
      window: z.enum(["any", "today", "this_week", "overdue"]),
      /** True when the line only adjusts the previous Ask question ("and Priya?"). */
      continues_previous: z.boolean().default(false),
    })
    .nullable(),
  confidence: z.number().min(0).max(1),
});
export type InterpretedThing = z.infer<typeof thingSchema>;

export const interpretationSchema = z.object({
  things: z.array(thingSchema).min(1).max(6),
  /** Forwarded / pasted message that contains several possible actions (V0.4). */
  forwarded: z.boolean(),
  gibberish: z.boolean(),
});
export type Interpretation = z.infer<typeof interpretationSchema>;

/** JSON Schema sent to Sarvam's guided decoding (kept in sync with the zod schema above). */
export function interpretationJsonSchema(): Record<string, unknown> {
  const nullableString = (pattern?: string, maxLength = 80) => ({
    anyOf: [{ type: "string", maxLength, ...(pattern ? { pattern } : {}) }, { type: "null" }],
  });
  const weekday = { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] };
  const timeExpr = {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["phrase", "day", "time", "boundary", "offset_days", "said_weekday"],
        properties: {
          phrase: { type: "string", maxLength: 80 },
          day: nullableString(),
          time: nullableString(),
          boundary: { anyOf: [{ type: "string", enum: [...BOUNDARIES] }, { type: "null" }] },
          offset_days: { anyOf: [{ type: "integer" }, { type: "null" }] },
          said_weekday: { anyOf: [weekday, { type: "null" }] },
        },
      },
      { type: "null" },
    ],
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["things", "forwarded", "gibberish"],
    properties: {
      forwarded: { type: "boolean" },
      gibberish: { type: "boolean" },
      things: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "kind", "action", "participants", "assign_shape", "action_time", "event_time", "recurrence",
            "pace", "pace_phrase", "activity_type", "mode", "waits_on", "tone_harsh", "addresses_group",
            "question", "confidence",
          ],
          properties: {
            kind: { type: "string", enum: [...KINDS] },
            action: { type: "string", maxLength: 280 },
            participants: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["mention", "role"],
                properties: { mention: { type: "string", maxLength: 60 }, role: { type: "string", enum: [...ROLES] } },
              },
            },
            assign_shape: { type: "string", enum: [...SHAPES] },
            action_time: timeExpr,
            event_time: timeExpr,
            recurrence: {
              anyOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["phrase", "freq", "weekdays", "month_day"],
                  properties: {
                    phrase: { type: "string", maxLength: 80 },
                    freq: { type: "string", enum: ["daily", "weekly", "monthly"] },
                    weekdays: { type: "array", items: weekday, maxItems: 7 },
                    month_day: { anyOf: [{ type: "integer", minimum: 1, maximum: 31 }, { type: "null" }] },
                  },
                },
                { type: "null" },
              ],
            },
            pace: { anyOf: [{ type: "string", enum: [...PACES] }, { type: "null" }] },
            pace_phrase: nullableString(undefined, 60),
            activity_type: { anyOf: [{ type: "string", enum: [...ACTIVITY_TYPES] }, { type: "null" }] },
            mode: { anyOf: [{ type: "string", enum: ["work", "home"] }, { type: "null" }] },
            waits_on: nullableString(undefined, 120),
            tone_harsh: { type: "boolean" },
            addresses_group: { type: "boolean" },
            question: {
              anyOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["about_person", "exclude_self", "state", "window", "continues_previous"],
                  properties: {
                    about_person: nullableString(undefined, 60),
                    exclude_self: { type: "boolean" },
                    state: { type: "string", enum: ["any", "pending", "waiting_on_others", "waiting_on_me", "stale", "sorted"] },
                    window: { type: "string", enum: ["any", "today", "this_week", "overdue"] },
                    continues_previous: { type: "boolean" },
                  },
                },
                { type: "null" },
              ],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };
}

/** Explicit choices the user made in the composer; they constrain re-interpretation. */
export type ComposerSelections = {
  /** mention text (lowercase) → chosen actor id, or "self"/"keep" (keep as plain text, no recipient). */
  people?: Record<string, string>;
  /** Answer to a time question, e.g. end of week → a local date. */
  dayChoices?: Record<string, string>;
  /** User accepted the ghost (inferred) time. */
  acceptInferred?: boolean;
  /** A date/time the user picked in the composer: a typed action anchor. */
  manualAction?: { at: number; date: string; precision: "date" | "time"; label: string } | null;
  /** Lane chosen on the chip; stored as an explicit scheduling decision. */
  lane?: "now" | "next" | "later";
  /** Resolution for L10 conflict: which signal the user meant. */
  paceConflict?: "pace" | "anchor";
  /** For C7 shared ownership: the chosen owner actor id. */
  owner?: string;
  /** For V0.1: the user chose to split, or to keep as one. */
  split?: "split" | "one";
  /** User chose to treat a question as a Thing anyway, or vice versa. */
  kindOverride?: ThingKind;
  /** Check ids the user dismissed for this draft (Keep it). */
  dismissed?: string[];
};

export type InterpretRequest = {
  schema_version: typeof INTERPRETATION_SCHEMA_VERSION;
  request_id: string;
  draft_revision: number;
  text: string;
  mode: "work" | "home";
  /** User-selected @mentions in the composer, already resolved by the user. */
  selections: ComposerSelections;
};

export type InterpretResponse =
  | {
      ok: true;
      schema_version: typeof INTERPRETATION_SCHEMA_VERSION;
      request_id: string;
      draft_revision: number;
      interpretation: Interpretation;
      latency_ms: number;
    }
  | {
      ok: false;
      schema_version: typeof INTERPRETATION_SCHEMA_VERSION;
      request_id: string;
      draft_revision: number;
      reason: "timeout" | "unavailable" | "invalid_output" | "not_configured" | "rate_limited" | "too_long";
      latency_ms: number;
    };

/**
 * Models sometimes emit empty slots ("phrase": "") instead of null. Those carry
 * no meaning, so they become null before strict validation instead of
 * rejecting the whole reading.
 */
function tidy(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as { things?: unknown };
  if (!Array.isArray(value.things)) return raw;
  for (const t of value.things as Array<Record<string, unknown>>) {
    if (!t || typeof t !== "object") continue;
    for (const slot of ["action_time", "event_time"]) {
      const v = t[slot] as Record<string, unknown> | null | undefined;
      if (!v) continue;
      if (typeof v.day === "string" && !DAY_EXPR.test(v.day)) v.day = null;
      if (typeof v.time === "string" && !TIME_EXPR.test(v.time)) v.time = null;
      // A phrase with no day/time label stays: code may still read an explicit date from it.
      if (typeof v.phrase !== "string" || !v.phrase.trim()) t[slot] = null;
    }
    const rec = t.recurrence as Record<string, unknown> | null | undefined;
    if (rec && (typeof rec.phrase !== "string" || !rec.phrase.trim())) t.recurrence = null;
    if (t.pace_phrase === "") t.pace_phrase = null;
    if (t.waits_on === "") t.waits_on = null;
    if (Array.isArray(t.participants))
      t.participants = (t.participants as Array<{ mention?: unknown }>).filter((x) => typeof x?.mention === "string" && x.mention.trim());
    if (typeof t.confidence === "number") t.confidence = Math.min(1, Math.max(0, t.confidence));
  }
  return raw;
}

export function parseInterpretation(raw: unknown): Interpretation | null {
  const result = interpretationSchema.safeParse(tidy(raw));
  return result.success ? result.data : null;
}
