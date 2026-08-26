import { useMemo } from "react";

import type { Thing } from "@/domain/thing";
import { cn } from "@/lib/utils";
import { courtLaneContent } from "./CourtLaneStack";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { KatalistIcon } from "./KatalistIcon";

type ThingNavigatorProps = {
  lane: CourtLaneId;
  things: Thing[];
  selectedThingId: string;
  onSelect: (thingId: string) => void;
};

const laneSelectionTone: Record<CourtLaneId, string> = {
  now: "border-status-now/35 bg-status-now/5",
  next: "border-status-next/35 bg-status-next/5",
  later: "border-status-later/35 bg-status-later/5",
};

const workLabel: Record<Thing["workStatus"], string> = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

export function ThingNavigator({ lane, things, selectedThingId, onSelect }: ThingNavigatorProps) {
  const content = courtLaneContent[lane];
  const selectedTitle = useMemo(
    () => things.find((thing) => thing.id === selectedThingId)?.title ?? "",
    [selectedThingId, things],
  );

  return (
    <nav
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-white"
      aria-label={`${content.label} Things`}
    >
      <div className={cn("border-b border-border/70 px-3 py-3", content.headerTone)}>
        <div className="flex items-center gap-2">
          <KatalistIcon name={content.icon} className={cn("h-4 w-4", content.tone)} />
          <h2 className={cn("text-[11px] font-semibold tracking-[0.08em]", content.tone)}>
            {content.label}
          </h2>
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
            {things.length}
          </span>
        </div>
        <p className="mt-1 truncate text-[10px] text-muted-foreground">{content.descriptor}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <div className="space-y-1">
          {things.map((thing) => {
            const selected = selectedThingId === thing.id;
            const due = formatCourtDue(thing);
            return (
              <button
                key={thing.id}
                type="button"
                aria-current={selected}
                onClick={() => onSelect(thing.id)}
                className={cn(
                  "w-full rounded-lg border border-transparent px-2.5 py-2 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? laneSelectionTone[lane] : "hover:border-border hover:bg-muted/30",
                )}
              >
                <span className="block line-clamp-2 text-[11.5px] font-medium leading-4 text-foreground">
                  {thing.title}
                </span>
                <span className="mt-1 flex items-center gap-1 text-[9.5px] text-muted-foreground">
                  <span className="truncate">{workLabel[thing.workStatus]}</span>
                  {due ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className={cn("truncate", due.urgent && "text-status-now")}>
                        {due.label}
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedTitle ? `Selected ${selectedTitle}.` : ""}
      </div>
    </nav>
  );
}
