import type { QueryClient } from "@tanstack/react-query";
import type { Pace } from "@/domain/thing";
import type { NudgeReason } from "./rpc";
import { rpcCatchAndStart, rpcCatchThing, rpcNudgeThing, rpcSetPersonalPace, rpcSnoozeThing, rpcSortThing } from "./rpc";
import { snoozeUntilFor, type SnoozeOption } from "./personal-snooze";
import {
  cancelThingReads,
  claimThingMutation,
  patchThingInCaches,
  releaseThingMutation,
  type ThingPatch,
} from "./query-updates";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

/**
 * T10-04/T03: the single shared entry point for every Thing-mutating action
 * a Catch Up/Court/detail surface can dispatch (Catch, set-pace/Move-Now,
 * Timed Snooze, Nudge, dismiss a ghost breakthrough) -- a typed outcome
 * instead of "did it throw", built directly on the SAME low-level
 * cancel/claim/patch/rollback/release primitives query-updates.ts's own
 * `withOptimisticPatch` uses (claimThingMutation, cancelThingReads,
 * patchThingInCaches, releaseThingMutation), NOT by wrapping
 * `withOptimisticPatch` itself -- that helper already calls
 * `claimThingMutation` internally, and wrapping it here would double-claim
 * (this module's own claim, plus a second one inside the wrapped helper),
 * defeating the whole point of a single shared claim registry.
 *
 * Reusing these exact primitives means a Catch dispatched from Catch Up and
 * a Catch dispatched from a Court lane or an open Thing detail panel all
 * contend for the SAME per-(QueryClient, thingId) claim -- rapid clicks or
 * simultaneous surfaces acting on the same Thing can never duplicate work.
 */
export type ActionOutcome =
  | { status: "performed" }
  /** Another surface (or another rapid click on this one) already has this
   *  exact Thing's mutation claimed -- this call did nothing at all: no
   *  RPC, no cache write, no receipt. */
  | { status: "already-in-flight" }
  /** The identity epoch was no longer current either before dispatch or
   *  after an internal await (a sign-out/switch/preview-toggle happened
   *  mid-flight) -- this call did nothing observable to the current
   *  identity's caches or server state on its behalf. */
  | { status: "retired" }
  /** The domain RPC itself failed (or the request's own arguments were
   *  invalid) -- any optimistic patch already applied has been rolled
   *  back before this is returned. */
  | { status: "failed"; error: unknown };

export type ThingActionRequest =
  | { kind: "catch"; thingId: string; pace?: Pace }
  | { kind: "acknowledge"; thingId: string }
  | { kind: "sort"; thingId: string }
  | { kind: "set_pace"; thingId: string; pace: Pace }
  | { kind: "move_now"; thingId: string }
  | { kind: "snooze"; thingId: string; option: SnoozeOption }
  | { kind: "nudge"; thingId: string; reason?: NudgeReason }
  | { kind: "dismiss_ghost"; thingId: string };

/** The one action this module cannot dispatch on its own -- ghost dismissal
 *  is a `useMutation` owned by `useDoorman` (preview/local vs. live RPC
 *  branching lives there already). Callers pass their own bound dispatcher
 *  rather than this module importing a hook. */
export type RunThingActionDeps = {
  dismissGhost: (thingId: string) => Promise<unknown>;
};

const SUPPORTED_PACES: readonly Pace[] = ["now", "next", "later"];
const SUPPORTED_SNOOZE_OPTIONS: readonly SnoozeOption[] = ["1h", "6h", "next_day"];

/** The shared Thing-field patch for each action kind that actually changes
 *  a shared field Court/detail also render -- matches CourtLaneStack's own
 *  field semantics exactly (see its `runAction`'s "catch" patch) so the two
 *  surfaces agree on what "optimistically caught" looks like. Timed Snooze
 *  and Nudge are personal-visibility / no shared-field change respectively,
 *  matching `runSnooze` in CourtLaneStack (no patch passed there either).
 *  Ghost dismissal has no Thing-field patch: it changes doorman visibility,
 *  not the Thing itself. */
function patchFor(request: ThingActionRequest): ThingPatch | undefined {
  switch (request.kind) {
    case "catch":
      return { acknowledgement: "caught", workStatus: "under_progress", personalPace: request.pace ?? "next" };
    case "acknowledge":
      return { acknowledgement: "caught", personalPace: "next" };
    case "sort":
      return { workStatus: "sorted" };
    case "set_pace":
      return { personalPace: request.pace };
    case "move_now":
      return { personalPace: "now" };
    default:
      return undefined;
  }
}

async function dispatch(request: ThingActionRequest, deps: RunThingActionDeps): Promise<void> {
  switch (request.kind) {
    case "catch":
      await rpcCatchAndStart(request.thingId, request.pace);
      return;
    case "acknowledge":
      await rpcCatchThing(request.thingId);
      return;
    case "sort":
      await rpcSortThing(request.thingId);
      return;
    case "set_pace":
      await rpcSetPersonalPace(request.thingId, request.pace);
      return;
    case "move_now":
      await rpcSetPersonalPace(request.thingId, "now");
      return;
    case "snooze":
      await rpcSnoozeThing(request.thingId, snoozeUntilFor(request.option));
      return;
    case "nudge":
      await rpcNudgeThing(request.thingId, request.reason);
      return;
    case "dismiss_ghost":
      await deps.dismissGhost(request.thingId);
      return;
  }
}

/**
 * Dispatches one Thing-mutating action with cross-surface dedup, optimistic
 * cache patch + rollback, and a typed outcome. Capture the Thing ID, moment
 * key, context, and any presentation epoch/generation the CALLER cares
 * about (e.g. Catch Up's own moment/scope bookkeeping) BEFORE calling this
 * -- this function only owns the mutation's own identity epoch and the
 * Thing-cache claim, not any caller-side presentation state.
 *
 * A failed/already-in-flight/retired outcome never touches the moment
 * receipt or any "resolved"/"viewed" bookkeeping -- only `{ status:
 * "performed" }` means the caller may reconcile caches, await
 * `surfaceMoment` separately (with its OWN fresh epoch/scope recheck -- see
 * use-catchup.ts), and advance.
 */
export async function runThingAction(
  qc: QueryClient,
  request: ThingActionRequest,
  deps: RunThingActionDeps,
): Promise<ActionOutcome> {
  if (request.kind === "catch" && request.pace !== undefined && !SUPPORTED_PACES.includes(request.pace)) {
    return { status: "failed", error: new Error(`Unsupported pace: ${String(request.pace)}`) };
  }
  if (request.kind === "set_pace" && !SUPPORTED_PACES.includes(request.pace)) {
    return { status: "failed", error: new Error(`Unsupported pace: ${String(request.pace)}`) };
  }
  if (request.kind === "snooze" && !SUPPORTED_SNOOZE_OPTIONS.includes(request.option)) {
    return { status: "failed", error: new Error(`Unsupported snooze option: ${String(request.option)}`) };
  }

  // Captured synchronously, before any await -- the same "capture at
  // construction time, re-verify after every await" contract every other
  // identity-sensitive mutation in this codebase follows (see
  // query-updates.ts's own withOptimisticPatch and CourtLaneStack's
  // runAction/runOptimisticRemoval for the same pattern).
  const epoch = getIdentityEpoch(qc).epoch;
  if (!isEpochCurrent(qc, epoch)) return { status: "retired" };

  const token = claimThingMutation(qc, request.thingId, epoch);
  if (!token) return { status: "already-in-flight" };

  const patch = patchFor(request);
  try {
    if (patch) {
      await cancelThingReads(qc, request.thingId);
      // Re-check after the await: cancelling in-flight reads can itself
      // take a tick, during which identity could have switched -- neither
      // the optimistic patch nor the RPC dispatch below should run against
      // a now-stale identity's caches/credentials.
      if (!isEpochCurrent(qc, epoch)) return { status: "retired" };
    }
    const rollback = patch ? patchThingInCaches(qc, request.thingId, patch, epoch) : null;
    try {
      await dispatch(request, deps);
      return { status: "performed" };
    } catch (error) {
      rollback?.();
      return { status: "failed", error };
    }
  } finally {
    // Releases only if this token is STILL the live claim for its epoch --
    // a stale release from a call whose epoch has since advanced can never
    // release a newer owner's claim (see releaseThingMutation's own doc).
    releaseThingMutation(qc, token);
  }
}
