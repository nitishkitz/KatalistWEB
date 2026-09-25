import { useNavigate } from "@tanstack/react-router";
import { PhoneCall, X } from "lucide-react";
import { requestAutojoin } from "@/features/calls/autojoin-signal";
import { useUpcomingMeetingReminder } from "./use-upcoming-meetings-reminder";

function formatCountdown(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes <= 0) return "now";
  if (minutes === 1) return "1 minute";
  return `${minutes} minutes`;
}

/** Global "starting soon" call reminder — same fixed-card placement as
 *  GhostCard, mounted alongside it in AppShell. Join reuses the existing
 *  auto-join handoff (ConversationWorkspace / lists.$listId.tsx) — same
 *  three redundant signals CallRingProvider's incoming-ring "Join" already
 *  uses (in-memory requestAutojoin, a sessionStorage flag, and ?call=1 in
 *  the URL), not just the URL param alone. Relying on the URL param by
 *  itself was the bug: on a fresh cross-route navigation (e.g. from Court),
 *  the destination page can mount before its identity/session hooks are
 *  ready, and by the time its own effect re-runs, the earlier symptom was
 *  the call window never appearing at all. */
export function MeetingReminderCard() {
  const navigate = useNavigate();
  const { reminder, inProgress, dismiss } = useUpcomingMeetingReminder();
  if (!reminder) return null;

  const msUntilStart = new Date(reminder.startsAt).getTime() - Date.now();
  const to = reminder.listKind === "list" ? "/lists/$listId" : "/team/$conversationId";
  const params = reminder.listKind === "list" ? { listId: reminder.listId } : { conversationId: reminder.listId };

  const join = () => {
    requestAutojoin(reminder.listId);
    try {
      sessionStorage.setItem(`katalist.autojoin.${reminder.listId}`, "1");
    } catch {
      // sessionStorage may be unavailable; the other two signals still cover it
    }
    dismiss(reminder.id);
    void navigate({ to, params, search: { call: "1" } });
  };

  return (
    // Stacked above GhostCard's position (bottom-20/bottom-6) so the two
    // never overlap on the rare occasion both are visible at once.
    <aside className="pointer-events-auto fixed bottom-40 right-4 z-50 w-[320px] rounded-xl border border-border bg-card p-3 katalist-elevation-card md:bottom-24">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground">
          <PhoneCall className="h-3 w-3 text-[#12a15f]" />
          {inProgress ? "MEETING IN PROGRESS" : `STARTING IN ${formatCountdown(msUntilStart).toUpperCase()}`}
        </p>
        <button
          type="button"
          onClick={() => dismiss(reminder.id)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 text-[13px] font-medium text-foreground">{reminder.title}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{reminder.listName}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-md bg-primary px-2.5 py-1 text-[12px] text-primary-foreground"
          onClick={join}
        >
          Join
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 text-[12px]"
          onClick={() => dismiss(reminder.id)}
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
