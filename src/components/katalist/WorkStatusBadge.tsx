import { cn } from "@/lib/utils";
import type { WorkStatus } from "@/domain/thing";

const label: Record<WorkStatus, string> = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

const map: Record<WorkStatus, string> = {
  not_started: "bg-status-neutral-bg text-status-neutral",
  under_progress: "bg-status-next-bg text-status-next",
  sorted: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-muted text-muted-foreground",
};

export function WorkStatusBadge({
  value,
  className,
}: {
  value: WorkStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        map[value],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label[value]}
    </span>
  );
}
