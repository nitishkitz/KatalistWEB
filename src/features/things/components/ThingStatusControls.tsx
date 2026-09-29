import type * as React from "react";
import { Calendar, Check, ChevronDown, Folder, Lock, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { PersonCell } from "@/components/katalist/PersonCell";
import type { Pace, Person, Thing, WorkStatus } from "@/domain/thing";
import type { getThingCapabilities } from "@/domain/capabilities";
import type { BucketCard } from "@/features/buckets/fixtures";
import { cn } from "@/lib/utils";

type Caps = ReturnType<typeof getThingCapabilities> | null;

const paces: Pace[] = ["now", "next", "later"];
const statuses: WorkStatus[] = ["not_started", "under_progress", "sorted"];

function PaceValue({ pace }: { pace: Pace | null }) {
  return (
    <span className={cn("inline-flex min-h-7 items-center gap-1.5 text-[12px] font-medium", pace ? "text-[#3a4675]" : "text-muted-foreground")}>
      {pace ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", pace === "now" ? "bg-status-now" : pace === "next" ? "bg-status-next" : "bg-status-later")} /> : null}
      <span className="capitalize">{pace ?? "Not set yet"}</span>
    </span>
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

/**
 * T09 item 5: the people/status row, due/pace info card, and Catch/Mark
 * Sorted + bucket-dropdown action row (court), and their equivalent status
 * sections in the default detail panel (People, Bucket, Acknowledgement &
 * Status, Pace, Work Status). Every mutation the buttons below trigger is
 * still built and run by ThingDetailContent -- this component only calls
 * whichever `on*` callback prop it was handed; it does not call any rpc*
 * function, run.mutate, or withOptimisticPatch itself.
 *
 * Court and default render meaningfully different layouts (a compact info
 * card + single Catch/Sort button for court vs. discrete labeled sections
 * for default), so -- like ThingViewOnlyBanner's own extraction note
 * explains -- they are kept as two branches behind `variant` rather than
 * forced into one shared shape.
 */
export type ThingStatusControlsProps = {
  variant: "default" | "court";
  thing: Thing;
  caps: Caps;
  busy: boolean;
  activePace: Pace;
  onSetPace: (pace: Pace) => void;
  onSetRequestedPace: (pace: Pace) => void;
  currentBucket: BucketCard | null;
  buckets: BucketCard[];
  onSelectBucket: (bucketId: string) => void;
  /** court-only */
  ownerAvatar?: string | null;
  assigneeAvatar?: string | null;
  isAssigneeSameAsOwner?: boolean;
  dueLabel?: string | null;
  onCatch?: () => void;
  onSort?: () => void;
  /** default-only */
  viewOnly?: boolean;
  assignableList?: Person[];
  onReassign?: (targetId: string) => void;
  terminal?: boolean;
  onSetWorkStatus?: (status: "not_started" | "under_progress") => void;
};

export function ThingStatusControls({
  variant,
  thing,
  caps,
  busy,
  onSetPace,
  onSetRequestedPace,
  currentBucket,
  buckets,
  onSelectBucket,
  ownerAvatar,
  assigneeAvatar,
  dueLabel,
  onCatch,
  onSort,
  viewOnly,
  assignableList,
  onReassign,
  terminal,
  onSetWorkStatus,
}: ThingStatusControlsProps): React.ReactNode {
  const selfAssigned = thing.owner.id === thing.assignee.id;
  const personalPaceLabel = caps?.isAssignee ? "Your pace" : "Assignee’s pace";

  const paceControl = (label: string, value: Pace | null, editable: boolean, onChange: (pace: Pace) => void) => editable ? (
    <div role="group" aria-label={label} className="inline-flex rounded-[6px] bg-[#f0f1f9] p-0.5">
      {paces.map((pace) => (
        <button
          key={pace}
          type="button"
          disabled={busy}
          aria-pressed={value === pace}
          onClick={() => onChange(pace)}
          className={cn(
            "min-h-7 min-w-[48px] rounded-[5px] px-2.5 text-[12px] font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
            value === pace ? "bg-[#975ee2] text-white" : "text-[#3a4675] hover:bg-white/70",
          )}
        >
          {pace}
        </button>
      ))}
    </div>
  ) : <PaceValue pace={value} />;
  const personalPaceControl = paceControl(personalPaceLabel, thing.personalPace, Boolean(caps?.canSetPace), onSetPace);
  const requestedPaceControl = paceControl("Assigned pace", thing.ownerImportance, Boolean(caps?.canSetImportance), onSetRequestedPace);

  const selfPaceControl = thing.acknowledgement === "caught"
    ? paceControl("Pace", thing.personalPace, Boolean(caps?.canSetPace), onSetPace)
    : paceControl("Pace", thing.ownerImportance, Boolean(caps?.canSetImportance), onSetRequestedPace);

  const reassignControl = !viewOnly ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy || !caps?.canReassign}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] border border-[#e6e8f2] bg-white px-3 text-[12px] font-medium text-[#3a4675] transition-colors hover:bg-[#f0f1f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Reassign
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        {(assignableList ?? []).filter((person) => person.id !== thing.assignee.id).map((person) => (
          <DropdownMenuItem key={person.id} onSelect={() => onReassign?.(person.id)}>
            <PersonCell person={person} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  if (variant === "court") {
    return (
      <>
        {/* People / Status Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-7">
            <div className="flex items-center gap-2.5">
              <PersonAvatar
                name={thing.owner.name}
                initials={thing.owner.initials}
                src={ownerAvatar}
                size={30}
              />
              <div>
                <span className="block text-[12px] font-medium text-black leading-tight">
                  {thing.owner.name}
                </span>
                <span className="block text-[12px] text-[#3a4675] mt-0.5">{selfAssigned ? (caps?.isAssignee ? "You" : "Self-assigned") : "Owner"}</span>
              </div>
            </div>

            {!selfAssigned ? (
            <div className="flex items-center gap-2.5">
              <PersonAvatar
                name={thing.assignee.name}
                initials={thing.assignee.initials}
                src={assigneeAvatar}
                size={30}
              />
              <div>
                <span className="block text-[12px] font-medium text-black leading-tight">
                  {thing.assignee.name}
                </span>
                <span className="block text-[12px] text-[#3a4675] mt-0.5">
                  Assignee{caps?.isAssignee ? " • You" : ""}
                </span>
              </div>
            </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#3a4675]">
              {thing.acknowledgement === "waiting_for_catch" ? "Waiting for Catch" : "Caught"}
            </span>
            {(() => {
              const isSorted = thing.workStatus === "sorted";
              const isCancelled = thing.workStatus === "cancelled";
              const inProgress =
                !isSorted &&
                !isCancelled &&
                (thing.workStatus === "under_progress" || thing.acknowledgement === "caught");
              const label = isCancelled
                ? "Cancelled"
                : isSorted
                  ? "Sorted"
                  : inProgress
                    ? "Under Progress"
                    : "Not Started";
              return (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f0f2fe] px-2.5 py-1.5 text-[12px] font-medium text-[#975ee2]">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      isSorted ? "bg-emerald-500" : inProgress ? "bg-[#975ee2]" : "bg-slate-400",
                    )}
                  />
                  {label}
                </span>
              );
            })()}
          </div>
        </div>

        {/* Due and both pace values share one compact metadata row. */}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-[8px] border border-[#f0f1f7] bg-white px-4 py-3">
          <div className="min-w-[100px] flex-1 space-y-1">
            <div className="flex items-center gap-1.5 text-[12px] text-[#3a4675]">
              <Calendar className="h-3.5 w-3.5" />
              <span>Due</span>
            </div>
            <div className={cn("flex min-h-7 items-center text-[12px] font-medium", dueLabel ? "text-[#f71a24]" : "text-muted-foreground")}>
              {dueLabel ?? "No due date"}
            </div>
          </div>
          {selfAssigned ? (
            <div className="min-w-[156px] flex-1 space-y-1">
              <div className="text-[12px] text-[#3a4675]">Pace</div>
              {selfPaceControl}
            </div>
          ) : (
            <>
          <div className="min-w-[156px] flex-1 space-y-1">
            <div className="text-[12px] text-[#3a4675]">Assigned pace</div>
            {requestedPaceControl}
          </div>
          <div className="min-w-[156px] flex-1 space-y-1">
            <div className="text-[12px] text-[#3a4675]">{personalPaceLabel}</div>
            {personalPaceControl}
          </div>
            </>
          )}
        </div>

        {/* Action buttons & bucket link */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 border-b border-[#eef0f6]">
          <div className="flex flex-wrap items-center gap-2">
            {reassignControl}
            {caps?.canCatch ? (
              <button
                type="button"
                disabled={busy}
                onClick={onCatch}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-[#975ee2] px-3.5 text-[12px] font-medium text-white hover:brightness-95 disabled:opacity-60 transition cursor-pointer"
              >
                Catch
              </button>
            ) : caps?.canSort ? (
              <button
                type="button"
                disabled={busy}
                onClick={onSort}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-[#975ee2] px-3.5 text-[12px] font-medium text-white hover:brightness-95 disabled:opacity-60 transition cursor-pointer"
              >
                <Check className="h-4 w-4" />
                Mark Sorted
              </button>
            ) : null}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3a4675] hover:text-[#000533] transition-colors cursor-pointer disabled:opacity-60"
                title={currentBucket?.name ? `Bucket: ${currentBucket.name}` : "Add to bucket"}
              >
                <Folder className="h-3.5 w-3.5" />
                <span>{currentBucket?.name || "Add to bucket"}</span>
                <ChevronDown className="h-3 w-3 text-[#5d6786]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-white border border-border/70 rounded-xl p-1 z-50">
              {buckets.length === 0 ? (
                <DropdownMenuItem disabled className="text-[12px]">
                  No buckets yet
                </DropdownMenuItem>
              ) : (
                buckets.map((b) => (
                  <DropdownMenuItem
                    key={b.id}
                    onClick={() => onSelectBucket(b.id)}
                    className="flex items-center justify-between gap-2 text-[12px] rounded-lg px-2.5 py-1.5 cursor-pointer"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Folder className="h-3.5 w-3.5 text-[#975ee2]" />
                      <span className="truncate">{b.name}</span>
                    </span>
                    {currentBucket?.id === b.id && <Check className="h-3.5 w-3.5 text-[#975ee2]" />}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </>
    );
  }

  return (
    <>
      <section data-detail-region="people" className="space-y-1.5 xl:col-span-2">
        <h3 className="katalist-section-title">People</h3>
        {selfAssigned ? (
          <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-white p-3">
            <PersonCell person={thing.owner} />
            <span className="text-[12px] text-muted-foreground">{caps?.isAssignee ? "You" : "Self-assigned"}</span>
          </div>
        ) : (
        <div className="grid gap-2 rounded-lg border border-border/70 bg-white p-3 md:grid-cols-3">
          <div className="flex min-h-7 items-center justify-between gap-2 md:block">
            <span className="text-[12px] text-muted-foreground">Creator</span>
            <PersonCell person={thing.creator} />
          </div>
          <div className="flex min-h-7 items-center justify-between gap-2 md:block">
            <span className="text-[12px] text-muted-foreground">Owner</span>
            <PersonCell person={thing.owner} />
          </div>
          <div className="flex min-h-7 items-center justify-between gap-2 md:block">
            <span className="text-[12px] text-muted-foreground">Current Assignee</span>
            <PersonCell person={thing.assignee} />
          </div>
        </div>
        )}
        <div className="pt-1">{reassignControl}</div>
      </section>

      {viewOnly ? (
        currentBucket ? (
          <section className="space-y-1.5 xl:col-span-2">
            <h3 className="katalist-section-title">Bucket</h3>
            <p className="text-[12px] text-muted-foreground">
              In <span className="font-medium text-foreground">{currentBucket.name}</span>
            </p>
          </section>
        ) : null
      ) : caps?.canAddToBucket ? (
        <section className="space-y-1.5 xl:col-span-2">
          <h3 className="katalist-section-title">Add to Bucket</h3>
          {currentBucket ? (
            <p className="text-[12px] text-muted-foreground">
              In <span className="font-medium text-foreground">{currentBucket.name}</span></p>
          ) : null}
          <select
            disabled={busy}
            className="h-8 w-full rounded-lg border border-border bg-white px-2 text-[12px] outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              onSelectBucket(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">
              {currentBucket ? "Change bucket…" : "Choose a private bucket…"}
            </option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </section>
      ) : null}

      <section data-detail-region="controls" className="space-y-1.5">
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
      </section>

      <section className="space-y-2 xl:col-span-2">
        <h3 className="katalist-section-title">Pace</h3>
        <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-[8px] border border-[#f0f1f7] px-3 py-2.5">
          {selfAssigned ? (
            <div className="min-w-[156px] flex-1 space-y-1">
              <div className="text-[12px] text-[#3a4675]">Pace</div>
              {selfPaceControl}
            </div>
          ) : (
            <>
          <div className="min-w-[156px] flex-1 space-y-1">
            <div className="text-[12px] text-[#3a4675]">Assigned pace</div>
            {requestedPaceControl}
          </div>
          <div className="min-w-[156px] flex-1 space-y-1">
            <div className="text-[12px] text-[#3a4675]">{personalPaceLabel}</div>
            {personalPaceControl}
          </div>
            </>
          )}
        </div>
      </section>

      {!terminal ? (
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
                  busy || Boolean(terminal) || (s === "sorted" ? !caps?.canSort : !caps?.canSetStatus)
                }
                onClick={() => {
                  if (s === "sorted") {
                    onSort?.();
                  } else if (s === "not_started" || s === "under_progress") {
                    onSetWorkStatus?.(s);
                  }
                }}
                className={cn(
                  "flex h-8 items-center justify-center rounded-lg border px-2 text-center text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
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
      ) : null}

    </>
  );
}
