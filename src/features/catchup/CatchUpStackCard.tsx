import { ArrowUp, Bell, ChevronLeft, ChevronRight, Clock, EyeOff, Gauge, MoreVertical, Play, SquareArrowOutUpRight } from "lucide-react";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
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
  inlineDetail?: boolean;
  /** arg carries a SnoozeOption for "snooze" and a Pace for "set_pace". */
  onAction: (id: CatchUpActionId, arg?: string) => void;
  /** Digest header controls (inline detail only). */
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  isLast?: boolean;
  onOpen?: () => void;
};

export function CatchUpStackCard({ moment, actions, busy, onAction, inlineDetail = false, onPrev, onNext, prevDisabled, isLast, onOpen }: Props) {
  const { thing } = moment;
  const chip = KIND_CHIP[moment.kind];
  const facePerson = moment.actor ?? thing.assignee;
  const faceAvatar = useAvatarUrl(facePerson.name, null, facePerson.avatarUrl);
  const due = formatCourtDue(thing);
  const dueLabel = thing.dueAt ? due.label : null;
  const triggerLabel = `${reasonLabelFor(moment.kind, moment.reason)} · ${relativeTimeLabel(moment.occurredAt)}`;

  return (
    <div data-thing-id={thing.id} className="brief-card relative z-10 flex flex-col gap-4 rounded-[16px] border border-slate-200 bg-white p-5 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.18)]">
      {/* Header: who + trigger */}
      <div className="brief-card-sender flex items-center gap-[10px]">
        <PersonAvatar
          name={facePerson.name}
          initials={facePerson.initials}
          src={faceAvatar}
          size={inlineDetail ? 33 : 36}
        />
        <span className="text-[12.2px] text-[#8286a2]">
          <span className="font-semibold text-[#30104d]">{facePerson.name}</span>
          <span className="brief-sender-context">{moment.actor ? " sent you an update" : " · your task"}</span>
        </span>
        <span
          className={cn(
            "brief-status inline-flex items-center gap-[5px] rounded-full px-[10px] py-[5.8px] text-[12px] leading-[1.4]",
            inlineDetail ? "bg-[#ffebd0] text-[#30104d]" : cn(chip.bg, chip.text, "font-semibold"),
          )}
        >
          <Bell className="h-[11.5px] w-[11.5px]" />
          {triggerLabel}
        </span>
        {inlineDetail ? (
          <>
            <span className="flex-1" />
            <span className="flex items-center gap-[3.2px]">
              <button
                type="button"
                onClick={onPrev}
                disabled={prevDisabled || busy}
                aria-label="Previous"
                className="flex h-[29.5px] w-[29.5px] cursor-pointer items-center justify-center rounded-full border-[1.28px] border-[#e6e3ed] bg-white text-[#30104d] outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#8d2bf5]"
              >
                <ChevronLeft className="h-[15px] w-[15px]" />
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={busy}
                aria-label={isLast ? "Finish" : "Next"}
                className="flex h-[29.5px] w-[29.5px] cursor-pointer items-center justify-center rounded-full border-[1.28px] border-[#e6e3ed] bg-white text-[#30104d] outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#8d2bf5]"
              >
                <ChevronRight className="h-[15px] w-[15px]" />
              </button>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More options"
                  className="flex h-[29.5px] w-[24.4px] cursor-pointer items-center justify-center text-[#30104d] outline-none focus-visible:ring-2 focus-visible:ring-[#8d2bf5]"
                >
                  <MoreVertical className="h-[15px] w-[15px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-white">
                <DropdownMenuItem className="text-[12.5px]" onSelect={() => onOpen?.()}>
                  Open thing
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>

      {!inlineDetail && <>
      {/* Title */}
      <h3 className="brief-task-title text-[22px] font-bold leading-tight tracking-[-0.01em] text-slate-900 break-words">
        {thing.title}
      </h3>

      {/* Meta row */}
      <div className="brief-task-meta flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-slate-500">
        {thing.listName && thing.listName.trim().toLowerCase() !== "standalone" ? (
          <span className="inline-flex items-center gap-1.5">
            <KatalistIcon name="list" className="h-3.5 w-3.5" />
            {thing.listName}
          </span>
        ) : null}
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
        {(thing.attachmentCount ?? thing.files?.length ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <KatalistIcon name="attachment" className="h-3.5 w-3.5" />
            {thing.attachmentCount ?? thing.files?.length ?? 0} {(thing.attachmentCount ?? thing.files?.length ?? 0) === 1 ? "file" : "files"}
          </span>
        ) : null}
        {thing.overviewStatsUnavailable && <span title="Open this Thing to retry its counts">Counts unavailable</span>}
      </div>

      {/* Description preview */}
      {thing.description ? (
        <p className="border-t border-slate-100 pt-3 text-[13px] leading-relaxed text-slate-600 line-clamp-2">
          {thing.description}
        </p>
      ) : (
        <div className="border-t border-slate-100" />
      )}

      </>}

      {/* Contextual actions retain Morning Brief receipt handling. */}
      <div className="brief-actions flex flex-wrap items-center gap-2.5">
        {actions.filter((id) => !inlineDetail || id !== "open").map((id, index) => {
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
                    data-primary={primary}
                    className={cn(
                      "brief-action inline-flex h-10 items-center gap-2 rounded-[10px] border px-4 text-[13px] font-semibold outline-none transition disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
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
              data-primary={primary}
              data-action={id}
              onClick={() => onAction(id)}
              className={cn(
                "brief-action inline-flex h-10 items-center gap-2 rounded-[10px] border px-4 text-[13px] font-semibold outline-none transition disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
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
      {inlineDetail && (
        <div className="brief-thing-content">
          {thing.listName && thing.listName.trim().toLowerCase() !== "standalone" && (
            <p className="mb-3 text-xs text-muted-foreground">{thing.listName}</p>
          )}
          <ThingDetailContent key={thing.id} initialThing={thing} variant="court" reviewActionsExternal />
        </div>
      )}
    </div>
  );
}
