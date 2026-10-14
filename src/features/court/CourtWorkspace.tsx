import { useMemo, type MutableRefObject } from "react";

import type { Thing } from "@/domain/thing";
import { CourtFocusView } from "./CourtFocusView";
import { CourtLaneStack, type CourtLaneStackHandle } from "./CourtLaneStack";
import type { CourtFocusSelection, FocusViewTabId } from "./court-stack-model";
import type { CourtLaneId } from "./court-view-model";
import { useLists } from "@/features/lists/use-lists";
import type { CardFeedbackState } from "./toss-feedback-model";

type CourtWorkspaceProps = {
  selection: CourtFocusSelection | null;
  lanes: Record<CourtLaneId, Thing[]>;
  theirs?: Thing[];
  myActorId: string | null;
  initialPositions: Partial<Record<CourtLaneId, { activeIndex: number; activeThingId: string | null }>>;
  laneRefs: MutableRefObject<Partial<Record<CourtLaneId, CourtLaneStackHandle | null>>>;
  feedbackByThingId?: Record<string, CardFeedbackState>;
  onOpen: (lane: FocusViewTabId, thing: Thing, origin: HTMLElement) => void;
  onSelectThing: (thingId: string, lane?: FocusViewTabId) => void;
  onClose: () => void;
  onRefresh: (epoch: number) => unknown;
  onViewAll?: (lane: FocusViewTabId) => void;
  heroRect?: { top: number; left: number; width: number; height: number } | null;
};

export function CourtWorkspace({
  selection,
  lanes,
  theirs,
  myActorId,
  initialPositions,
  laneRefs,
  feedbackByThingId,
  heroRect,
  onOpen,
  onSelectThing,
  onClose,
  onRefresh,
  onViewAll,
}: CourtWorkspaceProps) {
  const { lists } = useLists();
  const listCoversById = useMemo(
    () => new Map(lists.map((list) => [list.id, list.coverUrl ?? null] as const)),
    [lists],
  );

  if (selection) {
    return (
      <CourtFocusView
        selection={selection}
        lanes={lanes}
        theirs={theirs}
        onSelectThing={onSelectThing}
        onOpen={onOpen}
        onClose={onClose}
        heroRect={heroRect}
      />
    );
  }

  return (
    <div className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-3 grid-rows-1 items-stretch gap-3">
      {(["now", "next", "later"] as const).map((lane) => (
        <CourtLaneStack
          key={lane}
          ref={(handle) => {
            laneRefs.current[lane] = handle;
          }}
          lane={lane}
          things={lanes[lane]}
          courtThings={lanes}
          listCoversById={listCoversById}
          feedbackByThingId={feedbackByThingId}
          myActorId={myActorId}
          initialPosition={initialPositions[lane]}
          onOpen={(thing, origin) => onOpen(lane, thing, origin)}
          onRefresh={onRefresh}
          onViewAll={onViewAll}
        />
      ))}
    </div>
  );
}
