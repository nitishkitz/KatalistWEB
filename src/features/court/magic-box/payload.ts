import type { FinalCreateThingInput, MagicBoxDraft } from "./types";
import { tossBlockReason } from "./reducer";

export function buildFinalCreateThingInput(
  draft: MagicBoxDraft,
  pending = false,
): FinalCreateThingInput | { error: NonNullable<ReturnType<typeof tossBlockReason>> } {
  const blocked = tossBlockReason(draft, pending);
  if (blocked) return { error: blocked };
  return {
    title: draft.derivedTitle.trim(),
    context: draft.context,
    ownerImportance: draft.ownerImportance,
    listId: draft.listId,
    assigneeActorId: draft.assignee.status === "resolved" ? draft.assignee.person.id : undefined,
    dueAt: draft.due.status === "resolved" ? draft.due.dueAt : undefined,
    dueHasTime: draft.due.status === "resolved" ? draft.due.dueHasTime : undefined,
  };
}

export function liveSafeAssigneeId(assigneeActorId: string | undefined, live: boolean): string | undefined {
  if (!assigneeActorId) return undefined;
  if (live && assigneeActorId.startsWith("p-")) return undefined;
  return assigneeActorId;
}
