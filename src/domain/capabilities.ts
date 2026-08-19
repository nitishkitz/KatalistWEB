import type { Thing } from "./thing";
import type { ListRole } from "@/features/lists/fixtures";

export function getListCapabilities(input: {
  currentProfileId?: string | null;
  ownerProfileId?: string | null;
  memberRole?: ListRole | null;
}) {
  const isOwner = Boolean(input.currentProfileId && input.currentProfileId === input.ownerProfileId) || input.memberRole === "owner";
  const isCollab = isOwner || input.memberRole === "collaborator";
  const isView = input.memberRole === "view_only";
  return {
    canAdministerMembers: isOwner,
    canChangeRoles: isOwner,
    canPromoteThingPerson: isOwner,
    canCollaborate: isCollab && !isView,
    canChat: isCollab && !isView,
    canComment: Boolean(input.memberRole) || isOwner,
    canMutateWorkflow: isCollab && !isView,
  };
}

export function getThingCapabilities(thing: Thing, myActorId: string | null) {
  const terminal = thing.workStatus === "sorted" || thing.workStatus === "cancelled" || Boolean(thing.cancelledAt);
  const isAssignee = Boolean(myActorId && thing.assignee.id === myActorId);
  const isOwner = Boolean(myActorId && thing.owner.id === myActorId);
  const caught = thing.acknowledgement === "caught";
  return {
    canCatch: isAssignee && thing.acknowledgement === "waiting_for_catch" && !terminal,
    canSetPace: isAssignee && caught && !terminal,
    canSetImportance: isOwner && !terminal,
    canSetDue: (isOwner || isAssignee) && !terminal,
    canSetStatus: isAssignee && caught && !terminal,
    canAssign: isOwner && !terminal,
    canReassign: (isOwner || (isAssignee && caught)) && !terminal,
    canNudge: isOwner && !terminal && thing.acknowledgement !== "waiting_for_catch" ? true : isOwner && !terminal,
    canSort: (isOwner || isAssignee) && !terminal,
    canCancel: isOwner && !terminal,
    canComment: true,
    canShred: Boolean(myActorId),
    canAddToBucket: Boolean(myActorId) && !terminal,
  };
}
