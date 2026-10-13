import { supabase } from "@/integrations/supabase/client";
import type { ThingFile } from "@/domain/thing";
import type { Anchor, DraftThing } from "@/domain/coey/model";
import type { DraftPlan, PlannedThing } from "@/domain/coey/draft";
import { INTERPRETATION_SCHEMA_VERSION } from "@/domain/coey/contract";
import { rpcAddThingReferences } from "@/features/thing-references/rpc";
import type { ThingReference } from "@/features/thing-references/thing-reference";

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

const iso = (ms: number) => new Date(ms).toISOString();
const anchorJson = (a: Anchor | null) => (a ? { at: iso(a.at), date: a.date, precision: a.precision, source: a.source, accepted: a.accepted, phrase: a.phrase } : null);

const MENTION_TOKEN = /(^|\s)[@#/][^\s@#/]+/g;

function capitalise(title: string): string {
  if (!title || /^(?:https?:\/\/|www\.)/i.test(title)) return title;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * The card title is the action in the user's own words. If the model's action
 * does not come from the typed text, the typed text (without @#/ tokens) is used.
 */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

export function titleFor(draft: DraftThing): string {
  const typed = draft.textRaw.replace(MENTION_TOKEN, "$1").replace(/\s+/g, " ").trim();
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const typedWords = new Set(words(draft.textRaw));
  const action = draft.action.trim();
  const actionWords = words(action);
  // A word counts as typed when it is, or is a spelling fix of, a typed word ("doicter" → "doctor").
  const typedList = [...typedWords];
  const isTyped = (w: string) => typedWords.has(w) || (w.length >= 4 && typedList.some((t) => t[0] === w[0] && Math.abs(t.length - w.length) <= 2 && editDistance(t, w) <= 2));
  const grounded = actionWords.length > 0 && actionWords.filter(isTyped).length / actionWords.length >= 0.7;
  return capitalise((grounded ? action : typed || action).slice(0, 500));
}

function legacyDue(draft: DraftThing): { due_at: string | null; due_has_time: boolean } {
  const anchor = draft.actionTime ?? draft.eventTime ?? (draft.inferredTime?.accepted ? draft.inferredTime : null);
  return anchor ? { due_at: iso(anchor.at), due_has_time: anchor.precision === "time" } : { due_at: null, due_has_time: false };
}

type CommonFields = { mode: "work" | "home"; listId?: string; files?: ThingFile[]; checkIds: string[] };

function baseItem(p: PlannedThing, common: CommonFields) {
  const d = p.draft;
  const actionTime = d.actionTime ?? (d.inferredTime && d.inferredTime.accepted ? d.inferredTime : null);
  return {
    title: titleFor(d),
    text_raw: d.textRaw,
    kind: d.kind === "question" ? "task" : d.kind,
    mode: d.mode ?? common.mode,
    list_id: common.listId ?? null,
    pace: d.pace,
    pace_resolution: null as string | null,
    action_time: anchorJson(actionTime),
    event_time: anchorJson(d.eventTime),
    activity_type: d.activityType,
    recurrence: d.recurrence,
    lane: p.lane.lane,
    lane_rule: p.lane.rule,
    wake_at: p.lane.wakeAt ? iso(p.lane.wakeAt) : null,
    rule_id: `${p.court.rule}+${p.lane.rule}`.slice(0, 40),
    notes: common.files?.length ? JSON.stringify({ files: common.files }) : null,
    inputs: { schema: INTERPRETATION_SCHEMA_VERSION, checks: common.checkIds.slice(0, 12), confidence: d.confidence },
    ...legacyDue(d),
  };
}

export function itemsForPlan(plan: DraftPlan, common: CommonFields & { paceResolution: "pace" | "anchor" | null }) {
  const items: Array<Record<string, unknown>> = [];
  for (const p of plan.things) {
    const base = { ...baseItem(p, common), pace_resolution: common.paceResolution };
    const c = p.court;
    switch (c.kind) {
      case "with_others":
        if (c.privateWait) items.push({ ...base, private_wait: true, tracked_profile_id: c.holders[0]?.profileId });
        else items.push({ ...base, holder_profile_id: c.holders[0]?.profileId });
        break;
      case "group":
        for (const h of c.holders) items.push({ ...base, holder_profile_id: h.profileId, group: "group-1" });
        break;
      case "chain":
        items.push({ ...base, chain: c.holders.map((h) => h.profileId) });
        break;
      case "inbox":
        items.push({ ...base, inbox_reason: c.reason, lane: c.reason === "thought" ? "later" : "none" });
        break;
      case "note":
        items.push({ ...base, kind: "note", lane: "later" });
        break;
      case "my_court":
        items.push(base);
        break;
      default:
        // answer, split offer and shared ownership never commit directly.
        break;
    }
  }
  return items;
}

/** "Keep it to myself": the text as typed, private, in the sender's Inbox. Nobody is notified. */
export function privateCaptureItem(text: string, common: CommonFields) {
  const typed = text.replace(MENTION_TOKEN, "$1").replace(/\s+/g, " ").trim() || text.trim();
  return {
    title: capitalise(typed.slice(0, 500)),
    text_raw: text,
    kind: "task",
    mode: common.mode,
    // Private means private: never a shared List (the server enforces this too).
    list_id: null,
    inbox_reason: "unresolved_capture",
    lane: "none",
    rule_id: "C10+L0",
    notes: common.files?.length ? JSON.stringify({ files: common.files }) : null,
    inputs: { schema: INTERPRETATION_SCHEMA_VERSION, private_capture: true },
  };
}

export class CoeyCommitError extends Error {
  readonly forbidden: boolean;
  constructor(message: string, forbidden = false) {
    super(message);
    this.forbidden = forbidden;
  }
}

/** Atomic create. A repeated key returns the first result instead of creating duplicates. */
export async function commitCoeyItems(idempotencyKey: string, items: Array<Record<string, unknown>>, references?: ThingReference[]) {
  const { data, error } = await (supabase.rpc as unknown as LooseRpc)("coey_create_things", {
    p_idempotency_key: idempotencyKey,
    p_items: items,
  });
  if (error) throw new CoeyCommitError(error.message, error.code === "42501");
  const result = data as { things: Array<{ index: number; thing_id: string; group_id: string | null }>; replayed?: boolean };
  if (references?.length && !result.replayed) {
    for (const t of result.things) {
      try {
        await rpcAddThingReferences(t.thing_id, references);
      } catch (err) {
        console.error("Could not save Thing references:", err);
      }
    }
  }
  return result;
}
