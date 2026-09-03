import { forwardRef, type MouseEvent, type MutableRefObject } from "react";
import { GripVertical } from "lucide-react";

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

const laneCardBorder: Record<
  CourtLaneId,
  { border: string; hover: string; shadow: string; pillBg: string; pillText: string }
> = {
  now: {
    border: "border-red-100/90",
    hover: "hover:border-red-200",
    shadow: "shadow-[0_4px_24px_-4px_rgba(239,68,68,0.1),0_2px_8px_-2px_rgba(0,0,0,0.03)]",
    pillBg: "bg-red-50/90",
    pillText: "text-red-600",
  },
  next: {
    border: "border-blue-100/90",
    hover: "hover:border-blue-200",
    shadow: "shadow-[0_4px_24px_-4px_rgba(59,130,246,0.1),0_2px_8px_-2px_rgba(0,0,0,0.03)]",
    pillBg: "bg-blue-50/90",
    pillText: "text-blue-600",
  },
  later: {
    border: "border-purple-100/90",
    hover: "hover:border-purple-200",
    shadow: "shadow-[0_4px_24px_-4px_rgba(168,85,247,0.1),0_2px_8px_-2px_rgba(0,0,0,0.03)]",
    pillBg: "bg-purple-50/90",
    pillText: "text-purple-600",
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
    const styling = laneCardBorder[lane];

    const run = (event: MouseEvent<HTMLButtonElement>, action: CourtStackAction) => {
      event.stopPropagation();
      onAction(action);
    };

    return (
      <article
        className={cn(
          "group/card flex h-[168px] flex-col justify-between overflow-hidden rounded-2xl border bg-white transition-all duration-200",
          styling.border,
          styling.hover,
          styling.shadow,
        )}
        style={{
          boxShadow:
            "0 16px 32px -22px rgba(15, 23, 42, 0.34), 0 5px 14px -9px rgba(15, 23, 42, 0.2)",
        }}
      >
        <button
          ref={ref}
          type="button"
          onClick={(event) => {
            if (!suppressClickRef.current) onOpen(thing, event.currentTarget);
          }}
          className="block w-full px-4 pb-2.5 pt-3.5 text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-primary/40"
          aria-label={`Open ${thing.title}`}
        >
          {/* Top row: avatar + @name | due date + drag grip */}
          <span className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2">
              <PersonAvatar
                name={thing.assignee.name}
                initials={thing.assignee.initials}
                src={assigneeAvatar}
                size={26}
              />
              <span className="truncate text-[12.5px] font-bold text-slate-800">
                @{thing.assignee.name}
              </span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {dueLabel ? (
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-bold",
                    due.urgent ? "text-red-600" : laneTone[lane].text,
                  )}
                >
                  Due {dueLabel}
                </span>
              ) : null}
              <span
                draggable={true}
                onDragStart={(e) => {
                  e.stopPropagation();
                  const cardEl = (e.currentTarget as HTMLElement).closest("article");
                  if (cardEl && e.dataTransfer.setDragImage) {
                    const rect = cardEl.getBoundingClientRect();
                    const gripRect = (e.currentTarget as HTMLElement).getBoundingClientRect();

                    // Clone the entire card so the drag preview is the full card, not a small icon
                    const clone = cardEl.cloneNode(true) as HTMLElement;
                    clone.style.width = `${rect.width}px`;
                    clone.style.height = `${rect.height}px`;
                    clone.style.position = "fixed";
                    clone.style.top = "-9999px";
                    clone.style.left = "-9999px";
                    clone.style.zIndex = "99999";
                    clone.style.pointerEvents = "none";
                    clone.style.opacity = "0.95";
                    clone.style.boxShadow =
                      "0 20px 35px -10px rgba(0, 0, 0, 0.25), 0 4px 10px rgba(0, 0, 0, 0.1)";
                    clone.style.transform = "none";
                    document.body.appendChild(clone);

                    const offsetX = Math.max(10, gripRect.left - rect.left + gripRect.width / 2);
                    const offsetY = Math.max(10, gripRect.top - rect.top + gripRect.height / 2);

                    e.dataTransfer.setDragImage(clone, offsetX, offsetY);

                    window.requestAnimationFrame(() => {
                      clone.remove();
                    });
                  }
                  e.dataTransfer.setData(
                    "application/katalist-thing",
                    JSON.stringify({ thingId: thing.id, fromLane: lane, title: thing.title }),
                  );
                  e.dataTransfer.setData(
                    "text/plain",
                    JSON.stringify({ thingId: thing.id, fromLane: lane, title: thing.title }),
                  );
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                title="Drag to Buckets or across lanes"
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-grab active:cursor-grabbing"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            </div>
          </span>

          {/* Title */}
          <span
            className="mt-2 block overflow-hidden text-[15px] font-bold leading-[1.3] tracking-[-0.01em] text-slate-900"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
            }}
          >
            {thing.title}
          </span>

          {/* Tags row */}
          <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {thing.listId && thing.listName && thing.listName.toLowerCase() !== "list" ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold border border-transparent",
                  styling.pillBg,
                  styling.pillText,
                )}
              >
                <KatalistIcon name="list" className="h-3 w-3" />
                {thing.listName}
              </span>
            ) : null}

            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-medium border",
                thing.workStatus === "under_progress"
                  ? "bg-blue-50 text-blue-600 border-blue-200/60"
                  : thing.workStatus === "sorted"
                    ? "bg-emerald-50 text-emerald-600 border-emerald-200/60"
                    : "bg-slate-50 text-slate-600 border-slate-200/60",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  thing.workStatus === "under_progress"
                    ? "bg-blue-500"
                    : thing.workStatus === "sorted"
                      ? "bg-emerald-500"
                      : "bg-slate-400",
                )}
              />
              {workLabel[thing.workStatus]}
            </span>

            {thing.starred ? (
              <span className="text-amber-500 ml-auto" title="Starred">
                <KatalistIcon name="favourite-star" className="h-3.5 w-3.5 fill-current" />
                <span className="sr-only">Starred</span>
              </span>
            ) : null}
          </span>
        </button>

        <div className="flex min-h-[38px] h-9 divide-x divide-slate-100 border-t border-slate-100">
          <button
            type="button"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(thing, event.currentTarget);
            }}
            className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-600 outline-none hover:text-slate-900 hover:bg-slate-50/50 focus-visible:ring-1 focus-visible:ring-primary/40 disabled:opacity-60 transition-colors"
          >
            <KatalistIcon name="list" className="h-3.5 w-3.5" />
            Details
          </button>
          {capabilities.canCatch ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "catch")}
              className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 text-[11px] font-semibold text-primary outline-none hover:bg-primary/5 focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            >
              <KatalistIcon name="catch" className="h-3.5 w-3.5" />
              Catch
            </button>
          ) : capabilities.canSetPace && lane !== "later" ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "later")}
              className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-700 outline-none hover:bg-purple-50/60 hover:text-purple-600 focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            >
              <KatalistIcon name="snooze" className="h-3.5 w-3.5 text-slate-600" />
              Later
            </button>
          ) : null}
          {capabilities.canSort ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => run(event, "sort")}
              className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 text-[11px] font-semibold text-emerald-600 outline-none hover:bg-emerald-50/60 hover:text-emerald-700 focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            >
              <KatalistIcon name="sorted" className="h-3.5 w-3.5 text-emerald-600" />
              Sorted
            </button>
          ) : null}
        </div>
      </article>
    );
  },
);
