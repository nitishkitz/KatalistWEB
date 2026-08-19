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
          "inline-flex items-center gap-1 text-[12px] text-muted-foreground",
          className,
        )}
      >
        <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.4} />
        Caught
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[12px] font-medium text-status-waiting",
        className,
      )}
    >
      <Clock className="h-3.5 w-3.5" />
      Waiting for Catch
    </span>
  );
}
