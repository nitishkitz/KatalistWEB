import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  AtSign,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  Eye,
  FileText,
  Flag,
  Folder,
  Hand,
  Loader2,
  List as ListIcon,
  Lock,
  MoreHorizontal,
  Paperclip,
  Play,
  RotateCcw,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { domainErrorMessage } from "@/lib/domain-error";
import type { Pace, Thing, WorkStatus } from "@/domain/thing";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonCell } from "@/components/katalist/PersonCell";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import {
  isUuid,
  rpcAddThingFile,
  rpcAddToBucket,
  rpcAssignOutsideKatalist,
  rpcCancelThing,
  rpcCatchThing,
  rpcCatchAndStart,
  rpcNudgeThing,
  rpcReopenThing,
  rpcRemoveFromBucket,
  rpcReassignThing,
  rpcSetDue,
  rpcSetPersonalPace,
  rpcSetWorkStatus,
  rpcShred,
  rpcSortThing,
} from "./rpc";
import { invalidatePersonalSurfaces } from "./personal-shred";
import { isPreviewMode } from "@/lib/session-mode";
import { uploadThingAttachment } from "./attachments";
import { getThingCapabilities } from "@/domain/capabilities";
import { useCourt } from "@/features/court/use-court";
import { formatCourtDue } from "@/features/court/court-view-model";
import { useSession } from "@/hooks/useSession";
import { useThing } from "./use-thing";
import { useThingComments } from "./use-thing-comments";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { useAvatarUrl } from "@/features/people/directory";
import { useBuckets } from "@/features/buckets/use-buckets";
import { getBucketRefs } from "./local-state";
import { useLocalVersion } from "./use-local-version";
import { type ThingFile } from "@/features/things/PDFViewer";
import { markThingAsRead } from "@/features/things/read-state";
import { processFileForUpload } from "@/lib/file-utils";

export type ThingDetailContentProps = {
  initialThing: Thing | null;
  headerAction?: React.ReactNode;
  onAfterTerminalAction?: () => void;
  variant?: "default" | "court";
  viewOnly?: boolean;
  onFileSelect?: (file: ThingFile) => void;
};

const paces: Pace[] = ["now", "next", "later"];
const statuses: WorkStatus[] = ["not_started", "under_progress", "sorted"];

/** File-type chip colors matching the Figma detail dialog. */
function fileTypeChip(type: ThingFile["type"]): {
  label: string;
  bg: string;
  text: string;
  border: string;
} {
  switch (type) {
    case "pdf":
      return { label: "PDF", bg: "#fef9fa", text: "#ff080a", border: "#fdecec" };
    case "docx":
      return { label: "DOCX", bg: "#dde9fe", text: "#0238fa", border: "#dde9fe" };
    case "excel":
      return { label: "XLS", bg: "#dcfce7", text: "#16a34a", border: "#bbf7d0" };
    case "video":
      return { label: "VID", bg: "#eadffe", text: "#4218f0", border: "#eadffe" };
    case "image":
    case "png":
    case "jpg":
      return { label: "PNG", bg: "#eadffe", text: "#4218f0", border: "#eadffe" };
    default:
      return { label: "FILE", bg: "#eef0f6", text: "#515b8e", border: "#e4e6ef" };
  }
}
const paceTone: Record<Pace, string> = {
  now: "text-status-now",
  next: "text-status-next",
  later: "text-status-later",
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

function CommentRow({
  author,
  body,
  at,
  avatarUrl: explicitAvatar,
  sending,
  attachments,
  onFileSelect,
}: {
  author: string;
  body: string;
  at: string;
  avatarUrl?: string | null;
  sending?: boolean;
  attachments?: ThingFile[];
  onFileSelect?: (file: ThingFile) => void;
}) {
  const avatarUrl = useAvatarUrl(author, null, explicitAvatar);

  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-xl border border-border/70 bg-white px-3 py-2.5 transition-opacity",
        sending && "opacity-75 bg-muted/15",
      )}
    >
      <PersonAvatar name={author} initials={initialsForName(author)} src={avatarUrl} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-[11px] font-semibold text-foreground">{author}</p>
          <time className="shrink-0 text-[10px] text-muted-foreground flex items-center gap-1">
            {sending ? (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                <span>Sending…</span>
              </>
            ) : (
              format(new Date(at), "MMM d · h:mm a")
            )}
          </time>
        </div>
        {body ? <p className="mt-0.5 text-[12px] leading-relaxed text-foreground">{body}</p> : null}
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((att) => {
              const isImg = att.type === "image" || att.type === "png" || att.type === "jpg";
              const isVid = att.type === "video";
              return (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => onFileSelect?.(att)}
                  className="group/att flex items-center gap-2 rounded-lg border border-border/80 bg-slate-50/70 hover:bg-white hover:border-slate-300 p-1.5 text-left transition-all cursor-pointer shadow-2xs"
                >
                  {isImg && att.url ? (
                    <img src={att.url} alt={att.name} className="h-8 w-8 rounded-md object-cover border border-slate-200" />
                  ) : isVid ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-50 text-purple-600 border border-purple-200">
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </div>
                  ) : (
                    <span
                      className={cn(
                        "flex h-7 px-1.5 items-center justify-center rounded text-[9px] font-bold uppercase",
                        att.type === "pdf"
                          ? "bg-red-50 text-red-600 border border-red-200"
                          : att.type === "excel"
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                            : att.type === "docx"
                              ? "bg-blue-50 text-blue-600 border border-blue-200"
                              : "bg-slate-100 text-slate-600 border border-slate-200",
                      )}
                    >
                      {att.type}
                    </span>
                  )}
                  <div className="min-w-0 pr-1">
                    <p className="text-[11px] font-semibold text-slate-900 group-hover/att:text-primary truncate max-w-[130px]">
                      {att.name}
                    </p>
                    {att.sizeLabel && (
                      <p className="text-[9px] text-muted-foreground font-medium">
                        {att.sizeLabel}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
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
  variant = "default",
  viewOnly = false,
  onFileSelect,
}: ThingDetailContentProps): React.ReactNode {
  const qc = useQueryClient();
  const localVersion = useLocalVersion();
  const { user } = useSession();
  const court = useCourt();
  const people = useAssignablePeople();
  const live = useThing(initialThing?.id ?? null);
  const thing = live.thing ?? initialThing;

  const myActorId = useMemo(() => {
    if (court.myActorId) return court.myActorId;
    if (user?.id) {
      const match = people.find((p) => p.profileId === user.id || p.id === user.id);
      if (match?.id) return match.id;
    }
    return null;
  }, [court.myActorId, user?.id, people]);

  const rawCaps = thing ? getThingCapabilities(thing, myActorId) : null;
  const caps = useMemo(() => {
    if (!rawCaps) return null;
    if (viewOnly) {
      return {
        ...rawCaps,
        canCatch: false,
        canSetPace: false,
        canSetImportance: false,
        canSetDue: false,
        canSetStatus: false,
        canAssign: false,
        canReassign: false,
        canNudge: false,
        canSort: false,
        canCancel: false,
        canReopen: false,
        canShred: false,
        canAddToBucket: false,
        canComment: true,
      };
    }
    return rawCaps;
  }, [rawCaps, viewOnly]);
  const thread = useThingComments(thing?.id ?? null);
  const assignableList = useMemo(() => {
    const list = [...people];
    if (thing?.assignee && !list.some((p) => p.id === thing.assignee.id)) {
      list.unshift(thing.assignee);
    }
    return list;
  }, [people, thing?.assignee]);
  const { buckets, preview: bucketsPreview } = useBuckets();
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comment, setComment] = useState("");
  const [due, setDue] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [commentAttachments, setCommentAttachments] = useState<ThingFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const commentFileInputRef = useRef<HTMLInputElement | null>(null);
  const thingFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (thing?.id) {
      markThingAsRead(thing.id);
    }
  }, [thing?.id]);

  const handleCommentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const newFiles: ThingFile[] = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const processed = await processFileForUpload(files[i]);
          newFiles.push(processed);
        } catch {
          toast.error(`Could not attach ${files[i].name}`);
        }
      }
      setCommentAttachments((prev) => [...prev, ...newFiles]);
    } finally {
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
    }
  };

  const handleThingFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const files = e.target.files;
      if (!files || files.length === 0 || !thing?.id) return;
      const useRealStorage = !isPreviewMode() && isUuid(thing.id);
      for (let i = 0; i < files.length; i++) {
        try {
          const processed = useRealStorage
            ? await uploadThingAttachment(thing.id, files[i])
            : await processFileForUpload(files[i]);
          if (!useRealStorage) await rpcAddThingFile(thing.id, processed);
          onFileSelect?.(processed);
          toast.success(`Attached ${files[i].name}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Could not attach ${files[i].name}`);
        }
      }
      await qc.invalidateQueries({ queryKey: ["thing", thing.id] });
      await qc.invalidateQueries({ queryKey: ["court"] });
    } finally {
      if (thingFileInputRef.current) thingFileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    setMoreOpen(false);
    setCommentAttachments([]);
  }, [thing?.id]);

  const invalidate = async () => {
    await invalidatePersonalSurfaces(qc);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["thing"] }),
      qc.invalidateQueries({ queryKey: ["notifications"] }),
      qc.invalidateQueries({ queryKey: ["buckets"] }),
      qc.invalidateQueries({ queryKey: ["bucket-items"] }),
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
  const currentBuckets = useMemo(() => {
    void localVersion;
    return buckets.filter(
      (bucket) =>
        bucket.thingIds?.includes(thing.id) ||
        bucket.previews?.some((preview) => preview.kind === "thing" && preview.thingId === thing.id) ||
        getBucketRefs(bucket.id).some((ref) => ref.thingId === thing.id),
    );
  }, [buckets, thing.id, localVersion]);
  const currentBucket = currentBuckets[0] ?? null;
  const dueLabel = thing.dueAt ? formatCourtDue(thing).label : null;

  const creatorAvatar = useAvatarUrl(thing.creator.name, null, thing.creator.avatarUrl);
  const ownerAvatar = useAvatarUrl(thing.owner.name, null, thing.owner.avatarUrl);
  const assigneeAvatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);

  const isCreatorSameAsOwner = thing.creator.id === thing.owner.id;
  const isAssigneeSameAsOwner = thing.assignee.id === thing.owner.id;
  const isTheirs = !isAssigneeSameAsOwner || !caps?.isAssignee;

  if (variant === "court") {
    const displayFiles: ThingFile[] =
      thing.files && thing.files.length > 0 ? thing.files : [];
    const activeFileId = selectedFileId ?? displayFiles[0]?.id ?? null;

    return (
      <div className="min-h-[454px] w-full text-left">
        {headerAction && <div className="mb-2">{headerAction}</div>}

        {/* Title */}
        <div className="flex items-start justify-between gap-3 pr-9">
          <h1 className="text-[25px] font-medium leading-tight tracking-tight text-[#000533] break-words flex-1">
            {thing.title}
          </h1>
        </div>

        {/* Subtitle */}
        <p className="mt-1 text-[11.5px] text-[#6a769c] font-medium">
          Created by {thing.creator.name}
          {thing.updatedAt ? ` • Updated ${format(new Date(thing.updatedAt), "MMM d, h:mm a")}` : ""}
        </p>

        {viewOnly && (
          <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-3 py-2 text-[11.5px] font-semibold text-emerald-800">
            <Eye className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>View only mode · You can view details and post comments.</span>
          </div>
        )}

        <div className="space-y-4 pt-4">
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
                  <span className="block text-[11.5px] font-medium text-black leading-tight">
                    {thing.owner.name}
                  </span>
                  <span className="block text-[10px] text-[#3a4675] mt-0.5">Owner</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <PersonAvatar
                  name={thing.assignee.name}
                  initials={thing.assignee.initials}
                  src={assigneeAvatar}
                  size={30}
                />
                <div>
                  <span className="block text-[11.5px] font-medium text-black leading-tight">
                    {thing.assignee.name}
                  </span>
                  <span className="block text-[10px] text-[#3a4675] mt-0.5">
                    Assignee{isAssigneeSameAsOwner ? "" : " • You"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10.5px] text-[#3a4675]">
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
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f0f2fe] px-2.5 py-1.5 text-[11px] font-medium text-[#975ee2]">
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

          {/* Info cards: Due · Assigned pace */}
          <div className="grid grid-cols-[1fr_1.6fr] items-center rounded-[8px] border border-[#f0f1f7] bg-white py-2">
            <div className="flex items-center gap-2 px-4">
              <Calendar className="h-4 w-4 shrink-0 text-[#3a4675]" />
              <div className="min-w-0">
                <div className="text-[10px] text-[#3a4675]">Due</div>
                <div className={cn("text-[11.5px] font-medium", dueLabel ? "text-[#f71a24]" : "text-muted-foreground")}>
                  {dueLabel ?? "No due date"}
                </div>
              </div>
            </div>
            <div className="border-l border-[#f0f1f7] px-4">
              <div className="mb-1 text-[10px] text-[#3a4675]">Assigned pace</div>
              <div className="inline-flex rounded-[6px] bg-[#f0f1f9] p-0.5">
                {(["now", "next", "later"] as const).map((pace) => (
                  <button
                    key={pace}
                    type="button"
                    disabled={busy || !caps?.canSetPace}
                    onClick={() => run.mutate(async () => rpcSetPersonalPace(thing.id, pace))}
                    className={cn(
                      "h-[22px] min-w-[48px] rounded-[5px] px-2 text-[10px] font-medium capitalize transition-colors cursor-pointer disabled:cursor-not-allowed",
                      activePace === pace
                        ? "bg-[#975ee2] text-white"
                        : "text-[#3a4675] hover:text-[#000533]",
                    )}
                  >
                    {pace}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action buttons & bucket link */}
          <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 border-b border-[#eef0f6]">
            <div className="flex items-center gap-2">
              {caps?.canCatch ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run.mutate(async () => {
                      await rpcCatchAndStart(thing.id);
                      toast.success("Caught — now in progress.");
                    })
                  }
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-[#975ee2] px-3.5 text-[12px] font-medium text-white hover:brightness-95 disabled:opacity-60 transition cursor-pointer"
                >
                  Catch
                </button>
              ) : caps?.canSort ? (
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
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#3a4675] hover:text-[#000533] transition-colors cursor-pointer disabled:opacity-60"
                  title={currentBucket?.name ? `Bucket: ${currentBucket.name}` : "Add to bucket"}
                >
                  <Folder className="h-3.5 w-3.5" />
                  <span>{currentBucket?.name || "Add to bucket"}</span>
                  <ChevronDown className="h-3 w-3 text-[#5d6786]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-white shadow-lg border border-border/70 rounded-xl p-1 z-50">
                {buckets.length === 0 ? (
                  <DropdownMenuItem disabled className="text-[12px]">
                    No buckets yet
                  </DropdownMenuItem>
                ) : (
                  buckets.map((b) => (
                    <DropdownMenuItem
                      key={b.id}
                      onClick={() =>
                        run.mutate(async () => {
                          if (currentBucket && currentBucket.id === b.id) return;
                          if (currentBucket) await rpcRemoveFromBucket(currentBucket.id, thing.id);
                          await rpcAddToBucket(b.id, thing.id);
                          toast.success(currentBucket ? "Bucket changed." : "Added to bucket.");
                        })
                      }
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

          {/* Description Section */}
          {thing.description ? (
            <div className="py-3 border-b border-[#eef0f6]">
              <h3 className="text-[13px] font-medium text-[#000533] mb-1.5">Description</h3>
              <p className="text-[11px] leading-relaxed text-[#6a769c] whitespace-pre-wrap">
                {thing.description}
              </p>
            </div>
          ) : null}

          {/* Files Section: strictly dynamic */}
          <div className="py-3 border-b border-border/40">
            <input
              ref={thingFileInputRef}
              type="file"
              multiple
              onChange={handleThingFileUpload}
              className="hidden"
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,*/*"
            />
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[#000533]">Files</span>
                {displayFiles.length > 0 && (
                  <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#eef0f6] px-1 text-[9px] font-medium text-[#000533]">
                    {displayFiles.length}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => thingFileInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#975ee2] hover:opacity-80 transition-opacity cursor-pointer"
              >
                + Add file
              </button>
            </div>
            {displayFiles.length > 0 ? (
              <div className="overflow-hidden rounded-[8px] border border-[#eeeff6] bg-[#fdfcfd]">
                {displayFiles.map((file, idx) => {
                  const isSelected = file.id === activeFileId;
                  const chip = fileTypeChip(file.type);
                  return (
                    <div
                      key={file.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedFileId(file.id);
                        onFileSelect?.(file);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedFileId(file.id);
                          onFileSelect?.(file);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 cursor-pointer outline-none transition-colors",
                        idx > 0 && "border-t border-[#eeeff6]",
                        isSelected ? "bg-[#f3f6ff]" : "hover:bg-[#f6f7fb]",
                      )}
                    >
                      <span
                        className="inline-flex h-[22px] items-center justify-center rounded-[6px] border px-2 text-[9.5px] font-medium uppercase"
                        style={{ backgroundColor: chip.bg, color: chip.text, borderColor: chip.border }}
                      >
                        {chip.label}
                      </span>
                      <span className="flex-1 truncate text-[10.8px] text-black">{file.name}</span>
                      {file.sizeLabel && (
                        <span className="shrink-0 text-[10.8px] text-[#515b8e]">{file.sizeLabel}</span>
                      )}
                      {file.isNew && (
                        <span className="shrink-0 rounded bg-[#975ee2] px-1 py-0.5 text-[8px] font-bold text-white">
                          New
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-[#6a769c] italic">No files attached yet</p>
            )}
          </div>

          {/* Comments and Activity Section */}
          <div className="pt-3">
            <div className="flex items-center gap-6 border-b border-border/60 pb-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setTab("comments")}
                  className={cn(
                    "text-[12px] font-medium transition-colors flex items-center gap-1.5 cursor-pointer pb-2 -mb-2",
                    tab === "comments"
                      ? "text-[#975ee2] border-b-2 border-[#975ee2]"
                      : "text-[#2b2e55] hover:text-[#000533]",
                  )}
                >
                  <span>Comments</span>
                  <span
                    className={cn(
                      "inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-medium",
                      tab === "comments" ? "bg-[#f0eafe] text-[#975ee2]" : "bg-[#eef0f6] text-[#2b2e55]",
                    )}
                  >
                    {comments.length}
                  </span>
                </button>
                {(thing.unreadCommentCount ?? 0) > 0 && (
                  <span className="text-[11.5px] font-medium text-[#975ee2] pb-2 -mb-2">
                    {thing.unreadCommentCount} new
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTab("activity")}
                className={cn(
                  "text-[12px] font-medium transition-colors cursor-pointer pb-2 -mb-2",
                  tab === "activity"
                    ? "text-[#975ee2] border-b-2 border-[#975ee2]"
                    : "text-[#2b2e55] hover:text-[#000533]",
                )}
              >
                Activity
              </button>
            </div>

            {tab === "comments" ? (
              <div className="pt-3 space-y-3">
                {comments.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground py-3 italic text-center">
                    No comments yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((entry, idx) => {
                      const unread = thing.unreadCommentCount ?? 0;
                      const isFirstNew = unread > 0 && idx === Math.max(0, comments.length - unread);
                      return (
                        <div key={entry.id} className="space-y-3">
                          {isFirstNew && (
                            <div className="relative my-3 flex items-center justify-center">
                              <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-blue-500" />
                              </div>
                              <span className="relative bg-white px-3 text-[11px] font-semibold text-blue-600">
                                New comments
                              </span>
                            </div>
                          )}
                          <CommentRow
                            author={entry.author}
                            avatarUrl={entry.avatarUrl}
                            body={entry.body}
                            at={entry.at}
                            sending={(entry as any).sending}
                            attachments={entry.attachments}
                            onFileSelect={onFileSelect}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Comment attachments preview */}
                {commentAttachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-bottom-1">
                    {commentAttachments.map((att) => (
                      <div
                        key={att.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 shadow-2xs"
                      >
                        {att.type === "image" && att.url ? (
                          <img src={att.url} alt={att.name} className="h-4 w-4 rounded object-cover" />
                        ) : (
                          <span
                            className={cn(
                              "flex h-4 px-1 items-center justify-center rounded text-[8.5px] font-bold uppercase",
                              att.type === "pdf"
                                ? "bg-red-50 text-red-600 border border-red-200"
                                : att.type === "excel"
                                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                                  : att.type === "docx"
                                    ? "bg-blue-50 text-blue-600 border border-blue-200"
                                    : att.type === "video"
                                      ? "bg-purple-50 text-purple-600 border border-purple-200"
                                      : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {att.type}
                          </span>
                        )}
                        <span className="max-w-[130px] truncate">{att.name}</span>
                        <button
                          type="button"
                          onClick={() => setCommentAttachments((prev) => prev.filter((f) => f.id !== att.id))}
                          className="ml-0.5 rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                          aria-label={`Remove ${att.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply input box */}
                <input
                  ref={commentFileInputRef}
                  type="file"
                  multiple
                  onChange={handleCommentFileChange}
                  className="hidden"
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,*/*"
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = comment.trim();
                    if ((!text && commentAttachments.length === 0) || thread.post.isPending) return;
                    const atts = [...commentAttachments];
                    setComment("");
                    setCommentAttachments([]);
                    thread.post.mutate(
                      { body: text, attachments: atts.length > 0 ? atts : undefined },
                      {
                        onError: (err) => {
                          setComment(text);
                          setCommentAttachments(atts);
                          toast.error(domainErrorMessage(err));
                        },
                        onSuccess: () => {
                          toast.success("Comment sent.");
                        },
                      },
                    );
                  }}
                  className="flex items-center gap-2 rounded-[9px] border border-[#e9ecf4] bg-[#fdfdfe] px-3 py-2 mt-4"
                >
                  <button
                    type="button"
                    onClick={() => commentFileInputRef.current?.click()}
                    className="text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                    title="Attach file (photo, video, doc, excel, etc.)"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Reply to this Thing..."
                    disabled={thread.post.isPending}
                    className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none py-1"
                  />
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                  >
                    <AtSign className="h-4 w-4" />
                  </button>
                  <button
                    type="submit"
                    disabled={(!comment.trim() && commentAttachments.length === 0) || thread.post.isPending}
                    className="rounded-[6px] bg-[#975ee2] hover:brightness-95 text-white font-medium text-[11.5px] px-3.5 py-1.5 transition disabled:opacity-50 cursor-pointer"
                  >
                    Send
                  </button>
                </form>
              </div>
            ) : (
              <ul className="space-y-2 pt-3">
                {events.slice(0, 4).map((event) => (
                  <li key={event.id} className="text-[11.5px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {event.event.replaceAll("_", " ")}
                    </span>
                    <span className="ml-2">{format(new Date(event.at), "MMM d · h:mm a")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-border/70 px-5 py-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-semibold leading-snug text-foreground">{thing.title}</h2>
          {headerAction}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="capitalize">{thing.context}</span>
          {thing.listName ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{thing.listName}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span>Updated {format(new Date(thing.updatedAt), "MMM d · h:mm a")}</span>
        </p>
        {viewOnly && (
          <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-3 py-2 text-[11.5px] font-semibold text-emerald-800">
            <Eye className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>View only mode · You can view details and post comments.</span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 px-5 py-4 xl:grid-cols-2">
        <section data-detail-region="people" className="space-y-1.5 xl:col-span-2">
          <h3 className="katalist-section-title">People</h3>
          <div className="grid gap-2 rounded-lg border border-border/70 bg-white p-3 md:grid-cols-3">
            <div className="flex min-h-7 items-center justify-between gap-2 md:block">
              <span className="text-[11px] text-muted-foreground">Creator</span>
              <PersonCell person={thing.creator} />
            </div>
            <div className="flex min-h-7 items-center justify-between gap-2 md:block">
              <span className="text-[11px] text-muted-foreground">Owner</span>
              <PersonCell person={thing.owner} />
            </div>
            <div className="flex min-h-7 items-center justify-between gap-2 md:block">
              <span className="text-[11px] text-muted-foreground">Current Assignee</span>
              <PersonCell person={thing.assignee} />
            </div>
          </div>
          {!viewOnly && (
            <label className="flex h-9 items-center gap-2 px-1 text-[11px] text-muted-foreground">
              <UserPlus className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium text-foreground">Reassign</span>
              <select
                disabled={busy || !caps?.canReassign}
                className="ml-auto h-8 max-w-[170px] rounded-lg border border-border bg-white px-2 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                id="thing-detail-reassign"
                value={thing.assignee.id}
                onChange={(e) => {
                  const targetId = e.target.value;
                  if (!targetId || targetId === thing.assignee.id) return;
                  run.mutate(async () => {
                    await rpcReassignThing(thing.id, targetId);
                    toast.success("Waiting for Catch.");
                  });
                }}
              >
                {assignableList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {!caps?.canReassign ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
            </label>
          )}
        </section>

        {viewOnly ? (
          currentBucket ? (
            <section className="space-y-1.5 xl:col-span-2">
              <h3 className="katalist-section-title">Bucket</h3>
              <p className="text-[11px] text-muted-foreground">
                In <span className="font-medium text-foreground">{currentBucket.name}</span>
              </p>
            </section>
          ) : null
        ) : caps?.canAddToBucket ? (
          <section className="space-y-1.5 xl:col-span-2">
            <h3 className="katalist-section-title">Add to Bucket</h3>
            {currentBucket ? (
              <p className="text-[11px] text-muted-foreground">
                In <span className="font-medium text-foreground">{currentBucket.name}</span>
              </p>
            ) : null}
            <select
              disabled={busy}
              className="h-8 w-full rounded-lg border border-border bg-white px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                run.mutate(async () => {
                  if (currentBucket && currentBucket.id !== e.target.value) {
                    await rpcRemoveFromBucket(currentBucket.id, thing.id);
                  }
                  await rpcAddToBucket(e.target.value, thing.id);
                  toast.success(currentBucket ? "Bucket changed." : "Added to bucket.");
                });
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

        {!terminal ? (
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
        ) : null}

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
                    busy || terminal || (s === "sorted" ? !caps?.canSort : !caps?.canSetStatus)
                  }
                  onClick={() =>
                    run.mutate(async () => {
                      if (s === "sorted") {
                        await rpcSortThing(thing.id);
                        onAfterTerminalAction?.();
                      } else if (s === "not_started" || s === "under_progress") {
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
        ) : null}

        <div
          data-detail-region="metadata"
          className="grid grid-cols-2 gap-3 border-t border-border/70 pt-3 xl:col-span-2"
        >
          {thing.dueAt ? (
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="katalist-section-title">Due Date</h3>
              </div>
              <p className="flex items-start gap-1.5 text-[11px] text-foreground">
                <Calendar className="mt-0.5 h-3.5 w-3.5 text-primary" />
                <span>
                  {dueLabel}
                  <span className="block text-[10px] text-muted-foreground">
                    {format(new Date(thing.dueAt), "dd MMM yyyy")}
                  </span>
                </span>
              </p>
            </section>
          ) : null}

          {thing.listName ? (
            <section className="space-y-2">
              <h3 className="katalist-section-title">Source</h3>
              <p className="flex items-start gap-1.5 text-[11px] text-foreground">
                <ListIcon className="mt-0.5 h-3.5 w-3.5 text-primary" />
                <span>
                  {thing.listName}
                  <span className="block text-[10px] text-muted-foreground">List</span>
                </span>
              </p>
            </section>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border/70 bg-white px-5 py-4">
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
                    className="flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-primary bg-white text-[11px] font-medium text-primary hover:bg-white disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Hand className="h-3.5 w-3.5" />
                    )}
                    Caught It
                  </button>
                ) : null}

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
                        onClick={() => {
                          if (window.confirm("Are you sure you want to cancel this thing?")) {
                            run.mutate(async () => {
                              await rpcCancelThing(thing.id);
                              toast.success("Cancelled.");
                              onAfterTerminalAction?.();
                            });
                          }
                        }}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white text-[11px] font-medium text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                        Cancel Thing
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
                  <CommentRow
                    key={c.id}
                    author={c.author}
                    avatarUrl={c.avatarUrl}
                    body={c.body}
                    at={c.at}
                    sending={"sending" in c ? (c as any).sending : undefined}
                    attachments={c.attachments}
                    onFileSelect={onFileSelect}
                  />
                ))
              )}
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = comment.trim();
                  if ((!text && commentAttachments.length === 0) || thread.post.isPending) return;
                  const atts = [...commentAttachments];
                  setComment("");
                  setCommentAttachments([]);
                  thread.post.mutate(
                    { body: text, attachments: atts.length > 0 ? atts : undefined },
                    {
                      onError: (err) => {
                        setComment(text);
                        setCommentAttachments(atts);
                        toast.error(domainErrorMessage(err));
                      },
                      onSuccess: () => {
                        toast.success("Comment sent.");
                      },
                    },
                  );
                }}
              >
                {commentAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {commentAttachments.map((att) => (
                      <span key={att.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px]">
                        <span className="truncate max-w-[100px]">{att.name}</span>
                        <button type="button" onClick={() => setCommentAttachments((prev) => prev.filter((f) => f.id !== att.id))}>
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => commentFileInputRef.current?.click()}
                    className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
                    title="Attach file"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </button>
                  <input
                    value={comment}
                    disabled={!caps?.canComment || thread.post.isPending}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={thread.post.isPending ? "Sending…" : "Write a comment…"}
                    className="h-7 flex-1 rounded-md border border-border bg-white px-2 text-[10px] outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={!caps?.canComment || (!comment.trim() && commentAttachments.length === 0) || thread.post.isPending}
                    className="inline-flex items-center gap-1 h-7 rounded-md bg-primary px-2.5 text-[10px] text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                  >
                  {thread.post.isPending ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Sending…</span>
                    </>
                  ) : (
                    <span>Post</span>
                  )}
                </button>
                </div>
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
