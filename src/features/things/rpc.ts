import { supabase } from "@/integrations/supabase/client";
import type { Importance, Pace, WorkStatus } from "@/domain/thing";
import { isPreviewMode } from "@/lib/session-mode";
import {
  addCommentLocal,
  addBucketRef,
  catchLocal,
  createBucketLocal,
  createListLocal,
  deleteBucketLocal,
  getListById,
  getThing,
  nudgeLocal,
  patchThing,
  reassignLocal,
  removeBucketRef,
  renameBucketLocal,
  setDueLocal,
  setImportanceLocal,
  setPaceLocal,
  setStatusLocal,
  restoreLocal,
  shredLocal,
  tossLocalThing,
} from "./local-state";

export type MutableWorkStatus = Extract<WorkStatus, "not_started" | "under_progress">;

async function liveRpc<T>(fn: () => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await fn();
  if (error) throw error;
  return data;
}

async function runDomainMutation<T>(handlers: { live: () => Promise<T>; preview: () => T }): Promise<T> {
  if (isPreviewMode()) return handlers.preview();
  return handlers.live();
}

export async function rpcCatchThing(thingId: string, pace: Pace = "next") {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("catch_thing", { p_thing_id: thingId, p_personal_pace: pace })),
    preview: () => {
      catchLocal(thingId, pace);
      return null as never;
    },
  });
}

export async function rpcSetPersonalPace(thingId: string, pace: Pace) {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("set_personal_pace", { p_thing_id: thingId, p_personal_pace: pace })),
    preview: () => {
      setPaceLocal(thingId, pace);
      return null as never;
    },
  });
}

export async function rpcSetOwnerImportance(thingId: string, importance: Importance) {
  return runDomainMutation({
    live: () =>
      liveRpc(() =>
        supabase.rpc("set_owner_importance", {
          p_thing_id: thingId,
          p_owner_importance: importance,
        }),
      ),
    preview: () => {
      setImportanceLocal(thingId, importance);
      return null as never;
    },
  });
}

export async function rpcSetWorkStatus(thingId: string, status: MutableWorkStatus) {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("set_work_status", { p_thing_id: thingId, p_work_status: status })),
    preview: () => {
      setStatusLocal(thingId, status);
      return null as never;
    },
  });
}

export async function rpcSetDue(thingId: string, dueAt: string, dueHasTime: boolean) {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("set_due", { p_thing_id: thingId, p_due_at: dueAt, p_due_has_time: dueHasTime })),
    preview: () => {
      setDueLocal(thingId, dueAt, dueHasTime);
      return null as never;
    },
  });
}

export async function rpcNudgeThing(thingId: string) {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("nudge_thing", { p_thing_id: thingId })),
    preview: () => {
      nudgeLocal(thingId);
      return null as never;
    },
  });
}

export async function rpcSortThing(thingId: string) {
  return runDomainMutation({
    live: () =>
      liveRpc(() =>
        supabase.rpc("sort_thing", {
          p_thing_id: thingId,
        }),
      ),
    preview: () => {
      setStatusLocal(thingId, "sorted");
      return null as never;
    },
  });
}

export async function rpcCancelThing(thingId: string, reason?: string) {
  return runDomainMutation({
    live: () =>
      liveRpc(() =>
        supabase.rpc("cancel_thing", {
          p_thing_id: thingId,
          p_reason: reason,
        }),
      ),
    preview: () => {
      setStatusLocal(thingId, "cancelled");
      return null as never;
    },
  });
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
  return runDomainMutation({
    live: () =>
      liveRpc(() =>
        supabase.rpc("create_thing", {
          p_title: input.title,
          p_context: input.context,
          p_owner_importance: input.ownerImportance ?? "next",
          p_list_id: input.listId,
          p_assignee_actor_id: input.assigneeActorId,
          p_due_at: input.dueAt,
          p_due_has_time: input.dueHasTime,
        }),
      ),
    preview: () => {
      tossLocalThing({
        title: input.title,
        context: input.context,
        ownerImportance: input.ownerImportance,
        listId: input.listId,
        assigneeId: input.assigneeActorId,
        dueAt: input.dueAt,
        dueHasTime: input.dueHasTime,
      });
      return null as never;
    },
  });
}

export async function rpcReassignThing(thingId: string, assigneeActorId: string) {
  return runDomainMutation({
    live: () =>
      liveRpc(() =>
        supabase.rpc("reassign_thing", {
          p_thing_id: thingId,
          p_new_assignee_actor_id: assigneeActorId,
        }),
      ),
    preview: () => {
      reassignLocal(thingId, assigneeActorId);
      return null as never;
    },
  });
}

export async function rpcAssignThing(thingId: string, assigneeActorId: string) {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("assign_thing", { p_thing_id: thingId, p_assignee_actor_id: assigneeActorId })),
    preview: () => {
      reassignLocal(thingId, assigneeActorId);
      return null as never;
    },
  });
}

export async function rpcCreateList(name: string, context: "work" | "home") {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("create_list", { p_name: name, p_context: context })),
    preview: () => createListLocal(name, context) as never,
  });
}

export async function rpcCreateBucket(name: string, context: "work" | "home") {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("create_bucket", { p_name: name, p_context: context })),
    preview: () => createBucketLocal(name, context) as never,
  });
}

export async function rpcRenameBucket(bucketId: string, name: string) {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("rename_bucket", { p_bucket_id: bucketId, p_name: name })),
    preview: () => {
      renameBucketLocal(bucketId, name);
      return null as never;
    },
  });
}

export async function rpcDeleteBucket(bucketId: string) {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("delete_bucket", { p_bucket_id: bucketId })),
    preview: () => {
      deleteBucketLocal(bucketId);
      return null as never;
    },
  });
}

export async function rpcAddToBucket(bucketId: string, thingId?: string, listId?: string) {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("add_to_bucket", { p_bucket_id: bucketId, p_thing_id: thingId, p_list_id: listId })),
    preview: () => {
      if (thingId) {
        const t = getThing(thingId);
        addBucketRef(bucketId, { thingId, title: t?.title ?? thingId, kind: "thing" });
      }
      if (listId) {
        const list = getListById(listId);
        addBucketRef(bucketId, { listId, title: list?.name ?? listId, kind: "list" });
      }
      return null as never;
    },
  });
}

export async function rpcRemoveFromBucket(bucketId: string, thingId?: string, listId?: string) {
  return runDomainMutation({
    live: () =>
      liveRpc(() => supabase.rpc("remove_from_bucket", { p_bucket_id: bucketId, p_thing_id: thingId, p_list_id: listId })),
    preview: () => {
      removeBucketRef(bucketId, thingId, listId);
      return null as never;
    },
  });
}

export async function rpcShred(objectId: string, objectType: "thing" | "list" | "bucket" = "thing") {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("shred_for_me", { p_object_id: objectId, p_object_type: objectType })),
    preview: () => {
      if (objectType === "bucket") throw new Error("Buckets can’t be shredded.");
      shredLocal(objectId, objectType === "list" ? "list" : "thing");
      return null as never;
    },
  });
}

export async function rpcRestore(objectId: string, objectType: "thing" | "list" | "bucket" = "thing") {
  return runDomainMutation({
    live: () => liveRpc(() => supabase.rpc("restore_for_me", { p_object_id: objectId, p_object_type: objectType })),
    preview: () => {
      if (objectType === "bucket") return null as never;
      restoreLocal(objectId, objectType === "list" ? "list" : "thing");
      return null as never;
    },
  });
}

export async function rpcComment(thingId: string, body: string) {
  if (isPreviewMode()) {
    addCommentLocal(thingId, body);
    return;
  }
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sign in to comment.");
  const { data: actor, error: actorError } = await supabase.from("actors").select("id").eq("profile_id", auth.user.id).maybeSingle();
  if (actorError) throw actorError;
  if (!actor?.id) throw new Error("Couldn’t resolve your actor.");
  const { error } = await supabase.from("thing_comments").insert({
    thing_id: thingId,
    body,
    author_actor_id: actor.id,
  });
  if (error) throw error;
}

export function starLocal(thingId: string, starred: boolean) {
  patchThing(thingId, { starred });
}
