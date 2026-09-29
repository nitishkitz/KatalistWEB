import { forwardRef, type MouseEvent, type MutableRefObject } from "react";
import { Play } from "lucide-react";

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
  listCoverUrl?: string | null;
  lane: CourtLaneId;
  myActorId: string | null;
  pendingAction: CourtStackAction | null;
  suppressClickRef: MutableRefObject<boolean>;
  onOpen: (thing: Thing, origin: HTMLElement) => void;
  onAction: (action: CourtStackAction) => void;
  /** T09/E01: swipe-left opens the timed-Snooze interval menu -- this gives
   *  a button/keyboard equivalent for that exact same menu, rather than a
   *  second, independent snooze path. Omitted (no button rendered) when
   *  the caller has no active Thing to snooze, matching the swipe
   *  gesture's own availability. */
  onSnooze?: () => void;
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

// Exact Figma per-lane accents for the due chip and primary action button.
const laneFigma: Record<
  CourtLaneId,
  { primaryBtn: string; primaryHover: string; dueChipBg: string; dueChipText: string }
> = {
  now: {
    primaryBtn: "#fe1d19",
    primaryHover: "#e01512",
    dueChipBg: "#feeaeb",
    dueChipText: "#fd0d0d",
  },
  next: {
    primaryBtn: "#005dfe",
    primaryHover: "#0050df",
    dueChipBg: "#e3f0fd",
    dueChipText: "#0b62f8",
  },
  later: {
    primaryBtn: "#fe1d19",
    primaryHover: "#e01512",
    dueChipBg: "#f0effc",
    dueChipText: "#641dfb",
  },
};

export const ThingStackCard = forwardRef<HTMLButtonElement, ThingStackCardProps>(
  function ThingStackCard(
    {
      thing,
      listCoverUrl,
      lane,
      myActorId,
      pendingAction,
      suppressClickRef,
      onOpen,
      onAction,
      onSnooze,
    },
    ref,
  ) {
    const due = formatCourtDue(thing);
    const dueLabel = thing.dueAt ? due.label : null;
    const capabilities = getThingCapabilities(thing, myActorId);
    const assigneeAvatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);
    const ownerAvatar = useAvatarUrl(thing.owner.name, null, thing.owner.avatarUrl);
    // When someone else assigns a Thing to me, show THEIR face (the assigner),
    // so it doesn't look like a Thing I created for myself.
    const assignedByOther = Boolean(
      myActorId && thing.assignee.id === myActorId && thing.owner.id !== thing.assignee.id,
    );
    const facePerson = assignedByOther ? thing.owner : thing.assignee;
    const faceAvatar = assignedByOther ? ownerAvatar : assigneeAvatar;
    const disabled = pendingAction !== null;
    const styling = laneCardBorder[lane];
    const fileCount = thing.attachmentCount ?? thing.files?.length ?? 0;
    const hasList = Boolean(
      thing.listId &&
      thing.listName &&
      !["standalone", "list"].includes(thing.listName.toLowerCase()),
    );

    const run = (event: MouseEvent<HTMLButtonElement>, action: CourtStackAction) => {
      event.stopPropagation();
      onAction(action);
    };

    return (
      <article
        className={cn(
          "group/card flex min-h-[170px] flex-col justify-between overflow-hidden rounded-[12px] border bg-white transition-all duration-200",
          styling.border,
          styling.hover,
        )}
        style={{
          boxShadow: "0 3.788px 3.788px 0 rgba(0, 0, 0, 0.03)",
        }}
      >
        <button
          ref={ref}
          type="button"
          onClick={(event) => {
            if (!suppressClickRef.current) onOpen(thing, event.currentTarget);
          }}
          className="flex flex-col flex-1 w-full px-4 pb-2.5 pt-3.5 text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-primary/40"
          aria-label={`Open ${thing.title}`}
        >
          {/* Top row: drag grip + avatar + name | due date */}
          <span className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                draggable={true}
                onDragStart={(e) => {
                  e.stopPropagation();
                  const cardEl = (e.currentTarget as HTMLElement).closest("article");
                  if (cardEl && e.dataTransfer.setDragImage) {
                    const rect = cardEl.getBoundingClientRect();
                    const gripRect = (e.currentTarget as HTMLElement).getBoundingClientRect();

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
                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-grab active:cursor-grabbing -ml-1.5 shrink-0"
              >
                <KatalistIcon name="drag-handle" className="h-3.5 w-3.5" />
              </span>
              <PersonAvatar
                name={facePerson.name}
                initials={facePerson.initials}
                src={faceAvatar}
                size={24}
              />
              <span className="truncate text-[12.5px] font-bold text-slate-800">
                {assignedByOther
                  ? `${thing.owner.name.split(" ")[0]} → You`
                  : myActorId && thing.assignee.id === myActorId
                    ? "You"
                    : thing.assignee.name.split(" ")[0]}
              </span>
            </span>
            {dueLabel ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium"
                style={{
                  backgroundColor: laneFigma[lane].dueChipBg,
                  color: due.urgent ? "#fd0d0d" : laneFigma[lane].dueChipText,
                }}
              >
                <KatalistIcon name="calendar" className="h-3 w-3" />
                {dueLabel}
              </span>
            ) : null}
          </span>

          {/* Title */}
          <span className="mt-2 text-[15px] font-medium leading-[1.35] tracking-[-0.01em] text-slate-900 break-words line-clamp-3">
            {thing.title}
          </span>
          {hasList && thing.listName && (
            <span className="mt-1 inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground font-medium truncate">
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-50 text-violet-600">
                {listCoverUrl ? (
                  <img src={listCoverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <KatalistIcon name="list" className="h-3 w-3" aria-hidden="true" />
                )}
              </span>
              <span className="truncate">{thing.listName}</span>
            </span>
          )}

          {/* Badges: comments & files */}
          {((thing.commentCount ?? 0) > 0 || fileCount > 0 || thing.overviewStatsUnavailable) && (
            <div className="mt-2 flex items-center gap-3 text-[12px] text-muted-foreground">
              {(thing.commentCount ?? 0) > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-medium",
                    (thing.unreadCommentCount ?? 0) > 0
                      ? "text-blue-600 font-semibold"
                      : "text-muted-foreground",
                  )}
                >
                  <KatalistIcon name="comment" className="h-3 w-3" />
                  {(thing.unreadCommentCount ?? 0) > 0
                    ? `${thing.unreadCommentCount} ${thing.unreadCommentCount === 1 ? "new comment" : "new comments"}`
                    : `${thing.commentCount} ${thing.commentCount === 1 ? "comment" : "comments"}`}
                </span>
              )}
              {fileCount > 0 && (
                <span className="inline-flex items-center gap-1 text-muted-foreground font-medium">
                  <KatalistIcon name="attachment" className="h-3 w-3" />
                  {fileCount} {fileCount === 1 ? "file" : "files"}
                  {thing.files?.some((f) => f.isNew) && (
                    <span className="text-blue-600 font-semibold">· 1 new</span>
                  )}
                </span>
              )}
              {thing.overviewStatsUnavailable ? (
                <span title="Open this Thing to retry its counts">Counts unavailable</span>
              ) : null}
            </div>
          )}

          {/* Description */}
          {thing.description ? (
            <p className="mt-2 text-[12px] text-slate-600 leading-relaxed text-left break-words whitespace-pre-wrap">
              {thing.description}
            </p>
          ) : null}

          {/* File Preview thumbnail card or Notes preview - strictly uniform height matching Image 1 */}
          {thing.files && thing.files.length > 0
            ? (() => {
                const firstFile = thing.files[0];
                const isPdf = firstFile.type === "pdf";
                const isDocx = firstFile.type === "docx";
                const isImg =
                  firstFile.type === "image" ||
                  firstFile.type === "png" ||
                  firstFile.type === "jpg";
                const isVid = firstFile.type === "video";
                // Overview cards must not open a PDF worker or download full
                // document bytes. The explicit file viewer owns that work.
                const isMedia = Boolean((isImg || isVid) && firstFile.url);

                return (
                  <div
                    className={cn(
                      "mt-2.5 flex h-[clamp(120px,22vh,225px)] min-h-[clamp(120px,22vh,225px)] max-h-[clamp(120px,22vh,225px)] flex-col overflow-hidden rounded-xl",
                      isMedia
                        ? "bg-slate-50"
                        : "justify-between border border-slate-200/80 bg-slate-50 text-left",
                    )}
                  >
                    {isImg && firstFile.url ? (
                      <img
                        src={firstFile.url}
                        alt={firstFile.name}
                        className="h-full w-full object-cover"
                      />
                    ) : isVid && firstFile.url ? (
                      <div className="relative h-full w-full bg-black">
                        <video
                          src={firstFile.url}
                          className="h-full w-full object-cover opacity-90"
                          muted
                          playsInline
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="h-8 w-8 rounded-full bg-white/85 flex items-center justify-center text-slate-900">
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          </div>
                        </div>
                      </div>
                    ) : isPdf || isDocx ? (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-left">
                        <div className="flex items-center gap-3 px-4 pt-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-500">
                            <KatalistIcon name="attachment" className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <h4 className="truncate text-[13px] font-semibold leading-tight text-slate-900">
                              {firstFile.name.replace(/\.[^/.]+$/, "")}
                            </h4>
                            <p className="mt-0.5 truncate text-[11px] text-[#46557d]">
                              {thing.listName || (isDocx ? "Notes" : "Document")}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 line-clamp-6 overflow-hidden px-4 text-[11px] leading-[1.4] text-[#46557d] whitespace-pre-line">
                          {thing.description || "Open this file to view its contents."}
                        </p>
                        <div className="mt-auto flex h-10 shrink-0 items-center gap-2 border-t border-slate-200/80 px-3 text-[11px] text-slate-700">
                          <span className="rounded bg-white px-1.5 py-0.5 font-medium uppercase text-red-500">
                            {isPdf ? "PDF" : "DOCX"}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{firstFile.name}</span>
                          {fileCount > 1 ? (
                            <span className="shrink-0 font-medium">+{fileCount - 1} files</span>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full flex-1 min-h-0 items-center gap-2 overflow-hidden px-4 text-left">
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg text-[12px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                          {firstFile.type}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-bold text-slate-900 truncate">
                            {firstFile.name}
                          </p>
                          <p className="text-[12px] font-medium text-slate-500">
                            {firstFile.sizeLabel ||
                              (isImg || isVid ? "Preview unavailable" : "File attached")}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            : null}
        </button>

        {/* Card action: Catch (Things awaiting catch) or Sort (already
            caught) -- capabilities.canCatch/canSort are mutually exclusive
            (see domain/capabilities.ts), so exactly one of these renders.
            E01: Sort used to be swipe-right/Thing-detail-only, with no
            keyboard/click equivalent in the stack itself -- this button
            calls the exact same onAction("sort") the swipe gesture already
            dispatches (CourtLaneStack's runAction), not a second path. */}
        {(capabilities.canCatch || capabilities.canSort || onSnooze) && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-2 px-4 pb-3 pt-0"
          >
            {capabilities.canCatch && (
              <button
                type="button"
                disabled={disabled}
                onClick={(event) => run(event, "catch")}
                style={{ backgroundColor: laneFigma[lane].primaryBtn }}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[12px] font-medium text-white transition hover:brightness-95 disabled:opacity-60 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <span>Catch</span>
              </button>
            )}
            {capabilities.canSort && (
              <button
                type="button"
                disabled={disabled}
                onClick={(event) => run(event, "sort")}
                style={{ backgroundColor: laneFigma[lane].primaryBtn }}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[12px] font-medium text-white transition hover:brightness-95 disabled:opacity-60 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <span>Mark Sorted</span>
              </button>
            )}
            {/* T09/E01: swipe-left used to be the ONLY way to reach the
                timed-Snooze menu -- no button/keyboard equivalent existed.
                This opens the exact same menu (CourtLaneStack's
                snoozeOpen/runSnooze), not a second snooze path. */}
            {onSnooze && (
              <button
                type="button"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onSnooze();
                }}
                aria-label="Snooze"
                title="Snooze"
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-slate-200 px-3 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <span>Snooze</span>
              </button>
            )}
          </div>
        )}
      </article>
    );
  },
);
