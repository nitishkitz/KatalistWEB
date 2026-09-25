import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, FileText, Folder, Hash, Layers, List, Paperclip, RotateCw, Sparkles, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { useAppContext } from "@/features/context/use-app-context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rpcAddToBucket, rpcCreateThing } from "@/features/things/rpc";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { useLists } from "@/features/lists/use-lists";
import { useBuckets } from "@/features/buckets/use-buckets";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { isPreviewMode } from "@/lib/session-mode";
import { parseToss, tossBlockedByPerson } from "./parse-toss";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
import type { ThingFile, Person } from "@/domain/thing";
import { processFileForUpload, formatFileSize } from "@/lib/file-utils";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import { getDraft, setDraft, clearDraft } from "@/features/drafts/session-drafts";

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

  const [value, setValue] = useState(() => getDraft<string>(qc, "magic-box", draftEntityId)?.value ?? "");
  const [tossed, setTossed] = useState(false);
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
  const people = useMemo(() => {
    if (!extraPeople?.length) return assignablePeople;
    const byKey = new Map<string, Person>();
    for (const p of [...extraPeople, ...assignablePeople]) {
      const key = (p.id || p.name).toLowerCase();
      if (!byKey.has(key)) byKey.set(key, p);
    }
    return [...byKey.values()];
  }, [assignablePeople, extraPeople]);
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
    const draft = getDraft<string>(qc, "magic-box", draftEntityId);
    setValue(draft?.value ?? "");
    setAttachedFiles((draft?.attachments as ThingFile[] | undefined) ?? []);
    // Failed/in-flight uploads are transient per-composer-instance state,
    // not part of the persisted draft -- a validation failure against one
    // destination has no meaning once switched to a different one.
    setFailedAttachments([]);
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

  const processOneFile = async (opId: string, file: File) => {
    setProcessingFiles((n) => n + 1);
    try {
      const processed = await processFileForUpload(file);
      setAttachedFiles((prev) => [...prev, processed]);
      applyFirstAsTitleIfEmpty(processed);
    } catch (err) {
      console.error("Failed to process file:", err);
      const message = err instanceof Error ? err.message : `Could not attach ${file.name}`;
      setFailedAttachments((prev) => [
        ...prev,
        { id: opId, file, name: file.name, sizeLabel: formatFileSize(file.size), error: message },
      ]);
    } finally {
      setProcessingFiles((n) => Math.max(0, n - 1));
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // Each file gets its own stable operation id and its own
    // validating->ready|failed transition, entirely independent of the
    // others -- one slow/failing file never blocks or drops another that
    // already succeeded.
    const picked = Array.from(files).map((file) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
    }));
    if (fileInputRef.current) fileInputRef.current.value = "";
    await Promise.all(picked.map(({ id, file }) => processOneFile(id, file)));
  };

  const removeAttachedFile = (fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const removeFailedAttachment = (opId: string) => {
    setFailedAttachments((prev) => prev.filter((f) => f.id !== opId));
  };

  const retryFailedAttachment = async (opId: string) => {
    const entry = failedAttachments.find((f) => f.id === opId);
    if (!entry) return;
    setFailedAttachments((prev) => prev.filter((f) => f.id !== opId));
    // Same stable id on retry -- this is the same logical operation
    // continuing, not a new one.
    await processOneFile(opId, entry.file);
  };

  const isMac = typeof navigator !== "undefined" && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const parsed = useMemo(() => parseToss(value, people), [value, people]);
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
        parsed.title.trim() ||
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
                ownerImportance: parsed.importance,
                listId: effectiveListId,
                assigneeActorId,
                dueAt: parsed.dueAt,
                dueHasTime: parsed.dueHasTime,
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
        ownerImportance: parsed.importance,
        listId: effectiveListId,
        assigneeActorId: assignee,
        dueAt: parsed.dueAt,
        dueHasTime: parsed.dueHasTime,
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
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: async (result, _vars, mutationContext) => {
      const failedAssigneeIds = result?.failedAssigneeIds ?? [];
      const hasPartialFailure = failedAssigneeIds.length > 0;

      setTossed(true);
      // A partial multi-toss failure keeps the input (title/files) so the
      // retry attempt below reuses the same content -- only a full
      // success or a fresh edit (see the input's onChange) clears it.
      if (!hasPartialFailure) {
        setValue("");
        setAttachedFiles([]);
        setFailedAttachments([]);
      }
      setRetryAssigneeIds(hasPartialFailure ? failedAssigneeIds : null);
      setTrigger(null);
      setDismissedSuggestionId(null);
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
      window.setTimeout(() => setTossed(false), 240);
    },
    onError: (err, _vars, mutationContext) => {
      if (mutationContext && !isEpochCurrent(qc, mutationContext.epoch)) return;
      toast.error(err instanceof Error ? err.message : "Couldn’t toss that.");
    },
  });
  const canToss = (Boolean(value.trim()) || attachedFiles.length > 0) && !blocked && !mutation.isPending;

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

      {/* T09/E05: destination List and Work/Home context, shown before
          submit -- previously only surfaced as a placeholder string that
          vanished the moment the user started typing, so there was no
          persistent pre-submit confirmation of where a Thing would land. */}
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Folder className="h-3 w-3 shrink-0" />
        <span>{listName ?? "Court"}</span>
        <span aria-hidden="true">·</span>
        <span className="capitalize">{context}</span>
      </div>

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
          "flex items-center gap-2.5 transition-opacity duration-200",
          desktop
            ? "h-[50px] rounded-[10px] border border-[#975ee2]/25 bg-white px-3 font-composer hover:border-[#975ee2]/40 transition-all"
            : "rounded-xl border border-border bg-card px-1.5",
          tossed && "opacity-60",
        )}
        style={desktop ? { boxShadow: "0 10px 30px -14px rgba(151,94,226,0.35)" } : undefined}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />

        {/* ── Highlight mirror + input overlay ─────────────────────────────
            The mirror div renders @person #list /bucket tokens as colored bold
            spans. The real <input> sits on top with color:transparent so only
            the blinking caret is visible. Font metrics must match exactly. */}
        <div className="relative flex-1 h-full">
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
                    return <span key={i} className="text-foreground">{part}</span>;
                  });
                })()}
              </>
            )}
          </div>

          {/* Real input — transparent text, caret only */}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
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

            if (e.key === "Enter" && (value.trim() || attachedFiles.length > 0) && !blocked && !mutation.isPending) {
              e.preventDefault();
              void mutation.mutate();
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
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                inputRef.current?.focus();
                inputRef.current?.select();
              }}
              title={isMac ? "Press ⌘K to activate" : "Press Ctrl+K to activate"}
              aria-label={isMac ? "Focus Magic Box (⌘K)" : "Focus Magic Box (Ctrl+K)"}
              className="hidden sm:inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[12px] font-medium text-slate-500 cursor-pointer select-none hover:bg-slate-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <kbd className="font-medium">{isMac ? "⌘ K" : "Ctrl K"}</kbd>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 outline-none hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Attach file"
              title="Attach files (photos, videos, doc, excel, etc.)"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 outline-none hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Voice input"
              title="Voice input"
            >
              <KatalistIcon name="mic" className="h-4 w-4" />
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  setValue("");
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
              onClick={() => void mutation.mutate()}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-[#975ee2] px-4 text-[12px] font-medium text-white outline-none hover:brightness-95 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label="Toss Thing"
              title="Toss Thing"
            >
              <KatalistIcon name="send-toss" className="h-3.5 w-3.5" />
              Toss
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              aria-label="Attach file"
              title="Attach files (photos, videos, doc, excel, etc.)"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              aria-label="Voice input"
            >
              <KatalistIcon name="mic" className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

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

      {parsed.chips.length > 0 && value.trim() ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parsed.chips.map((c) => {
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
