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
        className={cn(
          "relative min-h-[190px] overflow-hidden rounded-xl border border-border bg-white shadow-sm",
          "border-l-2",
          laneTone[lane].border,
        )}
      >
        <button
          ref={ref}
          type="button"
          onClick={(event) => {
            if (!suppressClickRef.current) onOpen(thing, event.currentTarget);
          }}
          className="block min-h-[136px] w-full px-4 pb-3 pt-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Open ${thing.title}`}
        >
          <span className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block line-clamp-2 text-[14px] font-semibold leading-5 text-foreground">
                {thing.title}
              </span>
              <span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[10.5px] text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <PersonAvatar
                    name={thing.assignee.name}
                    initials={thing.assignee.initials}
                    src={assigneeAvatar}
                    size={20}
                  />
                  <span className="max-w-28 truncate font-medium text-foreground">
                    {thing.assignee.name}
                  </span>
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    thing.acknowledgement === "waiting_for_catch"
                      ? "text-status-waiting"
                      : "text-status-caught",
                  )}
                >
                  <KatalistIcon
                    name={thing.acknowledgement === "waiting_for_catch" ? "waiting" : "catch"}
                    className="h-3.5 w-3.5"
                  />
                  {thing.acknowledgement === "waiting_for_catch" ? "Waiting for Catch" : "Caught"}
                </span>
                <span className="inline-flex items-center gap-1 text-foreground">
                  <KatalistIcon name={workIcon[thing.workStatus]} className="h-3.5 w-3.5" />
                  {workLabel[thing.workStatus]}
                </span>
              </span>
              <span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    due.urgent && "font-medium text-status-now",
                  )}
                >
                  <KatalistIcon name="calendar" className="h-3.5 w-3.5" />
                  {due.label}
                </span>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <KatalistIcon name="list" className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-32 truncate">{thing.listName ?? "Standalone"}</span>
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn("text-[9px] font-semibold", laneTone[thing.ownerImportance].text)}
              >
                {importanceLabel[thing.ownerImportance]}
                <span className="sr-only"> owner importance</span>
              </span>
              {thing.starred ? (
                <span className="text-status-waiting" title="Starred">
                  <KatalistIcon name="favourite-star" className="h-3.5 w-3.5 fill-current" />
                  <span className="sr-only">Starred</span>
                </span>
              ) : null}
            </span>
          </span>
        </button>

        <div className="flex min-h-[52px] items-center justify-end gap-2 border-t border-border/70 px-3">
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
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-semibold text-foreground outline-none hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <KatalistIcon name="later-lob" className="h-4 w-4 text-status-later" />
                  Later
                </button>
              ) : null}
              {capabilities.canSort ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) => run(event, "sort")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-semibold text-foreground outline-none hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <KatalistIcon name="sorted" className="h-4 w-4 text-status-caught" />
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
