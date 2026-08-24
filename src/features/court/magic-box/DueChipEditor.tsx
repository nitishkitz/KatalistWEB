import { useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { defaultTimeZone, formatDueLabel, fromZonedLocal, zonedParts } from "./date-time";
import type { MagicBoxDraft } from "./types";

export function DueChipEditor({
  draft,
  onSet,
  onClear,
}: {
  draft: MagicBoxDraft;
  onSet: (dueAt: string, dueHasTime: boolean, label: string) => void;
  onClear: () => void;
}) {
  const timeZone = defaultTimeZone();
  const initial = draft.due.status === "resolved" ? new Date(draft.due.dueAt) : new Date();
  const initialParts = zonedParts(initial, timeZone);
  const [selected, setSelected] = useState<Date>(
    new Date(initialParts.year, initialParts.month - 1, initialParts.day),
  );
  const [time, setTime] = useState(() => {
    if (draft.due.status === "resolved" && draft.due.dueHasTime) {
      return `${String(initialParts.hour).padStart(2, "0")}:${String(initialParts.minute).padStart(2, "0")}`;
    }
    return "";
  });

  const preview = useMemo(() => {
    const hasTime = Boolean(time);
    const [hour, minute] = hasTime ? time.split(":").map(Number) : [9, 0];
    const date = fromZonedLocal(
      selected.getFullYear(),
      selected.getMonth() + 1,
      selected.getDate(),
      hour ?? 9,
      minute ?? 0,
      timeZone,
    );
    const parts = zonedParts(date, timeZone);
    return { dueAt: date.toISOString(), dueHasTime: hasTime, label: formatDueLabel(parts, hasTime) };
  }, [selected, time, timeZone]);

  return (
    <div className="flex flex-col gap-3">
      <Calendar
        mode="single"
        selected={selected}
        onSelect={(day) => {
          if (day) setSelected(day);
        }}
      />
      <label className="flex items-center gap-2 text-[12px]">
        <span className="text-muted-foreground">Time</span>
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClear}
          className="h-8 rounded-md px-2 text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          No due
        </button>
        <button
          type="button"
          onClick={() => onSet(preview.dueAt, preview.dueHasTime, preview.label)}
          className="h-8 rounded-md border border-primary px-3 text-[12px] font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Set {preview.label}
        </button>
      </div>
    </div>
  );
}
