import type { MutableRefObject } from "react";

import type { Thing } from "@/domain/thing";
import { CourtFocusView } from "./CourtFocusView";
import { CourtLaneStack, type CourtLaneStackHandle } from "./CourtLaneStack";
import type { CourtFocusSelection } from "./court-stack-model";
import type { CourtLaneId } from "./court-view-model";

type CourtWorkspaceProps = {
  selection: CourtFocusSelection | null;
  lanes: Record<CourtLaneId, Thing[]>;
  myActorId: string | null;
  initialPositions: Partial<Record<CourtLaneId, { activeIndex: number; activeThingId: string | null }>>;
  laneRefs: MutableRefObject<Partial<Record<CourtLaneId, CourtLaneStackHandle | null>>>;
  onOpen: (lane: CourtLaneId, thing: Thing, origin: HTMLElement) => void;
  onSelectThing: (thingId: string) => void;
  onClose: () => void;
  onRefresh: () => unknown;
};

export function CourtWorkspace({
  selection,
  lanes,
  myActorId,
  initialPositions,
  laneRefs,
  onOpen,
  onSelectThing,
  onClose,
  onRefresh,
}: CourtWorkspaceProps) {
  if (selection) {
    return (
      <CourtFocusView
        selection={selection}
        lanes={lanes}
        onSelectThing={onSelectThing}
        onOpen={onOpen}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-3 items-start gap-3 overflow-hidden">
      {(["now", "next", "later"] as const).map((lane) => (
        <CourtLaneStack
          key={lane}
          ref={(handle) => {
            laneRefs.current[lane] = handle;
          }}
          lane={lane}
          things={lanes[lane]}
          myActorId={myActorId}
          initialPosition={initialPositions[lane]}
          onOpen={(thing, origin) => onOpen(lane, thing, origin)}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}
