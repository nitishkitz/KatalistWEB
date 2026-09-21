import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { domainErrorMessage } from "@/lib/domain-error";
import { useListMeetings } from "./use-list-meetings";

const DURATIONS = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 45, label: "45 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 90, label: "1.5 hours" },
] as const;

/** "Schedule Meeting" dialog for a List's Quick Actions (Figma parity). */
export function ScheduleMeetingDialog({
  listId,
  open,
  onOpenChange,
}: {
  listId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { schedule } = useListMeetings(listId);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [durationMin, setDurationMin] = useState<number>(30);

  const reset = () => {
    setTitle("");
    setStartsAt("");
    setDurationMin(30);
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Give the meeting a title.");
      return;
    }
    if (!startsAt) {
      toast.error("Pick a start time.");
      return;
    }
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) {
      toast.error("That start time isn't valid.");
      return;
    }
    const end = new Date(start.getTime() + durationMin * 60_000);
    try {
      await schedule.mutateAsync({ title: trimmed, startsAt: start, endsAt: end });
      toast.success("Meeting scheduled.");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(domainErrorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Schedule Meeting</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <label htmlFor="meeting-title" className="text-[11.5px] font-medium text-[#6a769c]">
              Title
            </label>
            <input
              id="meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Design Review"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-[13px] outline-none focus:border-primary"
            />
          </div>
          <div>
            <label htmlFor="meeting-starts" className="text-[11.5px] font-medium text-[#6a769c]">
              Starts
            </label>
            <input
              id="meeting-starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-[13px] outline-none focus:border-primary"
            />
          </div>
          <div>
            <label htmlFor="meeting-duration" className="text-[11.5px] font-medium text-[#6a769c]">
              Duration
            </label>
            <select
              id="meeting-duration"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-[13px] outline-none focus:border-primary"
            >
              {DURATIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[13px] font-medium text-foreground hover:bg-muted cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={schedule.isPending}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center rounded-lg bg-[#975ee2] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60 cursor-pointer"
          >
            {schedule.isPending ? "Scheduling…" : "Schedule"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
