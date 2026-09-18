import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { fetchProfileIdentities, matchAvatarByName } from "@/features/people/directory";

export type ContactPerson = {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  role: string | null;
};

export type ContactRequest = {
  id: string;
  person: ContactPerson;
  createdAt: string;
};

export type Invitation = {
  id: string;
  email: string;
  token: string;
  status: string;
  createdAt: string;
};

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

async function resolvePeople(): Promise<Map<string, ContactPerson>> {
  const identities = await fetchProfileIdentities();
  const { data: profRows } = await supabase.from("profiles").select("id, occupation");
  const roleById = new Map((profRows ?? []).map((r) => [r.id, (r as { occupation: string | null }).occupation]));
  const map = new Map<string, ContactPerson>();
  for (const p of identities) {
    const name = p.display_name?.trim() || "Member";
    map.set(p.id, {
      id: p.id,
      name,
      initials: initialsOf(name),
      avatarUrl: p.avatar_url || matchAvatarByName(name),
      role: roleById.get(p.id)?.trim() || null,
    });
  }
  return map;
}

/** Accepted connections (either direction), resolved to people. */
export function useContacts() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);

  const query = useQuery({
    queryKey: ["hub-contacts", user?.id],
    enabled: Boolean(user) && !preview,
    staleTime: 10_000,
    queryFn: async (): Promise<ContactPerson[]> => {
      const { data, error } = await supabase
        .from("contact_requests")
        .select("requester_profile_id, addressee_profile_id, status")
        .eq("status", "accepted");
      if (error) throw error;
      const people = await resolvePeople();
      const me = user!.id;
      const out: ContactPerson[] = [];
      const seen = new Set<string>();
      for (const r of data ?? []) {
        const otherId = r.requester_profile_id === me ? r.addressee_profile_id : r.requester_profile_id;
        if (seen.has(otherId)) continue;
        seen.add(otherId);
        out.push(people.get(otherId) ?? { id: otherId, name: "Member", initials: "?", avatarUrl: null, role: null });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },
  });

  return { contacts: query.data ?? [], isLoading: query.isLoading };
}

/** Pending connection requests: incoming (to approve) and outgoing (awaiting approval). */
export function useContactRequests() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["hub-contact-requests", user?.id],
    enabled: Boolean(user) && !preview,
    staleTime: 10_000,
    queryFn: async (): Promise<{ incoming: ContactRequest[]; outgoing: ContactRequest[] }> => {
      const { data, error } = await supabase
        .from("contact_requests")
        .select("id, requester_profile_id, addressee_profile_id, status, created_at")
        .eq("status", "pending");
      if (error) throw error;
      const people = await resolvePeople();
      const me = user!.id;
      const incoming: ContactRequest[] = [];
      const outgoing: ContactRequest[] = [];
      const fallback = (id: string): ContactPerson =>
        people.get(id) ?? { id, name: "Member", initials: "?", avatarUrl: null, role: null };
      for (const r of data ?? []) {
        if (r.addressee_profile_id === me) {
          incoming.push({ id: r.id, person: fallback(r.requester_profile_id), createdAt: r.created_at });
        } else if (r.requester_profile_id === me) {
          outgoing.push({ id: r.id, person: fallback(r.addressee_profile_id), createdAt: r.created_at });
        }
      }
      return { incoming, outgoing };
    },
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ["hub-contact-requests", user?.id] });

  return {
    incoming: query.data?.incoming ?? [],
    outgoing: query.data?.outgoing ?? [],
    isLoading: query.isLoading,
    refetch,
  };
}

/** My pending email invitations. */
export function useInvitations() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["hub-invitations", user?.id],
    enabled: Boolean(user) && !preview,
    staleTime: 10_000,
    queryFn: async (): Promise<Invitation[]> => {
      const { data, error } = await supabase
        .from("invitations")
        .select("id, email, token, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        email: r.email,
        token: r.token,
        status: r.status,
        createdAt: r.created_at,
      }));
    },
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ["hub-invitations", user?.id] });

  return { invitations: query.data ?? [], isLoading: query.isLoading, refetch };
}

/** Invalidate all contact-related caches (after mutations). */
export function useRefreshContacts() {
  const qc = useQueryClient();
  const { user } = useSession();
  return () => {
    void qc.invalidateQueries({ queryKey: ["hub-contacts", user?.id] });
    void qc.invalidateQueries({ queryKey: ["hub-contact-requests", user?.id] });
    void qc.invalidateQueries({ queryKey: ["hub-invitations", user?.id] });
  };
}
