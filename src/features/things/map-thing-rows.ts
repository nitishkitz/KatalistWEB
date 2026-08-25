import type { Thing } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { personOrSomeone, resolveActorPeople } from "@/features/people/resolve-actors";

export const THING_COLUMNS =
  "id,title,acknowledgement,work_status,owner_importance,assignee_personal_pace,due_at,due_has_time,context,list_id,creator_actor_id,owner_actor_id,current_assignee_actor_id,current_assignment_id,cancelled_at,sorted_at,caught_at,created_at,updated_at";

export type DbThingRow = {
  id: string;
  title: string;
  acknowledgement: Thing["acknowledgement"];
  work_status: Thing["workStatus"];
  owner_importance: Thing["ownerImportance"];
  assignee_personal_pace: Thing["personalPace"];
  due_at: string | null;
  due_has_time: boolean;
  context: Thing["context"];
  list_id: string | null;
  creator_actor_id: string;
  owner_actor_id: string;
  current_assignee_actor_id: string;
  current_assignment_id: string | null;
  cancelled_at: string | null;
  sorted_at: string | null;
  caught_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function mapDbThingRows(rows: DbThingRow[]): Promise<Thing[]> {
  if (!rows.length) return [];
  const assignmentIds = [...new Set(rows.map((row) => row.current_assignment_id).filter(Boolean))] as string[];
  const assignedByByAssignment = new Map<string, string>();
  if (assignmentIds.length) {
    const { data: assignments, error } = await supabase
      .from("thing_assignments")
      .select("id,assigned_by_actor_id")
      .in("id", assignmentIds);
    if (error) throw error;
    for (const assignment of assignments ?? []) assignedByByAssignment.set(assignment.id, assignment.assigned_by_actor_id);
  }
  const actorIds = new Set<string>();
  for (const r of rows) {
    actorIds.add(r.creator_actor_id);
    actorIds.add(r.owner_actor_id);
    actorIds.add(r.current_assignee_actor_id);
    const assignedById = r.current_assignment_id ? assignedByByAssignment.get(r.current_assignment_id) : null;
    if (assignedById) actorIds.add(assignedById);
  }
  const people = await resolveActorPeople([...actorIds]);
  const fallback = (id: string) => personOrSomeone(people, id);

  const listIds = [...new Set(rows.map((r) => r.list_id).filter(Boolean))] as string[];
  const listNames = new Map<string, string>();
  if (listIds.length) {
    const { data: lists } = await supabase.from("lists").select("id,name").in("id", listIds);
    for (const l of lists ?? []) listNames.set(l.id, l.name);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    creator: fallback(r.creator_actor_id),
    owner: fallback(r.owner_actor_id),
    assignedBy: fallback((r.current_assignment_id && assignedByByAssignment.get(r.current_assignment_id)) || r.owner_actor_id),
    assignee: fallback(r.current_assignee_actor_id),
    acknowledgement: r.acknowledgement,
    workStatus: r.work_status,
    ownerImportance: r.owner_importance,
    personalPace: r.assignee_personal_pace,
    dueAt: r.due_at,
    dueHasTime: r.due_has_time,
    context: r.context,
    listId: r.list_id,
    listName: r.list_id ? (listNames.get(r.list_id) ?? "List") : null,
    cancelledAt: r.cancelled_at,
    sortedAt: r.sorted_at,
    caughtAt: r.caught_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
