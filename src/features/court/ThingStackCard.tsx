import { forwardRef, type MouseEvent, type MutableRefObject } from "react";

import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import { useAvatarUrl } from "@/features/people/directory";
import { cn } from "@/lib/utils";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { KatalistIcon } from "./KatalistIcon";

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

const laneTone: Record<CourtLaneId, { text: string }> = {
  now: { text: "text-status-now" },
  next: { text: "text-status-next" },
  later: { text: "text-status-later" },
};

const laneTagTone: Record<CourtLaneId, { bg: string; text: string; border: string; icon: string }> =
  {
    now: { bg: "bg-red-50", text: "text-red-600", border: "border-red-100", icon: "text-red-500" },
    next: {
      bg: "bg-blue-50",
      text: "text-blue-600",
      border: "border-blue-100",
      icon: "text-blue-500",
    },
    later: {
      bg: "bg-purple-50",
      text: "text-purple-600",
      border: "border-purple-100",
      icon: "text-purple-500",
    },
  };

const workLabel: Record<Thing["workStatus"], string> = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

export const ThingStackCard = forwardRef<HTMLButtonElement, ThingStackCardProps>(
  function ThingStackCard(
    { thing, lane, myActorId, pendingAction, suppressClickRef, onOpen, onAction },
    ref,
  ) {
    const due = formatCourtDue(thing);
    const dueLabel = thing.dueAt ? due.label : null;
    const capabilities = getThingCapabilities(thing, myActorId);
    const assigneeAvatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);
    const disabled = pendingAction !== null;

    const run = (event: MouseEvent<HTMLButtonElement>, action: CourtStackAction) => {
      event.stopPropagation();
      onAction(action);
    };

    return (
      <article className="relative min-h-[190px] overflow-hidden rounded-xl border border-border bg-white shadow-sm">
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
            {dueLabel ? (
              <span
                className={cn(
                  "shrink-0 text-[11px] font-medium italic",
                  due.urgent ? "text-status-now" : laneTone[lane].text,
                )}
              >
                Due {dueLabel}
              </span>
            ) : null}
          </span>

          {/* Title */}
          <span className="mt-3 block line-clamp-2 text-[15px] font-bold leading-[1.35] text-foreground">
            {thing.title}
          </span>

          <span className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/65 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <KatalistIcon
                name={
                  thing.workStatus === "under_progress"
                    ? "under-progress"
                    : thing.workStatus === "sorted"
                      ? "sorted"
                      : "not-started"
                }
                className="h-3 w-3"
              />
              {workLabel[thing.workStatus]}
            </span>
            {thing.listId && thing.listName ? (
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

        <div className="grid min-h-[48px] grid-cols-3 divide-x divide-border/60 border-t border-border/70">
          <button
            type="button"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(thing, event.currentTarget);
            }}
            className="inline-flex h-12 items-center justify-center gap-1.5 text-[10.5px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
          >
            <KatalistIcon name="list" className="h-3.5 w-3.5" />
            Details
          </button>
          {capabilities.canCatch ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "catch")}
              className="inline-flex h-12 items-center justify-center gap-1.5 text-[10.5px] font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KatalistIcon name="catch" className="h-4 w-4" />
              Catch
            </button>
          ) : capabilities.canSetPace && lane !== "later" ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "later")}
              className="inline-flex h-12 items-center justify-center gap-1.5 text-[10.5px] font-semibold text-status-later outline-none hover:text-status-later/80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KatalistIcon name="snooze" className="h-4 w-4" />
              Later
            </button>
          ) : (
            <span />
          )}
          {capabilities.canSort ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "sort")}
              className="inline-flex h-12 items-center justify-center gap-1.5 text-[10.5px] font-semibold text-emerald-600 outline-none hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KatalistIcon name="sorted" className="h-4 w-4" />
              Sorted
            </button>
          ) : (
            <span />
          )}
        </div>
      </article>
    );
  },
);
