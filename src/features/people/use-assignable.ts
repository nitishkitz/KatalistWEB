import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLists } from "@/features/lists/use-lists";
import { mergeAssignablePeople, memberToPerson } from "./merge-people";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { directoryPeople } from "@/features/things/local-state";
import { matchAvatarByName } from "./directory";
import type { Person } from "@/domain/thing";

const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

type IdentityRow = { profile_id: string; actor_id: string | null; display_name: string; avatar_url: string | null; connected: boolean };

/** You plus the people you are connected with — the only people a Thing can
 *  be sent to (the database refuses anyone else). Never demo personas. */
export function assignableFromIdentities(rows: IdentityRow[], myProfileId: string): Person[] {
  return rows
    .filter((r) => r.actor_id && (r.profile_id === myProfileId || r.connected))
    .map((r) => ({
      id: r.actor_id!,
      actorId: r.actor_id!,
      profileId: r.profile_id,
      name: r.display_name,
      initials: initialsOf(r.display_name),
      avatarUrl: r.avatar_url || matchAvatarByName(r.display_name),
    }));
}

/**
 * Everyone who can be assigned a Thing. Pass `listId` to also include that
 * List's members (flagged `listMember`) so they can be @mentioned.
 */
export function useAssignablePeople(listId?: string | null) {
  const { session, user } = useSession();
  const { lists } = useLists();
  const members = listId ? lists.find((l) => l.id === listId)?.members : undefined;
  const preview = isPreviewSession(session);

  const query = useQuery({
    queryKey: ["assignable-people", user?.id],
    enabled: Boolean(user) && !preview,
    staleTime: 30_000,
    queryFn: async (): Promise<Person[]> => {
      const { data, error } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>)(
        "list_visible_identities",
      );
      if (error) throw new Error(error.message);
      return assignableFromIdentities((data ?? []) as IdentityRow[], user!.id);
    },
  });

  const base = useMemo(() => (preview ? directoryPeople() : (query.data ?? [])), [preview, query.data]);
  return useMemo(
    () => (members?.length ? mergeAssignablePeople(base, members.map(memberToPerson)) : base),
    [base, members],
  );
}
