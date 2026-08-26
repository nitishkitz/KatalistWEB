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
  now: { border: "border-status-now/25", text: "text-status-now" },
  next: { border: "border-status-next/25", text: "text-status-next" },
  later: { border: "border-status-later/25", text: "text-status-later" },
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
          "relative min-h-[284px] overflow-hidden rounded-[20px] border bg-white",
          "shadow-[0_22px_44px_-30px_rgba(15,23,42,0.46),0_10px_24px_-20px_rgba(109,94,252,0.24)]",
          laneTone[lane].border,
        )}
      >
        <button
          ref={ref}
          type="button"
          onClick={(event) => {
            if (!suppressClickRef.current) onOpen(thing, event.currentTarget);
          }}
          className="block min-h-[220px] w-full px-5 pb-4 pt-4.5 text-left outline-none transition-colors hover:bg-slate-50/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Open ${thing.title}`}
        >
          <span className="block">
            <span className="flex items-center justify-between gap-3">
              <span className="inline-flex min-w-0 items-center gap-2.5">
                <PersonAvatar
                  name={thing.assignee.name}
                  initials={thing.assignee.initials}
                  src={assigneeAvatar}
                  size={32}
                  className="ring-4 ring-white shadow-sm"
                />
                <span className="max-w-32 truncate text-[12px] font-semibold text-slate-600">
                  @{thing.assignee.name.split(" ")[0]}
                </span>
              </span>
              {due ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 text-[10.5px] font-semibold",
                    due.urgent ? "text-status-now" : laneTone[lane].text,
                  )}
                >
                  <KatalistIcon name="calendar" className="h-3.5 w-3.5" />
                  {due.label}
                </span>
              ) : null}
            </span>

            <span className="mt-4 block line-clamp-2 text-[17px] font-semibold leading-[1.32] tracking-[-0.02em] text-slate-950">
              {thing.title}
            </span>

            <span className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
                  thing.acknowledgement === "waiting_for_catch"
                    ? "bg-amber-50 text-status-waiting"
                    : "bg-emerald-50 text-status-caught",
                )}
              >
                <KatalistIcon
                  name={thing.acknowledgement === "waiting_for_catch" ? "waiting" : "catch"}
                  className="h-3.5 w-3.5"
                />
                {thing.acknowledgement === "waiting_for_catch" ? "Waiting for Catch" : "Caught"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                <KatalistIcon name={workIcon[thing.workStatus]} className="h-3.5 w-3.5" />
                {workLabel[thing.workStatus]}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">
                <KatalistIcon name="list" className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-32 truncate">{thing.listName ?? "Standalone"}</span>
              </span>
            </span>

            <span className="mt-4 flex items-center justify-between border-t border-slate-100 pt-2.5">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {thing.context}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cn(
                    "text-[9.5px] font-semibold tracking-[0.08em]",
                    laneTone[thing.ownerImportance].text,
                  )}
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
          </span>
        </button>

        <div
          className={cn(
            "grid min-h-[64px] items-stretch gap-0 border-t border-slate-100 bg-slate-50/55",
            capabilities.canCatch
              ? "grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]"
              : capabilities.canSetPace && lane !== "later"
                ? "grid-cols-3"
                : "grid-cols-2",
          )}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (!suppressClickRef.current) onOpen(thing, event.currentTarget);
            }}
            className="group inline-flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-500 outline-none transition-colors hover:bg-white/80 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
          >
            <KatalistIcon
              name="details"
              className="h-4 w-4 transition-transform group-hover:scale-110"
            />
            Details
          </button>
          {capabilities.canCatch ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "catch")}
              className="m-2 inline-flex min-w-0 flex-col items-center justify-center gap-1 rounded-[11px] bg-primary px-3 text-[10px] font-semibold text-primary-foreground shadow-[0_12px_25px_-14px_rgba(109,94,252,0.9)] outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="inline-flex min-w-0 flex-col items-center justify-center gap-1 border-l border-slate-100 px-2 text-[10px] font-semibold text-violet-700 outline-none transition-colors hover:bg-violet-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <KatalistIcon name="later-lob" className="h-4 w-4" />
                  Later
                </button>
              ) : null}
              {capabilities.canSort ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) => run(event, "sort")}
                  className="inline-flex min-w-0 flex-col items-center justify-center gap-1 border-l border-slate-100 px-2 text-[10px] font-semibold text-emerald-700 outline-none transition-colors hover:bg-emerald-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
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
