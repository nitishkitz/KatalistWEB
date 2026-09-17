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
    void rpcNudgeThing(thing.id, reason).then(
      () => {
        setNudgedIds((prev) => ({ ...prev, [thing.id]: true }));
        setNudgingId(null);
        toast.success(
          alreadyNudged ? "Nudged again — they'll get another gentle tap." : "Just a gentle paw tap on this one.",
        );
        void qc.invalidateQueries({ queryKey: ["nudges"] });
        void qc.invalidateQueries({ queryKey: ["nudge-history"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
        void qc.invalidateQueries({ queryKey: ["thing-activity"] });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      },
      (err: unknown) => {
        setNudgingId(null);
        // Nudges are soft. Never show the scary generic error — keep it calm.
        const raw = domainErrorMessage(err);
        const friendly =
          raw === "Something didn’t go through. Try again."
            ? "Couldn’t send that nudge right now — they may already have been reminded."
            : raw;
        // A repeat nudge is usually just a cooldown — reflect the Nudged state.
        if (alreadyNudged) {
          setNudgedIds((prev) => ({ ...prev, [thing.id]: true }));
          toast("Already nudged — give them a little time to catch it.");
        } else {
          toast(friendly);
        }
      },
    );
  };

  return (
    <aside className="w-[325px] xl:w-[340px] shrink-0 border-l border-border/70 bg-white sticky top-14 h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-border/60">
        <div className="mb-3 flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#e0e4f4] text-[#050d33]"
          >
            <KatalistIcon name="with-others" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[20px] font-medium uppercase leading-none tracking-tight text-[#050d33]">
              With Others
            </h2>
          </div>
        </div>
        {/* Underline Tabs */}
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
          {(
            [
              ["waiting_for_catch", "Waiting for Catch", theirGroups.waiting_for_catch.length],
              ["moving", "Moving", theirGroups.moving.length],
              ["needs_attention", "Needs Attention", theirGroups.needs_attention.length],
            ] as const
          ).map(([id, label, count]) => {
            const isActive = activeFocus === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTheirFocus(id)}
                className={cn(
                  "pb-2 text-[11px] whitespace-nowrap transition-colors relative cursor-pointer outline-none",
                  isActive ? "text-black font-medium" : "text-black/80 hover:text-black font-normal",
                )}
              >
                {label}{" "}
                <span className={cn(id === "needs_attention" ? "text-[#fd1c1a]" : "text-black/80")}>
                  {count}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#503188]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

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
            {theirGroups[activeFocus].map((thing) => {
              const assigneeAvatar =
                thing.assignee.avatarUrl || matchProfile(directory, thing.assignee.name)?.avatar_url;
              const state = theirStateFor(thing);
              const dueInfo = thing.dueAt ? formatCourtDue(thing) : null;

              return (
                <div
                  key={thing.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => onOpenThing(thing, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenThing(thing, e.currentTarget);
                    }
                  }}
                  className={cn(
                    "flex items-start gap-3 p-3.5 cursor-pointer transition-colors outline-none",
                    thing.id === theirSelectedId ? "bg-muted/50" : "hover:bg-muted/20",
                  )}
                >
                  <PersonAvatar
                    name={thing.assignee.name}
                    initials={thing.assignee.initials}
                    src={assigneeAvatar}
                    size={32}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-normal text-slate-900 leading-snug line-clamp-3 break-words">
                      {thing.title}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-medium text-slate-700">{thing.assignee.name.split(" ")[0]}</span>
                      <span>·</span>
                      {dueInfo ? (
                        <span className={cn("font-medium", dueInfo.urgent ? "text-red-600" : "text-slate-500")}>
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
                    {((thing.commentCount ?? 0) > 0 || (thing.files?.length ?? 0) > 0 || (thing.attachmentCount ?? 0) > 0) && (
                      <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-muted-foreground">
                        {(thing.commentCount ?? 0) > 0 && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-medium",
                              (thing.unreadCommentCount ?? 0) > 0 ? "text-blue-600 font-semibold" : "text-slate-500",
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
                            {thing.files?.length ?? thing.attachmentCount} {((thing.files?.length ?? thing.attachmentCount) === 1) ? "file" : "files"}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Nudge button */}
                    <div className="mt-2">
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
                              "group/nudge inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer disabled:cursor-default",
                              isNudged
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "border-[#eaeffa] bg-[#eff1fc] font-normal text-[#1d1d1d] hover:bg-[#e6eafb]",
                            )}
                          >
                            {isNudging ? (
                              <>
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                <span>Nudging…</span>
                              </>
                            ) : isNudged ? (
                              <>
                                <KatalistIcon name="sorted" className="h-3 w-3 group-hover/nudge:hidden" />
                                <KatalistIcon name="nudge-paw-tap" className="hidden h-3 w-3 group-hover/nudge:block" />
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

      {/* View all footer */}
      {!theirSelectedId && (
        <div className="px-4 py-3 border-t border-border/60 bg-white">
          <button
            type="button"
            onClick={onViewAllTheirs}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-black hover:text-[#503188] transition-colors cursor-pointer"
          >
            View all {theirs.length}
            <KatalistIcon name="view-all-arrow" className="h-3 w-3" />
          </button>
        </div>
      )}
    </aside>
  );
}
