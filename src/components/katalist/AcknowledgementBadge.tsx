import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Acknowledgement } from "@/domain/thing";

export function AcknowledgementBadge({
  value,
  className,
}: {
  value: Acknowledgement;
  className?: string;
}) {
  if (value === "caught") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-status-caught-bg px-2 py-0.5 text-[11px] font-medium text-status-caught",
          className,
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
        Caught
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-status-waiting-bg px-2 py-0.5 text-[11px] font-medium text-status-waiting",
        className,
      )}
    >
      <Clock className="h-3.5 w-3.5" />
      Waiting for Catch
    </span>
  );
}
