import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, MoreHorizontal, X } from "lucide-react";
import meetingCoey from "@/assets/notifications/meeting-coey.png";
import { Logo } from "@/components/katalist/Logo";
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
    <aside
      className="pointer-events-auto fixed bottom-40 right-4 z-50 w-[min(303px,calc(100vw-2rem))] overflow-hidden rounded-[10px] border border-[#eeedf3] bg-white p-2.5 text-[#111] shadow-[0_12px_34px_rgba(25,18,52,0.18)] md:bottom-24"
      role="status"
      aria-live="polite"
    >
      <div className="relative z-10 flex h-6 items-center justify-between">
        <Logo markClassName="h-[18px] w-[18px] rounded-[3px] p-[3px]" textClassName="text-[12px]" className="gap-1.5" />
        <div className="flex items-center gap-1 text-[#51466c]">
          <button type="button" className="rounded p-1 hover:bg-[#f4f1fa]" aria-label="More meeting options" title="More options">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => dismiss(reminder.id)}
            className="rounded p-1 hover:bg-[#f4f1fa]"
            aria-label="Dismiss meeting reminder"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-[124px] flex-col justify-center pb-2 pt-1">
        <img
          src={meetingCoey}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -right-1 bottom-0 h-[128px] w-[132px] object-contain"
        />
        <div className="relative z-[1] max-w-[190px]">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold leading-4 text-[#7669fb]">
            <span className="flex h-[27px] w-[27px] items-center justify-center rounded-[4px] bg-[#f4f2ff]">
              <CalendarDays className="h-4 w-4" />
            </span>
            <span>{inProgress ? "MEETING IN PROGRESS" : `STARTING IN ${formatCountdown(msUntilStart).toUpperCase()}`}</span>
          </p>
          <p className="mt-1.5 truncate text-[13px] font-semibold leading-[18px] text-black">{reminder.title}</p>
          <p className="mt-0.5 truncate text-[10px] leading-4 text-[#292929]">{reminder.listName}</p>
          <p className="mt-0.5 truncate text-[8px] leading-3 text-black/60">
            {inProgress ? "Meeting is in progress" : "Your meeting is coming up"}
          </p>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="inline-flex h-[31px] items-center justify-center gap-1.5 rounded-[4px] bg-[#7669fb] px-2 text-[10px] font-medium text-white transition hover:bg-[#6658ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7669fb] focus-visible:ring-offset-2"
          onClick={join}
        >
          Join now
        </button>
        <button
          type="button"
          className="inline-flex h-[31px] items-center justify-center rounded-[4px] border border-[#ebecf7] bg-[#f9f9fe] px-2 text-[10px] font-medium text-[#7669fb] transition hover:bg-[#f1efff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7669fb] focus-visible:ring-offset-2"
          onClick={() => dismiss(reminder.id)}
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
