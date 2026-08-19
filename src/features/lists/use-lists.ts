import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import { createListLocal, getLists, useLocalVersion } from "@/features/things/local-state";
import { rpcCreateList } from "@/features/things/rpc";
import type { ListRow } from "./fixtures";

const COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

async function fetchLists(profileId: string, context: "work" | "home"): Promise<ListRow[]> {
  const { data: lists, error } = await supabase
    .from("lists")
    .select("id,name,context,owner_profile_id,updated_at")
    .eq("context", context)
    .is("archived_at", null);
  if (error) throw error;

  const ids = (lists ?? []).map((l) => l.id);
  const { data: members } = ids.length
    ? await supabase.from("list_members").select("list_id,profile_id,role,profiles(display_name,avatar_url)").in("list_id", ids)
    : { data: [] };
  const { data: things } = ids.length
    ? await supabase.from("things").select("id,list_id,work_status").in("list_id", ids)
    : { data: [] };

  return (lists ?? []).map((l, i) => {
    const listMembers = (members ?? []).filter((m) => m.list_id === l.id);
    const mine = listMembers.find((m) => m.profile_id === profileId);
    const role = l.owner_profile_id === profileId ? "owner" : (mine?.role ?? "view_only");
    const listThings = (things ?? []).filter((t) => t.list_id === l.id);
    return {
      id: l.id,
      name: l.name,
      context: l.context,
      role,
      ownerLine: l.owner_profile_id === profileId ? "Owned by you" : "Shared list",
      members: listMembers.slice(0, 5).map((m) => {
        const profile = (m as { profiles?: { display_name?: string; avatar_url?: string | null } }).profiles;
        const name = profile?.display_name ?? "Member";
        return {
          name,
          initials: name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase(),
          avatarUrl: profile?.avatar_url ?? null,
        };
      }),
      memberCount: listMembers.length,
      thingCount: listThings.length,
      doneCount: listThings.filter((t) => t.work_status === "sorted").length,
      inProgressCount: listThings.filter((t) => t.work_status === "under_progress").length,
      unread: 0,
      latestActivity: "Updated",
      updatedAt: new Date(l.updated_at).toLocaleString(),
      color: COLORS[i % COLORS.length]!,
    } satisfies ListRow;
  });
}

export function useLists() {
  const { session, user } = useSession();
  const { context } = useAppContext();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: keys.lists(user?.id, context),
    queryFn: () => fetchLists(user!.id, context),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  const lists = useMemo(() => {
    if (preview) return getLists().filter((l) => l.context === context || true);
    return query.data ?? [];
  }, [preview, query.data, context, version]);

  const create = useMutation({
    mutationFn: (name: string) => rpcCreateList(name, context),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.lists(user?.id, context) });
    },
  });

  return { lists, isLoading: !preview && query.isLoading, error: query.error, preview, create };
}

export function useList(listId: string | undefined) {
  const { lists, isLoading, error, preview } = useLists();
  const list = lists.find((l) => l.id === listId) ?? (preview ? getLists().find((l) => l.id === listId) : undefined);
  return { list, isLoading, error, preview };
}
