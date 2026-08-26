import { useEffect, useRef } from "react";

import type { Thing } from "@/domain/thing";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { cn } from "@/lib/utils";
import { courtLaneContent } from "./CourtLaneStack";
import { focusCourtWorkspaceOnEntry } from "./court-stack-model";
import type { CourtLaneId } from "./court-view-model";
import { KatalistIcon } from "./KatalistIcon";
import { ThingNavigator } from "./ThingNavigator";

export type CourtFocusSelection = {
  lane: CourtLaneId;
  thingId: string;
};

export type CourtFocusViewProps = {
  selection: CourtFocusSelection;
  lanes: Record<CourtLaneId, Thing[]>;
  onSelectThing: (thingId: string) => void;
  onClose: () => void;
};

const laneOrder: CourtLaneId[] = ["now", "next", "later"];

export function CourtFocusView({ selection, lanes, onSelectThing, onClose }: CourtFocusViewProps) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const selectedThing =
    lanes[selection.lane].find((thing) => thing.id === selection.thingId) ?? null;
  const rails = laneOrder.filter((lane) => lane !== selection.lane);

  useEffect(() => {
    focusCourtWorkspaceOnEntry(workspaceRef.current);
  }, []);

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-violet-100 bg-violet-50/70 px-3 text-[11px] font-semibold text-violet-700 outline-none transition-all hover:-translate-y-0.5 hover:bg-violet-100/70 focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Back to Court stacks"
    >
      <KatalistIcon name="chevron-right" className="h-3.5 w-3.5 rotate-180" />
      Back
    </button>
  );

  return (
    <section
      ref={workspaceRef}
      tabIndex={-1}
      className="grid min-h-[620px] min-w-0 grid-cols-[minmax(210px,252px)_minmax(0,1fr)_repeat(2,minmax(54px,62px))] items-stretch gap-3 overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_45%_0%,rgba(109,94,252,0.08),transparent_42%)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Focused Court Thing"
    >
      <ThingNavigator
        lane={selection.lane}
        things={lanes[selection.lane]}
        selectedThingId={selection.thingId}
        onSelect={onSelectThing}
      />

      <div className="min-w-0 overflow-hidden rounded-[20px] border border-violet-100/80 bg-white shadow-[0_24px_60px_-40px_rgba(76,29,149,0.42)]">
        <div
          key={selection.thingId}
          className="h-full min-h-[620px] max-h-[calc(100vh-11rem)] min-w-0 overflow-y-auto overscroll-contain transition-[opacity,transform] duration-[220ms] ease-out motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-reduce:animate-none motion-reduce:transition-none"
        >
          {selectedThing ? (
            <ThingDetailContent initialThing={selectedThing} headerAction={closeButton} />
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-muted-foreground">
              {closeButton}
              This Thing is no longer in the selected lane.
            </div>
          )}
        </div>
      </div>

      {rails.map((lane) => (
        <aside
          key={lane}
          className={cn(
            "flex min-w-0 flex-col items-center justify-between overflow-hidden rounded-[20px] border border-white/80 px-2 py-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.4)]",
            courtLaneContent[lane].headerTone,
          )}
          aria-label={`${courtLaneContent[lane].label} lane, ${lanes[lane].length} Things`}
        >
          <KatalistIcon
            name={courtLaneContent[lane].icon}
            className={cn("h-4 w-4 shrink-0", courtLaneContent[lane].tone)}
          />
          <span
            className={cn(
              "my-2 whitespace-nowrap text-[10px] font-semibold tracking-[0.08em] [writing-mode:vertical-rl]",
              courtLaneContent[lane].tone,
            )}
          >
            {courtLaneContent[lane].label}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {lanes[lane].length}
          </span>
        </aside>
      ))}
    </section>
  );
}
