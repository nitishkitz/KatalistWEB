import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import type { Thing } from "@/domain/thing";
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

  return (
    <aside
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border shadow-xs",
        content.bgTone,
        content.borderTone,
      )}
      aria-label={`${content.label} lane, ${things.length} Things`}
    >
      <div className="flex min-h-12 items-center gap-2 border-b border-border/45 px-3">
        <KatalistIcon name={content.icon} className={cn("h-4 w-4", content.tone)} />
        <h2 className={cn("text-[11px] font-bold tracking-[0.08em]", content.tone)}>
          {content.label}
        </h2>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {things.length}
        </span>
      </div>
      <div className="space-y-2 p-2">
        {things.slice(0, 3).map((thing) => (
          <button
            key={thing.id}
            type="button"
            onClick={(event) => onOpen(thing, event.currentTarget)}
            className="w-full rounded-xl border border-border/70 bg-white px-2.5 py-2.5 text-left shadow-xs outline-none transition-[border-color,box-shadow] duration-200 hover:border-primary/35 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <span className="block line-clamp-2 text-[11px] font-semibold leading-4 text-foreground">
              {thing.title}
            </span>
            <span className="mt-2 flex items-center gap-1.5 text-[9.5px] text-muted-foreground">
              <PersonAvatar
                name={thing.assignee.name}
                initials={thing.assignee.initials}
                src={thing.assignee.avatarUrl}
                size={18}
              />
              <span className="truncate">{workLabel[thing.workStatus]}</span>
            </span>
          </button>
        ))}
        {things.length > 3 ? (
          <p className="py-1 text-center text-[10px] text-muted-foreground">
            {things.length - 3} more
          </p>
        ) : null}
      </div>
    </aside>
  );
}
