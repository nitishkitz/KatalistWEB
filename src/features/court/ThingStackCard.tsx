import { forwardRef, type MouseEvent, type MutableRefObject } from "react";

import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import { useAvatarUrl } from "@/features/people/directory";
import { cn } from "@/lib/utils";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";

export type CourtStackAction = "catch" | "later" | "sort";

type ThingStackCardProps = {
  thing: Thing;
  lane: CourtLaneId;
  myActorId: string | null;
  pendingAction: CourtStackAction | null;
  suppressClickRef: MutableRefObject<boolean>;
  onOpen: (thing: Thing, origin: HTMLElement) => void;
  onAction: (action: CourtStackAction) => void;
};

const laneTone: Record<CourtLaneId, { border: string; text: string }> = {
  now: { border: "border-l-status-now", text: "text-status-now" },
  next: { border: "border-l-status-next", text: "text-status-next" },
  later: { border: "border-l-status-later", text: "text-status-later" },
};

const laneTagTone: Record<CourtLaneId, { bg: string; text: string; border: string; icon: string }> = {
  now: { bg: "bg-red-50", text: "text-red-600", border: "border-red-100", icon: "text-red-500" },
  next: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-100", icon: "text-blue-500" },
  later: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-100", icon: "text-purple-500" },
};

const workLabel: Record<Thing["workStatus"], string> = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

const workIcon: Record<Thing["workStatus"], KatalistIconName> = {
  not_started: "not-started",
  under_progress: "under-progress",
  sorted: "sorted",
  cancelled: "stale",
};

const importanceLabel = { now: "NOW", next: "NEXT", later: "LATER" } as const;

export const ThingStackCard = forwardRef<HTMLButtonElement, ThingStackCardProps>(
  function ThingStackCard(
    { thing, lane, myActorId, pendingAction, suppressClickRef, onOpen, onAction },
    ref,
  ) {
    const due = formatCourtDue(thing);
    const capabilities = getThingCapabilities(thing, myActorId);
    const assigneeAvatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);
    const disabled = pendingAction !== null;

    const run = (event: MouseEvent<HTMLButtonElement>, action: CourtStackAction) => {
      event.stopPropagation();
      onAction(action);
    };

    return (
      <article
        className="relative min-h-[190px] overflow-hidden rounded-xl border border-border bg-white shadow-sm"
      >
        <button
          ref={ref}
          type="button"
          onClick={(event) => {
            if (!suppressClickRef.current) onOpen(thing, event.currentTarget);
          }}
          className="block w-full px-4 pb-3 pt-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Open ${thing.title}`}
        >
          {/* Top row: avatar + name | due date */}
          <span className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <PersonAvatar
                name={thing.assignee.name}
                initials={thing.assignee.initials}
                src={assigneeAvatar}
                size={28}
              />
              <span className="max-w-28 truncate text-[11px] font-medium text-muted-foreground">
                @{thing.assignee.name.split(" ")[0]}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-[11px] font-medium italic",
                due?.urgent ? "text-status-now" : laneTone[lane].text,
              )}
            >
              {due ? `Due ${due.label}` : ""}
            </span>
          </span>

          {/* Title */}
          <span className="mt-3 block line-clamp-2 text-[15px] font-bold leading-[1.35] text-foreground">
            {thing.title}
          </span>

          {/* Description / subtitle */}
          <span className="mt-1.5 block text-[11.5px] leading-[1.4] text-muted-foreground line-clamp-2">
            {thing.acknowledgement === "waiting_for_catch"
              ? "Needs to be caught before proceeding."
              : thing.workStatus === "under_progress"
                ? "Work is in progress on this item."
                : "Go through the brief and share your initial feedback."}
          </span>

          {/* Tag pill */}
          <span className="mt-2.5 flex items-center gap-2">
            {thing.listName ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-semibold",
                  laneTagTone[lane].bg,
                  laneTagTone[lane].text,
                  laneTagTone[lane].border,
                )}
              >
                <KatalistIcon name="list" className={cn("h-3 w-3", laneTagTone[lane].icon)} />
                {thing.listName}
              </span>
            ) : null}
            {thing.starred ? (
              <span className="text-status-waiting" title="Starred">
                <KatalistIcon name="favourite-star" className="h-3.5 w-3.5 fill-current" />
                <span className="sr-only">Starred</span>
              </span>
            ) : null}
          </span>
        </button>

        <div className="flex min-h-[48px] items-center justify-between gap-2 border-t border-border/70 px-4">
          {capabilities.canCatch ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "catch")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[11px] font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KatalistIcon name="catch" className="h-4 w-4" />
              Caught It
            </button>
          ) : (
            <>
              {capabilities.canSetPace && lane !== "later" ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) => run(event, "later")}
                  className="inline-flex h-8 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <KatalistIcon name="snooze" className="h-4 w-4 text-muted-foreground" />
                  Snooze
                </button>
              ) : (
                <span />
              )}
              {capabilities.canSort ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) => run(event, "sort")}
                  className="inline-flex h-8 items-center gap-1.5 text-[11px] font-semibold text-emerald-600 outline-none hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <KatalistIcon name="sorted" className="h-4 w-4" />
                  Sorted
                </button>
              ) : null}
            </>
          )}
        </div>
      </article>
    );
  },
);
