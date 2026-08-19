import { supabase } from "@/integrations/supabase/client";
import type { Importance, Pace, WorkStatus } from "@/domain/thing";

export async function rpcCatchThing(thingId: string) {
  const { data, error } = await supabase.rpc("catch_thing", { p_thing_id: thingId });
  if (error) throw error;
  return data;
}

export async function rpcSetPersonalPace(thingId: string, pace: Pace) {
  const { data, error } = await supabase.rpc("set_personal_pace", {
    p_thing_id: thingId,
    p_pace: pace,
  });
  if (error) throw error;
  return data;
}

export async function rpcSetOwnerImportance(thingId: string, importance: Importance) {
  const { data, error } = await supabase.rpc("set_owner_importance", {
    p_thing_id: thingId,
    p_importance: importance,
  });
  if (error) throw error;
  return data;
}

export async function rpcSetWorkStatus(thingId: string, status: WorkStatus) {
  const { data, error } = await supabase.rpc("set_work_status", {
    p_thing_id: thingId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

export async function rpcSetDue(thingId: string, dueAt: string | null, dueHasTime: boolean) {
  const { data, error } = await supabase.rpc("set_due", {
    p_thing_id: thingId,
    p_due_at: dueAt,
    p_due_has_time: dueHasTime,
  });
  if (error) throw error;
  return data;
}

export async function rpcNudgeThing(thingId: string) {
  const { data, error } = await supabase.rpc("nudge_thing", { p_thing_id: thingId });
  if (error) throw error;
  return data;
}

export async function rpcSortThing(thingId: string) {
  const { data, error } = await supabase.rpc("sort_thing", { p_thing_id: thingId });
  if (error) throw error;
  return data;
}

export async function rpcCancelThing(thingId: string) {
  const { data, error } = await supabase.rpc("cancel_thing", { p_thing_id: thingId });
  if (error) throw error;
  return data;
}

export async function rpcCreateThing(input: {
  title: string;
  context: "work" | "home";
  ownerImportance?: Importance;
}) {
  const { data, error } = await supabase.rpc("create_thing", {
    p_title: input.title,
    p_context: input.context,
    p_owner_importance: input.ownerImportance ?? "next",
  });
  if (error) throw error;
  return data;
}
