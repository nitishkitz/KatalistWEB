import { supabase } from "@/integrations/supabase/client";
import type { Importance, Pace, WorkStatus } from "@/domain/thing";
import { isPreviewMode } from "@/lib/session-mode";
import { DEMO_ACTOR_BY_KEY } from "@/features/demo/identities";
import {
  addCommentLocal,
  addListMemberLocal,
  addBucketRef,
  catchLocal,
  changeListRoleLocal,
  createBucketLocal,
  createListLocal,
  deleteBucketLocal,
  getListById,
  getThing,
  nudgeLocal,
  patchThing,
  reassignLocal,
  removeBucketRef,
  removeListMemberLocal,
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value?: string | null): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

async function resolveToActorUuid(actorOrProfileOrKey: string): Promise<string | null> {
  const raw = (actorOrProfileOrKey || "").trim();
  if (!raw) return null;

  if (UUID_REGEX.test(raw)) {
    try {
      const { data: actor } = await supabase.from("actors").select("id").eq("id", raw).maybeSingle();
      if (actor?.id) return actor.id;
      const { data: byProfile } = await supabase.from("actors").select("id").eq("profile_id", raw).maybeSingle();
      if (byProfile?.id) return byProfile.id;
    } catch {
      // fallback
    }
    return raw;
  }

  const key = raw.replace(/^p-/, "").toLowerCase();
  const demoPersona = Object.values(DEMO_ACTOR_BY_KEY).find(
    (p) => p.id === raw || p.id === `p-${key}` || p.name.toLowerCase().includes(key),
  );
  const searchName = demoPersona ? demoPersona.name.split(" ")[0] : key;

  try {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .ilike("display_name", `%${searchName}%`)
      .limit(5);

    if (profiles && profiles.length > 0) {
      const profileIds = profiles.map((p) => p.id);
      const { data: actors } = await supabase
        .from("actors")
        .select("id, profile_id")
        .in("profile_id", profileIds)
        .limit(1);
      if (actors && actors.length > 0) {
        return actors[0]!.id;
      }
    }

    const { data: assignable } = await supabase.rpc("list_assignable_people");
    if (assignable && assignable.length > 0) {
      const hit = assignable.find(
        (a) => a.actor_id === raw || a.display_name?.toLowerCase().includes(key),
      );
      if (hit?.actor_id) return hit.actor_id;
    }
  } catch {
    // ignore
  }

  return null;
}

async function liveRpc<T>(fn: () => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await fn();
  if (error) throw error;
  return data;
}

async function runDomainMutation<T>(handlers: {
  live: () => Promise<T>;
  preview: () => T;
  thingId?: string;
  objectId?: string;
}): Promise<T> {
  if (isPreviewMode()) return handlers.preview();
  const idToCheck = handlers.thingId ?? handlers.objectId;
  if (idToCheck && !isUuid(idToCheck)) {
    return handlers.preview();
  }
  try {
    return await handlers.live();
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (
      msg.includes("Thing not found") ||
      msg.includes("not found") ||
      msg.includes("invalid input syntax for type uuid") ||
      msg.includes("not authenticated") ||
      msg.includes("unknown assignee") ||
      msg.includes("already holds")
    ) {
      return handlers.preview();
    }
    throw error;
  }
}

export async function rpcCatchThing(thingId: string, pace: Pace = "next") {
  return runDomainMutation({
    thingId,
    live: () => liveRpc(() => supabase.rpc("catch_thing", { p_thing_id: thingId, p_personal_pace: pace })),
    preview: () => {
      catchLocal(thingId, pace);
      return null as never;
    },
  });
}

export async function rpcSetPersonalPace(thingId: string, pace: Pace) {
  return runDomainMutation({
    thingId,
    live: () => liveRpc(() => supabase.rpc("set_personal_pace", { p_thing_id: thingId, p_personal_pace: pace })),
    preview: () => {
      setPaceLocal(thingId, pace);
      return null as never;
    },
  });
}

export async function rpcSetOwnerImportance(thingId: string, importance: Importance) {
  return runDomainMutation({
    thingId,
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
    thingId,
    live: () => liveRpc(() => supabase.rpc("set_work_status", { p_thing_id: thingId, p_work_status: status })),
    preview: () => {
      setStatusLocal(thingId, status);
      return null as never;
    },
  });
}

export async function rpcSetDue(thingId: string, dueAt: string, dueHasTime: boolean) {
  return runDomainMutation({
    thingId,
    live: () => liveRpc(() => supabase.rpc("set_due", { p_thing_id: thingId, p_due_at: dueAt, p_due_has_time: dueHasTime })),
    preview: () => {
      setDueLocal(thingId, dueAt, dueHasTime);
      return null as never;
    },
  });
}

export async function rpcNudgeThing(thingId: string) {
  return runDomainMutation({
    thingId,
    live: () => liveRpc(() => supabase.rpc("nudge_thing", { p_thing_id: thingId })),
    preview: () => {
      nudgeLocal(thingId);
      return null as never;
    },
  });
}

export async function rpcSortThing(thingId: string) {
  return runDomainMutation({
    thingId,
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
    thingId,
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
    thingId,
    live: async () => {
      let targetActorId = assigneeActorId;
      if (!isUuid(targetActorId)) {
        const resolved = await resolveToActorUuid(targetActorId);
        if (resolved) targetActorId = resolved;
      } else {
        try {
          const { data: actor } = await supabase
            .from("actors")
            .select("id")
            .eq("id", targetActorId)
            .maybeSingle();
          if (!actor?.id) {
            const { data: actorByProfile } = await supabase
              .from("actors")
              .select("id")
              .eq("profile_id", targetActorId)
              .maybeSingle();
            if (actorByProfile?.id) targetActorId = actorByProfile.id;
          }
        } catch {
          // ignore
        }
      }

      if (!isUuid(targetActorId)) {
        reassignLocal(thingId, assigneeActorId);
        return null as never;
      }

      return liveRpc(() =>
        supabase.rpc("reassign_thing", {
          p_thing_id: thingId,
          p_new_assignee_actor_id: targetActorId,
        }),
      );
    },
    preview: () => {
      reassignLocal(thingId, assigneeActorId);
      return null as never;
    },
  });
}

export async function rpcAssignThing(thingId: string, assigneeActorId: string) {
  return runDomainMutation({
    thingId,
    live: async () => {
      let targetActorId = assigneeActorId;
      if (!isUuid(targetActorId)) {
        const resolved = await resolveToActorUuid(targetActorId);
        if (resolved) targetActorId = resolved;
      } else {
        try {
          const { data: actor } = await supabase
            .from("actors")
            .select("id")
            .eq("id", targetActorId)
            .maybeSingle();
          if (!actor?.id) {
            const { data: actorByProfile } = await supabase
              .from("actors")
              .select("id")
              .eq("profile_id", targetActorId)
              .maybeSingle();
            if (actorByProfile?.id) targetActorId = actorByProfile.id;
          }
        } catch {
          // ignore
        }
      }

      if (!isUuid(targetActorId)) {
        reassignLocal(thingId, assigneeActorId);
        return null as never;
      }

      return liveRpc(() =>
        supabase.rpc("assign_thing", {
          p_thing_id: thingId,
          p_assignee_actor_id: targetActorId,
        }),
      );
    },
    preview: () => {
      reassignLocal(thingId, assigneeActorId);
      return null as never;
    },
  });
}

export async function rpcAssignOutsideKatalist(input: {
  thingId: string;
  displayName: string;
  email?: string;
  phone?: string;
}): Promise<{ actorId: string; token: string; expiresAt: string; path: string }> {
  if (isPreviewMode()) {
    throw new Error("Assign outside Katalist needs a live session.");
  }
  const displayName = input.displayName.trim();
  const email = input.email?.trim() || undefined;
  const phone = input.phone?.trim() || undefined;
  if (!displayName) throw new Error("A display name is required.");
  if (!email && !phone) throw new Error("An email or phone number is required.");

  const issued = await liveRpc(() =>
    supabase.rpc("assign_outside_katalist", {
      p_thing_id: input.thingId,
      p_display_name: displayName,
      p_email: email,
      p_phone_e164: phone,
    }),
  );
  const row = Array.isArray(issued) ? issued[0] : issued;
  if (!row?.token || !row.actor_id) throw new Error("Couldn’t open a Bridge for this Thing.");
  return {
    actorId: row.actor_id,
    token: row.token,
    expiresAt: row.expires_at,
    path: `/bridge/${row.token}`,
  };
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
    objectId: bucketId,
    live: async () => {
      if (!isUuid(bucketId)) {
        renameBucketLocal(bucketId, name);
        return null as never;
      }
      return liveRpc(() => supabase.rpc("rename_bucket", { p_bucket_id: bucketId, p_name: name }));
    },
    preview: () => {
      renameBucketLocal(bucketId, name);
      return null as never;
    },
  });
}

export async function rpcDeleteBucket(bucketId: string) {
  return runDomainMutation({
    objectId: bucketId,
    live: async () => {
      if (!isUuid(bucketId)) {
        deleteBucketLocal(bucketId);
        return null as never;
      }
      return liveRpc(() => supabase.rpc("delete_bucket", { p_bucket_id: bucketId }));
    },
    preview: () => {
      deleteBucketLocal(bucketId);
      return null as never;
    },
  });
}

export async function rpcAddToBucket(bucketId: string, thingId?: string, listId?: string) {
  const isBucketUuid = isUuid(bucketId);
  const isThingUuid = !thingId || isUuid(thingId);
  const isListUuid = !listId || isUuid(listId);

  return runDomainMutation({
    live: async () => {
      if (!isBucketUuid || !isThingUuid || !isListUuid) {
        if (thingId) {
          const t = getThing(thingId);
          addBucketRef(bucketId, { thingId, title: t?.title ?? thingId, kind: "thing" });
        }
        if (listId) {
          const list = getListById(listId);
          addBucketRef(bucketId, { listId, title: list?.name ?? listId, kind: "list" });
        }
        return null as never;
      }

      const res = await fetch("/api/buckets/add-item", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucketId, thingId, listId }),
      });

      if (res.ok) {
        const json = await res.json().catch(() => ({ ok: true }));
        if (thingId) {
          const t = getThing(thingId);
          addBucketRef(bucketId, { thingId, title: t?.title ?? thingId, kind: "thing" });
        }
        if (listId) {
          const list = getListById(listId);
          addBucketRef(bucketId, { listId, title: list?.name ?? listId, kind: "list" });
        }
        return json as never;
      }

      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.message || `Failed to add to bucket (${res.status})`);
    },
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
  const isBucketUuid = isUuid(bucketId);
  const isThingUuid = !thingId || isUuid(thingId);
  const isListUuid = !listId || isUuid(listId);

  return runDomainMutation({
    live: async () => {
      if (!isBucketUuid || !isThingUuid || !isListUuid) {
        removeBucketRef(bucketId, thingId, listId);
        return null as never;
      }
      return liveRpc(() =>
        supabase.rpc("remove_from_bucket", {
          p_bucket_id: bucketId,
          p_thing_id: thingId || undefined,
          p_list_id: listId || undefined,
        }),
      );
    },
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

async function resolveToProfileUuid(actorOrProfileOrKey: string): Promise<string | null> {
  const raw = (actorOrProfileOrKey || "").trim();
  if (!raw) return null;

  if (UUID_REGEX.test(raw)) {
    try {
      const { data: profile } = await supabase.from("profiles").select("id").eq("id", raw).maybeSingle();
      if (profile?.id) return profile.id;
      const { data: actor } = await supabase.from("actors").select("profile_id").eq("id", raw).maybeSingle();
      if (actor?.profile_id) return actor.profile_id;
    } catch {
      // fallback
    }
    return raw;
  }

  const key = raw.replace(/^p-/, "").toLowerCase();
  const demoPersona = Object.values(DEMO_ACTOR_BY_KEY).find(
    (p) => p.id === raw || p.id === `p-${key}` || p.name.toLowerCase().includes(key),
  );
  const searchName = demoPersona ? demoPersona.name.split(" ")[0] : key;

  try {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .ilike("display_name", `%${searchName}%`)
      .limit(5);

    if (profiles && profiles.length > 0) {
      return profiles[0].id;
    }
  } catch {
    // fallback
  }

  try {
    const { data: identities } = await supabase
      .from("public_identities")
      .select("id, display_name")
      .ilike("display_name", `%${searchName}%`)
      .limit(5);
    if (identities && identities.length > 0) {
      return identities[0].id;
    }
  } catch {
    // fallback
  }

  return null;
}

export async function rpcAddListMember(
  listId: string,
  profileOrActorId: string,
  role: "collaborator" | "view_only" = "collaborator",
) {
  return runDomainMutation({
    objectId: listId,
    live: async () => {
      if (!isUuid(listId)) {
        addListMemberLocal(listId, profileOrActorId, role);
        return null as never;
      }

      // 1. First try API endpoint backed by service role to properly resolve actors/demo personas
      try {
        const res = await fetch("/api/lists/add-member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId, personId: profileOrActorId, role }),
        });
        if (res.ok) {
          const json = await res.json();
          return json.member as never;
        }
      } catch {
        // fallback to direct Supabase RPC
      }

      // 2. Direct Supabase RPC
      const profId = await resolveToProfileUuid(profileOrActorId);
      if (profId && isUuid(profId)) {
        const { data, error } = await supabase.rpc("add_list_member", {
          p_list_id: listId,
          p_profile_id: profId,
          p_role: role,
        });

        if (!error && data) {
          return data as never;
        }

        if (error) {
          const { error: upsertError } = await supabase.from("list_members").upsert(
            {
              list_id: listId,
              profile_id: profId,
              role,
            },
            { onConflict: "list_id,profile_id" },
          );
          if (!upsertError) {
            return null as never;
          }
        }
      }

      throw new Error("Unable to add team member to this list.");
    },
    preview: () => {
      addListMemberLocal(listId, profileOrActorId, role);
      return null as never;
    },
  });
}

export async function rpcChangeListRole(
  listId: string,
  profileOrActorId: string,
  role: "collaborator" | "view_only",
) {
  return runDomainMutation({
    objectId: listId,
    live: async () => {
      if (!isUuid(listId)) {
        changeListRoleLocal(listId, profileOrActorId, role);
        return null as never;
      }

      // 1. First try API endpoint
      try {
        const res = await fetch("/api/lists/change-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId, personId: profileOrActorId, role }),
        });
        if (res.ok) {
          const json = await res.json();
          return json.member as never;
        }
      } catch {
        // fallback to direct RPC
      }

      // 2. Direct Supabase RPC
      const profId = await resolveToProfileUuid(profileOrActorId);
      if (profId && isUuid(profId)) {
        const { data, error } = await supabase.rpc("change_list_role", {
          p_list_id: listId,
          p_profile_id: profId,
          p_role: role,
        });
        if (!error && data) return data as never;

        if (error) {
          const { error: updateError } = await supabase
            .from("list_members")
            .update({ role })
            .match({ list_id: listId, profile_id: profId });
          if (!updateError) return null as never;
        }
      }

      throw new Error("Unable to change member role.");
    },
    preview: () => {
      changeListRoleLocal(listId, profileOrActorId, role);
      return null as never;
    },
  });
}

export async function rpcRemoveListMember(listId: string, profileOrActorId: string) {
  return runDomainMutation({
    objectId: listId,
    live: async () => {
      if (!isUuid(listId)) {
        removeListMemberLocal(listId, profileOrActorId);
        return null as never;
      }

      // 1. First try API endpoint
      try {
        const res = await fetch("/api/lists/remove-member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId, personId: profileOrActorId }),
        });
        if (res.ok) {
          return true as never;
        }
      } catch {
        // fallback to direct RPC
      }

      // 2. Direct Supabase RPC
      const profId = await resolveToProfileUuid(profileOrActorId);
      if (profId && isUuid(profId)) {
        const { data, error } = await supabase.rpc("remove_list_member", {
          p_list_id: listId,
          p_profile_id: profId,
        });
        if (!error) return data as never;

        if (error) {
          const { error: deleteError } = await supabase
            .from("list_members")
            .delete()
            .match({ list_id: listId, profile_id: profId });
          if (!deleteError) return null as never;
        }
      }

      throw new Error("Unable to remove member from list.");
    },
    preview: () => {
      removeListMemberLocal(listId, profileOrActorId);
      return null as never;
    },
  });
}
