import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Bell,
  Calendar,
  Check,
  Hand,
  List as ListIcon,
  Loader2,
  Lock,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { domainErrorMessage } from "@/lib/domain-error";
import type { Pace, Thing } from "@/domain/thing";
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
import { withOptimisticPatch } from "./query-updates";
import { invalidatePersonalSurfaces } from "./personal-shred";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
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
import { ThingIdentityHeader } from "./components/ThingIdentityHeader";
import { ThingStatusControls } from "./components/ThingStatusControls";
import { ThingAttachments } from "./components/ThingAttachments";
import { ThingDiscussion } from "./components/ThingDiscussion";
import { getDraft, setDraft, clearDraft, getDraftRevision } from "@/features/drafts/session-drafts";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";

export type ThingDetailContentProps = {
  initialThing: Thing | null;
  headerAction?: React.ReactNode;
  onAfterTerminalAction?: () => void;
  variant?: "default" | "court";
  viewOnly?: boolean;
  onFileSelect?: (file: ThingFile) => void;
};


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
        className="flex h-8 w-full items-center gap-2 px-3 text-left text-[12px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        aria-expanded={expanded}
      >
        <span>Assign outside Katalist</span>
        {disabled ? <Lock className="ml-auto h-3.5 w-3.5 text-muted-foreground" /> : null}
        {!disabled ? (
          <span className="ml-auto text-[12px] text-muted-foreground">
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
              <code className="min-w-0 flex-1 truncate text-[12px] text-foreground">
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
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const thread = useThingComments(thing?.id ?? null, tab === "activity");
  const assignableList = useMemo(() => {
    const list = [...people];
    if (thing?.assignee && !list.some((p) => p.id === thing.assignee.id)) {
      list.unshift(thing.assignee);
    }
    return list;
  }, [people, thing?.assignee]);
  const { buckets, preview: bucketsPreview } = useBuckets();
  // E-03: comment/commentAttachments are a per-Thing draft, not component
  // state that happens to be cleared on Thing change. Initialized from
  // whatever draft this Thing already has (covers the common case where a
  // parent keys ThingDetailContent by thing.id, so this only runs once per
  // mount) and re-hydrated by the effect below on every actual thing.id
  // change (covers CourtDetailModal, the one render site that does NOT key
  // by thing.id, so this same component instance can be handed a different
  // Thing without unmounting).
  const [comment, setComment] = useState(() => getDraft<string>(qc, "thing-comment", thing?.id ?? "")?.value ?? "");
  const [due, setDue] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [commentAttachments, setCommentAttachments] = useState<ThingFile[]>(
    () => (getDraft<string>(qc, "thing-comment", thing?.id ?? "")?.attachments as ThingFile[] | undefined) ?? [],
  );
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const commentFileInputRef = useRef<HTMLInputElement | null>(null);
  const thingFileInputRef = useRef<HTMLInputElement | null>(null);
  // E-03: latest thing.id on every render, readable from an async
  // continuation that captured an OLDER thing.id in its own closure --
  // lets a continuation tell whether it's still looking at the Thing it
  // started with.
  const thingIdRef = useRef(thing?.id);
  thingIdRef.current = thing?.id;
  // R-02: thingIdRef is only ever updated by a render, so after the
  // component UNMOUNTS entirely (not just switches to a different Thing)
  // it keeps pointing at whatever Thing was last displayed -- indistinguishable
  // from "still mounted, still on the same Thing" by thingIdRef alone. An
  // explicit mounted flag is what actually distinguishes the two.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [processingCommentFiles, setProcessingCommentFiles] = useState(0);

  // T05: only counts as "viewed" when the Comments tab is actually
  // selected, and only once that tab's own read has settled successfully
  // -- opening a Thing at all (even on the Activity tab, even before
  // comments load) used to mark EVERYTHING read as of wall-clock now,
  // which could suppress the unread badge for a comment the viewer never
  // actually saw. Anchored to the latest LOADED comment's own timestamp,
  // not "now" -- a comment that arrives after this boundary (even a
  // moment later, while still on this same render) must still show as
  // unread on the next check.
  useEffect(() => {
    if (!thing?.id || !myActorId) return;
    if (tab !== "comments") return;
    if (thread.commentsIsLoading || thread.commentsError) return;
    const latestComment = thread.comments[thread.comments.length - 1];
    if (!latestComment) return; // nothing loaded to anchor a read boundary to
    const latestAt = new Date(latestComment.at).getTime();
    if (Number.isNaN(latestAt)) return;
    markThingAsRead(thing.id, myActorId, latestAt);
  }, [thing?.id, myActorId, tab, thread.commentsIsLoading, thread.commentsError, thread.comments]);

  // E-03: register a blocker while there's unsent text/files so nothing
  // (Morning Brief's auto-open, etc.) can silently interrupt mid-draft.
  // R-02: also block while a selected file is still being processed --
  // it isn't in commentAttachments yet, but it's just as much an
  // in-progress composer action.
  useBlockWhile(
    Boolean(comment.trim()) || commentAttachments.length > 0 || processingCommentFiles > 0,
    "thing-comment-draft",
  );

  const handleCommentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // E-03: captured before any await -- if the selected Thing changes
    // while these files are still processing, the result belongs to the
    // Thing the user was looking at when they picked the files, not
    // whatever happens to be selected once processing finishes.
    const targetThingId = thing?.id;
    // Follow-up review of R-02: also captured before any await --
    // setDraft() stamps a write with WHATEVER epoch is current AT WRITE
    // TIME by default, not "unreadable after a switch" as an earlier
    // version of this comment incorrectly claimed. Without passing the
    // epoch captured HERE explicitly, a late write (after an account
    // switch during processing) would be stamped as belonging to the NEW
    // identity, making an old identity's file readable under a new
    // account. Passing it explicitly makes setDraft() silently no-op
    // instead once the epoch has gone stale, per its own contract.
    const targetEpoch = getIdentityEpoch(qc).epoch;
    try {
      const files = e.target.files;
      if (!files || files.length === 0 || !targetThingId) return;
      setProcessingCommentFiles((n) => n + 1);
      const newFiles: ThingFile[] = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const processed = await processFileForUpload(files[i]);
          newFiles.push(processed);
        } catch (err) {
          if (isMountedRef.current && thingIdRef.current === targetThingId) {
            toast.error(err instanceof Error ? err.message : `Could not attach ${files[i].name}`);
          }
        }
      }
      if (newFiles.length === 0) return;
      // R-02: still mounted AND still showing the Thing these files were
      // picked for -- update live state directly; the write-through effect
      // below persists it to the draft on the next render, same as before.
      if (isMountedRef.current && thingIdRef.current === targetThingId) {
        setCommentAttachments((prev) => [...prev, ...newFiles]);
      } else {
        // Unmounted entirely, OR still mounted but now showing a different
        // Thing -- either way there is no live state to update, so persist
        // directly into targetThingId's own draft, under the CAPTURED
        // epoch -- if the identity has since changed, setDraft() silently
        // drops this write instead of misattributing an old identity's
        // file to whatever identity is current now.
        const existing = getDraft<string>(qc, "thing-comment", targetThingId);
        setDraft(
          qc,
          "thing-comment",
          targetThingId,
          {
            value: existing?.value ?? "",
            attachments: [...((existing?.attachments as ThingFile[] | undefined) ?? []), ...newFiles],
          },
          targetEpoch,
        );
      }
    } finally {
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
      setProcessingCommentFiles((n) => Math.max(0, n - 1));
    }
  };

  const handleThingFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Captured before any await in this handler.
    const uploadEpoch = getIdentityEpoch(qc).epoch;
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
          if (isEpochCurrent(qc, uploadEpoch)) {
            onFileSelect?.(processed);
            toast.success(`Attached ${files[i].name}`);
          }
        } catch (err) {
          if (isEpochCurrent(qc, uploadEpoch)) {
            toast.error(err instanceof Error ? err.message : `Could not attach ${files[i].name}`);
          }
        }
      }
      if (!isEpochCurrent(qc, uploadEpoch)) return;
      await qc.invalidateQueries({ queryKey: ["thing", thing.id] });
      await qc.invalidateQueries({ queryKey: ["court"] });
    } finally {
      if (thingFileInputRef.current) thingFileInputRef.current.value = "";
    }
  };

  // E-03: re-hydrate the draft whenever the DISPLAYED Thing actually
  // changes -- not just on mount (the initializers above only run once).
  // This is what makes CourtDetailModal (the render site with no
  // key={thing.id}, so this same instance can be handed a different
  // Thing without unmounting) restore the NEW Thing's own draft instead
  // of leaking the previous Thing's still-live comment/attachments state.
  useEffect(() => {
    setMoreOpen(false);
    const draft = getDraft<string>(qc, "thing-comment", thing?.id ?? "");
    setComment(draft?.value ?? "");
    setCommentAttachments((draft?.attachments as ThingFile[] | undefined) ?? []);
    // T02: null -> Thing A -> Thing B -> null transitions. Neither the
    // due-date edit input nor the selected-file-in-viewer selection had
    // any per-Thing draft store or reset -- switching Thing (this same
    // component instance, e.g. via CourtDetailModal) left Thing A's typed
    // (unsaved) due-date value visible in Thing B's own "Edit Due Date"
    // input, and Thing A's selected attachment id carried over into Thing
    // B's own Files list (where it may not even exist, or may coincide
    // with an unrelated file's id). Neither is a durable draft worth
    // persisting across navigation (unlike the comment composer above) --
    // it's simple editable/selection state that must just not leak
    // between Things.
    setDue("");
    setSelectedFileId(null);
  }, [thing?.id, qc]);

  // E-03: write-through -- every edit is persisted immediately so it
  // survives unmount/remount (closing and reopening the same Thing) and,
  // for CourtDetailModal specifically, a same-instance switch to another
  // Thing and back. Writing the same value back right after the
  // hydration effect above is harmless (idempotent, not a render loop).
  useEffect(() => {
    if (!thing?.id) return;
    if (!comment && commentAttachments.length === 0) {
      clearDraft(qc, "thing-comment", thing.id);
      return;
    }
    setDraft(qc, "thing-comment", thing.id, { value: comment, attachments: commentAttachments });
  }, [qc, thing?.id, comment, commentAttachments]);

  const invalidate = async (epoch: number) => {
    if (!isEpochCurrent(qc, epoch)) return;
    await invalidatePersonalSurfaces(qc, epoch);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["thing"] }),
      qc.invalidateQueries({ queryKey: ["notifications"] }),
      qc.invalidateQueries({ queryKey: ["buckets"] }),
      qc.invalidateQueries({ queryKey: ["bucket-items"] }),
    ]);
  };

  const run = useMutation({
    // Captures the epoch at mutation-start (before `fn()`'s own work,
    // and therefore before any await inside it) and threads it through
    // to onSuccess as the mutationFn's return value -- this mutation is
    // reused generically across every withOptimisticPatch(...) call site
    // in this file, so there's no single fixed place to read a captured
    // epoch other than here, at the point `run.mutate(fn)` actually
    // starts running.
    mutationFn: async (fn: () => Promise<unknown>) => {
      const epoch = getIdentityEpoch(qc).epoch;
      await fn();
      return epoch;
    },
    onSuccess: async (epoch) => {
      await invalidate(epoch);
    },
    onError: (err) => {
      toast.error(domainErrorMessage(err));
    },
  });

  const comments = thread.comments;
  const events = thread.activity;
  const busy = run.isPending;

  const currentBuckets = useMemo(() => {
    void localVersion;
    if (!thing) return [];
    return buckets.filter(
      (bucket) =>
        bucket.thingIds?.includes(thing.id) ||
        bucket.previews?.some((preview) => preview.kind === "thing" && preview.thingId === thing.id) ||
        getBucketRefs(bucket.id).some((ref) => ref.thingId === thing.id),
    );
  }, [buckets, thing, localVersion]);

  const creatorAvatar = useAvatarUrl(thing?.creator.name, null, thing?.creator.avatarUrl);
  const ownerAvatar = useAvatarUrl(thing?.owner.name, null, thing?.owner.avatarUrl);
  const assigneeAvatar = useAvatarUrl(thing?.assignee.name, null, thing?.assignee.avatarUrl);

  if (!thing) return null;

  // E-03/R-01: shared by both variant branches' comment forms below
  // (they're two renderings of the same comment/commentAttachments
  // state, not two independent drafts). The actual restore-on-failure
  // and toast are now owned by use-thing-comments.ts's own hook-level
  // mutation callbacks (R-01) -- a per-call `.mutate(vars, {onError})`
  // callback like this used to own that logic directly, but does not
  // reliably fire once this component has unmounted (confirmed
  // directly against a real useMutation), which is exactly the case a
  // failed send closing over a since-closed detail needs to survive.
  // This per-call callback's only remaining job is purely cosmetic: if
  // the user is STILL looking at the SAME Thing when the failure
  // arrives, mirror whatever the hook-level callback already restored
  // into the draft store back into the live input -- there is nothing
  // to mirror into if unmounted, which is fine, since there is no
  // visible input to update in that case anyway.
  const submitComment = () => {
    const text = comment.trim();
    if ((!text && commentAttachments.length === 0) || thread.post.isPending) return;
    const atts = [...commentAttachments];
    const submittedThingId = thing.id;
    setComment("");
    setCommentAttachments([]);
    // T02: clear the draft store synchronously, HERE, rather than relying
    // on the write-through effect below to eventually do it once this
    // render commits -- capturing the revision right after this explicit
    // clear is what lets onError's later comparison mean "has anything
    // touched this draft since THIS submission's own clear", not "since
    // whatever the draft looked like a moment before submitting" (which
    // would count this very clear as if it were a later, independent
    // edit). clearDraft() is a no-op revision-wise if the effect already
    // beat it to the same clear -- see session-drafts.ts's own doc.
    clearDraft(qc, "thing-comment", submittedThingId);
    const submittedRevision = getDraftRevision(qc, "thing-comment", submittedThingId);
    thread.post.mutate(
      {
        thingId: submittedThingId,
        body: text,
        attachments: atts.length > 0 ? atts : undefined,
        draftRevision: submittedRevision,
        epoch: getIdentityEpoch(qc).epoch,
      },
      {
        onError: () => {
          if (thingIdRef.current !== submittedThingId) return;
          const current = getDraft<string>(qc, "thing-comment", submittedThingId);
          setComment(current?.value ?? "");
          setCommentAttachments((current?.attachments as ThingFile[] | undefined) ?? []);
        },
      },
    );
  };

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
  const currentBucket = currentBuckets[0] ?? null;
  const dueLabel = thing.dueAt ? formatCourtDue(thing).label : null;

  const isCreatorSameAsOwner = thing.creator.id === thing.owner.id;
  const isAssigneeSameAsOwner = thing.assignee.id === thing.owner.id;
  const isTheirs = !isAssigneeSameAsOwner || !caps?.isAssignee;

  // T09 item 5: these handlers are what ThingStatusControls/ThingDiscussion
  // call via their `on*` props -- the extraction moved the JSX (buttons,
  // dropdowns, sections) into src/features/things/components/, but every
  // rpc*/run.mutate/withOptimisticPatch call stays defined here, unchanged
  // from what each button used to do inline.
  const handleSetPace = (pace: Pace) =>
    run.mutate(
      withOptimisticPatch(qc, thing.id, { personalPace: pace }, async () => {
        await rpcSetPersonalPace(thing.id, pace);
      }),
    );

  const handleCatchAndStart = () =>
    run.mutate(
      withOptimisticPatch(
        qc,
        thing.id,
        { acknowledgement: "caught", workStatus: "under_progress", personalPace: "next" },
        async () => {
          await rpcCatchAndStart(thing.id);
          toast.success("Caught — now in progress.");
        },
      ),
    );

  const handleSort = () =>
    run.mutate(
      withOptimisticPatch(
        qc,
        thing.id,
        { workStatus: "sorted", sortedAt: new Date().toISOString() },
        async () => {
          await rpcSortThing(thing.id);
          toast.success("Nicely sorted.");
          onAfterTerminalAction?.();
        },
      ),
    );

  const handleSelectBucket = (bucketId: string) =>
    run.mutate(async () => {
      if (currentBucket && currentBucket.id === bucketId) return;
      if (currentBucket) await rpcRemoveFromBucket(currentBucket.id, thing.id);
      await rpcAddToBucket(bucketId, thing.id);
      toast.success(currentBucket ? "Bucket changed." : "Added to bucket.");
    });

  const handleReassign = (targetId: string) => {
    const target = assignableList.find((p) => p.id === targetId);
    run.mutate(
      withOptimisticPatch(
        qc,
        thing.id,
        target
          ? { assignee: target, acknowledgement: "waiting_for_catch", personalPace: null, caughtAt: null }
          : {},
        async () => {
          await rpcReassignThing(thing.id, targetId);
          toast.success("Waiting for Catch.");
        },
      ),
    );
  };

  const handleSetWorkStatus = (status: "not_started" | "under_progress") =>
    run.mutate(
      withOptimisticPatch(qc, thing.id, { workStatus: status }, async () => {
        await rpcSetWorkStatus(thing.id, status);
      }),
    );

  const handleRemoveCommentAttachment = (id: string) =>
    setCommentAttachments((prev) => prev.filter((f) => f.id !== id));

  if (variant === "court") {
    const displayFiles: ThingFile[] =
      thing.files && thing.files.length > 0 ? thing.files : [];
    const activeFileId = selectedFileId ?? displayFiles[0]?.id ?? null;

    return (
      <div className="min-h-[454px] w-full text-left">
        <ThingIdentityHeader
          variant="court"
          title={thing.title}
          headerAction={headerAction}
          viewOnly={viewOnly}
          onRetry={() => void live.refetch()}
          creatorName={thing.creator.name}
          updatedAt={thing.updatedAt}
          showOverviewLoadError={thing.detailLevel === "overview" && Boolean(live.error)}
          commentCountsUnavailable={thing.commentCountsUnavailable}
        />

        <div className="space-y-4 pt-4">
          <ThingStatusControls
            variant="court"
            thing={thing}
            caps={caps}
            busy={busy}
            activePace={activePace}
            onSetPace={handleSetPace}
            currentBucket={currentBucket}
            buckets={buckets}
            onSelectBucket={handleSelectBucket}
            ownerAvatar={ownerAvatar}
            assigneeAvatar={assigneeAvatar}
            isAssigneeSameAsOwner={isAssigneeSameAsOwner}
            dueLabel={dueLabel}
            onCatch={handleCatchAndStart}
            onSort={handleSort}
          />

          {/* Description Section */}
          {thing.description ? (
            <div className="py-3 border-b border-[#eef0f6]">
              <h3 className="text-[13px] font-medium text-[#000533] mb-1.5">Description</h3>
              <p className="text-[12px] leading-relaxed text-[#6a769c] whitespace-pre-wrap">
                {thing.description}
              </p>
            </div>
          ) : null}

          <ThingAttachments
            files={displayFiles}
            activeFileId={activeFileId}
            viewOnly={viewOnly}
            isLoading={thing.detailLevel === "overview" && live.isLoading}
            attachmentsUnavailable={Boolean(thing.attachmentsUnavailable)}
            onRetry={() => void live.refetch()}
            onSelectFile={(file) => {
              setSelectedFileId(file.id);
              onFileSelect?.(file);
            }}
            onAddFileClick={() => thingFileInputRef.current?.click()}
            fileInput={
              <input
                ref={thingFileInputRef}
                type="file"
                multiple
                onChange={handleThingFileUpload}
                className="hidden"
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,*/*"
              />
            }
          />

          <ThingDiscussion
            variant="court"
            tab={tab}
            onTabChange={setTab}
            comments={comments}
            commentsHasMore={thread.commentsHasMore}
            commentsOlderError={Boolean(thread.commentsOlderError)}
            commentsLoadingOlder={thread.commentsLoadingOlder}
            onLoadOlderComments={() => void thread.loadOlderComments()}
            commentsError={Boolean(thread.commentsError)}
            unreadCommentCount={thing.unreadCommentCount ?? 0}
            events={events}
            activityHasMore={thread.activityHasMore}
            activityOlderError={Boolean(thread.activityOlderError)}
            activityLoadingOlder={thread.activityLoadingOlder}
            onLoadOlderActivity={() => void thread.loadOlderActivity()}
            activityError={Boolean(thread.activityError)}
            commentAttachments={commentAttachments}
            onRemoveCommentAttachment={handleRemoveCommentAttachment}
            comment={comment}
            onCommentChange={setComment}
            onSubmitComment={submitComment}
            postIsPending={thread.post.isPending}
            onOpenCommentFileDialog={() => commentFileInputRef.current?.click()}
            commentFileInput={
              <input
                ref={commentFileInputRef}
                type="file"
                multiple
                onChange={handleCommentFileChange}
                className="hidden"
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,*/*"
              />
            }
            onFileSelect={onFileSelect}
          />
        </div>
      </div>
    );
  }

  const moreActionsButton = hasMoreActions ? (
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
  ) : null;

  const moreActionsPanel = moreOpen ? (
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
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-white px-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              disabled={busy}
              className="h-7 rounded-md border border-border bg-white px-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                if (!due) return;
                const iso = new Date(due).toISOString();
                run.mutate(
                  withOptimisticPatch(qc, thing.id, { dueAt: iso, dueHasTime: true }, async () => {
                    await rpcSetDue(thing.id, iso, true);
                  }),
                );
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
                run.mutate(
                  withOptimisticPatch(
                    qc,
                    thing.id,
                    { acknowledgement: "caught", personalPace: "next", caughtAt: new Date().toISOString() },
                    async () => {
                      await rpcCatchThing(thing.id);
                      toast.success("Caught.");
                    },
                  ),
                )
              }
              className="flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-primary bg-white text-[12px] font-medium text-primary hover:bg-white disabled:opacity-60"
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
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-white text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Bell className="h-3 w-3" />
                  Nudge
                </button>
              ) : null}
              {caps?.canSort ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSort}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-white text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
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
                      run.mutate(
                        withOptimisticPatch(
                          qc,
                          thing.id,
                          { workStatus: "cancelled", cancelledAt: new Date().toISOString() },
                          async () => {
                            await rpcCancelThing(thing.id);
                            toast.success("Cancelled.");
                            onAfterTerminalAction?.();
                          },
                        ),
                      );
                    }
                  }}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white text-[12px] font-medium text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
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
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border bg-white text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Shred for me
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="min-h-full">
      <ThingIdentityHeader
        variant="default"
        title={thing.title}
        headerAction={headerAction}
        viewOnly={viewOnly}
        onRetry={() => void live.refetch()}
        context={thing.context}
        listName={thing.listName}
        updatedAt={thing.updatedAt}
        showCombinedError={Boolean(
          thing.commentCountsUnavailable ||
            thing.attachmentsUnavailable ||
            (thing.detailLevel === "overview" && live.error),
        )}
      />

      <div className="grid grid-cols-1 gap-4 px-5 py-4 xl:grid-cols-2">
        <ThingStatusControls
          variant="default"
          thing={thing}
          caps={caps}
          busy={busy}
          activePace={activePace}
          onSetPace={handleSetPace}
          currentBucket={currentBucket}
          buckets={buckets}
          onSelectBucket={handleSelectBucket}
          viewOnly={viewOnly}
          assignableList={assignableList}
          onReassign={handleReassign}
          terminal={terminal}
          onSort={handleSort}
          onSetWorkStatus={handleSetWorkStatus}
        />

        <div
          data-detail-region="metadata"
          className="grid grid-cols-2 gap-3 border-t border-border/70 pt-3 xl:col-span-2"
        >
          {thing.dueAt ? (
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="katalist-section-title">Due Date</h3>
              </div>
              <p className="flex items-start gap-1.5 text-[12px] text-foreground">
                <Calendar className="mt-0.5 h-3.5 w-3.5 text-primary" />
                <span>
                  {dueLabel}
                  <span className="block text-[12px] text-muted-foreground">
                    {format(new Date(thing.dueAt), "dd MMM yyyy")}
                  </span>
                </span>
              </p>
            </section>
          ) : null}

          {thing.listName ? (
            <section className="space-y-2">
              <h3 className="katalist-section-title">Source</h3>
              <p className="flex items-start gap-1.5 text-[12px] text-foreground">
                <ListIcon className="mt-0.5 h-3.5 w-3.5 text-primary" />
                <span>
                  {thing.listName}
                  <span className="block text-[12px] text-muted-foreground">List</span>
                </span>
              </p>
            </section>
          ) : null}
        </div>
      </div>

      <ThingDiscussion
        variant="default"
        tab={tab}
        onTabChange={setTab}
        comments={comments}
        commentsHasMore={thread.commentsHasMore}
        commentsOlderError={Boolean(thread.commentsOlderError)}
        commentsLoadingOlder={thread.commentsLoadingOlder}
        onLoadOlderComments={() => void thread.loadOlderComments()}
        commentsError={Boolean(thread.commentsError)}
        unreadCommentCount={thing.unreadCommentCount ?? 0}
        events={events}
        activityHasMore={thread.activityHasMore}
        activityOlderError={Boolean(thread.activityOlderError)}
        activityLoadingOlder={thread.activityLoadingOlder}
        onLoadOlderActivity={() => void thread.loadOlderActivity()}
        activityError={Boolean(thread.activityError)}
        commentAttachments={commentAttachments}
        onRemoveCommentAttachment={handleRemoveCommentAttachment}
        comment={comment}
        onCommentChange={setComment}
        onSubmitComment={submitComment}
        postIsPending={thread.post.isPending}
        onOpenCommentFileDialog={() => commentFileInputRef.current?.click()}
        commentFileInput={null}
        onFileSelect={onFileSelect}
        canComment={caps?.canComment}
        workStatus={thing.workStatus}
        hasMoreActions={hasMoreActions}
        moreActionsButton={moreActionsButton}
        moreActionsPanel={moreActionsPanel}
      />
    </div>
  );
}
