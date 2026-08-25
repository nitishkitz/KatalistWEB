import type { Thing } from "@/domain/thing";
import { ImportanceBadge, PaceBadge } from "@/components/katalist/ImportanceBadge";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonCell } from "@/components/katalist/PersonCell";
import { CatchActionButton } from "@/features/things/CatchActionButton";

export function ThingCard({ thing, onSelect }: { thing: Thing; onSelect?: (t: Thing) => void }) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left md:hidden">
      <button
        type="button"
        onClick={() => onSelect?.(thing)}
        className="text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="text-[13px] font-medium text-foreground">{thing.title}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ImportanceBadge value={thing.ownerImportance} />
          <PaceBadge value={thing.personalPace} />
          <AcknowledgementBadge value={thing.acknowledgement} />
          <WorkStatusBadge value={thing.workStatus} />
        </div>
      </button>
      <div className="flex items-center justify-between gap-2">
        <PersonCell person={thing.assignee} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{thing.listName ?? "Standalone"}</span>
          <CatchActionButton
            thing={thing}
            className="inline-flex h-7 items-center rounded-md border border-primary bg-white px-2 text-[11px] font-medium text-primary"
          >
            Catch
          </CatchActionButton>
        </div>
      </div>
    </div>
  );
}
