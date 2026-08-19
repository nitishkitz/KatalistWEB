import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Bell,
  Calendar,
  Check,
  Hand,
  Loader2,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { domainErrorMessage } from "@/lib/domain-error";
import type { Importance, Pace, Thing, WorkStatus } from "@/domain/thing";
import { ImportanceBadge, PaceBadge } from "@/components/katalist/ImportanceBadge";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonCell } from "@/components/katalist/PersonCell";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  rpcAddToBucket,
  rpcCancelThing,
  rpcCatchThing,
  rpcNudgeThing,
  rpcReassignThing,
  rpcSetDue,
  rpcSetOwnerImportance,
  rpcSetPersonalPace,
  rpcSetWorkStatus,
  rpcShred,
  rpcSortThing,
} from "./rpc";
import { getThingCapabilities } from "@/domain/capabilities";
import { useCourt } from "@/features/court/use-court";
import { useThing } from "./use-thing";
import { useThingComments } from "./use-thing-comments";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { useBuckets } from "@/features/buckets/use-buckets";

type Props = {
  thing: Thing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const paces: Pace[] = ["now", "next", "later"];
const importances: Importance[] = ["now", "next", "later"];
const statuses: WorkStatus[] = ["not_started", "under_progress", "sorted"];

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

export function ThingDetailSheet({ thing: initial, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const court = useCourt();
  const live = useThing(initial?.id ?? null);
  const thing = live.thing ?? initial;
  const caps = thing ? getThingCapabilities(thing, court.myActorId) : null;
  const thread = useThingComments(thing?.id ?? null);
  const people = useAssignablePeople();
  const { buckets } = useBuckets();
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comment, setComment] = useState("");
  const [due, setDue] = useState("");

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["court"] }),
      qc.invalidateQueries({ queryKey: ["thing"] }),
      qc.invalidateQueries({ queryKey: ["lists"] }),
      qc.invalidateQueries({ queryKey: ["list"] }),
      qc.invalidateQueries({ queryKey: ["buckets"] }),
      qc.invalidateQueries({ queryKey: ["nudges"] }),
      qc.invalidateQueries({ queryKey: ["trophy"] }),
      qc.invalidateQueries({ queryKey: ["notifications"] }),
    ]);
  };

  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (err) => {
      toast.error(domainErrorMessage(err));
    },
  });

  const comments = thread.comments;
  const events = thread.activity;
  const busy = run.isPending;

  if (!thing) return null;
  const terminal = caps?.terminal ?? false;
  const dueLabel = thing.dueAt
    ? format(new Date(thing.dueAt), thing.dueHasTime ? "EEE, MMM d · h:mm a" : "EEE, MMM d")
    : "No due date";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border bg-card p-0 sm:max-w-[440px]">
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
            <section className="space-y-2">
              <h3 className="katalist-section-title">People</h3>
              <div className="grid gap-2 rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">Creator</span>
                  <PersonCell person={thing.creator} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">Owner</span>
                  <PersonCell person={thing.owner} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">Current Assignee</span>
                  <PersonCell person={thing.assignee} />
                </div>
              </div>
              {!terminal ? (
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <UserPlus className="h-3.5 w-3.5" />
                  Reassign
                  <select
                    className="ml-auto h-8 rounded-md border border-border bg-card px-2 text-[12px] text-foreground"
                    defaultValue={thing.assignee.id}
                    onChange={(e) =>
                      run.mutate(async () => {
                        await rpcReassignThing(thing.id, e.target.value);
                        toast.success("Waiting for Catch.");
                      })
                    }
                  >
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="katalist-section-title">State</h3>
              <div className="flex flex-wrap gap-2">
                <ImportanceBadge value={thing.ownerImportance} />
                <PaceBadge value={thing.personalPace} />
                <AcknowledgementBadge value={thing.acknowledgement} />
                <WorkStatusBadge value={thing.workStatus} />
              </div>
            </section>

            {caps?.canSetPace ? (
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
            ) : thing.acknowledgement === "waiting_for_catch" && caps?.isAssignee ? (
              <p className="text-[12px] text-muted-foreground">Personal Pace unlocks after Catch.</p>
            ) : thing.personalPace ? (
              <p className="text-[12px] text-muted-foreground">
                Assignee pace: <span className="font-semibold uppercase">{thing.personalPace}</span> (read only)
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">Personal Pace is assignee-controlled after Catch.</p>
            )}

            <section className="space-y-2">
              <h3 className="katalist-section-title">Owner Importance</h3>
              <div className="flex gap-1.5">
                {importances.map((imp) => (
                  <button
                    key={imp}
                    type="button"
                    disabled={busy || !caps?.canSetImportance}
                    onClick={() => {
                      if (!caps?.canSetImportance) return;
                      run.mutate(async () => {
                        await rpcSetOwnerImportance(thing.id, imp);
                      });
                    }}
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

            <section className="space-y-2">
              <h3 className="katalist-section-title">Work Status</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {statuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy || terminal || (s === "sorted" ? !caps?.canSort : !caps?.canSetStatus)}
                    onClick={() =>
                      run.mutate(async () => {
                        if (s === "sorted") await rpcSortThing(thing.id);
                        else await rpcSetWorkStatus(thing.id, s);
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

            <section className="space-y-2">
              <h3 className="katalist-section-title">Due</h3>
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                {dueLabel}
              </p>
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-[12px]"
                />
                <button
                  type="button"
                  className="rounded-md border border-border px-2 text-[12px]"
                  onClick={() => {
                    if (!due) return;
                    const iso = new Date(due).toISOString();
                    run.mutate(async () => rpcSetDue(thing.id, iso, true));
                  }}
                >
                  Set
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="katalist-section-title">Add to Bucket</h3>
              <select
                className="h-8 w-full rounded-md border border-border bg-card px-2 text-[12px]"
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value || !caps?.canAddToBucket) return;
                  run.mutate(async () => {
                    await rpcAddToBucket(e.target.value, thing.id);
                    toast.success("Referenced in bucket. Thing unchanged.");
                  });
                  e.target.value = "";
                }}
              >
                <option value="">Choose a private bucket…</option>
                {buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </section>

            <section>
              <div className="mb-2 flex gap-1 rounded-lg border border-border p-0.5">
                {(["comments", "activity"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={cn(
                      "flex-1 rounded-md py-1.5 text-[12px] font-medium capitalize",
                      tab === id ? "bg-muted text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {id}
                  </button>
                ))}
              </div>
              {tab === "comments" ? (
                <div className="space-y-2">
                  {comments.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">No comments yet.</p>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="rounded-lg border border-border bg-background px-3 py-2">
                        <p className="text-[12px] font-medium">{c.author}</p>
                        <p className="text-[12.5px] text-foreground">{c.body}</p>
                      </div>
                    ))
                  )}
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!comment.trim()) return;
                      void thread.post.mutateAsync(comment.trim()).then(
                        () => setComment(""),
                        (err) => toast.error(domainErrorMessage(err)),
                      );
                    }}
                  >
                    <input
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Write a comment…"
                      className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-[12px]"
                    />
                    <button type="submit" className="rounded-md bg-primary px-2 text-[12px] text-primary-foreground">
                      Post
                    </button>
                  </form>
                  {thing.workStatus === "sorted" ? (
                    <p className="text-[11px] text-muted-foreground">Comments stay open. They don’t reopen Sorted.</p>
                  ) : null}
                </div>
              ) : (
                <ul className="space-y-2">
                  {events.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">Movement will appear here.</p>
                  ) : (
                    events.map((ev) => (
                      <li key={ev.id} className="text-[12px] text-muted-foreground">
                        <span className="font-medium text-foreground">{ev.event.replaceAll("_", " ")}</span>
                        <span className="ml-2">{format(new Date(ev.at), "MMM d · h:mm a")}</span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </section>
          </div>

          <div className="space-y-2 border-t border-border px-5 py-4">
            {caps?.canCatch ? (
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
                Caught It
              </button>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || !caps?.canNudge}
                onClick={() =>
                  run.mutate(async () => {
                    await rpcNudgeThing(thing.id);
                    toast.success("Just a gentle paw tap on this one.");
                  })
                }
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-[12.5px] font-medium"
              >
                <Bell className="h-3.5 w-3.5" />
                Nudge
              </button>
              <button
                type="button"
                disabled={busy || !caps?.canSort}
                onClick={() =>
                  run.mutate(async () => {
                    await rpcSortThing(thing.id);
                    toast.success("Nicely sorted.");
                    onOpenChange(false);
                  })
                }
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-[12.5px] font-medium"
              >
                <Check className="h-3.5 w-3.5" />
                Sort
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || !caps?.canCancel}
                onClick={() =>
                  run.mutate(async () => {
                    await rpcCancelThing(thing.id);
                    toast.success("Cancelled.");
                    onOpenChange(false);
                  })
                }
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void rpcShred(thing.id);
                  toast.success("Shredded from your surfaces.");
                  onOpenChange(false);
                }}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border text-[12.5px]"
              >
                Shred for me
              </button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
