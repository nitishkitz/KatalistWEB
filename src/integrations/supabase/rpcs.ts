import { supabase } from "./client";
import type { Database } from "./types";

type Importance = Database["public"]["Enums"]["importance"];
type Pace = Database["public"]["Enums"]["pace"];
type WorkStatus = Database["public"]["Enums"]["work_status"];
type ContextKind = Database["public"]["Enums"]["context_kind"];
type NudgeReason = Database["public"]["Enums"]["nudge_reason"];

async function rpc<T>(name: keyof Database["public"]["Functions"], args: object): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

export const katalistRpc = {
  createThing: (args: {
    p_title: string;
    p_assignee_actor_id?: string;
    p_context?: ContextKind;
    p_due_at?: string;
    p_due_has_time?: boolean;
    p_list_id?: string;
    p_notes?: string;
    p_owner_importance?: Importance;
    p_personal_pace?: Pace;
  }) => rpc("create_thing", args),

  catchThing: (p_thing_id: string, p_personal_pace?: Pace) =>
    rpc("catch_thing", { p_thing_id, p_personal_pace }),

  assignThing: (p_thing_id: string, p_assignee_actor_id: string) =>
    rpc("assign_thing", { p_thing_id, p_assignee_actor_id }),

  reassignThing: (p_thing_id: string, p_new_assignee_actor_id: string) =>
    rpc("reassign_thing", { p_thing_id, p_new_assignee_actor_id }),

  setPersonalPace: (p_thing_id: string, p_personal_pace: Pace) =>
    rpc("set_personal_pace", { p_thing_id, p_personal_pace }),

  setOwnerImportance: (p_thing_id: string, p_owner_importance: Importance) =>
    rpc("set_owner_importance", { p_thing_id, p_owner_importance }),

  setWorkStatus: (p_thing_id: string, p_work_status: WorkStatus) =>
    rpc("set_work_status", { p_thing_id, p_work_status }),

  setDue: (p_thing_id: string, p_due_at: string, p_due_has_time?: boolean) =>
    rpc("set_due", { p_thing_id, p_due_at, p_due_has_time }),

  sortThing: (p_thing_id: string) => rpc("sort_thing", { p_thing_id }),

  cancelThing: (p_thing_id: string, p_reason?: string) =>
    rpc("cancel_thing", { p_thing_id, p_reason }),

  createList: (p_name: string, p_context?: ContextKind) =>
    rpc("create_list", { p_name, p_context }),

  createBucket: (p_name: string, p_context?: ContextKind) =>
    rpc("create_bucket", { p_name, p_context }),

  addToBucket: (p_bucket_id: string, p_thing_id?: string, p_list_id?: string) =>
    rpc("add_to_bucket", { p_bucket_id, p_thing_id, p_list_id }),

  removeFromBucket: (p_bucket_id: string, p_thing_id?: string, p_list_id?: string) =>
    rpc("remove_from_bucket", { p_bucket_id, p_thing_id, p_list_id }),

  nudgeThing: (p_thing_id: string, p_reason?: NudgeReason, p_message?: string) =>
    rpc("nudge_thing", { p_thing_id, p_reason, p_message }),

  listNudgeable: () => rpc("list_nudgeable_things", {}),

  shredForMe: (p_object_id: string, p_object_type: "thing" | "list" | "bucket") =>
    rpc("shred_for_me", { p_object_id, p_object_type }),

  restoreForMe: (p_object_id: string, p_object_type: "thing" | "list" | "bucket") =>
    rpc("restore_for_me", { p_object_id, p_object_type }),

  reserveThingAttachment: (args: {
    p_thing_id: string;
    p_client_id: string;
    p_staging_key: string;
    p_file_name: string;
  }) => rpc("reserve_thing_attachment", args),

  completeThingAttachment: (args: { p_attachment_id: string; p_storage_key: string }) =>
    rpc("complete_thing_attachment", args),

  abandonPendingAttachment: (args: { p_thing_id: string; p_client_id: string; p_staging_key: string }) =>
    rpc("abandon_pending_attachment", args),

  listThingAttachments: (p_thing_id: string) => rpc("list_thing_attachments", { p_thing_id }),
};
