import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getThing } from "./local-state";
import { useLocalVersion } from "./use-local-version";
import type { Thing } from "@/domain/thing";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "./map-thing-rows";

async function fetchThing(thingId: string): Promise<Thing | null> {
  const { data, error } = await supabase.from("things").select(THING_COLUMNS).eq("id", thingId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [thing] = await mapDbThingRows([data as DbThingRow]);
  return thing ?? null;
}

export function useThing(thingId: string | null) {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  useLocalVersion();

  const query = useQuery({
    queryKey: keys.thing(thingId ?? "none"),
    queryFn: () => fetchThing(thingId!),
    enabled: Boolean(thingId) && !preview,
    staleTime: 10_000,
  });

  if (!thingId) return { thing: null, isLoading: false };
  if (preview) return { thing: getThing(thingId) ?? null, isLoading: false };
  return { thing: query.data ?? null, isLoading: query.isLoading, error: query.error };
}