import { Calendar, MoreHorizontal, Star } from "lucide-react";
import { format, isToday, isTomorrow, isThisWeek } from "date-fns";
import type { Thing } from "@/domain/thing";
import { AcknowledgementBadge } from "./AcknowledgementBadge";
import { WorkStatusBadge } from "./WorkStatusBadge";
import { PersonCell } from "./PersonCell";
import { cn } from "@/lib/utils";
import { rpcNudgeThing, rpcSortThing } from "@/features/things/rpc";
import { CatchActionButton } from "@/features/things/CatchActionButton";
import { toast } from "sonner";
import { getThingCapabilities } from "@/domain/capabilities";
import { useCurrentActor } from "@/features/people/use-current-actor";
import { domainErrorMessage } from "@/lib/domain-error";

function formatDue(thing: Thing): { label: string; urgent: boolean } | null {
  if (!thing.dueAt) return null;
  const d = new Date(thing.dueAt);
  if (isToday(d)) {
    return {
      label: thing.dueHasTime ? `Today ${format(d, "h:mm a")}` : "Today",
      urgent: true,
    };
  }
  if (isTomorrow(d)) return { label: "Tomorrow", urgent: true };
  if (isThisWeek(d)) return { label: format(d, "EEE"), urgent: false };
  return { label: format(d, "MMM d"), urgent: false };
}

export function ThingRow({
  thing,
  onSelect,
}: {
  thing: Thing;
  onSelect?: (thing: Thing) => void;
}) {
  const { actorId } = useCurrentActor();
  const due = formatDue(thing);
  const caps = getThingCapabilities(thing, actorId);
  const terminal = caps.terminal;

  return (
    <tr
      className="group cursor-pointer border-t border-border/80 hover:bg-muted/40"
      onClick={() => onSelect?.(thing)}
    >
      <td className="py-2.5 pr-3 pl-3">
        <div className="flex items-center gap-2.5">
          <Star className={cn("h-3.5 w-3.5 shrink-0", thing.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground/70")} />
          <span className="truncate text-[13px] font-medium text-foreground">{thing.title}</span>
        </div>
      </td>
      <td className="px-2">
        <PersonCell person={thing.assignee} />
      </td>
      <td className="px-2">
        <AcknowledgementBadge value={thing.acknowledgement} />
      </td>
      <td className="px-2">
        <WorkStatusBadge value={thing.workStatus} />
      </td>
      <td className="px-2">
        {due ? <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[12px]",
            due.urgent ? "font-medium text-status-now" : "text-muted-foreground",
          )}
        >
          <Calendar className="h-3.5 w-3.5 opacity-70" />
          {due.label}
        </span> : null}
      </td>
      <td className="px-2 text-[12px] text-muted-foreground">{thing.listName ?? null}</td>
      <td className="pr-2 text-right">
        <details className="relative" onClick={(e) => e.stopPropagation()}>
          <summary className="list-none rounded p-1 text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Thing actions</span>
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card py-1 text-left shadow-sm">
            <button type="button" className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-muted" onClick={() => onSelect?.(thing)}>
              Open
            </button>
            {caps.canCatch ? (
              <CatchActionButton
                thing={thing}
                className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-muted"
              >
                Catch
              </CatchActionButton>
            ) : null}
            {caps.canNudge ? (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-muted"
                onClick={() =>
                  void rpcNudgeThing(thing.id).then(
                    () => toast.success("Just a gentle paw tap on this one."),
                    (e: unknown) => toast.error(domainErrorMessage(e)),
                  )
                }
              >
                Nudge
              </button>
            ) : null}
            {caps.canSort ? (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-muted"
                onClick={() =>
                  void rpcSortThing(thing.id).then(
                    () => toast.success("Nicely sorted."),
                    (e: unknown) => toast.error(domainErrorMessage(e)),
                  )
                }
              >
                Sort
              </button>
            ) : null}
          </div>
        </details>
      </td>
    </tr>
  );
}

export function ThingTableHeader() {
  return (
    <thead>
      <tr className="text-left text-[11px] font-medium text-muted-foreground">
        <th className="pb-2 pl-3 font-medium">Thing</th>
        <th className="px-2 pb-2 font-medium">With</th>
        <th className="px-2 pb-2 font-medium">Ack</th>
        <th className="px-2 pb-2 font-medium">Status</th>
        <th className="px-2 pb-2 font-medium">Due</th>
        <th className="px-2 pb-2 font-medium">From</th>
        <th className="w-8 pb-2" />
      </tr>
    </thead>
  );
}
