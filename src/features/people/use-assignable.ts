import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { directoryPeople } from "@/features/things/local-state";
import { demoDirectory } from "@/features/demo/identities";
import { matchAvatarByName } from "./directory";
import type { Person } from "@/domain/thing";

export function useAssignablePeople() {
  const { session } = useSession();
  const preview = isPreviewSession(session);

  const query = useQuery({
    queryKey: ["assignable-people"],
    enabled: !preview,
    staleTime: 30_000,
    queryFn: async (): Promise<Person[]> => {
      const map = new Map<string, Person>();

      // 1. Fetch from list_assignable_people RPC
      try {
        const { data, error } = await supabase.rpc("list_assignable_people");
        if (!error && data) {
          for (const row of data) {
            if (row.actor_id) {
              const name = row.display_name && row.display_name !== "Someone" ? row.display_name : "Priya Sharma";
              map.set(row.actor_id, {
                id: row.actor_id,
                name,
                initials: name
                  .split(" ")
                  .map((p: string) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase(),
                avatarUrl: row.avatar_url || matchAvatarByName(name),
              });
            }
          }
        }
      } catch {
        // ignore
      }

      // 2. Fetch all actors with their profiles so any valid user can be assigned/reassigned
      try {
        const { data: actors } = await supabase
          .from("actors")
          .select("id, profile_id, kind")
          .eq("kind", "user");
        if (actors && actors.length > 0) {
          const profileIds = actors.map((a) => a.profile_id).filter(Boolean) as string[];
          if (profileIds.length > 0) {
            const { data: profiles } = await supabase
              .from("profiles")
              .select("id, display_name, avatar_url")
              .in("id", profileIds);
            const profMap = new Map((profiles ?? []).map((p) => [p.id, p]));
            for (const a of actors) {
              if (a.profile_id && !map.has(a.id)) {
                const prof = profMap.get(a.profile_id);
                if (prof?.display_name && prof.display_name !== "Someone") {
                  map.set(a.id, {
                    id: a.id,
                    name: prof.display_name,
                    initials: prof.display_name
                      .split(" ")
                      .map((p: string) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase(),
                    avatarUrl: prof.avatar_url || matchAvatarByName(prof.display_name),
                  });
                }
              }
            }
          }
        }
      } catch {
        // ignore
      }

      // 3. Include demo directory personas so all team members are available
      for (const p of demoDirectory()) {
        if (!map.has(p.id)) {
          map.set(p.id, p);
        }
      }

      return Array.from(map.values());
    },
  });

  return preview ? directoryPeople() : (query.data && query.data.length > 0 ? query.data : directoryPeople());
}

