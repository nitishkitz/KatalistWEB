import { codeActivityApi } from "./api";
import type { CodeActivityAdapter } from "../adapter";
import type { ConfirmFailureReason, DraftFailureReason } from "../types";

/**
 * An adapter with no behavior: every method says "unavailable". Used where an adapter is required but AI and
 * Thing creation are not (tests, and the inspector while Coey is off).
 */
export const liveAdapter: CodeActivityAdapter = {
  source: "live",
  loadFeed: () => Promise.reject(new Error("The live feed is loaded through useLiveFeed.")),
  loadAssigneeCandidates: () => Promise.resolve([]),
  generateDraft: () => Promise.resolve({ ok: false, reason: "unavailable" }),
  summarizeChange: () => Promise.resolve({ ok: false, reason: "unavailable" }),
  confirmDraft: () => Promise.resolve({ ok: false, reason: "not_allowed" }),
};

const DRAFT_REASON: Record<string, DraftFailureReason> = {
  timeout: "timeout",
  timed_out: "timeout",
  invalid_output: "invalid_output",
  consent_withdrawn: "consent_withdrawn",
};

/** A calendar date the person picked, as the start of that day in THEIR time zone (never guessed, never shifted). */
export function dueDateToInstant(date: string | null): string | null {
  if (date === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The live adapter for one List: drafting, summaries and confirmed creation go through the authorized routes. */
export function createLiveAdapter(listId: string): CodeActivityAdapter {
  return {
    source: "live",
    loadFeed: () => Promise.reject(new Error("The live feed is loaded through useLiveFeed.")),
    async loadAssigneeCandidates(signal) {
      const result = await codeActivityApi.candidates(listId, signal);
      return result.ok ? result.data : [];
    },
    async generateDraft({ change, note }, signal) {
      const result = await codeActivityApi.draft(listId, change.id, note, signal).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return { ok: false as const, status: 0, code: "unavailable" };
      });
      if (result.ok) return { ok: true, fields: result.data };
      return { ok: false, reason: DRAFT_REASON[result.code] ?? "unavailable" };
    },
    async summarizeChange({ change }, signal) {
      const result = await codeActivityApi.summary(listId, change.id, signal).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return { ok: false as const, status: 0, code: "unavailable" };
      });
      if (result.ok) return { ok: true, text: result.data.text, partial: result.data.partial };
      return { ok: false, reason: result.code === "consent_withdrawn" ? "consent_withdrawn" : "unavailable" };
    },
    async confirmDraft({ key, draft }) {
      const result = await codeActivityApi.confirm({
        listId,
        changeId: draft.evidence.changeId,
        key,
        title: draft.title,
        notes: draft.description.trim() === "" ? null : draft.description,
        assigneeActorId: draft.assigneeActorId,
        dueAt: dueDateToInstant(draft.dueDate),
        importance: draft.ownerImportance,
        headSha: draft.evidence.headSha,
        acknowledgeSourceChange: draft.acknowledgeSourceChange,
        aiGenerated: draft.aiGenerated,
      });
      if (result.ok) return { ok: true, thingId: result.data.thingId ?? "", replayed: result.data.replayed };
      // A reply that never arrived (or a server fault) may still have created the Thing: the same key makes a retry safe.
      const reason: ConfirmFailureReason =
        result.code === "source_changed" ? "source_changed" : result.code === "conflict" ? "conflict" : result.code === "consent_withdrawn" ? "consent_withdrawn" : result.code === "not_allowed" || result.code === "disabled" ? "not_allowed" : result.code === "invalid_request" ? "invalid" : "no_response";
      return { ok: false, reason };
    },
  };
}
