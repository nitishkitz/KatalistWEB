import type { Thing } from "@/domain/thing";
import type { CourtCardDensity, CourtLaneId } from "./court-view-model";
import { formatCourtDue } from "./court-view-model";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";
import { CatchActionButton } from "@/features/things/CatchActionButton";
import { ArrowRight } from "lucide-react";

const workLabel = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
} as const;

const workIcon: Record<Thing["workStatus"], KatalistIconName> = {
  not_started: "not-started",
  under_progress: "under-progress",
  sorted: "sorted",
  cancelled: "stale",
};

const laneTone: Record<CourtLaneId, { edge: string; border: string; text: string }> = {
  now: { edge: "bg-status-now", border: "border-l-status-now", text: "text-status-now" },
  next: { edge: "bg-status-next", border: "border-l-status-next", text: "text-status-next" },
  later: { edge: "bg-status-later", border: "border-l-status-later", text: "text-status-later" },
};

function relativeTime(value: string | null, now = new Date()) {
  if (!value) return null;
  const elapsed = Math.max(0, now.getTime() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function movementLabel(thing: Thing) {
  if (thing.acknowledgement === "waiting_for_catch") {
    return `Waiting ${relativeTime(thing.updatedAt) ?? "for Catch"}`;
  }
  if (thing.caughtAt) return `Caught ${relativeTime(thing.caughtAt) ?? "recently"}`;
  return `Updated ${relativeTime(thing.updatedAt) ?? "recently"}`;
}

function StatusMark({ thing }: { thing: Thing }) {
  const waiting = thing.acknowledgement === "waiting_for_catch";
  const statusTone = waiting
    ? "text-status-waiting"
    : thing.workStatus === "under_progress"
      ? "text-status-next"
      : thing.workStatus === "sorted"
        ? "text-status-caught"
        : "text-status-neutral";
  const statusIcon = waiting
    ? "waiting"
    : thing.workStatus === "under_progress"
      ? "under-progress"
      : workIcon[thing.workStatus];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        statusTone,
      )}
    >
      <KatalistIcon name={statusIcon} className="h-3.5 w-3.5" />
      {waiting ? "Waiting for Catch" : workLabel[thing.workStatus]}
    </span>
  );
}

function CardCatchButton({ thing }: { thing: Thing }) {
  return (
    <CatchActionButton
      thing={thing}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-primary bg-white px-2 text-[10px] font-medium text-primary outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-ring"
    >
      <KatalistIcon name="catch" className="h-3.5 w-3.5" />
      Catch
    </CatchActionButton>
  );
}

export function CourtThingCard({
  thing,
  density,
  lane,
  muted = false,
  onSelect,
}: {
  thing: Thing;
  density: CourtCardDensity;
  lane?: CourtLaneId;
  muted?: boolean;
  onSelect: (thing: Thing) => void;
}) {
  const due = formatCourtDue(thing);
  const tone = lane ? laneTone[lane] : laneTone.later;
  const assigneeAvatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);
  const assignedByAvatar = useAvatarUrl(thing.assignedBy.name, null, thing.assignedBy.avatarUrl);
  const open = () => onSelect(thing);

  if (density === "peek") {
    return (
      <div
        className={cn(
          "group relative flex min-h-[62px] w-full items-center gap-2 border-b border-border/70 bg-white px-2 py-2.5",
          muted && "text-muted-foreground",
        )}
      >
        <button
          type="button"
          onClick={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className={cn("h-5 w-0.5 shrink-0 rounded-full", tone.edge)} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-medium text-foreground">
              {thing.title}
            </span>
            <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <KatalistIcon
                name={thing.acknowledgement === "waiting_for_catch" ? "waiting" : workIcon[thing.workStatus]}
                className="h-3 w-3"
              />
              <span className="truncate">
                {thing.acknowledgement === "waiting_for_catch"
                  ? "Waiting for Catch"
                  : workLabel[thing.workStatus]}
              </span>
              {due ? <><span aria-hidden="true">·</span><span className={cn("truncate", due.urgent && "text-status-now")}>{due.label}</span></> : null}
            </span>
          </span>
        </button>
        <CardCatchButton thing={thing} />
      </div>
    );
  }

  return (
    <div className={cn("group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-l-2 border-border/70 bg-white px-3 py-2", density === "focused" ? "min-h-[96px]" : "min-h-[56px]", muted && "text-muted-foreground", tone.border)}>
      <button
        type="button"
        onClick={open}
        className={cn(
          "min-w-0 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="block truncate text-[12.5px] font-semibold leading-5 text-foreground">
          {thing.title}
        </span>

        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
          {thing.assignedBy.id === thing.assignee.id ? <span className="inline-flex min-w-0 items-center gap-1.5" aria-label={`Self-assigned by ${thing.assignee.name}`}><PersonAvatar name={thing.assignee.name} initials={thing.assignee.initials} src={assigneeAvatar} size={18} /><span className="truncate font-medium text-foreground">Self-assigned</span></span> : <span className="inline-flex min-w-0 items-center gap-1" aria-label={`Assigned by ${thing.assignedBy.name} to ${thing.assignee.name}`} title={`${thing.assignedBy.name} → ${thing.assignee.name}`}><PersonAvatar name={thing.assignedBy.name} initials={thing.assignedBy.initials} src={assignedByAvatar} size={18} /><ArrowRight className="h-3 w-3 shrink-0" /><PersonAvatar name={thing.assignee.name} initials={thing.assignee.initials} src={assigneeAvatar} size={18} />{density === "focused" ? <span className="truncate font-medium text-foreground">{thing.assignedBy.name} → {thing.assignee.name}</span> : null}</span>}
          <StatusMark thing={thing} />
          {due ? <span
            className={cn(
              "inline-flex items-center gap-1",
              due.urgent && "font-medium text-status-now",
            )}
          >
            <KatalistIcon name="calendar" className="h-3 w-3" />
            {due.label}
          </span> : null}
          {thing.listName ? <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <KatalistIcon name="list" className="h-3 w-3 shrink-0" />
            <span className="truncate">{thing.listName}</span>
          </span> : null}
        </span>

        {density === "focused" ? (
          <span className="mt-1.5 block text-[10px] text-muted-foreground">
            {movementLabel(thing)} · {thing.context === "work" ? "Work" : "Home"} update
          </span>
        ) : null}
      </button>

      <span className="flex shrink-0 items-center gap-1">
        <CardCatchButton thing={thing} />
        {thing.starred ? (
          <span className="text-status-waiting" title="Starred">
            <KatalistIcon name="favourite-star" className="h-3.5 w-3.5 fill-current" />
            <span className="sr-only">Starred</span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={open}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          aria-label={`Open ${thing.title}`}
          title="Open details"
        >
          <KatalistIcon name="more-ellipsis" className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}
