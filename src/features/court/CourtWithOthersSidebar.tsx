import { thingReference } from "@/features/things/thing-reference";
import "./with-others-sidebar.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Thing } from "@/domain/thing";
import { theirStateFor } from "@/domain/thing";
import { formatCourtDue, type TheirsFocus } from "./court-view-model";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { matchProfile, useProfileDirectory } from "@/features/people/directory";
import { InlineThingDetailWorkspace } from "@/features/things/InlineThingDetailWorkspace";
import { KatalistIcon } from "./KatalistIcon";
import { rpcNudgeThing, type NudgeReason } from "@/features/things/rpc";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

type CourtWithOthersSidebarProps = {
  theirGroups: {
    waiting_for_catch: Thing[];
    moving: Thing[];
    needs_attention: Thing[];
  };
  theirFocus: TheirsFocus | null;
  setTheirFocus: React.Dispatch<React.SetStateAction<TheirsFocus | null>>;
  theirs: Thing[];
  onOpenThing: (thing: Thing, origin: HTMLElement) => void;
  onViewAllTheirs: () => void;
  directory: ReturnType<typeof useProfileDirectory>;
  theirSelectedId?: string | null;
  setTheirSelectedId?: React.Dispatch<React.SetStateAction<string | null>>;
};

export function CourtWithOthersSidebar({
  theirGroups,
  theirFocus,
  setTheirFocus,
  theirs,
  onOpenThing,
  onViewAllTheirs,
  directory,
  theirSelectedId,
  setTheirSelectedId,
}: CourtWithOthersSidebarProps) {
  const selectedThing = theirs.find((t) => t.id === theirSelectedId) ?? null;
  const activeFocus = theirFocus ?? "waiting_for_catch";
  const qc = useQueryClient();
  const [view, setView] = useState<"status" | "pace">("status");
  const [pace, setPace] = useState<"now" | "next" | "later">("now");
  // Shared owner priority is stable across viewers; Court placement is private.
  const paceGroups = {
    now: theirs.filter((thing) => thing.ownerImportance === "now"),
    next: theirs.filter((thing) => thing.ownerImportance === "next"),
    later: theirs.filter((thing) => thing.ownerImportance === "later"),
  };
  const visibleThings = view === "status" ? theirGroups[activeFocus] : paceGroups[pace];
  const tabs =
    view === "status"
      ? ([
          ["waiting_for_catch", "Waiting for Catch", theirGroups.waiting_for_catch.length],
          ["moving", "Moving", theirGroups.moving.length],
          ["needs_attention", "Needs Attention", theirGroups.needs_attention.length],
        ] as const)
      : ([
          ["now", "Now", paceGroups.now.length],
          ["next", "Next", paceGroups.next.length],
          ["later", "Later", paceGroups.later.length],
        ] as const);

  // Track which Things have been nudged this session (for the "Nudged / Nudge
  // again" affordance) and which nudges are in flight.
  const [nudgedIds, setNudgedIds] = useState<Record<string, boolean>>({});
  const [nudgingId, setNudgingId] = useState<string | null>(null);

  const handleNudge = (thing: Thing) => {
    if (nudgingId) return;
    const alreadyNudged = Boolean(nudgedIds[thing.id]);
    // Give the RPC a valid reason for every state (an undefined reason can be
    // rejected by the server) — waiting → catch, moving → quiet check-in,
    // needs_attention → stale reminder.
    const state = theirStateFor(thing);
    const reason: NudgeReason =
      state === "waiting_for_catch" ? "waiting_for_catch" : state === "moving" ? "quiet" : "stale";
    setNudgingId(thing.id);
    const epoch = getIdentityEpoch(qc).epoch;
    void rpcNudgeThing(thing.id, reason).then(
      () => {
        setNudgedIds((prev) => ({ ...prev, [thing.id]: true }));
        setNudgingId(null);
        if (!isEpochCurrent(qc, epoch)) return;
        toast.success(
          alreadyNudged
            ? `Nudged ${thing.assignee.name} again about “${thing.title}”.`
            : `Nudged ${thing.assignee.name} about “${thing.title}”.`,
        );
        void qc.invalidateQueries({ queryKey: ["nudges"] });
        void qc.invalidateQueries({ queryKey: ["nudge-history"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
        void qc.invalidateQueries({ queryKey: ["thing-activity"] });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      },
      (err: unknown) => {
        setNudgingId(null);
        if (!isEpochCurrent(qc, epoch)) return;
        // Nudges are soft. Never show the scary generic error — keep it calm.
        const raw = domainErrorMessage(err);
        const friendly =
          raw === "Something didn’t go through. Try again."
            ? "Couldn’t send that nudge right now — they may already have been reminded."
            : raw;
        // A repeat nudge is usually just a cooldown — reflect the Nudged state.
        if (alreadyNudged) {
          setNudgedIds((prev) => ({ ...prev, [thing.id]: true }));
          toast(
            `${thing.assignee.name} was already nudged about “${thing.title}”. Give them a little time to catch it.`,
          );
        } else {
          toast(friendly);
        }
      },
    );
  };

  return (
    <aside
      id="court-with-others"
      className="@container w-full min-w-0 shrink-0 max-xl:border-l border-border/70 bg-white sticky top-14 h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden"
    >
      <header className="with-others-header relative shrink-0 border-b border-border/60 px-4 pb-3 pt-2">
        <div className="mb-2 flex min-w-0 items-center gap-1">
          <h2 className="min-w-0 whitespace-nowrap text-[16px] font-semibold tracking-tight text-[#101639]">With others</h2>
          <button
            type="button"
            onClick={onViewAllTheirs}
            aria-label={`View all ${theirs.length}`}
            title="View all"
            className="inline-flex h-8 w-6 shrink-0 items-center justify-center rounded text-[#536187] transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <KatalistIcon name="chevron-right" className="h-4 w-4" />
          </button>
          <div role="group" aria-label="With Others view" className="with-others-modes ml-auto inline-flex shrink-0 rounded-md border border-[#dce1eb] bg-[#f1f3f7] p-0.5">
            {(["status", "pace"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                title={mode === "pace" ? "Group by the owner's shared priority, not personal Court placement" : "Group by collaboration status"}
                onClick={() => setView(mode)}
                className={cn(
                  "inline-flex min-h-7 items-center justify-center rounded px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  view === mode ? "bg-white text-[#6c2aee] shadow-sm" : "text-[#536187] hover:text-[#101639]",
                )}
              >
                {mode === "status" ? "Status" : "Pace"}
              </button>
            ))}
          </div>
        </div>
        <div role="group" aria-label={view === "status" ? "Filter by status" : "Filter by pace"} className="with-others-counts grid grid-cols-3 overflow-hidden rounded-md border border-[#dce1eb] divide-x divide-[#dce1eb]">
          {tabs.map(([id, label, count]) => {
            const isActive = (view === "status" ? activeFocus : pace) === id;
            const compactLabel = id === "waiting_for_catch" ? "Waiting" : id === "needs_attention" ? "Attention" : label;
            return (
              <button
                key={id}
                type="button"
                data-filter={id}
                aria-label={`${label}: ${count}`}
                aria-pressed={isActive}
                title={label}
                onClick={() => {
                  if (id === "now" || id === "next" || id === "later") setPace(id);
                  else setTheirFocus(id);
                }}
                className={cn(
                  "relative flex min-h-9 min-w-0 items-center justify-center gap-1.5 px-1 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive ? "bg-[#f3effc] text-[#221445]" : "bg-white text-[#536187] hover:bg-[#faf9fd]",
                )}
              >
                <span className="order-2 max-w-full truncate text-[12px] font-semibold leading-4 tabular-nums">{count}</span>
                <span className="text-[11px] leading-4">{compactLabel}</span>
                {isActive && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-[#7837ee]" />}
              </button>
            );
          })}
        </div>
      </header>

      {/* Item list - scrollable */}
      <div className="flex-1 overflow-y-auto bg-white relative">
        {theirSelectedId && selectedThing ? (
          <div className="absolute inset-0 z-10 bg-white">
            <InlineThingDetailWorkspace
              thing={selectedThing}
              onClose={() => setTheirSelectedId?.(null)}
              className="h-full border-none shadow-none rounded-none !flex !flex-col"
              sourceClassName="hidden"
            >
              <></>
            </InlineThingDetailWorkspace>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {view === "status" && visibleThings.length === 0 && (
              <div className="court-others-home-empty hidden px-3 pb-3 pt-2">
                <div className="rounded-xl border border-white/80 bg-white px-4 py-6 text-center text-[13px] text-[#46557d]" role="status">
                  <KatalistIcon name="with-others" className="mx-auto mb-3 h-6 w-6" aria-hidden="true" />
                  <p className="font-medium">All clear here.</p>
                  <p className="mt-1">You’re up to date with your team.</p>
                </div>
              </div>
            )}
            {view === "pace" && visibleThings.length === 0 && (
              <p className="px-4 py-6 text-[13px] text-muted-foreground" role="status">
                No Things in {pace === "now" ? "Now" : pace === "next" ? "Next" : "Later"}.
              </p>
            )}
            {visibleThings.map((thing) => {
              const assigneeAvatar =
                thing.assignee.avatarUrl ||
                matchProfile(directory, thing.assignee.name)?.avatar_url;
              const state = theirStateFor(thing);
              const dueInfo = thing.dueAt ? formatCourtDue(thing) : null;

              return (
                <div
                  key={thing.id}
                  data-thing-id={thing.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => onOpenThing(thing, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenThing(thing, e.currentTarget);
                    }
                  }}
                  className={cn(
                    "with-others-item px-4 py-3 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    thing.id === theirSelectedId ? "bg-muted/50" : "hover:bg-muted/20",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <PersonAvatar
                      name={thing.assignee.name}
                      initials={thing.assignee.initials}
                      src={assigneeAvatar}
                      size={28}
                    />
                    <p className="min-w-0 truncate text-[13px] font-semibold leading-5 text-slate-700">
                      {thing.assignee.name}
                    </p>
                  </div>
                  <div className="with-others-item-body mt-1.5 min-w-0">
                    <p className="text-[13px] font-medium text-slate-900 leading-snug line-clamp-3 break-words">
                      {thing.title}
                    </p>
                    <div className="with-others-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                      {thingReference(thing) && <span className="font-mono text-[11px] text-slate-500">{thingReference(thing)}</span>}
                      {dueInfo ? (
                        <span
                          className={cn(
                            "font-medium",
                            dueInfo.urgent ? "text-red-600" : "text-slate-500",
                          )}
                        >
                          Due {dueInfo.label}
                        </span>
                      ) : state === "waiting_for_catch" ? (
                        <span>Waiting for Catch</span>
                      ) : state === "moving" ? (
                        <span>Under Progress</span>
                      ) : (
                        <span>Needs Attention</span>
                      )}
                    </div>

                    {/* Badges line: comments and files */}
                    {((thing.commentCount ?? 0) > 0 ||
                      (thing.files?.length ?? 0) > 0 ||
                      (thing.attachmentCount ?? 0) > 0 ||
                      thing.overviewStatsUnavailable) && (
                      <div className="mt-1.5 flex items-center gap-2.5 text-[12px] text-muted-foreground">
                        {(thing.commentCount ?? 0) > 0 && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-medium",
                              (thing.unreadCommentCount ?? 0) > 0
                                ? "text-blue-600 font-semibold"
                                : "text-slate-500",
                            )}
                          >
                            <KatalistIcon name="comment" className="h-3 w-3" />
                            {(thing.unreadCommentCount ?? 0) > 0
                              ? `${thing.unreadCommentCount} new ${thing.unreadCommentCount === 1 ? "comment" : "comments"}`
                              : `${thing.commentCount} ${thing.commentCount === 1 ? "comment" : "comments"}`}
                          </span>
                        )}
                        {((thing.files?.length ?? 0) > 0 || (thing.attachmentCount ?? 0) > 0) && (
                          <span className="inline-flex items-center gap-1 text-slate-500 font-medium">
                            <KatalistIcon name="attachment" className="h-3 w-3" />
                            {thing.attachmentCount ?? thing.files?.length ?? 0}{" "}
                            {(thing.attachmentCount ?? thing.files?.length ?? 0) === 1
                              ? "file"
                              : "files"}
                          </span>
                        )}
                        {thing.overviewStatsUnavailable && (
                          <span title="Open this Thing to retry its counts">
                            Counts unavailable
                          </span>
                        )}
                      </div>
                    )}

                    {/* Nudge button */}
                    <div className="with-others-nudge mt-1">
                      {(() => {
                        const isNudged = Boolean(nudgedIds[thing.id]);
                        const isNudging = nudgingId === thing.id;
                        return (
                          <button
                            type="button"
                            disabled={isNudging}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNudge(thing);
                            }}
                            className={cn(
                              "group/nudge inline-flex min-h-8 items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer disabled:cursor-default",
                              isNudged
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "border-[#dce1eb] bg-white font-normal text-[#46557d] hover:bg-[#f7f8fb]",
                            )}
                          >
                            {isNudging ? (
                              <>
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                <span>Nudging…</span>
                              </>
                            ) : isNudged ? (
                              <>
                                <KatalistIcon
                                  name="sorted"
                                  className="h-3 w-3 group-hover/nudge:hidden"
                                />
                                <KatalistIcon
                                  name="nudge-paw-tap"
                                  className="hidden h-3 w-3 group-hover/nudge:block"
                                />
                                <span className="group-hover/nudge:hidden">Nudged</span>
                                <span className="hidden group-hover/nudge:inline">Nudge again</span>
                              </>
                            ) : (
                              <>
                                <KatalistIcon name="nudge-paw-tap" className="h-3 w-3" />
                                <span>Nudge</span>
                              </>
                            )}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
