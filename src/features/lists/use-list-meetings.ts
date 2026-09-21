import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { keys } from "@/domain/query-keys";
import {
  cancelMeetingLocal,
  getMeetingsLocal,
  scheduleMeetingLocal,
} from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { isPersonallyShreddedList, usePersonalShred } from "@/features/things/personal-shred";

export type ListMeeting = {
  id: string;
  listId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  createdBy: string;
};

async function fetchMeetings(listId: string): Promise<ListMeeting[]> {
  const { data, error } = await supabase
    .from("list_meetings")
    .select("id, list_id, title, starts_at, ends_at, created_by")
    .eq("list_id", listId)
    .is("cancelled_at", null)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    listId: r.list_id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdBy: r.created_by,
  }));
}

/** Upcoming meetings for a List (also covers Team-Hub DM/group conversations,
 *  which are themselves rows in `lists`). Ordered soonest-first. */
export function useListMeetings(listId: string) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);
  useLocalVersion();

  const query = useQuery({
    queryKey: keys.listMeetings(listId),
    queryFn: () => fetchMeetings(listId),
    enabled: Boolean(listId) && !preview && !hidden,
    staleTime: 15_000,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.listMeetings(listId) });

  const schedule = useMutation({
    mutationFn: async (input: { title: string; startsAt: Date; endsAt: Date }) => {
      if (hidden) throw new Error("That List isn’t available.");
      if (preview) {
        return scheduleMeetingLocal(
          listId,
          input.title,
          input.startsAt.toISOString(),
          input.endsAt.toISOString(),
        );
      }
      if (!user?.id) throw new Error("Sign in to schedule a meeting.");
      const { data, error } = await supabase.rpc("create_list_meeting", {
        p_list_id: listId,
        p_title: input.title,
        p_starts_at: input.startsAt.toISOString(),
        p_ends_at: input.endsAt.toISOString(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: async (meetingId: string) => {
      if (preview) {
        cancelMeetingLocal(meetingId);
        return;
      }
      const { error } = await supabase.rpc("cancel_list_meeting", { p_meeting_id: meetingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const meetings: ListMeeting[] = hidden
    ? []
    : preview
      ? getMeetingsLocal(listId).map((m) => ({
          id: m.id,
          listId: m.listId,
          title: m.title,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
          createdBy: m.createdBy,
        }))
      : query.data ?? [];

  return {
    meetings,
    isLoading: !preview && !hidden && query.isLoading,
    schedule,
    cancel,
  };
}
