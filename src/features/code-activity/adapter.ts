import type {
  ActivityChange,
  ActivityFeedData,
  AssigneeCandidate,
  ConfirmResult,
  DraftPayload,
  DraftResult,
} from "./types";

export type SummaryResult =
  | { ok: true; text: string; /** Some input was left out, for example files beyond the listed limit. */ partial: boolean }
  | { ok: false; reason: "unavailable" | "consent_withdrawn" };

/**
 * The data boundary the Code Activity UI reads through. The app runtime has no adapter yet: the live
 * adapter arrives in a later, separately reviewed task. The fixture-backed "preview" adapter lives under
 * scripts/fixtures and is used by tests only, never imported from src.
 */
export interface CodeActivityAdapter {
  readonly source: "preview" | "live";
  loadFeed(signal?: AbortSignal): Promise<ActivityFeedData>;
  loadAssigneeCandidates(signal?: AbortSignal): Promise<AssigneeCandidate[]>;
  generateDraft(req: { change: ActivityChange; note: string }, signal?: AbortSignal): Promise<DraftResult>;
  summarizeChange(req: { change: ActivityChange }, signal?: AbortSignal): Promise<SummaryResult>;
  confirmDraft(req: { key: string; draft: DraftPayload }, signal?: AbortSignal): Promise<ConfirmResult>;
}
