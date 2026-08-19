import type { Thing } from "@/domain/thing";
import { ImportanceBadge, PaceBadge } from "@/components/katalist/ImportanceBadge";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonCell } from "@/components/katalist/PersonCell";

export function ThingCard({ thing, onSelect }: { thing: Thing; onSelect?: (t: Thing) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(thing)}
      className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left md:hidden"
    >
      <p className="text-[13px] font-medium text-foreground">{thing.title}</p>
      <div className="flex flex-wrap gap-1.5">
        <ImportanceBadge value={thing.ownerImportance} />
        <PaceBadge value={thing.personalPace} />
        <AcknowledgementBadge value={thing.acknowledgement} />
        <WorkStatusBadge value={thing.workStatus} />
      </div>
      <div className="flex items-center justify-between">
        <PersonCell person={thing.assignee} />
        <span className="text-[11px] text-muted-foreground">{thing.listName ?? "Standalone"}</span>
      </div>
    </button>
  );
}
