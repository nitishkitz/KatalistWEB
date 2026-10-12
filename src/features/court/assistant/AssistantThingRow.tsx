import { MoreHorizontal } from "lucide-react";
import type { Thing } from "@/domain/thing";
import { getThingCapabilities } from "@/domain/capabilities";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";
import { SNOOZE_OPTIONS, type SnoozeOption } from "@/features/things/personal-snooze";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatCourtDue } from "../court-view-model";
import { KatalistIcon } from "../KatalistIcon";
import { pendingLabel, type RowActionKind } from "./use-assistant-row-actions";

export type RowNudgeState = { allowed: boolean; lastNudgedAt?: string; loading: boolean };

function minutesAgo(iso: string, now: number) {
  const minutes = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60_000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

const buttonBase =
  "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-default disabled:opacity-60";

export function AssistantThingRow({
  thing,
  myActorId,
  note,
  nudge,
  pending,
  error,
  onRun,
  onOpen,
}: {
  thing: Thing;
  myActorId: string | null;
  note?: string;
  nudge: RowNudgeState;
  pending?: RowActionKind;
  error?: string;
  onRun: (kind: RowActionKind, snooze?: SnoozeOption) => void;
  onOpen: (thingId: string) => void;
}) {
  const caps = getThingCapabilities(thing, myActorId);
  const avatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);
  const who = caps.isAssignee ? "You" : thing.assignee.name.split(" ")[0];
  const due = thing.dueAt ? formatCourtDue(thing) : null;
  const overdue = Boolean(
    thing.dueAt && new Date(thing.dueAt).getTime() < Date.now() && !caps.terminal,
  );
  const state = caps.terminal
    ? thing.workStatus === "sorted"
      ? "Sorted"
      : "Cancelled"
    : thing.acknowledgement === "waiting_for_catch"
      ? "Waiting for Catch"
      : "In progress";
  const busy = Boolean(pending);

  // One primary control, chosen by the same capability rules as the Court.
  const primary = (() => {
    if (pending)
      return (
        <span className={cn(buttonBase, "bg-slate-100 text-slate-600")} role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingLabel(pending)}
        </span>
      );
    if (caps.canCatch)
      return (
        <button
          type="button"
          onClick={() => onRun("catch")}
          className={cn(buttonBase, "bg-blue-600 text-white hover:bg-blue-700")}
        >
          Catch
        </button>
      );
    if (caps.canSort)
      return (
        <button
          type="button"
          onClick={() => onRun("sort")}
          className={cn(buttonBase, "bg-red-600 text-white hover:bg-red-700")}
        >
          Mark Sorted
        </button>
      );
    if (caps.canNudge) {
      if (nudge.lastNudgedAt)
        return (
          <span className="shrink-0 text-xs text-slate-500">
            Nudged {minutesAgo(nudge.lastNudgedAt, Date.now())}
          </span>
        );
      return (
        <button
          type="button"
          disabled={nudge.loading || !nudge.allowed}
          title={!nudge.loading && !nudge.allowed ? "Not nudgeable right now" : undefined}
          onClick={() => onRun("nudge")}
          className={cn(
            buttonBase,
            "border border-[#eaeffa] bg-[#eff1fc] text-[#1d1d1d] hover:bg-[#e6eafb]",
          )}
        >
          <KatalistIcon name="nudge-paw-tap" className="h-3 w-3" />
          Nudge
        </button>
      );
    }
    return null;
  })();

  return (
    <li className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-50/80">
      <PersonAvatar
        name={thing.assignee.name}
        initials={thing.assignee.initials}
        src={avatar}
        size={32}
      />
      <button
        type="button"
        onClick={() => onOpen(thing.id)}
        className="min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <span className="block break-words text-[13px] leading-snug text-slate-900 line-clamp-2">
          {thing.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{who}</span>
          <span aria-hidden="true">·</span>
          {due ? (
            <span className={cn("font-medium", overdue ? "text-red-600" : "text-slate-500")}>
              Due {due.label}
              {overdue ? " · Overdue" : ""}
            </span>
          ) : (
            <span>{state}</span>
          )}
          {note && (
            <>
              <span aria-hidden="true">·</span>
              <span>{note}</span>
            </>
          )}
        </span>
        {error && (
          <span className="mt-1 block text-xs text-red-700" role="alert">
            {error}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {primary}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={busy}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
            aria-label={`More actions for ${thing.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {!caps.terminal && (
              <>
                <DropdownMenuLabel className="text-xs text-slate-500">Snooze</DropdownMenuLabel>
                {SNOOZE_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.id} onSelect={() => onRun("snooze", option.id)}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => onOpen(thing.id)}>Open</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
