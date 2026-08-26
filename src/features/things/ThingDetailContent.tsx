import { useEffect, useState } from "react";
import type * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Bell,
  Calendar,
  Check,
  ChevronDown,
  Hand,
  List as ListIcon,
  Lock,
  MoreHorizontal,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { domainErrorMessage } from "@/lib/domain-error";
import type { Importance, Pace, Thing, WorkStatus } from "@/domain/thing";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonCell } from "@/components/katalist/PersonCell";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  rpcAddToBucket,
  rpcAssignOutsideKatalist,
  rpcCancelThing,
  rpcNudgeThing,
  rpcRemoveFromBucket,
  rpcReassignThing,
  rpcSetDue,
  rpcSetPersonalPace,
  rpcSetWorkStatus,
  rpcShred,
  rpcSortThing,
} from "./rpc";
import { invalidatePersonalSurfaces } from "./personal-shred";
import { getThingCapabilities } from "@/domain/capabilities";
import { useCurrentActor } from "@/features/people/use-current-actor";
import { useThing } from "./use-thing";
import { useThingComments } from "./use-thing-comments";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { useAvatarUrl } from "@/features/people/directory";
import { useBuckets } from "@/features/buckets/use-buckets";
import { selectedBucketIds } from "@/features/buckets/bucket-items-surface";
import { ThingAttachments } from "@/features/attachments/ThingAttachments";
import { CatchActionButton } from "./CatchActionButton";

export type ThingDetailContentProps = {
  initialThing: Thing | null;
  headerAction?: React.ReactNode;
  onAfterTerminalAction?: () => void;
};

const paces: Pace[] = ["now", "next", "later"];
const statuses: WorkStatus[] = ["not_started", "under_progress", "sorted"];
const importanceDisplay: Record<Importance, string> = {
  now: "High",
  next: "Medium",
  later: "Low",
};
const paceTone: Record<Pace, string> = {
  now: "text-status-now",
  next: "text-status-next",
  later: "text-status-later",
};
const importanceTone: Record<Importance, { text: string; active: string }> = {
  now: { text: "text-status-now", active: "border-status-now/25 bg-status-now/5" },
  next: { text: "text-status-next", active: "border-status-next/25 bg-status-next/5" },
  later: { text: "text-status-later", active: "border-status-later/25 bg-status-later/5" },
};

function initialsForName(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || "?";
}

function CommentRow({ author, body, at }: { author: string; body: string; at: string }) {
  const avatarUrl = useAvatarUrl(author);

  return (
    <div className="flex gap-2.5 rounded-lg border border-border/70 bg-white px-3 py-2">
      <PersonAvatar name={author} initials={initialsForName(author)} src={avatarUrl} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-[11px] font-semibold text-foreground">{author}</p>
          <time className="shrink-0 text-[10px] text-muted-foreground">
            {format(new Date(at), "MMM d · h:mm a")}
          </time>
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground">{body}</p>
      </div>
    </div>
  );
}

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

function AssignOutsideBlock({
  thingId,
  disabled,
  onIssued,
}: {
  thingId: string;
  disabled: boolean;
  onIssued: (fn: () => Promise<unknown>) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [bridgePath, setBridgePath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-white">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setExpanded((current) => !current)}
        className="flex h-8 w-full items-center gap-2 px-3 text-left text-[11px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        aria-expanded={expanded}
      >
        <span>Assign outside Katalist</span>
        {disabled ? <Lock className="ml-auto h-3.5 w-3.5 text-muted-foreground" /> : null}
        {!disabled ? (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {expanded ? "Hide" : "Open"}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-border/70 p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="h-8 w-full rounded-md border border-border bg-white px-2 text-[12px]"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="h-8 w-full rounded-md border border-border bg-white px-2 text-[12px]"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            className="h-8 w-full rounded-md border border-border bg-white px-2 text-[12px]"
          />
          <button
            type="button"
            className="h-8 w-full rounded-md border border-border text-[12px]"
            onClick={() =>
              onIssued(async () => {
                const result = await rpcAssignOutsideKatalist({
                  thingId,
                  displayName: name,
                  email,
                  phone,
                });
                setBridgePath(result.path);
                toast.success("Bridge opened. Share this link.");
              })
            }
          >
            Create Bridge link
          </button>
          {bridgePath ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                {bridgePath}
              </code>
              <button
                type="button"
                className="shrink-0 text-[12px] text-primary"
                onClick={() => {
                  const absolute = `${window.location.origin}${bridgePath}`;
                  void navigator.clipboard.writeText(absolute).then(
                    () => toast.success("Bridge link copied."),
                    () => toast.error("Copy the Bridge path from the field."),
                  );
                }}
              >
                Copy link
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ThingDetailContent({
  initialThing,
  headerAction,
  onAfterTerminalAction,
}: ThingDetailContentProps): React.ReactNode {
  const qc = useQueryClient();
  const currentActor = useCurrentActor();
  const live = useThing(initialThing?.id ?? null);
  const thing = live.thing ?? initialThing;
  const caps = thing ? getThingCapabilities(thing, currentActor.actorId) : null;
  const thread = useThingComments(thing?.id ?? null);
  const people = useAssignablePeople();
  const { buckets } = useBuckets();
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comment, setComment] = useState("");
  const [due, setDue] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [thing?.id]);

  const invalidate = async () => {
    await invalidatePersonalSurfaces(qc);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["thing"] }),
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

  const bucketRun = useMutation({
    mutationFn: async ({ bucketId, action }: { bucketId: string; action: "add" | "remove" }) => {
      if (!thing) return;
      if (action === "add") await rpcAddToBucket(bucketId, thing.id);
      else await rpcRemoveFromBucket(bucketId, thing.id);
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["buckets"] }),
        qc.invalidateQueries({ queryKey: ["bucket"] }),
        qc.invalidateQueries({ queryKey: ["bucket-items"] }),
      ]);
      toast.success(variables.action === "add" ? "Added to Bucket." : "Removed from Bucket.");
    },
    onError: (err) => toast.error(domainErrorMessage(err)),
  });

  const comments = thread.comments;
  const events = thread.activity;
  const busy = run.isPending;

  if (!thing) return null;
  const terminal = caps?.terminal ?? false;
  const canAssignOutside = Boolean(caps?.isOwner && !terminal);
  const hasMoreActions = Boolean(
    caps?.canSetDue ||
    canAssignOutside ||
    caps?.canCatch ||
    caps?.canNudge ||
    caps?.canSort ||
    caps?.canCancel ||
    caps?.canShred,
  );
  const activePace: Pace = thing.personalPace ?? "next";
  const selectedBuckets = selectedBucketIds(buckets, thing.id);
  const dueLabel = thing.dueAt
    ? format(new Date(thing.dueAt), thing.dueHasTime ? "EEE, MMM d · h:mm a" : "EEE, MMM d")
    : null;

  return (
    <div className="min-h-full">
      <header className="space-y-1 px-8 py-5 text-left">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-semibold leading-snug text-foreground">{thing.title}</h2>
          {headerAction}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {thing.listName ? `${thing.listName} · ` : ""}{thing.context}
        </p>
        <p className={cn("text-[11px] font-medium", importanceTone[thing.ownerImportance].text)}>
          {importanceDisplay[thing.ownerImportance]} importance
        </p>
      </header>

      <div className="space-y-5 px-8 py-5">
        <ThingAttachments thingId={thing.id} />
        <section className="space-y-1.5">
          <h3 className="katalist-section-title">People</h3>
          <div className="grid gap-1 rounded-lg border border-border/70 bg-white p-3">
            <div className="flex min-h-7 items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Creator</span>
              <PersonCell person={thing.creator} />
            </div>
            <div className="flex min-h-7 items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Owner</span>
              <PersonCell person={thing.owner} />
            </div>
            <div className="flex min-h-7 items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Current Assignee</span>
              <PersonCell person={thing.assignee} />
            </div>
          </div>
          <label className="flex h-9 items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <UserPlus className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium text-foreground">Reassign</span>
            <select
              disabled={busy || !caps?.canReassign}
              className="ml-auto h-8 max-w-[170px] rounded-lg border border-border bg-white px-2 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              id="thing-detail-reassign"
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
            {!caps?.canReassign ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
          </label>
        </section>

        {caps?.canAddToBucket ? (
          <section className="space-y-1.5">
            <h3 className="katalist-section-title">Add to Bucket</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-white px-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ListIcon className="h-3.5 w-3.5 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {selectedBuckets.size === 0 ? "Choose Buckets…" : `${selectedBuckets.size} Bucket${selectedBuckets.size === 1 ? "" : "s"} selected`}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[320px] max-w-[calc(100vw-4rem)] bg-white">
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">Add to one or more Buckets</DropdownMenuLabel>
                {buckets.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-muted-foreground">Create a Bucket first, then add this Thing here.</p>
                ) : buckets.map((bucket) => {
                  const checked = selectedBuckets.has(bucket.id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={bucket.id}
                      checked={checked}
                      disabled={bucketRun.isPending}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={() => bucketRun.mutate({ bucketId: bucket.id, action: checked ? "remove" : "add" })}
                      className="text-[12px]"
                    >
                      <span className="min-w-0 flex-1 truncate">{bucket.name}</span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </section>
        ) : null}

        <section className="space-y-1.5">
          <h3 className="katalist-section-title">Acknowledgement &amp; Status</h3>
          <div className="flex flex-wrap gap-2">
            <AcknowledgementBadge value={thing.acknowledgement} />
            <WorkStatusBadge
              value={thing.workStatus}
              className={
                thing.workStatus === "under_progress"
                  ? "bg-status-next/10 text-status-next"
                  : undefined
              }
            />
          </div>
          {caps?.canCatch ? (
            <CatchActionButton
              thing={thing}
              className="flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-primary bg-white text-[11px] font-medium text-primary hover:bg-white"
            >
              <Hand className="h-3.5 w-3.5" />
              Catch
            </CatchActionButton>
          ) : null}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h3 className="katalist-section-title">Pace</h3>
            {!caps?.canSetPace ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
          </div>
          <div className="relative pt-1">
            <div className="grid grid-cols-3">
              {paces.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={busy || !caps?.canSetPace}
                  onClick={() =>
                    run.mutate(async () => {
                      await rpcSetPersonalPace(thing.id, p);
                    })
                  }
                  className={cn(
                    "relative z-10 h-7 text-[11px] font-medium uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    paceTone[p],
                    !caps?.canSetPace && "cursor-not-allowed opacity-65",
                  )}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="absolute left-[16.6667%] right-[16.6667%] top-8 h-[3px] rounded-full bg-[#d4d7de]" />
            <span
              className={cn(
                "absolute top-[25px] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(88,71,255,0.18)]",
                activePace === "now"
                  ? "bg-status-now"
                  : activePace === "next"
                    ? "bg-status-next"
                    : "bg-status-later",
              )}
              style={{
                left:
                  activePace === "now" ? "16.6667%" : activePace === "later" ? "83.3333%" : "50%",
              }}
              aria-hidden="true"
            />
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h3 className="katalist-section-title">Work Status</h3>
            {!caps?.canSetStatus && !caps?.canSort ? (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {statuses.map((s) => (
              <button
                key={s}
                type="button"
                disabled={
                  busy || terminal || (s === "sorted" ? !caps?.canSort : !caps?.canSetStatus)
                }
                onClick={() =>
                  run.mutate(async () => {
                    if (s === "sorted") await rpcSortThing(thing.id);
                    else if (s === "not_started" || s === "under_progress") {
                      await rpcSetWorkStatus(thing.id, s);
                    }
                  })
                }
                className={cn(
                  "flex h-8 items-center justify-center rounded-lg border px-2 text-center text-[10px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  thing.workStatus === s
                    ? "border-primary/30 bg-primary/5 text-primary"
                    : "border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  (terminal || (s === "sorted" ? !caps?.canSort : !caps?.canSetStatus)) &&
                    "cursor-not-allowed opacity-65",
                )}
              >
                {statusLabel(s)}
                {thing.workStatus === s &&
                (terminal || (s === "sorted" ? !caps?.canSort : !caps?.canSetStatus)) ? (
                  <Lock className="ml-1 inline h-3 w-3" />
                ) : null}
              </button>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 border-t border-border/70 pt-3">
          {dueLabel ? <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="katalist-section-title">Due Date</h3>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-foreground">
              <Calendar className="mt-0.5 h-3.5 w-3.5 text-primary" />
              <span>
                {dueLabel}
                {thing.dueAt ? (
                  <span className="block text-[10px] text-muted-foreground">
                    {format(new Date(thing.dueAt), "dd MMM yyyy")}
                  </span>
                ) : null}
              </span>
            </p>
          </section> : null}

          {thing.listName ? <section className="space-y-2">
            <h3 className="katalist-section-title">Source</h3>
            <p className="flex items-start gap-1.5 text-[11px] text-foreground">
              <ListIcon className="mt-0.5 h-3.5 w-3.5 text-primary" />
              <span>
                {thing.listName}
                <span className="block text-[10px] text-muted-foreground">List</span>
              </span>
            </p>
          </section> : null}
        </div>
      </div>

      <div className="border-t border-border/70 bg-white px-8 py-4">
        <div className="flex items-center gap-5">
          {!caps?.canComment ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
          {(["comments", "activity"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "border-b-2 px-1 pb-2 text-[11px] font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {id}
              {id === "comments" && comments.length > 0 ? (
                <span className="ml-1 text-[10px] text-primary">{comments.length}</span>
              ) : null}
            </button>
          ))}
          {hasMoreActions ? (
            <button
              type="button"
              onClick={() => setMoreOpen((current) => !current)}
              className="ml-auto inline-flex h-7 w-8 items-center justify-center rounded-lg border border-border bg-white text-foreground outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Show more Thing actions"
              title="More actions"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {moreOpen ? (
          <div className="mb-3 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-white p-3">
            <div className="mb-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close Thing actions"
                title="Close actions"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {canAssignOutside ? (
              <AssignOutsideBlock
                key={thing.id}
                thingId={thing.id}
                disabled={busy}
                onIssued={(fn) => run.mutate(fn)}
              />
            ) : null}
            {caps?.canSetDue ? (
              <section className="mt-3 space-y-1.5 border-b border-border/70 pb-3">
                <h3 className="katalist-section-title">Edit Due Date</h3>
                <div className="flex gap-1.5">
                  <input
                    type="datetime-local"
                    value={due}
                    disabled={busy}
                    onChange={(e) => setDue(e.target.value)}
                    className="h-7 min-w-0 flex-1 rounded-md border border-border bg-white px-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="h-7 rounded-md border border-border bg-white px-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-60"
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
            ) : null}
            {caps?.canCatch ||
            caps?.canNudge ||
            caps?.canSort ||
            caps?.canCancel ||
            caps?.canShred ? (
              <div className="mt-3 space-y-3">
                {caps?.canNudge || caps?.canSort ? (
                  <div className="grid grid-cols-2 gap-2">
                    {caps?.canNudge ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run.mutate(async () => {
                            await rpcNudgeThing(thing.id);
                            toast.success("Just a gentle paw tap on this one.");
                          })
                        }
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-white text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Bell className="h-3 w-3" />
                        Nudge
                      </button>
                    ) : null}
                    {caps?.canSort ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run.mutate(async () => {
                            await rpcSortThing(thing.id);
                            toast.success("Nicely sorted.");
                            onAfterTerminalAction?.();
                          })
                        }
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-white text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Check className="h-3 w-3" />
                        Sort
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {caps?.canCancel || caps?.canShred ? (
                  <div className="grid grid-cols-2 gap-2">
                    {caps?.canCancel ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run.mutate(async () => {
                            await rpcCancelThing(thing.id);
                            toast.success("Cancelled.");
                            onAfterTerminalAction?.();
                          })
                        }
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white text-[11px] font-medium text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Trash2 className="h-3 w-3" />
                        Cancel
                      </button>
                    ) : null}
                    {caps?.canShred ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run.mutate(async () => {
                            await rpcShred(thing.id);
                            toast.success("Shredded from your surfaces.");
                            onAfterTerminalAction?.();
                          })
                        }
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border bg-white text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Shred for me
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <section className="pt-4">
          {tab === "comments" ? (
            <div className="space-y-2">
              {comments.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No comments yet.</p>
              ) : (
                comments.map((c) => (
                  <CommentRow key={c.id} author={c.author} body={c.body} at={c.at} />
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
                  disabled={!caps?.canComment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment…"
                  className="h-7 flex-1 rounded-md border border-border bg-white px-2 text-[10px] outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!caps?.canComment}
                  className="h-7 rounded-md bg-primary px-2 text-[10px] text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Post
                </button>
              </form>
              {thing.workStatus === "sorted" ? (
                <p className="text-[11px] text-muted-foreground">
                  Comments stay open. They don’t reopen Sorted.
                </p>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-2">
              {events.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Movement will appear here.</p>
              ) : (
                events.map((ev) => (
                  <li key={ev.id} className="text-[12px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {ev.event.replaceAll("_", " ")}
                    </span>
                    <span className="ml-2">{format(new Date(ev.at), "MMM d · h:mm a")}</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
