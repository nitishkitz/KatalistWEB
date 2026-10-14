import type { Pace } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";

export async function fetchPersonalCourtLanes(ids: string[]): Promise<Map<string, { lane: Pace; assigneeActorId: string }>> {
  const result = new Map<string, { lane: Pace; assigneeActorId: string }>();
  for (let i = 0; i < ids.length; i += 150) {
    // RLS returns only the authenticated current holder's own placement.
    const { data, error } = await supabase.from("thing_court_placement" as never)
      .select("thing_id,lane,assignee_actor_id").in("thing_id", ids.slice(i, i + 150));
    // During a rolling rollout, older databases have no personal placements
    // yet. Shared lanes still work. Never hide permission or transport errors
    // on an existing table, since doing so could discard saved placements.
    if (error) {
      if (error.code === "PGRST205" && error.message.includes("public.thing_court_placement")) return result;
      throw error;
    }
    for (const row of (data ?? []) as Array<{ thing_id: string; lane: Pace; assignee_actor_id: string }>) {
      if (!["now", "next", "later"].includes(row.lane)) throw new Error("Invalid Court placement");
      result.set(row.thing_id, { lane: row.lane, assigneeActorId: row.assignee_actor_id });
    }
  }
  return result;
}
