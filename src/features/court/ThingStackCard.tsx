import { forwardRef, type MouseEvent, type MutableRefObject } from "react";

import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import { useAvatarUrl } from "@/features/people/directory";
import { cn } from "@/lib/utils";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
import { formatThingCreatedAt, formatThingCreatedAtExact } from "./thing-time";

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

export const ThingStackCard = forwardRef<HTMLButtonElement, ThingStackCardProps>(
  function ThingStackCard(
    { thing, lane, myActorId, pendingAction, suppressClickRef, onOpen, onAction },
    ref,
  ) {
    const due = formatCourtDue(thing);
    const createdAtLabel = formatThingCreatedAt(thing.createdAt);
    const createdAtExact = formatThingCreatedAtExact(thing.createdAt);
    const capabilities = getThingCapabilities(thing, myActorId);
    const assigneeAvatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);
    const assignedByAvatar = useAvatarUrl(
      thing.assignedBy.name,
      null,
      thing.assignedBy.avatarUrl,
    );
    const disabled = pendingAction !== null;
    const waitingForCatch = thing.acknowledgement === "waiting_for_catch";
    const statusLabel = waitingForCatch ? "Waiting for Catch" : workLabel[thing.workStatus];
    const statusIcon = waitingForCatch ? "waiting" : workIcon[thing.workStatus];
    const actionCount =
      1 +
      Number(capabilities.canCatch) +
      Number(!capabilities.canCatch && capabilities.canSetPace && lane !== "later") +
      Number(!capabilities.canCatch && capabilities.canSort);

    const run = (event: MouseEvent<HTMLButtonElement>, action: CourtStackAction) => {
      event.stopPropagation();
      onAction(action);
    };

    return (
      <article
        className={cn(
          "relative min-h-[200px] overflow-hidden rounded-[16px] border bg-white",
          laneTone[lane].border,
        )}
      >
        <button
          ref={ref}
          type="button"
          onClick={(event) => {
            if (!suppressClickRef.current) onOpen(thing, event.currentTarget);
          }}
          className="block min-h-[154px] w-full px-4 py-3 text-left outline-none transition-colors hover:bg-slate-50/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Open ${thing.title}`}
        >
          <span className="block">
            <span className="flex min-w-0 items-start gap-2.5">
              <PersonAvatar
                name={thing.assignee.name}
                initials={thing.assignee.initials}
                src={assigneeAvatar}
                size={28}
                className="mt-0.5 shrink-0 ring-2 ring-white"
              />
              <span className="min-w-0 flex-1 pt-0.5">
                <span className="block line-clamp-2 text-[14px] font-semibold leading-5 tracking-[-0.01em] text-slate-950">
                  {thing.title}
                </span>
              </span>
              {due ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 pt-1 text-[10px] font-semibold",
                    due.urgent ? "text-status-now" : laneTone[lane].text,
                  )}
                >
                  <KatalistIcon name="calendar" className="h-3.5 w-3.5" />
                  {due.label}
                </span>
              ) : null}
            </span>

            <span className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[9.5px] text-muted-foreground">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
                  waitingForCatch
                    ? "bg-amber-50 text-status-waiting"
                    : thing.workStatus === "under_progress"
                      ? "bg-blue-50 text-status-next"
                      : thing.workStatus === "sorted"
                        ? "bg-emerald-50 text-status-caught"
                        : "bg-slate-100 text-slate-600",
                )}
              >
                <KatalistIcon name={statusIcon} className="h-3.5 w-3.5" />
                {statusLabel}
              </span>
              {thing.listName ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">
                  <KatalistIcon name="list" className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-32 truncate">{thing.listName}</span>
                </span>
              ) : null}
              {thing.starred ? (
                <span className="text-status-waiting" title="Starred">
                  <KatalistIcon name="favourite-star" className="h-3.5 w-3.5 fill-current" />
                  <span className="sr-only">Starred</span>
                </span>
              ) : null}
            </span>

            <span
              className="mt-3 inline-flex min-w-0 items-center gap-1.5 text-[9.5px] font-medium text-slate-500"
              aria-label={
                thing.assignedBy.id === thing.assignee.id
                  ? `Self-assigned by ${thing.assignee.name}`
                  : `Assigned by ${thing.assignedBy.name} to ${thing.assignee.name}`
              }
              title={
                thing.assignedBy.id === thing.assignee.id
                  ? `Self-assigned by ${thing.assignee.name}`
                  : `${thing.assignedBy.name} → ${thing.assignee.name}`
              }
            >
              {thing.assignedBy.id !== thing.assignee.id ? (
                <>
                  <PersonAvatar
                    name={thing.assignedBy.name}
                    initials={thing.assignedBy.initials}
                    src={assignedByAvatar}
                    size={19}
                    className="ring-2 ring-white"
                  />
                  <KatalistIcon name="arrow-right" className="h-3 w-3 text-slate-400" />
                  <PersonAvatar
                    name={thing.assignee.name}
                    initials={thing.assignee.initials}
                    src={assigneeAvatar}
                    size={19}
                    className="ring-2 ring-white"
                  />
                </>
              ) : (
                <>
                  <PersonAvatar
                    name={thing.assignee.name}
                    initials={thing.assignee.initials}
                    src={assigneeAvatar}
                    size={19}
                    className="ring-2 ring-white"
                  />
                  <span>Self-assigned</span>
                </>
              )}
            </span>
            {createdAtLabel ? (
              <span
                className="mt-1.5 inline-flex items-center gap-1 text-muted-foreground"
                aria-label={`Created ${createdAtLabel}`}
                title={createdAtExact ? `Created ${createdAtExact}` : undefined}
              >
                <KatalistIcon name="clock-time" className="h-3.5 w-3.5" />
                Created {createdAtLabel}
              </span>
            ) : null}
          </span>
        </button>

        <div
          className={cn(
            "grid min-h-[44px] items-stretch gap-0 border-t border-slate-100 bg-slate-50/45",
            actionCount === 1 ? "grid-cols-1" : actionCount === 2 ? "grid-cols-2" : "grid-cols-3",
          )}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (!suppressClickRef.current) onOpen(thing, event.currentTarget);
            }}
            className="group inline-flex min-w-0 items-center justify-center gap-1.5 text-[10px] font-medium text-slate-500 outline-none transition-colors hover:bg-white/80 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
          >
            <KatalistIcon
              name="details"
              className="h-3.5 w-3.5 transition-transform group-hover:scale-110"
            />
            Details
          </button>
          {capabilities.canCatch ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "catch")}
              className="inline-flex min-w-0 items-center justify-center gap-1.5 border-l border-slate-100 px-2 text-[10px] font-semibold text-emerald-700 outline-none transition-colors hover:bg-emerald-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KatalistIcon name="catch" className="h-3.5 w-3.5" />
              Catch
            </button>
          ) : (
            <>
              {capabilities.canSetPace && lane !== "later" ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) => run(event, "later")}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 border-l border-slate-100 px-2 text-[10px] font-semibold text-violet-700 outline-none transition-colors hover:bg-violet-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <KatalistIcon name="later-lob" className="h-3.5 w-3.5" />
                  Later
                </button>
              ) : null}
              {capabilities.canSort ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) => run(event, "sort")}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 border-l border-slate-100 px-2 text-[10px] font-semibold text-emerald-700 outline-none transition-colors hover:bg-emerald-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <KatalistIcon name="sorted" className="h-3.5 w-3.5" />
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
