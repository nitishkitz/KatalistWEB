import type { Thing } from "./thing";
import type { ListRole } from "../features/lists/fixtures";

export function getListCapabilities(input: {
  currentProfileId?: string | null;
  ownerProfileId?: string | null;
  memberRole?: ListRole | null;
}) {
  const isOwner =
    Boolean(input.currentProfileId && input.currentProfileId === input.ownerProfileId) ||
    input.memberRole === "owner";
  const isView = input.memberRole === "view_only";
  const isCollab = isOwner || input.memberRole === "collaborator";
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
  const waiting = thing.acknowledgement === "waiting_for_catch";
  return {
    canCatch: Boolean(isAssignee && waiting && !terminal),
    canSetPace: Boolean(isAssignee && caught && !terminal),
    canSetImportance: Boolean(isOwner && !terminal),
    canSetDue: Boolean((isOwner || (isAssignee && caught)) && !terminal),
    canSetStatus: Boolean(isAssignee && caught && !terminal),
    canAssign: Boolean(isOwner && !terminal),
    canReassign: Boolean((isOwner || (isAssignee && caught)) && !terminal),
    canNudge: Boolean(isOwner && !isAssignee && !terminal),
    canSort: Boolean(isAssignee && caught && !terminal),
    canCancel: Boolean(isOwner && !terminal),
    canComment: Boolean(myActorId),
    canShred: Boolean(myActorId),
    canAddToBucket: Boolean(myActorId),
    isAssignee,
    isOwner,
    terminal,
  };
}
