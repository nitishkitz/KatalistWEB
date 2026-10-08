import type { CodeActivityAdapter, SummaryResult } from "@/features/code-activity/adapter";
import { buildPreviewFeed, previewCandidates, previewViewer } from "./fixtures";
import { validateDraft } from "@/features/code-activity/types";
import type {
  ActivityChange,
  ActivityFeedData,
  AssigneeCandidate,
  ConfirmResult,
  DraftPayload,
  DraftResult,
  ListRole,
  SyncStatus,
} from "@/features/code-activity/types";

/**
 * Isolated preview adapter. It is the ONLY data source wired in this phase.
 * It never calls fetch, XMLHttpRequest, WebSocket, or any provider SDK. Every
 * result comes from labeled fixtures, and every outcome a reviewer needs to see
 * is a scenario setting.
 */

export type PreviewConnection = "unconnected" | "active" | "suspended" | "revoked" | "disconnected";
export type PreviewFeedMode = "normal" | "empty" | "error";
export type PreviewGeneration = "success" | "timeout" | "invalid_output" | "unavailable";
export type PreviewConfirm = "success" | "lost_response" | "source_changed" | "not_allowed";

export interface PreviewScenario {
  role: ListRole;
  /** Private-content (AI) consent for this List. Separate from the sharing acknowledgement. */
  consent: boolean;
  connection: PreviewConnection;
  feed: PreviewFeedMode;
  sync: SyncStatus;
  generation: PreviewGeneration;
  confirm: PreviewConfirm;
}

export function defaultScenario(role: ListRole): PreviewScenario {
  return {
    role,
    consent: true,
    connection: "active",
    feed: "normal",
    sync: "ok",
    generation: "success",
    confirm: "success",
  };
}

export interface PreviewAdapterOptions {
  /** Read at call time so the preview bar can change behavior without rebuilding the adapter. */
  getScenario: () => PreviewScenario;
  /** Simulated latency in milliseconds. Zero in tests. */
  delayMs?: number;
  now?: () => number;
}

class PreviewFeedError extends Error {
  constructor() {
    super("Preview: the feed could not be loaded.");
    this.name = "PreviewFeedError";
  }
}
export { PreviewFeedError };

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    if (ms <= 0) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Stable text for comparing two confirmation payloads. The key itself is excluded. */
export function payloadFingerprint(draft: DraftPayload): string {
  return JSON.stringify([
    draft.title.trim(),
    draft.description,
    draft.assigneeActorId,
    draft.dueDate,
    draft.ownerImportance,
    draft.evidence.changeId,
    draft.evidence.headSha,
    draft.aiGenerated,
    draft.acknowledgeSourceChange,
  ]);
}

export function createPreviewAdapter(options: PreviewAdapterOptions): CodeActivityAdapter {
  const delay = options.delayMs ?? 450;
  const clock = options.now ?? (() => Date.now());
  /** Permanent deduplication record, as in the contract: replay is looked up first. */
  const receipts = new Map<string, { fingerprint: string; thingId: string }>();
  /** Keys whose first response was deliberately "lost" in the lost_response scenario. */
  const lostOnce = new Set<string>();
  let counter = 0;

  return {
    source: "preview",

    async loadFeed(signal) {
      await wait(delay, signal);
      const scenario = options.getScenario();
      if (scenario.feed === "error") throw new PreviewFeedError();
      const feed = buildPreviewFeed(clock(), scenario.feed === "empty" ? "empty" : "normal");
      return { ...feed, freshness: { ...feed.freshness, syncStatus: scenario.sync } };
    },

    async loadAssigneeCandidates(signal) {
      await wait(Math.min(delay, 150), signal);
      return previewCandidates(options.getScenario().role);
    },

    async generateDraft({ change, note }, signal) {
      await wait(delay * 2, signal);
      const scenario = options.getScenario();
      if (!scenario.consent) return { ok: false, reason: "consent_withdrawn" };
      switch (scenario.generation) {
        case "timeout":
          return { ok: false, reason: "timeout" };
        case "invalid_output":
          return { ok: false, reason: "invalid_output" };
        case "unavailable":
          return { ok: false, reason: "unavailable" };
        default: {
          const hint = note.trim();
          return {
            ok: true,
            fields: {
              title: change.checkState === "failing" ? `Verify ${change.title.replace(/^#\d+\s*/, "").toLowerCase()}` : `Follow up on ${change.title}`,
              description: [
                change.checkState === "failing"
                  ? `A check is failing on ${change.number ? `PR #${change.number}` : "this change"}.`
                  : `Review ${change.number ? `PR #${change.number}` : "this change"}.`,
                hint ? `Requested follow-up: ${hint}` : "",
              ]
                .filter(Boolean)
                .join(" "),
            },
          };
        }
      }
    },

    async summarizeChange({ change }, signal) {
      await wait(delay, signal);
      const scenario = options.getScenario();
      if (!scenario.consent) return { ok: false, reason: "consent_withdrawn" };
      if (scenario.generation !== "success") return { ok: false, reason: "unavailable" };
      const files = change.files.length;
      return {
        ok: true,
        text: `${change.title.replace(/^#\d+\s*/, "")}. Touches ${files} ${files === 1 ? "file" : "files"}${
          change.checkState === "failing" ? " and has a failing check" : ""
        }. (Sample summary for preview.)`,
        partial: change.filesPartial || change.files.some((f) => f.patchState === "truncated" || f.patchState === "binary"),
      };
    },

    async confirmDraft({ key, draft }, signal) {
      await wait(Math.min(delay, 300), signal);
      const scenario = options.getScenario();
      const viewer = previewViewer(scenario.role);
      const receiptKey = `${viewer.actorId}:${key}`;
      const fingerprint = payloadFingerprint(draft);

      // 1. Replay lookup comes first. A retry of a successful request is never re-checked
      //    against the source, the connection, or consent.
      const existing = receipts.get(receiptKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { ok: false, reason: "conflict" };
        return { ok: true, thingId: existing.thingId, replayed: true };
      }

      // 2. New creation: eligibility, all checked here as the database function will.
      if (scenario.role === "view_only" || scenario.confirm === "not_allowed" || scenario.connection !== "active") {
        return { ok: false, reason: "not_allowed" };
      }
      if (!validateDraft(draft, previewCandidates(scenario.role)).ok) return { ok: false, reason: "invalid" };
      if (draft.aiGenerated && !scenario.consent) return { ok: false, reason: "consent_withdrawn" };
      if (scenario.confirm === "source_changed" && !draft.acknowledgeSourceChange) {
        return { ok: false, reason: "source_changed" };
      }

      // 3. Create. Preview creates nothing real: the id only proves deduplication works.
      counter += 1;
      const thingId = `preview-thing-${counter}`;
      receipts.set(receiptKey, { fingerprint, thingId });
      if (scenario.confirm === "lost_response" && !lostOnce.has(receiptKey)) {
        lostOnce.add(receiptKey);
        return { ok: false, reason: "no_response" };
      }
      return { ok: true, thingId, replayed: false };
    },
  };
}
