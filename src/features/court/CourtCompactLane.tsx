import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import type { Thing } from "@/domain/thing";
import { matchProfile, useProfileDirectory } from "@/features/people/directory";
import { cn } from "@/lib/utils";
import { courtLaneContent } from "./CourtLaneStack";
import type { CourtLaneId } from "./court-view-model";
import { KatalistIcon } from "./KatalistIcon";

type CourtCompactLaneProps = {
  lane: CourtLaneId;
  things: Thing[];
  onOpen: (thing: Thing, origin: HTMLElement) => void;
};

const workLabel: Record<Thing["workStatus"], string> = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

export function CourtCompactLane({ lane, things, onOpen }: CourtCompactLaneProps) {
  const content = courtLaneContent[lane];
  const directory = useProfileDirectory();

  return (
    <aside
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border shadow-xs p-3",
        content.bgTone,
        content.borderTone,
      )}
      aria-label={`${content.label} lane, ${things.length} Things`}
    >
      <div className="mb-2.5 px-1">
        <div className="flex items-center gap-2">
          <KatalistIcon name={content.icon} className={cn("h-4 w-4", content.tone)} />
          <h2 className={cn("text-[12px] font-bold tracking-[0.08em]", content.tone)}>
            {content.label}
          </h2>
          <span className={cn("ml-1 text-[11px] font-bold", content.tone)}>
            {things.length}
          </span>
        </div>
        <p className="mt-0.5 text-[10.5px] text-muted-foreground">{content.descriptor}</p>
      </div>

      <div className="space-y-2">
        {things.slice(0, 3).map((thing) => {
          const avatarUrl = thing.assignee.avatarUrl || matchProfile(directory, thing.assignee.name)?.avatar_url;
          const isCatch = thing.acknowledgement === "waiting_for_catch";
          const isProgress = thing.workStatus === "under_progress";
          return (
            <button
              key={thing.id}
              type="button"
              onClick={(event) => onOpen(thing, event.currentTarget)}
              className="w-full rounded-xl border border-border/60 bg-white p-3 text-left shadow-2xs outline-none transition-all duration-200 hover:border-border hover:shadow-xs focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block line-clamp-2 text-[12px] font-bold leading-snug text-foreground">
                {thing.title}
              </span>
              <span className="mt-2 flex items-center gap-1.5 text-[10px]">
                <PersonAvatar
                  name={thing.assignee.name}
                  initials={thing.assignee.initials}
                  src={avatarUrl}
                  size={18}
                />
                <span
                  className={cn(
                    "truncate font-medium",
                    isCatch
                      ? "text-orange-500 font-semibold"
                      : isProgress
                        ? "text-blue-600"
                        : "text-muted-foreground",
                  )}
                >
                  {isCatch ? "Waiting for Catch" : workLabel[thing.workStatus]}
                </span>
              </span>
            </button>
          );
        })}
        {things.length > 3 ? (
          <p className="pt-1 text-center text-[10.5px] font-medium text-muted-foreground">
            + {things.length - 3} more ∨
          </p>
        ) : null}
      </div>
    </aside>
  );
}
