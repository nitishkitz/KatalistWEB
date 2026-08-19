import { cn } from "@/lib/utils";
import type { Importance, Pace } from "@/domain/thing";

const map: Record<Importance, string> = {
  now: "bg-status-now-bg text-status-now",
  next: "bg-status-next-bg text-status-next",
  later: "bg-status-later-bg text-status-later",
};

export function ImportanceBadge({
  value,
  className,
}: {
  value: Importance;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide",
        map[value],
        className,
      )}
    >
      {value}
    </span>
  );
}

export function PaceBadge({
  value,
  className,
}: {
  value: Pace | null;
  className?: string;
}) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  return <ImportanceBadge value={value} className={className} />;
}
