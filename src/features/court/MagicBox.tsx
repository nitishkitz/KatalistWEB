import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, CalendarDays, Hash, Layers, List, Paperclip, RotateCw, Sparkles, X } from "lucide-react";
import { format } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { useAppContext } from "@/features/context/use-app-context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rpcAddToBucket, rpcCreateThing } from "@/features/things/rpc";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { mergeAssignablePeople } from "@/features/people/merge-people";
import { useLists } from "@/features/lists/use-lists";
import { useBuckets } from "@/features/buckets/use-buckets";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { isPreviewMode } from "@/lib/session-mode";
import { parseToss, tossBlockedByPerson } from "./parse-toss";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
import type { ThingFile, Person } from "@/domain/thing";
import { processFileForUpload, formatFileSize, getClipboardFiles } from "@/lib/file-utils";
import { acquireBlobUrl, releaseBlobUrl, releaseAllBlobUrlsForOwner } from "@/lib/owned-file-resources";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import { getDraft, setDraft, clearDraft } from "@/features/drafts/session-drafts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Importance } from "@/domain/thing";
import { MAGIC_BOX_FOCUS_EVENT } from "./magic-box-entry";

type MagicBoxMotionState = "idle" | "hover" | "focused" | "typing" | "submitting" | "processing" | "success" | "error";

function MagicBoxGlow() {
  return (
    <>
      <span className="magic-box-aura" aria-hidden="true"><span className="magic-box-aura-light" /></span>
      <span className="magic-box-frame" aria-hidden="true"><span className="magic-box-frame-light" /></span>
      <span className="magic-box-fill" aria-hidden="true" />
    </>
  );
}

/** Sentence-case the first letter of a parsed title, leaving links and handles alone. */
function capitalizeTitle(title: string): string {
  if (!title || /^(?:https?:\/\/|www\.)/i.test(title)) return title;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function MagicBox({
  listId,
  listName,
  desktop = false,
  extraPeople,
  onThingCreated,
}: {
  listId?: string;
  listName?: string;
  desktop?: boolean;
  /** Extra @-mention candidates (e.g. the current list's members) merged with
   *  the globally assignable people so mentions like @Rohit resolve. */
  extraPeople?: Person[];
  /** T09/E05: lets the caller offer an "Open" action on a successful
   *  single-Thing capture -- the caller looks the Thing up in whatever
   *  view/selection state it already owns at click time (not capture
   *  time), the same no-hero-animation pattern CourtDesktop already uses
   *  for opening a Thing from the Morning Brief overlay. Optional: a
   *  caller with no such mechanism (e.g. a bare mobile composer) can omit
   *  it and the success toast just identifies the Thing by title instead. */
  onThingCreated?: (thingId: string, title: string) => void;
}) {
  const { context } = useAppContext();
  const qc = useQueryClient();
  // T09/E05: one Magic Box draft slot per (destination List, or Work/Home
  // context when there's no List) -- switching Work<->Home context does
  // not unmount this component, so without the context in the key a
  // half-typed Home toss would still be sitting in the input after
  // switching to Work. A List-scoped composer keys off the List instead,
  // since it never changes context underneath the same instance.
  const draftEntityId = listId ? `list:${listId}` : `court:${context}`;
  // H04: scopes blob-URL ownership to this composer's own draft slot, not
  // to component mount lifecycle -- unmounting (e.g. navigating away) must
  // never revoke a retained draft's attachment preview, only an explicit
  // remove or a genuinely completed/cleared Toss should.
  const fileOwnerKey = `magic-box:${draftEntityId}`;
  // T09 fix: file processing and Toss are async and can outlive a
  // destination switch (Work<->Home, or a different List) that happens
  // while they're in flight -- without this guard, a slow upload or Toss
  // started for the OLD destination could resolve after the switch and
  // append a file to, or clear, the NEW destination's draft. Every async
  // operation below captures `epochRef.current` before its first `await`
  // and re-checks it afterward; a mismatch means the destination changed
  // mid-flight, so the stale result is dropped instead of applied.
  const epochRef = useRef(0);

  const [value, setValue] = useState(() => getDraft<string>(qc, "magic-box", draftEntityId)?.value ?? "");
  const suppressPasteTextRef = useRef(false);
  const [paceOverride, setPaceOverride] = useState<Importance | null>(null);
  // undefined follows parsed text; null explicitly clears the inferred date.
  const [dueOverride, setDueOverride] = useState<string | null | undefined>(undefined);
  const [tossed, setTossed] = useState(false);
  const [motionHovered, setMotionHovered] = useState(false);
  const [motionFocused, setMotionFocused] = useState(false);
  const [motionAccent, setMotionAccent] = useState<"submitting" | "success" | "error" | "attachment" | "first-character" | null>(null);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const motionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionPhaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitHandoff, setSubmitHandoff] = useState(false);

  const flashMotion = (accent: typeof motionAccent, duration: number) => {
    if (motionTimer.current) clearTimeout(motionTimer.current);
    setMotionAccent(accent);
    motionTimer.current = setTimeout(() => setMotionAccent(null), duration);
  };

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      if (motionTimer.current) clearTimeout(motionTimer.current);
      if (motionPhaseTimer.current) clearTimeout(motionPhaseTimer.current);
    };
  }, []);
  const [trigger, setTrigger] = useState<{
    type: "person" | "list" | "bucket";
    query: string;
    startIndex: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // tracks which person ID the user has explicitly dismissed from the suggestion prompt
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<ThingFile[]>(
    () => (getDraft<string>(qc, "magic-box", draftEntityId)?.attachments as ThingFile[] | undefined) ?? [],
  );
  // E04: a multi-assignee toss used to Promise.all() every rpcCreateThing
  // call -- if even one rejected, the whole mutation rejected too, but the
  // OTHER assignees' Things were already really created (Promise.all
  // doesn't undo settled work). Pressing Toss again then replayed the
  // ENTIRE assignee list, including the ones that already succeeded,
  // creating duplicates for them. This tracks which assignee ids from the
  // last attempt still need retrying, so the next submit only retries
  // those -- set on a partial failure, cleared on a fresh edit or a fully
  // successful toss.
  const [retryAssigneeIds, setRetryAssigneeIds] = useState<string[] | null>(null);
  // T03: how many selected files are still being processed -- not yet in
  // attachedFiles, but just as much an in-progress composer action as
  // typed text or an already-attached file (same reasoning as
  // ThingDetailContent's own processingCommentFiles).
  const [processingFiles, setProcessingFiles] = useState(0);
  // T09/E05: a file that failed validation/processing used to be silently
  // dropped with just a toast -- no visible chip, no way to retry without
  // re-picking the file from the OS file dialog again. Each entry keeps
  // the original File object (so Retry re-runs processFileForUpload on the
  // SAME file, not a re-selection) under a stable operation id, and is
  // independent of `attachedFiles` -- one file failing never touches
  // others that already succeeded.
  const [failedAttachments, setFailedAttachments] = useState<
    Array<{ id: string; file: File; name: string; sizeLabel: string; error: string }>
  >([]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const assignablePeople = useAssignablePeople();
  const people = useMemo(
    () => (extraPeople?.length ? mergeAssignablePeople(assignablePeople, extraPeople) : assignablePeople),
    [assignablePeople, extraPeople],
  );
  const { lists } = useLists();
  const { buckets } = useBuckets();

  // T03: register a blocker while there's unsent Magic Box text/files (or
  // a file still processing) so nothing (Morning Brief's auto-open, etc.)
  // can silently interrupt a mid-capture the way ThingDetailContent's own
  // comment composer already guards against.
  useBlockWhile(
    Boolean(value.trim()) || attachedFiles.length > 0 || processingFiles > 0 || failedAttachments.length > 0,
    "magic-box-draft",
  );

  // T09/E05: re-hydrate whenever the draft slot itself changes (switching
  // List, or switching Work/Home context on the bare Court composer) --
  // the lazy initializers above only ever run once, on first mount.
  useEffect(() => {
    // Bumping the epoch here (before anything else) invalidates every
    // async operation (file processing, Toss) that was still in flight for
    // the PREVIOUS destination -- their `finally`/`onSuccess` handlers
    // check this epoch and drop their result instead of mutating the
    // draft/attachments state now shown for the new destination.
    epochRef.current += 1;
    const draft = getDraft<string>(qc, "magic-box", draftEntityId);
    setValue(draft?.value ?? "");
    setPaceOverride(null);
    setDueOverride(undefined);
    setAttachedFiles((draft?.attachments as ThingFile[] | undefined) ?? []);
    // Failed/in-flight uploads are transient per-composer-instance state,
    // not part of the persisted draft -- a validation failure against one
    // destination has no meaning once switched to a different one.
    setFailedAttachments([]);
    setProcessingFiles(0);
    setRetryAssigneeIds(null);
    setTrigger(null);
    setDismissedSuggestionId(null);
  }, [draftEntityId, qc]);

  // T09/E05: write-through -- every edit persists immediately, so typed
  // text, chosen assignees (embedded in the text itself), and already-
  // processed attachment upload handles all survive unmount/remount (e.g.
  // navigating away from a List and back) the same way ThingDetailContent's
  // comment composer already does for its own draft.
  useEffect(() => {
    if (!value && attachedFiles.length === 0) {
      clearDraft(qc, "magic-box", draftEntityId);
      return;
    }
    setDraft(qc, "magic-box", draftEntityId, { value, attachments: attachedFiles });
  }, [qc, draftEntityId, value, attachedFiles]);

  const applyFirstAsTitleIfEmpty = (firstNewFile: ThingFile) => {
    // If input value is empty, auto-populate with the file name (without extension)
    // so the user immediately sees what they are tossing, can edit it or add tags,
    // and the Toss button enables immediately.
    if (value.trim()) return;
    const cleanName = firstNewFile.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (cleanName) setValue(cleanName);
  };

  const processOneFile = async (opId: string, file: File, opEpoch: number) => {
    setProcessingFiles((n) => n + 1);
    try {
      const processed = await processFileForUpload(file);
      // The destination may have changed while this awaited -- an old
      // upload landing here would silently append a file to whatever
      // List/context the user has since switched to.
      if (epochRef.current !== opEpoch) return;
      acquireBlobUrl(processed.url, fileOwnerKey);
      setAttachedFiles((prev) => [...prev, processed]);
      applyFirstAsTitleIfEmpty(processed);
      flashMotion("attachment", 630);
    } catch (err) {
      console.error("Failed to process file:", err);
      if (epochRef.current !== opEpoch) return;
      const message = err instanceof Error ? err.message : `Could not attach ${file.name}`;
      flashMotion("error", 650);
      setFailedAttachments((prev) => [
        ...prev,
        { id: opId, file, name: file.name, sizeLabel: formatFileSize(file.size), error: message },
      ]);
    } finally {
      // Only decrement the counter that this operation itself incremented
      // -- if the destination changed, the re-hydrate effect already reset
      // processingFiles to 0 for the new destination, and this stale
      // decrement must not touch it.
      if (epochRef.current === opEpoch) {
        setProcessingFiles((n) => Math.max(0, n - 1));
      }
    }
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    // Captured once, before any await, so every file from this pick shares
    // the destination it was picked for, regardless of how long processing
    // takes or whether the user switches destinations before it resolves.
    const opEpoch = epochRef.current;
    // Each file gets its own stable operation id and its own
    // validating->ready|failed transition, entirely independent of the
    // others -- one slow/failing file never blocks or drops another that
    // already succeeded.
    const picked = files.map((file) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
    }));
    await Promise.all(picked.map(({ id, file }) => processOneFile(id, file, opEpoch)));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    await processFiles(Array.from(files));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const files = getClipboardFiles(e.clipboardData);
    if (!files.length) return;
    // When the clipboard contains a file, its plain-text entry is often only
    // an image's alt label or filename (e.g. "image"). Treat this as an attach
    // action; ordinary text-only clipboard paste still uses the browser default.
    e.preventDefault();
    e.stopPropagation();
    // Some browsers expose both an image file and its alt label (often just
    // "image") as separate paste payloads. Suppress the follow-up text input
    // explicitly as well as preventing the paste default.
    suppressPasteTextRef.current = true;
    setValue(e.currentTarget.value);
    window.setTimeout(() => {
      suppressPasteTextRef.current = false;
    }, 0);
    void processFiles(files);
  };

  const removeAttachedFile = (fileId: string) => {
    setAttachedFiles((prev) => {
      const removed = prev.find((f) => f.id === fileId);
      if (removed) releaseBlobUrl(removed.url, fileOwnerKey);
      return prev.filter((f) => f.id !== fileId);
    });
  };

  const removeFailedAttachment = (opId: string) => {
    setFailedAttachments((prev) => prev.filter((f) => f.id !== opId));
  };

  const retryFailedAttachment = async (opId: string) => {
    const entry = failedAttachments.find((f) => f.id === opId);
    if (!entry) return;
    const opEpoch = epochRef.current;
    setFailedAttachments((prev) => prev.filter((f) => f.id !== opId));
    // Same stable id on retry -- this is the same logical operation
    // continuing, not a new one.
    await processOneFile(opId, entry.file, opEpoch);
  };

  const isMac = typeof navigator !== "undefined" && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);

  useEffect(() => {
    const focusInput = () => {
      const input = inputRef.current;
      if (!input || input.getClientRects().length === 0) return;
      input.focus();
      input.select();
    };
    window.addEventListener(MAGIC_BOX_FOCUS_EVENT, focusInput);
    return () => window.removeEventListener(MAGIC_BOX_FOCUS_EVENT, focusInput);
  }, []);

  const parsed = useMemo(() => parseToss(value, people), [value, people]);
  const effectivePace = paceOverride ?? parsed.importance;
  const effectiveDueAt = dueOverride === undefined ? parsed.dueAt : dueOverride ?? undefined;
  const dueIsPast = Boolean(effectiveDueAt && new Date(effectiveDueAt).getTime() < Date.now());
  const highlightedPhrases = [
    parsed.pacePhrase ? { phrase: parsed.pacePhrase, kind: "pace" } : null,
    parsed.duePhrase ? { phrase: parsed.duePhrase, kind: "due" } : null,
  ].filter((item): item is { phrase: string; kind: string } => Boolean(item));
  // Blocked if there's an unresolved person chip, OR an unconfirmed suggestion that
  // the user hasn't explicitly dismissed yet.
  const blocked = tossBlockedByPerson(
    parsed.chips.filter(
      (c) => !(c.kind === "suggestion" && c.value === dismissedSuggestionId),
    ),
  );

  const effectiveListId = useMemo(() => {
    if (listId) return listId;
    const hashChip = parsed.chips.find((c) => c.kind === "list");
    if (!hashChip) return undefined;
    const hit = lists.find(
      (l) =>
        l.name.toLowerCase() === hashChip.value.toLowerCase() ||
        l.name.toLowerCase().includes(hashChip.value.toLowerCase()),
    );
    return hit?.id;
  }, [listId, parsed.chips, lists]);

  const effectiveBucketId = useMemo(() => {
    const bucketChip = parsed.chips.find((c) => c.kind === "bucket");
    if (!bucketChip) return undefined;
    const hit = buckets.find(
      (b) =>
        b.name.toLowerCase() === bucketChip.value.toLowerCase() ||
        b.name.toLowerCase().includes(bucketChip.value.toLowerCase()),
    );
    return hit?.id;
  }, [parsed.chips, buckets]);

  const checkMentionTrigger = (text: string, cursor: number) => {
    const textBefore = text.slice(0, cursor);
    const atMatch = textBefore.match(/(?:^|\s)@([^\s@#/]*)$/);
    const hashMatch = textBefore.match(/(?:^|\s)#([^\s@#/]*)$/);
    const slashMatch = textBefore.match(/(?:^|\s)\/([^\s@#/]*)$/);

    if (atMatch) {
      const q = atMatch[1] ?? "";
      const startIndex = textBefore.lastIndexOf("@");
      setTrigger({ type: "person", query: q, startIndex });
      setActiveIndex(0);
    } else if (hashMatch) {
      const q = hashMatch[1] ?? "";
      const startIndex = textBefore.lastIndexOf("#");
      setTrigger({ type: "list", query: q, startIndex });
      setActiveIndex(0);
    } else if (slashMatch) {
      const q = slashMatch[1] ?? "";
      const startIndex = textBefore.lastIndexOf("/");
      setTrigger({ type: "bucket", query: q, startIndex });
      setActiveIndex(0);
    } else {
      setTrigger(null);
    }
  };

  const filteredPeople = useMemo(() => {
    if (!trigger || trigger.type !== "person") return [];
    const q = trigger.query.toLowerCase();
    return people.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.initials && p.initials.toLowerCase().includes(q)),
    );
  }, [trigger, people]);

  const filteredLists = useMemo(() => {
    if (!trigger || trigger.type !== "list") return [];
    const q = trigger.query.toLowerCase();
    return lists.filter((l) => l.name.toLowerCase().includes(q));
  }, [trigger, lists]);

  const filteredBuckets = useMemo(() => {
    if (!trigger || trigger.type !== "bucket") return [];
    const q = trigger.query.toLowerCase();
    return buckets.filter((b) => b.name.toLowerCase().includes(q));
  }, [trigger, buckets]);

  const selectPerson = (person: (typeof people)[0]) => {
    if (!trigger) return;
    const prefix = value.slice(0, trigger.startIndex);
    const suffix = value.slice(trigger.startIndex + 1 + trigger.query.length);
    const namePart = person.name.split(" ")[0] || person.name;
    const nextVal = `${prefix}@${namePart} ${suffix}`;
    setValue(nextVal);
    setTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = prefix.length + namePart.length + 2;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const selectList = (list: (typeof lists)[0]) => {
    if (!trigger) return;
    const prefix = value.slice(0, trigger.startIndex);
    const suffix = value.slice(trigger.startIndex + 1 + trigger.query.length);
    const nextVal = `${prefix}#${list.name} ${suffix}`;
    setValue(nextVal);
    setTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = prefix.length + list.name.length + 2;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const selectBucket = (bucket: (typeof buckets)[0]) => {
    if (!trigger) return;
    const prefix = value.slice(0, trigger.startIndex);
    const suffix = value.slice(trigger.startIndex + 1 + trigger.query.length);
    const nextVal = `${prefix}/${bucket.name} ${suffix}`;
    setValue(nextVal);
    setTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = prefix.length + bucket.name.length + 2;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const acceptSuggestedPerson = (person: (typeof people)[0], matchedWord: string) => {
    const namePart = person.name.split(" ")[0];
    const re = new RegExp(`\\b${matchedWord}\\b`, "i");
    let nextVal = value;
    if (re.test(value)) {
      nextVal = value.replace(re, `@${namePart}`);
    } else {
      nextVal = `${value} @${namePart}`;
    }
    setValue(nextVal);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (blocked) throw new Error("Pick a person — Coey won't guess.");
      const live = !isPreviewMode();

      // E04: after a partial multi-toss failure, retry ONLY the assignees
      // that actually failed -- re-parsing `value` here would include the
      // ones that already succeeded, creating duplicate Things for them.
      const parsedAssigneeIds = parsed.assigneeIds.filter(
        (id) => !(live && id.startsWith("p-")),
      );
      const assigneeIds = retryAssigneeIds ?? parsedAssigneeIds;

      const titleToUse =
        capitalizeTitle(parsed.title.trim()) ||
        (attachedFiles[0]?.name ? `Attachment: ${attachedFiles[0].name}` : "New Thing");

      // Multi-toss: one Thing per assignee in parallel. E04: uses
      // allSettled and reports which specific assignees failed, rather
      // than Promise.all's "one rejects, the mutation rejects" -- the
      // OTHER assignees' Things are already real, committed rows the
      // instant their own call resolves, so a naive full-mutation retry
      // after a partial failure would create duplicates for them.
      if (assigneeIds.length > 1) {
        const settled = await Promise.all(
          assigneeIds.map(async (assigneeActorId) => {
            try {
              const created = await rpcCreateThing({
                title: titleToUse,
                context,
                ownerImportance: effectivePace,
                listId: effectiveListId,
                assigneeActorId,
                dueAt: effectiveDueAt,
                dueHasTime: Boolean(effectiveDueAt),
                files: attachedFiles.length > 0 ? attachedFiles : undefined,
              });
              return { assigneeActorId, id: created?.id ?? null, ok: true as const };
            } catch (err) {
              return { assigneeActorId, error: err, ok: false as const };
            }
          }),
        );

        const succeeded = settled.filter((r) => r.ok);
        const failed = settled.filter((r) => !r.ok);
        const createdIds = succeeded.map((r) => r.id).filter((id): id is string => Boolean(id));

        if (effectiveBucketId && createdIds.length > 0) {
          await Promise.allSettled(createdIds.map((id) => rpcAddToBucket(effectiveBucketId, id)));
        }

        if (failed.length === settled.length) {
          // Every assignee failed -- nothing was created, so this is a
          // plain failure like any other; existing onError handling and
          // full-mutation retry are both correct here.
          throw failed[0].error instanceof Error ? failed[0].error : new Error("Couldn’t toss that.");
        }

        return {
          count: succeeded.length,
          createdIds,
          failedAssigneeIds: failed.map((r) => r.assigneeActorId),
          title: titleToUse,
        };
      }

      // Single-toss (0 or 1 assignee)
      const assignee = assigneeIds[0];
      const created = await rpcCreateThing({
        title: titleToUse,
        context,
        ownerImportance: effectivePace,
        listId: effectiveListId,
        assigneeActorId: assignee,
        dueAt: effectiveDueAt,
        dueHasTime: Boolean(effectiveDueAt),
        files: attachedFiles.length > 0 ? attachedFiles : undefined,
      });

      if (effectiveBucketId && created?.id) {
        try {
          await rpcAddToBucket(effectiveBucketId, created.id);
        } catch {
          // ignore bucket link error
        }
      }
      return {
        count: 1,
        createdIds: created?.id ? [created.id] : [],
        failedAssigneeIds: [],
        title: titleToUse,
      };
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch, opEpoch: epochRef.current }),
    onSuccess: async (result, _vars, mutationContext) => {
      const failedAssigneeIds = result?.failedAssigneeIds ?? [];
      const hasPartialFailure = failedAssigneeIds.length > 0;
      // The user may have switched destination (Work/Home, or List) while
      // this Toss was in flight -- if so, clearing `value`/`attachedFiles`
      // now would wipe out whatever the NEW destination's draft already
      // holds, and the retry-only-failed-assignees state belongs to the
      // old destination too.
      const stillSameDestination = epochRef.current === mutationContext.opEpoch;

      if (stillSameDestination) {
        setTossed(true);
        // A partial multi-toss failure keeps the input (title/files) so the
        // retry attempt below reuses the same content -- only a full
        // success or a fresh edit (see the input's onChange) clears it.
        if (!hasPartialFailure) {
          setValue("");
          setPaceOverride(null);
          setDueOverride(undefined);
          // A fully successful Toss is done with these local blob previews
          // -- the created Thing's own files are a separate, durable
          // concern (a JSON snapshot of `attachedFiles` at capture time)
          // and no longer need this tab's temporary object URLs alive.
          releaseAllBlobUrlsForOwner(fileOwnerKey);
          setAttachedFiles([]);
          setFailedAttachments([]);
        }
        setRetryAssigneeIds(hasPartialFailure ? failedAssigneeIds : null);
        setTrigger(null);
        setDismissedSuggestionId(null);
        window.setTimeout(() => setTossed(false), 240);
      }
      if (!isEpochCurrent(qc, mutationContext.epoch)) return;
      await qc.invalidateQueries({ queryKey: keys.court("preview", context) });
      await qc.invalidateQueries({ queryKey: ["court"] });
      if (effectiveListId) {
        await qc.invalidateQueries({ queryKey: ["list-things", effectiveListId] });
        await qc.invalidateQueries({ queryKey: ["lists"] });
      }
      if (effectiveBucketId) {
        await qc.invalidateQueries({ queryKey: ["buckets"] });
      }
      if (stillSameDestination) {
        flashMotion(hasPartialFailure ? "error" : "success", hasPartialFailure ? 650 : 380);
      }
      const count = result?.count ?? 1;
      if (hasPartialFailure) {
        toast.error(
          `${count} tossed, ${failedAssigneeIds.length} failed — press Toss again to retry just the failed ${failedAssigneeIds.length > 1 ? "ones" : "one"}.`,
        );
      } else if (count === 1 && result?.createdIds.length === 1) {
        // T09/E05: identify the created Thing by title (not just a bare
        // "Tossed."), and offer Open when the caller can act on it -- the
        // callback looks the Thing up in its own current state at click
        // time, not here at toast-creation time.
        const thingId = result.createdIds[0];
        const title = result.title ?? "New Thing";
        toast.success(`"${title}" tossed ✓`, {
          action: onThingCreated
            ? { label: "Open", onClick: () => onThingCreated(thingId, title) }
            : undefined,
        });
      } else {
        toast.success(`${count} things tossed ✓`);
      }
    },
    onError: (err, _vars, mutationContext) => {
      if (mutationContext && !isEpochCurrent(qc, mutationContext.epoch)) return;
      flashMotion("error", 650);
      toast.error(err instanceof Error ? err.message : "Couldn’t toss that.");
    },
  });
  const canToss = (Boolean(value.trim()) || attachedFiles.length > 0) && !blocked && !dueIsPast && !mutation.isPending;
  const startToss = () => {
    if (!canToss) return;
    if (effectiveDueAt && new Date(effectiveDueAt).getTime() < Date.now()) {
      toast.error("This due time has passed. Choose a later time.");
      return;
    }
    flashMotion("submitting", 430);
    setSubmitHandoff(true);
    if (motionPhaseTimer.current) clearTimeout(motionPhaseTimer.current);
    motionPhaseTimer.current = setTimeout(() => setSubmitHandoff(false), 420);
    mutation.mutate();
  };
  const motionState: MagicBoxMotionState = motionAccent === "success" || motionAccent === "error"
    ? motionAccent
    : motionAccent === "submitting" ? "submitting"
      : mutation.isPending || processingFiles > 0 ? "processing"
        : value.trim() ? "typing"
          : motionFocused ? "focused"
            : motionHovered ? "hover" : "idle";

  return (
    <div
      className={cn(
        "relative w-full",
        !desktop && "mb-3",
      )}
    >
      {/* Autocomplete Popover for @ People — appears immediately on typing @ */}
      {trigger?.type === "person" && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-full max-w-sm rounded-2xl border border-border/80 bg-white p-1.5 katalist-elevation-popover animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-1">
            <AtSign className="h-3 w-3 text-primary" />
            Assign to Person
            {trigger.query && (
              <span className="ml-auto normal-case font-normal text-muted-foreground/70">
                "{trigger.query}"
              </span>
            )}
          </div>
          <div className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredPeople.length > 0 ? (
              filteredPeople.map((person, idx) => (
                <button
                  key={person.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectPerson(person);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[12.5px] transition-colors cursor-pointer",
                    idx === activeIndex
                      ? "bg-primary/10 font-semibold text-primary"
                      : "hover:bg-muted/50 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PersonAvatar
                      name={person.name}
                      initials={person.initials}
                      src={person.avatarUrl}
                      size={26}
                    />
                    <span className="block min-w-0 truncate font-medium text-[12.5px]">{person.name}</span>
                  </div>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-3 text-[12px] text-muted-foreground text-center">
                {trigger.query ? `No match for "${trigger.query}"` : "No teammates connected yet"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Autocomplete Popover for # Lists — appears immediately on typing # */}
      {trigger?.type === "list" && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-full max-w-sm rounded-2xl border border-border/80 bg-white p-1.5 katalist-elevation-popover animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-1">
            <Hash className="h-3 w-3 text-primary" />
            Add to List
            {trigger.query && (
              <span className="ml-auto normal-case font-normal text-muted-foreground/70">
                "{trigger.query}"
              </span>
            )}
          </div>
          <div className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredLists.length > 0 ? (
              filteredLists.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectList(item);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[12.5px] transition-colors cursor-pointer",
                    idx === activeIndex
                      ? "bg-primary/10 font-semibold text-primary"
                      : "hover:bg-muted/50 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <List className="h-3.5 w-3.5" />
                    </div>
                    <span className="block min-w-0 truncate font-medium text-[12.5px]">{item.name}</span>
                  </div>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-3 text-[12px] text-muted-foreground text-center">
                {trigger.query ? `No list matching "${trigger.query}"` : "No lists yet"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Autocomplete Popover for / Buckets — appears immediately on typing / */}
      {trigger?.type === "bucket" && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-full max-w-sm rounded-2xl border border-border/80 bg-white p-1.5 katalist-elevation-popover animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-1">
            <Layers className="h-3 w-3 text-primary" />
            Add to Bucket
            {trigger.query && (
              <span className="ml-auto normal-case font-normal text-muted-foreground/70">
                "{trigger.query}"
              </span>
            )}
          </div>
          <div className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredBuckets.length > 0 ? (
              filteredBuckets.map((bucket, idx) => (
                <button
                  key={bucket.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectBucket(bucket);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[12.5px] transition-colors cursor-pointer",
                    idx === activeIndex
                      ? "bg-primary/10 font-semibold text-primary"
                      : "hover:bg-muted/50 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Layers className="h-3.5 w-3.5" />
                    </div>
                    <span className="block min-w-0 truncate font-medium text-[12.5px]">{bucket.name}</span>
                  </div>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-3 text-[12px] text-muted-foreground text-center">
                {trigger.query ? `No bucket matching "${trigger.query}"` : "No buckets yet"}
              </p>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,*/*"
      />

      {/* Pending attached files chips */}
      {attachedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-bottom-1">
          {attachedFiles.map((file) => (
            <div
              key={file.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-800"
            >
              {file.type === "image" && file.url ? (
                <img src={file.url} alt={file.name} className="h-4 w-4 rounded object-cover" />
              ) : (
                <span
                  className={cn(
                    "flex h-[18px] px-1 items-center justify-center rounded text-[12px] font-bold uppercase",
                    file.type === "pdf"
                      ? "bg-red-50 text-red-600 border border-red-200"
                      : file.type === "excel"
                        ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                        : file.type === "docx"
                          ? "bg-blue-50 text-blue-600 border border-blue-200"
                          : file.type === "video"
                            ? "bg-purple-50 text-purple-600 border border-purple-200"
                            : "bg-slate-100 text-slate-600 border border-slate-200",
                  )}
                >
                  {file.type}
                </span>
              )}
              <span className="max-w-[140px] truncate">{file.name}</span>
              {file.sizeLabel && (
                <span className="text-[12px] text-muted-foreground font-normal">({file.sizeLabel})</span>
              )}
              <button
                type="button"
                onClick={() => removeAttachedFile(file.id)}
                className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* T09/E05: files still being validated/processed -- an indeterminate
          spinner, not a fabricated percentage, since processFileForUpload
          has no real byte-level progress to report. */}
      {processingFiles > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5" role="status" aria-live="polite">
          {Array.from({ length: processingFiles }).map((_, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-slate-500"
            >
              <RotateCw className="h-3 w-3 animate-spin" />
              <span>Checking file…</span>
            </div>
          ))}
        </div>
      )}

      {/* T09/E05: a file that failed validation/processing is no longer
          silently dropped -- it keeps its own chip with a truthful "failed"
          state plus Retry (re-runs processFileForUpload on the SAME File
          under the SAME stable operation id) and Remove. Every other
          already-succeeded file in attachedFiles above is untouched. */}
      {failedAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {failedAttachments.map((f) => (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[12px] font-medium text-red-700"
              title={f.error}
            >
              <span className="max-w-[140px] truncate">{f.name}</span>
              <span className="text-[12px] font-normal text-red-500">Failed</span>
              <button
                type="button"
                onClick={() => void retryFailedAttachment(f.id)}
                className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded text-red-500 hover:text-red-700 hover:bg-red-100 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Retry ${f.name}`}
                title="Retry"
              >
                <RotateCw className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => removeFailedAttachment(f.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-red-500 hover:text-red-700 hover:bg-red-100 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={cn(
          "magic-box-root flex items-center gap-2.5 transition-opacity duration-200",
          desktop
            ? "h-[46px] rounded-[16px] px-3 font-composer"
            : "h-12 rounded-xl border border-border bg-card px-1.5",
          tossed && "opacity-60",
        )}
        data-state={motionState}
        data-accent={motionAccent ?? undefined}
        data-visible={documentVisible}
        data-handoff={submitHandoff}
        onMouseEnter={() => setMotionHovered(true)}
        onMouseLeave={() => setMotionHovered(false)}
        onFocusCapture={() => setMotionFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMotionFocused(false);
        }}
      >
        <MagicBoxGlow />
        <Sparkles className="magic-box-sparkle relative z-[1] h-4 w-4 shrink-0 text-primary" />

        {/* ── Highlight mirror + input overlay ─────────────────────────────
            The mirror div renders @person #list /bucket tokens as colored bold
            spans. The real <input> sits on top with color:transparent so only
            the blinking caret is visible. Font metrics must match exactly. */}
        <div className="relative z-[1] min-w-0 flex-1 h-full">
          {/* Mirror — purely visual, no interaction */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-[13.5px] leading-none"
            style={{ paddingTop: 0, paddingBottom: 0 }}
          >
            {value === "" ? null : (
              <>
                {(() => {
                  // Tokenise: split on @word, #word, /word keeping delimiters
                  const parts = value.split(/([@#/][^\s@#/]+)/g);
                  return parts.map((part, i) => {
                    if (/^@[^\s@#/]+/.test(part)) {
                      return (
                        <span key={i} className="font-bold text-primary">
                          {part}
                        </span>
                      );
                    }
                    if (/^#[^\s@#/]+/.test(part)) {
                      return (
                        <span key={i} className="font-bold text-blue-600">
                          {part}
                        </span>
                      );
                    }
                    if (/^\/[^\s@#/]+/.test(part)) {
                      return (
                        <span key={i} className="font-bold text-emerald-600">
                          {part}
                        </span>
                      );
                    }
                    if (!highlightedPhrases.length) return <span key={i} className="text-foreground">{part}</span>;
                    const escaped = highlightedPhrases.map(({ phrase }) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
                    const segments = part.split(new RegExp(`(${escaped.join("|")})`, "gi"));
                    return segments.map((segment, j) => {
                      const kind = highlightedPhrases.find(({ phrase }) => phrase.toLowerCase() === segment.toLowerCase())?.kind;
                      return <span key={`${i}-${j}`} className={kind === "due" ? "font-semibold text-blue-600" : kind === "pace" ? "font-semibold text-primary" : "text-foreground"}>{segment}</span>;
                    });
                  });
                })()}
              </>
            )}
          </div>

          {/* Real input — transparent text, caret only */}
          <input
            ref={inputRef}
            value={value}
            onPaste={handlePaste}
            onBeforeInput={(e) => {
              if (!suppressPasteTextRef.current) return;
              e.preventDefault();
              suppressPasteTextRef.current = false;
            }}
            onChange={(e) => {
              const next = e.target.value;
              if (!value && next) flashMotion("first-character", 280);
              setValue(next);
              const nextParsed = parseToss(next, people);
              if (nextParsed.pacePhrase !== parsed.pacePhrase) setPaceOverride(null);
              if (nextParsed.duePhrase !== parsed.duePhrase) setDueOverride(undefined);
              // A fresh edit means the user is composing something new, not
              // retrying the last partial failure -- the next submit should
              // parse `next` normally again, not silently narrow to
              // whichever assignees failed last time.
              setRetryAssigneeIds(null);
              const cursor = e.target.selectionStart ?? next.length;
              checkMentionTrigger(next, cursor);
            }}
            onKeyUp={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                const cursor = e.currentTarget.selectionStart ?? value.length;
                checkMentionTrigger(value, cursor);
              }
            }}

          onKeyDown={(e) => {
            if (trigger?.type === "person" && filteredPeople.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % filteredPeople.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + filteredPeople.length) % filteredPeople.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const selected = filteredPeople[activeIndex] ?? filteredPeople[0];
                if (selected) selectPerson(selected);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTrigger(null);
                return;
              }
            }

            if (trigger?.type === "list" && filteredLists.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % filteredLists.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + filteredLists.length) % filteredLists.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const selected = filteredLists[activeIndex] ?? filteredLists[0];
                if (selected) selectList(selected);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTrigger(null);
                return;
              }
            }

            if (trigger?.type === "bucket" && filteredBuckets.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % filteredBuckets.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + filteredBuckets.length) % filteredBuckets.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const selected = filteredBuckets[activeIndex] ?? filteredBuckets[0];
                if (selected) selectBucket(selected);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTrigger(null);
                return;
              }
            }

            if (e.key === "Enter" && canToss) {
              e.preventDefault();
              startToss();
              return;
            }

            // T09/E05: with no autocomplete popover open (those already
            // handle their own Escape above and return early), Escape
            // returns focus away from the composer -- it does NOT clear
            // `value`/`attachedFiles`, so the draft survives exactly like
            // dismissing any other unsaved composer.
            if (e.key === "Escape" && !trigger) {
              e.currentTarget.blur();
            }
          }}
          placeholder={listName ? `Toss into ${listName}…` : "Toss a thought..."}
          className="absolute inset-0 w-full h-full bg-transparent text-[13.5px] outline-none placeholder:text-[#7e7a94]"
          style={{ color: "transparent", caretColor: "var(--foreground)" }}
          aria-label="Magic Box"
        />
        </div>
        {desktop ? (
          <div className="relative z-[1] flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                inputRef.current?.focus();
                inputRef.current?.select();
              }}
              title={isMac ? "Press ⌘K to activate" : "Press Ctrl+K to activate"}
              aria-label={isMac ? "Focus Magic Box (⌘K)" : "Focus Magic Box (Ctrl+K)"}
              className="hidden sm:inline-flex min-h-8 items-center rounded border border-slate-200 bg-slate-50 px-2 text-[12px] font-medium text-slate-500 cursor-pointer select-none hover:bg-slate-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <kbd className="font-medium">{isMac ? "⌘ K" : "Ctrl K"}</kbd>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="magic-box-attachment inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 outline-none hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Attach file"
              title="Attach files (photos, videos, doc, excel, etc.)"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  setValue("");
                  setPaceOverride(null);
                  setDueOverride(undefined);
                  setTrigger(null);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 outline-none hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                aria-label="Clear Magic Box"
                title="Clear input"
              >
                <KatalistIcon name="clear-input" className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canToss}
              onClick={startToss}
              className="magic-box-toss inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-[#975ee2] px-4 text-[12px] font-medium text-white outline-none hover:brightness-95 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label="Toss Thing"
              title="Toss Thing"
            >
              <KatalistIcon name="send-toss" className="h-3.5 w-3.5" />
              Toss
            </button>
          </div>
        ) : (
          <div className="relative z-[1] flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              aria-label="Attach file"
              title="Attach files (photos, videos, doc, excel, etc.)"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!canToss}
              onClick={startToss}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground outline-none transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Toss Thing"
              title="Toss Thing"
            >
              Toss
            </button>
          </div>
        )}
      </div>

      {value.trim() ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 font-semibold text-primary hover:bg-primary/10" aria-label={`Pace ${effectivePace}. Change pace`}>
                {effectivePace.toUpperCase()}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="start" side="top">
              {(["now", "next", "later"] as Importance[]).map((pace) => (
                <button key={pace} type="button" onClick={() => setPaceOverride(pace)} className="block w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-primary/10" aria-pressed={effectivePace === pace}>
                  {pace.toUpperCase()}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100" aria-label={effectiveDueAt ? `Due ${format(new Date(effectiveDueAt), "MMM d, h:mm a")}. Change date` : "Add due date"}>
                <CalendarDays className="h-3 w-3" />
                {effectiveDueAt ? `Due ${format(new Date(effectiveDueAt), "MMM d, h:mm a")}` : "Add date"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2 p-3" align="start" side="top">
              <label className="block text-xs font-semibold text-foreground" htmlFor="magic-box-due">Due date and time</label>
              <input
                id="magic-box-due"
                type="datetime-local"
                value={format(effectiveDueAt ? new Date(effectiveDueAt) : new Date(Date.now() + 86400000), "yyyy-MM-dd'T'HH:mm")}
                onChange={(event) => {
                  const date = new Date(event.target.value);
                  if (!Number.isNaN(date.getTime())) setDueOverride(date.toISOString());
                }}
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs text-foreground"
              />
              {!effectiveDueAt ? <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(22, 0, 0, 0);
                setDueOverride(tomorrow.toISOString());
              }}>Use tomorrow, 10 PM</button> : null}
              {effectiveDueAt ? <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setDueOverride(null)}>Remove date</button> : null}
            </PopoverContent>
          </Popover>
          {dueIsPast ? <span role="alert" className="text-amber-700">This time has passed. Change the date before Toss.</span> : null}
        </div>
      ) : null}

      {/* Natural language AI person suggestion prompt — blocks toss until confirmed or dismissed */}
      {parsed.suggestedPerson &&
        !parsed.assigneeId &&
        parsed.suggestedPerson.person.id !== dismissedSuggestionId && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] text-primary animate-in fade-in slide-in-from-bottom-1">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate text-muted-foreground">
                Did you mean{" "}
                <strong className="font-semibold text-foreground">
                  {parsed.suggestedPerson.person.name}
                </strong>
                ?
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setDismissedSuggestionId(parsed.suggestedPerson!.person.id)}
                className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-all cursor-pointer"
              >
                No, skip
              </button>
              <button
                type="button"
                onClick={() => {
                  acceptSuggestedPerson(
                    parsed.suggestedPerson!.person,
                    parsed.suggestedPerson!.matchedWord,
                  );
                  setDismissedSuggestionId(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-primary/90 transition-all cursor-pointer"
              >
                <Sparkles className="h-3 w-3" />
                Yes, assign to {parsed.suggestedPerson.person.name.split(" ")[0]}
              </button>
            </div>
          </div>
        )}

      {parsed.chips.some((chip) => chip.kind === "suggestion" || chip.kind === "unresolved") && value.trim() ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parsed.chips.filter((chip) => chip.kind === "suggestion" || chip.kind === "unresolved").map((c) => {
            const isSuggestion = c.kind === "suggestion";
            return (
              <button
                key={c.kind + c.value}
                type="button"
                disabled={!isSuggestion}
                onClick={() => {
                  if (isSuggestion && parsed.suggestedPerson) {
                    acceptSuggestedPerson(
                      parsed.suggestedPerson.person,
                      parsed.suggestedPerson.matchedWord,
                    );
                  }
                }}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[12px] font-medium transition-all text-left",
                  desktop && "inline-flex items-center gap-1 bg-white",
                  isSuggestion &&
                    "border-primary/40 bg-primary/5 text-primary hover:bg-primary hover:text-white cursor-pointer",
                  c.kind === "unresolved"
                    ? desktop
                      ? "border-status-waiting/50 text-status-waiting"
                      : "border-status-waiting/40 bg-status-waiting-bg text-status-waiting"
                    : !isSuggestion &&
                      (desktop
                        ? "border-border text-foreground"
                        : "border-border bg-card text-foreground"),
                )}
              >
                {desktop ? (
                  <KatalistIcon
                    name={
                      (
                        {
                          assignee: "at-person",
                          due: "date-detection",
                          importance: "urgent",
                          list: "list",
                          bucket: "hash-bucket",
                          suggestion: "katalist-spark",
                          unresolved: "urgent",
                        } satisfies Record<typeof c.kind, KatalistIconName>
                      )[c.kind]
                    }
                    className="h-3 w-3"
                  />
                ) : null}
                {c.kind === "unresolved"
                  ? c.label
                  : c.kind === "suggestion"
                    ? `${c.label} ↵`
                    : `${c.kind === "assignee" ? "@" : ""}${c.label}`}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
