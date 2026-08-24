import { cn } from "@/lib/utils";
import type { Importance } from "@/domain/thing";

const OPTIONS: Importance[] = ["now", "next", "later"];

export function ImportanceChipEditor({
  value,
  onSet,
}: {
  value: Importance;
  onSet: (importance: Importance) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Owner importance">
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onSet(option)}
          className={cn(
            "h-8 rounded-md border px-3 text-[11px] font-semibold uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
