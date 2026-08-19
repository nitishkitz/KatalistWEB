import { supabase } from "@/integrations/supabase/client";
import type { Importance, Pace, WorkStatus } from "@/domain/thing";
import {
  addCommentLocal,
  catchLocal,
  nudgeLocal,
  patchThing,
  reassignLocal,
  setDueLocal,
  setImportanceLocal,
  setPaceLocal,
  setStatusLocal,
  shredLocal,
  tossLocalThing,
} from "./local-state";

async function tryRpc<T>(fn: () => PromiseLike<{ data: T; error: { message: string } | null }>, fallback: () => T): Promise<T> {
  try {
    const { data, error } = await fn();
    if (error) throw error;
    return data;
  } catch {
    return fallback();
  }
}

export async function rpcCatchThing(thingId: string, pace: Pace = "next") {
  return tryRpc(
    () => supabase.rpc("catch_thing", { p_thing_id: thingId, p_personal_pace: pace }),
    () => {
      catchLocal(thingId, pace);
      return null as never;
    },
  );
}

export async function rpcSetPersonalPace(thingId: string, pace: Pace) {
  return tryRpc(
    () => supabase.rpc("set_personal_pace", { p_thing_id: thingId, p_personal_pace: pace }),
    () => {
      setPaceLocal(thingId, pace);
      return null as never;
    },
  );
}

export async function rpcSetOwnerImportance(thingId: string, importance: Importance) {
  return tryRpc(
    () =>
      supabase.rpc("set_owner_importance", {
        p_thing_id: thingId,
        p_owner_importance: importance,
      }),
    () => {
      setImportanceLocal(thingId, importance);
      return null as never;
    },
  );
}

export async function rpcSetWorkStatus(thingId: string, status: WorkStatus) {
  return tryRpc(
    () => supabase.rpc("set_work_status", { p_thing_id: thingId, p_work_status: status }),
    () => {
      setStatusLocal(thingId, status);
      return null as never;
    },
  );
}

export async function rpcSetDue(thingId: string, dueAt: string, dueHasTime: boolean) {
  return tryRpc(
    () => supabase.rpc("set_due", { p_thing_id: thingId, p_due_at: dueAt, p_due_has_time: dueHasTime }),
    () => {
      setDueLocal(thingId, dueAt, dueHasTime);
      return null as never;
    },
  );
}

export async function rpcNudgeThing(thingId: string) {
  return tryRpc(
    () => supabase.rpc("nudge_thing", { p_thing_id: thingId }),
    () => {
      nudgeLocal(thingId);
      return null as never;
    },
  );
}

export async function rpcSortThing(thingId: string) {
  return tryRpc(
    () => supabase.rpc("sort_thing", { p_thing_id: thingId }),
    () => {
      setStatusLocal(thingId, "sorted");
      return null as never;
    },
  );
}

export async function rpcCancelThing(thingId: string) {
  return tryRpc(
    () => supabase.rpc("cancel_thing", { p_thing_id: thingId }),
    () => {
      setStatusLocal(thingId, "cancelled");
      return null as never;
    },
  );
}

export async function rpcCreateThing(input: {
  title: string;
  context: "work" | "home";
  ownerImportance?: Importance;
  listId?: string;
  assigneeActorId?: string;
  dueAt?: string;
  dueHasTime?: boolean;
}) {
  return tryRpc(
    () =>
      supabase.rpc("create_thing", {
        p_title: input.title,
        p_context: input.context,
        p_owner_importance: input.ownerImportance ?? "next",
        p_list_id: input.listId,
        p_assignee_actor_id: input.assigneeActorId,
        p_due_at: input.dueAt,
        p_due_has_time: input.dueHasTime,
      }),
    () =>
      tossLocalThing({
        title: input.title,
        context: input.context,
        ownerImportance: input.ownerImportance,
        listId: input.listId,
        assigneeId: input.assigneeActorId,
      }),
  );
}

export async function rpcReassignThing(thingId: string, assigneeActorId: string) {
  return tryRpc(
    () =>
      supabase.rpc("reassign_thing", {
        p_thing_id: thingId,
        p_new_assignee_actor_id: assigneeActorId,
      }),
    () => {
      reassignLocal(thingId, assigneeActorId);
      return null as never;
    },
  );
}

export async function rpcAssignThing(thingId: string, assigneeActorId: string) {
  return tryRpc(
    () => supabase.rpc("assign_thing", { p_thing_id: thingId, p_assignee_actor_id: assigneeActorId }),
    () => {
      reassignLocal(thingId, assigneeActorId);
      return null as never;
    },
  );
}

export async function rpcCreateList(name: string, context: "work" | "home") {
  return tryRpc(
    () => supabase.rpc("create_list", { p_name: name, p_context: context }),
    () => null as never,
  );
}

export async function rpcCreateBucket(name: string, context: "work" | "home") {
  return tryRpc(
    () => supabase.rpc("create_bucket", { p_name: name, p_context: context }),
    () => null as never,
  );
}

export async function rpcAddToBucket(bucketId: string, thingId?: string, listId?: string) {
  return tryRpc(
    () => supabase.rpc("add_to_bucket", { p_bucket_id: bucketId, p_thing_id: thingId, p_list_id: listId }),
    () => null as never,
  );
}

export async function rpcShred(objectId: string, objectType: "thing" | "list" | "bucket" = "thing") {
  return tryRpc(
    () => supabase.rpc("shred_for_me", { p_object_id: objectId, p_object_type: objectType }),
    () => {
      shredLocal(objectId);
      return null as never;
    },
  );
}

export async function rpcRestore(objectId: string, objectType: "thing" | "list" | "bucket" = "thing") {
  return tryRpc(
    () => supabase.rpc("restore_for_me", { p_object_id: objectId, p_object_type: objectType }),
    () => null as never,
  );
}

export async function rpcComment(thingId: string, body: string) {
  const { error } = await supabase.from("thing_comments").insert({
    thing_id: thingId,
    body,
    author_actor_id: "local",
  });
  if (error) {
    addCommentLocal(thingId, body);
    return;
  }
}

export function starLocal(thingId: string, starred: boolean) {
  patchThing(thingId, { starred });
}
