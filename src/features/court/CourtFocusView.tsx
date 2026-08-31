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
        ? "minmax(500px,1fr)"
        : column.kind === "navigator"
          ? "minmax(220px,250px)"
          : "minmax(150px,180px)",
    )
    .join(" ");
  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-primary/15 bg-primary/5 px-2.5 text-[10.5px] font-medium text-primary outline-none transition-colors hover:border-primary/35 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Back to Court stacks"
    >
      <KatalistIcon name="chevron-right" className="h-3.5 w-3.5 rotate-180" />
      Back to Court stacks
    </button>
  );

  return (
    <section
      className="grid min-w-0 items-start gap-2 transition-[grid-template-columns,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
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
                headerAction={closeButton}
                onAfterTerminalAction={onClose}
                variant="court"
              />
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-muted-foreground">
                {closeButton}
                This Thing is no longer in the selected lane.
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
