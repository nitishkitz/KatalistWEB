import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { withReadDeadline } from "@/lib/read-request";

const WITHIN_HOURS = 24;
/** Surface the reminder once a meeting is within this many minutes of
 *  starting, and keep it up for as long as the meeting is still running. */
const URGENT_WINDOW_MS = 5 * 60 * 1000;

export type UpcomingMeeting = {
  id: string;
  listId: string;
  listKind: "list" | "dm" | "group";
  listName: string;
  title: string;
  startsAt: string;
  endsAt: string;
};

async function fetchUpcomingMeetings(querySignal?: AbortSignal): Promise<UpcomingMeeting[]> {
  const { data, error } = await withReadDeadline(querySignal, async (signal) =>
    supabase.rpc("get_my_upcoming_meetings", { p_within_hours: WITHIN_HOURS }).abortSignal(signal),
  );
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    listId: r.list_id,
    listKind: r.list_kind === "dm" || r.list_kind === "group" ? r.list_kind : "list",
    listName: r.list_name,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
  }));
}

/**
 * Global "starting soon" call reminder (AppShell), across every List/Team-Hub
 * conversation the user belongs to — not scoped to whichever one is open.
 *
 * In-app only: the Vercel plan backing this project supports daily cron only
 * (see the meetings implementation plan), so a push notification while the
 * tab is closed isn't buildable here. This reminder only fires while the app
 * is open, computed client-side against `starts_at`/`ends_at` — no cron.
 *
 * Disabled in preview/demo sessions, same convention as the doorman "ghost"
 * card (see use-doorman.ts) — a global popup nudge isn't part of the demo
 * fixture experience.
 */
export function useUpcomingMeetingReminder() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["upcoming-meetings"],
    queryFn: ({ signal }) => fetchUpcomingMeetings(signal),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const meetings = useMemo(() => query.data ?? [], [query.data]);

  const reminder = useMemo(() => {
    const now = Date.now();
    const urgent = meetings
      .filter((m) => !dismissed.has(m.id))
      .filter((m) => new Date(m.endsAt).getTime() > now)
      .filter((m) => new Date(m.startsAt).getTime() - now <= URGENT_WINDOW_MS)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return urgent[0] ?? null;
  }, [meetings, dismissed]);

  const msUntilStart = reminder ? new Date(reminder.startsAt).getTime() - Date.now() : null;
  const inProgress = msUntilStart !== null && msUntilStart <= 0;

  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));

  return { reminder, inProgress, dismiss };
}
