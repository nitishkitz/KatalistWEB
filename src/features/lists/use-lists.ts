import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import { getLists } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { rpcCreateListV2 } from "@/features/things/rpc";
import {
  excludePersonallyShreddedList,
  excludePersonallyShreddedLists,
  isPersonallyShreddedList,
  usePersonalShred,
} from "@/features/things/personal-shred";
import { mapDbListRows, type DbListRow } from "./map-list-rows";
import type { ListRow } from "./fixtures";

async function fetchLists(profileId: string, context: "work" | "home"): Promise<ListRow[]> {
  const { data: lists, error } = await supabase
    .from("lists")
    .select("id,name,description,cover_storage_path,context,owner_profile_id,updated_at")
    .eq("context", context)
    .is("archived_at", null);
  if (error) throw error;
  return mapDbListRows(profileId, (lists ?? []) as DbListRow[]);
}

export function useLists() {
  const { session, user } = useSession();
  const { context } = useAppContext();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const qc = useQueryClient();
  const shred = usePersonalShred();

  const query = useQuery({
    queryKey: keys.lists(user?.id, context),
    queryFn: () => fetchLists(user!.id, context),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  const lists = useMemo(() => {
    if (preview) return getLists().filter((l) => l.context === context);
    return excludePersonallyShreddedLists(query.data ?? [], shred);
  }, [preview, query.data, context, version, shred]);

  const create = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) => rpcCreateListV2(name, context, description),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.lists(user?.id, context) });
    },
  });

  return { lists, isLoading: !preview && query.isLoading, error: query.error, preview, create };
}

export function useList(listId: string | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);
  useLocalVersion();

  const byId = useQuery({
    queryKey: ["list", listId],
    enabled: Boolean(listId) && Boolean(user) && !preview && !hidden,
    queryFn: async (): Promise<ListRow | null> => {
      const { data, error } = await supabase
        .from("lists")
        .select("id,name,description,cover_storage_path,context,owner_profile_id,updated_at")
        .eq("id", listId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const rows = await fetchLists(user!.id, data.context);
      return rows.find((l) => l.id === data.id) ?? null;
    },
  });

  if (preview) {
    const list = getLists().find((l) => l.id === listId);
    return { list, isLoading: false, error: null, preview: true };
  }
  if (hidden) {
    return { list: undefined, isLoading: false, error: null, preview: false };
  }
  return {
    list: excludePersonallyShreddedList(byId.data ?? undefined, shred),
    isLoading: byId.isLoading,
    error: byId.error,
    preview: false,
  };
}
