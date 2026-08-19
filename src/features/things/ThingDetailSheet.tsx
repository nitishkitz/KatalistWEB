import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Bell,
  Calendar,
  Check,
  Hand,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Importance, Pace, Thing, WorkStatus } from "@/domain/thing";
import { ImportanceBadge, PaceBadge } from "@/components/katalist/ImportanceBadge";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonCell } from "@/components/katalist/PersonCell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  rpcCancelThing,
  rpcCatchThing,
  rpcNudgeThing,
  rpcSetOwnerImportance,
  rpcSetPersonalPace,
  rpcSetWorkStatus,
  rpcSortThing,
} from "./rpc";

type Props = {
  thing: Thing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const paces: Pace[] = ["now", "next", "later"];
const importances: Importance[] = ["now", "next", "later"];
const statuses: WorkStatus[] = ["not_started", "under_progress", "sorted", "cancelled"];

function statusLabel(s: WorkStatus) {
  switch (s) {
    case "not_started":
      return "Not Started";
    case "under_progress":
      return "Under Progress";
    case "sorted":
      return "Sorted";
    case "cancelled":
      return "Cancelled";
  }
}

export function ThingDetailSheet({ thing, open, onOpenChange }: Props) {
  const qc = useQueryClient();

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["court"] });
  };

  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Action failed");
    },
  });

  const busy = run.isPending;

  if (!thing) return null;

  const dueLabel = thing.dueAt
    ? format(new Date(thing.dueAt), thing.dueHasTime ? "EEE, MMM d · h:mm a" : "EEE, MMM d")
    : "No due date";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-l border-border bg-card p-0 sm:max-w-[420px]"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="space-y-1 border-b border-border px-5 py-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <SheetTitle className="text-[16px] font-semibold leading-snug text-foreground">
                {thing.title}
              </SheetTitle>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[12px] text-muted-foreground">
              {thing.listName ?? "Standalone"} · {thing.context}
            </p>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* People */}
            <section className="space-y-2">
              <h3 className="katalist-section-title">People</h3>
              <div className="grid gap-2 rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">Owner</span>
                  <PersonCell person={thing.owner} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">With</span>
                  <PersonCell person={thing.assignee} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">Creator</span>
                  <PersonCell person={thing.creator} />
                </div>
              </div>
            </section>

            {/* State */}
            <section className="space-y-2">
              <h3 className="katalist-section-title">State</h3>
              <div className="flex flex-wrap gap-2">
                <ImportanceBadge value={thing.ownerImportance} />
                <PaceBadge value={thing.personalPace} />
                <AcknowledgementBadge value={thing.acknowledgement} />
                <WorkStatusBadge value={thing.workStatus} />
              </div>
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                {dueLabel}
              </p>
            </section>

            {/* My Pace */}
            <section className="space-y-2">
              <h3 className="katalist-section-title">My Pace</h3>
              <div className="flex gap-1.5">
                {paces.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run.mutate(async () => {
                        await rpcSetPersonalPace(thing.id, p);
                        toast.success(`Pace → ${p.toUpperCase()}`);
                      })
                    }
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide",
                      thing.personalPace === p
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </section>

            {/* Owner Importance */}
            <section className="space-y-2">
              <h3 className="katalist-section-title">Owner Importance</h3>
              <div className="flex gap-1.5">
                {importances.map((imp) => (
                  <button
                    key={imp}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run.mutate(async () => {
                        await rpcSetOwnerImportance(thing.id, imp);
                        toast.success(`Importance → ${imp.toUpperCase()}`);
                      })
                    }
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide",
                      thing.ownerImportance === imp
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {imp}
                  </button>
                ))}
              </div>
            </section>

            {/* Work Status */}
            <section className="space-y-2">
              <h3 className="katalist-section-title">Work Status</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {statuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run.mutate(async () => {
                        await rpcSetWorkStatus(thing.id, s);
                        toast.success(statusLabel(s));
                      })
                    }
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-left text-[12px] font-medium",
                      thing.workStatus === s
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {statusLabel(s)}
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Primary actions */}
          <div className="space-y-2 border-t border-border px-5 py-4">
            {thing.acknowledgement === "waiting_for_catch" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run.mutate(async () => {
                    await rpcCatchThing(thing.id);
                    toast.success("Caught.");
                  })
                }
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}
                Catch
              </button>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run.mutate(async () => {
                    await rpcNudgeThing(thing.id);
                    toast.success("Nudged.");
                  })
                }
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-[12.5px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                <Bell className="h-3.5 w-3.5" />
                Nudge
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run.mutate(async () => {
                    await rpcSortThing(thing.id);
                    toast.success("Sorted.");
                    onOpenChange(false);
                  })
                }
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-[12.5px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" />
                Sort
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run.mutate(async () => {
                  await rpcCancelThing(thing.id);
                  toast.success("Cancelled.");
                  onOpenChange(false);
                })
              }
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Cancel Thing
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
