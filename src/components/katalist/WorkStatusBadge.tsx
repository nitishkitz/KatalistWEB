import { cn } from "@/lib/utils";
import type { WorkStatus } from "@/domain/thing";

const label: Record<WorkStatus, string> = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

const map: Record<WorkStatus, string> = {
  not_started: "bg-status-not-started-bg text-status-not-started",
  under_progress: "bg-status-progress-bg text-status-progress",
  sorted: "bg-status-sorted-bg text-status-sorted",
  cancelled: "bg-status-cancelled-bg text-status-cancelled",
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
