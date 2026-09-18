import { ArrowUp, Bell, Clock, EyeOff, Gauge, Play, SquareArrowOutUpRight } from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { KatalistIcon } from "@/features/court/KatalistIcon";
import { formatCourtDue } from "@/features/court/court-view-model";
import { useAvatarUrl } from "@/features/people/directory";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SNOOZE_OPTIONS } from "@/features/things/personal-snooze";
import type { CatchUpMoment } from "./use-catchup";
import {
  reasonLabelFor,
  relativeTimeLabel,
  type CatchUpActionId,
  type CatchUpMomentKind,
} from "./catchup-logic";

const KIND_CHIP: Record<CatchUpMomentKind, { bg: string; text: string }> = {
  nudge: { bg: "bg-red-50", text: "text-red-600" },
  snooze_ended: { bg: "bg-blue-50", text: "text-blue-600" },
  ghost: { bg: "bg-purple-50", text: "text-purple-600" },
  follow_up: { bg: "bg-amber-50", text: "text-amber-700" },
};

const ACTION_META: Record<CatchUpActionId, { label: string; icon: typeof Play }> = {
  catch: { label: "Catch & Start", icon: Play },
  set_pace: { label: "Set Pace", icon: Gauge },
  move_now: { label: "Move to Now", icon: ArrowUp },
  snooze: { label: "Snooze", icon: Clock },
  open: { label: "Open", icon: SquareArrowOutUpRight },
  nudge: { label: "Nudge again", icon: Bell },
  dismiss_ghost: { label: "Dismiss", icon: EyeOff },
};

const PACE_OPTIONS: { id: "now" | "next" | "later"; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "next", label: "Next" },
  { id: "later", label: "Later" },
];

type Props = {
  moment: CatchUpMoment;
  actions: CatchUpActionId[];
  busy: boolean;
  /** arg carries a SnoozeOption for "snooze" and a Pace for "set_pace". */
  onAction: (id: CatchUpActionId, arg?: string) => void;
};

export function CatchUpStackCard({ moment, actions, busy, onAction }: Props) {
  const { thing } = moment;
  const chip = KIND_CHIP[moment.kind];
  const facePerson = moment.actor ?? thing.assignee;
  const faceAvatar = useAvatarUrl(facePerson.name, null, facePerson.avatarUrl);
  const due = formatCourtDue(thing);
  const dueLabel = thing.dueAt ? due.label : null;
  const triggerLabel = `${reasonLabelFor(moment.kind, moment.reason)} · ${relativeTimeLabel(moment.occurredAt)}`;

  return (
    <div className="relative z-10 flex flex-col gap-4 rounded-[16px] border border-slate-200 bg-white p-5 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.18)]">
      {/* Header: who + trigger */}
      <div className="flex items-center gap-2.5">
        <PersonAvatar
          name={facePerson.name}
          initials={facePerson.initials}
          src={faceAvatar}
          size={30}
        />
        <span className="text-[13px] font-semibold text-slate-800">{facePerson.name}</span>
        <span
          className={cn(
            "ml-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            chip.bg,
            chip.text,
          )}
        >
          <Bell className="h-3 w-3" />
          {triggerLabel}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-slate-900 break-words">
        {thing.title}
      </h3>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <KatalistIcon name="list" className="h-3.5 w-3.5" />
          {thing.listName && thing.listName.toLowerCase() !== "standalone"
            ? thing.listName
            : "Standalone"}
        </span>
        {dueLabel ? (
          <span
            className={cn("inline-flex items-center gap-1.5", due.urgent ? "text-red-600 font-semibold" : "")}
          >
            <KatalistIcon name="calendar" className="h-3.5 w-3.5" />
            {dueLabel}
          </span>
        ) : null}
        {(thing.commentCount ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <KatalistIcon name="comment" className="h-3.5 w-3.5" />
            {thing.commentCount} {thing.commentCount === 1 ? "comment" : "comments"}
          </span>
        ) : null}
        {(thing.files?.length ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <KatalistIcon name="attachment" className="h-3.5 w-3.5" />
            {thing.files!.length} {thing.files!.length === 1 ? "file" : "files"}
          </span>
        ) : null}
      </div>

      {/* Description preview */}
      {thing.description ? (
        <p className="border-t border-slate-100 pt-3 text-[13px] leading-relaxed text-slate-600 line-clamp-2">
          {thing.description}
        </p>
      ) : (
        <div className="border-t border-slate-100" />
      )}

      {/* Contextual actions */}
      <div className="flex flex-wrap items-center gap-2.5">
        {actions.map((id, index) => {
          const meta = ACTION_META[id];
          const Icon = meta.icon;
          const primary = index === 0;

          if (id === "snooze" || id === "set_pace") {
            const options =
              id === "snooze"
                ? SNOOZE_OPTIONS.map((o) => ({ id: o.id as string, label: o.label }))
                : PACE_OPTIONS.map((o) => ({ id: o.id as string, label: o.label }));
            return (
              <DropdownMenu key={id}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-[10px] border px-4 text-[13px] font-semibold outline-none transition disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                      primary
                        ? "border-transparent bg-primary text-primary-foreground hover:brightness-95"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {meta.label}
                    <KatalistIcon name="chevron-down" className="h-3 w-3 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40 bg-white">
                  {options.map((opt) => (
                    <DropdownMenuItem
                      key={opt.id}
                      className="text-[12.5px]"
                      onSelect={() => onAction(id, opt.id)}
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          }

          return (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => onAction(id)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-[10px] border px-4 text-[13px] font-semibold outline-none transition disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                primary
                  ? "border-transparent bg-primary text-primary-foreground hover:brightness-95"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
              )}
            >
              <Icon className="h-4 w-4" />
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
