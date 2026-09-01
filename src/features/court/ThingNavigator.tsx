import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import type { Thing } from "@/domain/thing";
import { matchProfile, useProfileDirectory } from "@/features/people/directory";
import { cn } from "@/lib/utils";
import { courtLaneContent } from "./CourtLaneStack";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { KatalistIcon } from "./KatalistIcon";

type ThingNavigatorProps = {
  lane: CourtLaneId;
  things: Thing[];
  selectedThingId: string;
  onSelect: (thingId: string) => void;
};

export function ThingNavigator({ lane, things, selectedThingId, onSelect }: ThingNavigatorProps) {
  const content = courtLaneContent[lane];
  const directory = useProfileDirectory();
  return (
    <nav
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border shadow-xs p-3",
        content.bgTone,
        content.borderTone,
      )}
      aria-label={`${content.label} Things`}
    >
      <div className="mb-2.5 px-1 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <KatalistIcon name={content.icon} className={cn("h-4 w-4", content.tone)} />
            <h2 className={cn("text-[12px] font-bold tracking-[0.08em]", content.tone)}>
              {content.label}
            </h2>
          </div>
          <p className="mt-0.5 text-[10.5px] text-muted-foreground">{content.descriptor}</p>
        </div>
        <span className={cn("text-[12px] font-bold pt-0.5", content.tone)}>
          {things.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5">
        {things.map((thing) => {
          const selected = selectedThingId === thing.id;
          const due = formatCourtDue(thing);
          const avatarUrl = thing.assignee.avatarUrl || matchProfile(directory, thing.assignee.name)?.avatar_url;
          const isProgress = thing.workStatus === "under_progress";
          return (
            <button
              key={thing.id}
              type="button"
              aria-current={selected}
              onClick={() => onSelect(thing.id)}
              className={cn(
                "w-full rounded-xl p-3 text-left shadow-2xs outline-none transition-all duration-200 focus-visible:ring-1 focus-visible:ring-primary/40",
                selected
                  ? "border-2 border-red-400 bg-white ring-2 ring-red-400/20 shadow-xs"
                  : "border border-border/60 bg-white hover:border-border",
              )}
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
                    "font-medium",
                    isProgress ? "text-blue-600" : "text-muted-foreground",
                  )}
                >
                  {isProgress ? "Under Progress" : "Not Started"}
                </span>
                {due.label && due.label !== "No due date" ? (
                  <>
                    <span className="text-muted-foreground/60">·</span>
                    <span
                      className={cn(
                        due.urgent ? "font-semibold text-red-500" : "text-muted-foreground",
                      )}
                    >
                      {due.label}
                    </span>
                  </>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
