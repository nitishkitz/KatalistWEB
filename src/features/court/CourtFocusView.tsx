import { X } from "lucide-react";
import type { Thing } from "@/domain/thing";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { CourtCompactLane } from "./CourtCompactLane";
import { focusColumns, type CourtFocusSelection } from "./court-stack-model";
import type { CourtLaneId } from "./court-view-model";
import { KatalistIcon } from "./KatalistIcon";
import { ThingNavigator } from "./ThingNavigator";

export type { CourtFocusSelection } from "./court-stack-model";

export type CourtFocusViewProps = {
  selection: CourtFocusSelection;
  lanes: Record<CourtLaneId, Thing[]>;
  onSelectThing: (thingId: string) => void;
  onOpen: (lane: CourtLaneId, thing: Thing, origin: HTMLElement) => void;
  onClose: () => void;
};

export function CourtFocusView({
  selection,
  lanes,
  onSelectThing,
  onOpen,
  onClose,
}: CourtFocusViewProps) {
  const selectedThing =
    lanes[selection.lane].find((thing) => thing.id === selection.thingId) ?? null;
  const columns = focusColumns(selection);
  const gridTemplateColumns = columns
    .map((column) =>
      column.kind === "detail"
        ? "minmax(480px, 1fr)"
        : column.kind === "navigator"
          ? "minmax(220px, 240px)"
          : "minmax(150px, 175px)",
    )
    .join(" ");

  const headerAction = (
    <div className="flex items-center justify-between w-full">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground hover:text-primary outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Back to Court stacks"
      >
        <KatalistIcon name="chevron-right" className="h-3.5 w-3.5 rotate-180 text-foreground" />
        Back to Court stacks
      </button>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/30 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <section
      className="grid min-w-0 items-start gap-3.5 transition-[grid-template-columns,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
      style={{ gridTemplateColumns }}
      aria-label="Focused Court Thing"
    >
      {columns.map((column) => {
        if (column.kind === "navigator") {
          return (
            <ThingNavigator
              key={`navigator-${column.lane}`}
              lane={column.lane}
              things={lanes[column.lane]}
              selectedThingId={selection.thingId}
              onSelect={onSelectThing}
            />
          );
        }
        if (column.kind === "compact") {
          return (
            <CourtCompactLane
              key={`compact-${column.lane}`}
              lane={column.lane}
              things={lanes[column.lane]}
              onOpen={(thing, origin) => onOpen(column.lane, thing, origin)}
            />
          );
        }
        return (
          <div
            key={`detail-${column.thingId}`}
            className="min-w-0 rounded-2xl border border-border/70 bg-white shadow-xs motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-reduce:animate-none"
          >
            {selectedThing ? (
              <ThingDetailContent
                initialThing={selectedThing}
                headerAction={headerAction}
                onAfterTerminalAction={onClose}
                variant="court"
              />
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-muted-foreground">
                {headerAction}
                This Thing is no longer in the selected lane.
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
