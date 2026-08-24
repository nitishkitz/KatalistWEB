import { buildFinalCreateThingInput } from "./payload";
import type { MagicBoxDraft } from "./types";

export type TossPhase = "idle" | "creating-thing" | "finalizing-attachments" | "attachment-recovery";

export type TossSubmission = {
  phase: TossPhase;
  createdThingId: string | null;
  snapshot: MagicBoxDraft | null;
};

export type SubmissionAction =
  | { type: "BEGIN_CREATE"; snapshot: MagicBoxDraft }
  | { type: "CREATE_SUCCEEDED"; thingId: string }
  | { type: "CREATE_FAILED" }
  | { type: "ATTACHMENTS_SUCCEEDED" }
  | { type: "ATTACHMENTS_PARTIAL" }
  | { type: "RECOVERY_CLEARED" };

export function emptySubmission(): TossSubmission {
  return { phase: "idle", createdThingId: null, snapshot: null };
}

export function submissionBlocksCreate(state: TossSubmission): boolean {
  return state.phase !== "idle";
}

export function reduceSubmission(state: TossSubmission, action: SubmissionAction): TossSubmission {
  switch (action.type) {
    case "BEGIN_CREATE":
      if (state.phase !== "idle") return state;
      return { phase: "creating-thing", createdThingId: null, snapshot: action.snapshot };
    case "CREATE_FAILED":
      if (state.phase !== "creating-thing") return state;
      return emptySubmission();
    case "CREATE_SUCCEEDED":
      if (state.phase !== "creating-thing") return state;
      return { phase: "finalizing-attachments", createdThingId: action.thingId, snapshot: state.snapshot };
    case "ATTACHMENTS_SUCCEEDED":
      if (state.phase !== "finalizing-attachments" && state.phase !== "attachment-recovery") return state;
      return emptySubmission();
    case "ATTACHMENTS_PARTIAL":
      if (state.phase !== "finalizing-attachments" && state.phase !== "attachment-recovery") return state;
      return { phase: "attachment-recovery", createdThingId: state.createdThingId, snapshot: state.snapshot };
    case "RECOVERY_CLEARED":
      if (state.phase !== "attachment-recovery") return state;
      return emptySubmission();
    default:
      return state;
  }
}

export type TossGuard = {
  getState: () => TossSubmission;
  tryBegin: (snapshot: MagicBoxDraft) => boolean;
  apply: (action: SubmissionAction) => TossSubmission;
};

export function createTossGuard(initial: TossSubmission = emptySubmission()): TossGuard {
  let state = initial;
  return {
    getState: () => state,
    tryBegin(snapshot) {
      if (submissionBlocksCreate(state)) return false;
      state = reduceSubmission(state, { type: "BEGIN_CREATE", snapshot });
      return true;
    },
    apply(action) {
      state = reduceSubmission(state, action);
      return state;
    },
  };
}

export type TossPipelineResult =
  | { status: "ignored" }
  | { status: "create-failed"; error: unknown }
  | { status: "ok"; thingId: string }
  | { status: "recovery"; thingId: string; failedClientIds: string[] };

export async function runTossPipeline(input: {
  guard: TossGuard;
  snapshot: MagicBoxDraft;
  createThing: () => Promise<{ id: string } | null | undefined>;
  finalize: (thingId: string, snapshot: MagicBoxDraft) => Promise<{ failedClientIds: string[] }>;
}): Promise<TossPipelineResult> {
  if (!input.guard.tryBegin(input.snapshot)) return { status: "ignored" };
  try {
    const created = await input.createThing();
    const thingId = created && typeof created === "object" && "id" in created ? String(created.id) : "";
    if (!thingId) throw new Error("create-failed");
    input.guard.apply({ type: "CREATE_SUCCEEDED", thingId });
    const finalized = await input.finalize(thingId, input.snapshot);
    if (finalized.failedClientIds.length) {
      input.guard.apply({ type: "ATTACHMENTS_PARTIAL" });
      return { status: "recovery", thingId, failedClientIds: finalized.failedClientIds };
    }
    input.guard.apply({ type: "ATTACHMENTS_SUCCEEDED" });
    return { status: "ok", thingId };
  } catch (error) {
    if (input.guard.getState().phase === "creating-thing") {
      input.guard.apply({ type: "CREATE_FAILED" });
      return { status: "create-failed", error };
    }
    const thingId = input.guard.getState().createdThingId;
    input.guard.apply({ type: "ATTACHMENTS_PARTIAL" });
    return { status: "recovery", thingId: thingId ?? "", failedClientIds: ["unknown"] };
  }
}

export function snapshotCreateInput(snapshot: MagicBoxDraft) {
  return buildFinalCreateThingInput(snapshot, false);
}
