import { Calendar, MoreHorizontal, Star } from "lucide-react";
import { format, isToday, isTomorrow, isThisWeek } from "date-fns";
import type { Thing } from "@/domain/thing";
import { ImportanceBadge, PaceBadge } from "./ImportanceBadge";
import { AcknowledgementBadge } from "./AcknowledgementBadge";
import { WorkStatusBadge } from "./WorkStatusBadge";
import { PersonCell } from "./PersonCell";
import { cn } from "@/lib/utils";

function formatDue(thing: Thing): { label: string; urgent: boolean } {
  if (!thing.dueAt) return { label: "—", urgent: false };
  const d = new Date(thing.dueAt);
  if (isToday(d)) {
    return {
      label: thing.dueHasTime ? `Today ${format(d, "h:mm a")}` : "Today",
      urgent: true,
    };
  }
  if (isTomorrow(d)) return { label: "Tomorrow", urgent: true };
  if (isThisWeek(d)) return { label: format(d, "EEE"), urgent: false };
  return { label: format(d, "MMM d"), urgent: false };
}

export function ThingRow({
  thing,
  onSelect,
}: {
  thing: Thing;
  onSelect?: (thing: Thing) => void;
}) {
  const due = formatDue(thing);

  return (
    <tr
      className="group cursor-pointer border-t border-border/80 hover:bg-muted/40"
      onClick={() => onSelect?.(thing)}
    >
      <td className="py-2.5 pr-3 pl-3">
        <div className="flex items-center gap-2.5">
          <Star className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          <span className="truncate text-[13px] font-medium text-foreground">{thing.title}</span>
        </div>
      </td>
      <td className="px-2">
        <ImportanceBadge value={thing.ownerImportance} />
      </td>
      <td className="px-2">
        <PaceBadge value={thing.personalPace} />
      </td>
      <td className="px-2">
        <PersonCell person={thing.assignee} />
      </td>
      <td className="px-2">
        <AcknowledgementBadge value={thing.acknowledgement} />
      </td>
      <td className="px-2">
        <WorkStatusBadge value={thing.workStatus} />
      </td>
      <td className="px-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[12px]",
            due.urgent ? "font-medium text-status-now" : "text-muted-foreground",
          )}
        >
          <Calendar className="h-3.5 w-3.5 opacity-70" />
          {due.label}
        </span>
      </td>
      <td className="px-2 text-[12px] text-muted-foreground">{thing.listName ?? "Standalone"}</td>
      <td className="pr-2 text-right">
        <button
          type="button"
          className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100"
          aria-label="Thing actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

export function ThingTableHeader() {
  return (
    <thead>
      <tr className="text-left text-[11px] font-medium text-muted-foreground">
        <th className="pb-2 pl-3 font-medium">Thing</th>
        <th className="px-2 pb-2 font-medium">Owner Importance</th>
        <th className="px-2 pb-2 font-medium">My Pace</th>
        <th className="px-2 pb-2 font-medium">With</th>
        <th className="px-2 pb-2 font-medium">Ack</th>
        <th className="px-2 pb-2 font-medium">Status</th>
        <th className="px-2 pb-2 font-medium">Due</th>
        <th className="px-2 pb-2 font-medium">From</th>
        <th className="w-8 pb-2" />
      </tr>
    </thead>
  );
}
