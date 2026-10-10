import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { authedFetch } from "@/lib/authed-fetch";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { loadGoogleContactsSdk, requestGoogleContactsCode, googleContactsClientId } from "./google-contacts";
import type { ContactPerson } from "@/features/hub/use-contacts";

type GoogleContactsState = { configured: boolean; people: ContactPerson[]; syncedAt: string | null; contactCount: number; matchedCount: number };

export function useGoogleContacts(open: boolean) {
  const { user, session } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  const clientId = googleContactsClientId();
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef(0);
  const state = useQuery({
    queryKey: ["google-contacts", user?.id], enabled: open && Boolean(user) && !preview,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<GoogleContactsState> => {
      const response = await authedFetch("/api/contacts/google", { signal });
      if (!response.ok) throw new Error("Contacts are unavailable. Try again later.");
      return response.json();
    },
  });
  useEffect(() => {
    let active = true;
    if (open && clientId && !preview) {
      void loadGoogleContactsSdk().then(() => { if (active) setReady(true); })
        .catch(error => { if (active) setSyncError(error.message); });
    }
    return () => { active = false; };
  }, [open, clientId, preview]);
  useEffect(() => {
    setSyncError(null); setSyncing(false); attempt.current++;
    return () => { attempt.current++; controller.current?.abort(); };
  }, [user?.id, preview]);

  const sync = () => {
    if (syncing || !clientId || !ready || !user || !session?.access_token || preview || !state.data?.configured) return;
    const accessToken = session.access_token;
    const epoch = getIdentityEpoch(qc).epoch, myAttempt = ++attempt.current;
    const current = () => isEpochCurrent(qc, epoch) && attempt.current === myAttempt;
    setSyncing(true); setSyncError(null);
    const fail = (message: string) => { if (current()) { setSyncError(message); setSyncing(false); } };
    requestGoogleContactsCode(clientId, code => {
      if (!current()) return;
      controller.current = new AbortController();
      void (async () => {
        try {
          const response = await fetch("/api/contacts/google-sync", { method: "POST",
            headers: { "Content-Type": "application/json", "X-Requested-With": "KatalistGoogleContacts", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ code }), signal: controller.current!.signal });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || body.statusMessage || "Google Contacts sync failed. Try again.");
          }
          if (!current()) return;
          await qc.invalidateQueries({ queryKey: ["google-contacts", user.id] });
        } catch (error) { if (current()) fail(error instanceof Error ? error.message : "Contacts sync failed."); }
        finally { if (current()) setSyncing(false); }
      })();
    }, fail);
  };
  return { people: state.data?.people ?? [], syncedAt: state.data?.syncedAt ?? null,
    contactCount: state.data?.contactCount ?? 0, matchedCount: state.data?.matchedCount ?? 0,
    isLoading: state.isLoading, error: syncError ?? (state.error instanceof Error ? state.error.message : null),
    configured: Boolean(clientId && state.data?.configured), ready, syncing, sync,
    retry: () => { setSyncError(null); void state.refetch();
      if (clientId && !preview) void loadGoogleContactsSdk().then(() => setReady(true)).catch(error => setSyncError(error.message)); },
  };
}
