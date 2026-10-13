import { Suspense, lazy, useId, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AtSign, Hash, Layers, List, Paperclip, RotateCw, Sparkles, X } from "lucide-react";
import { format } from "date-fns";
import { gsap } from "gsap";
import { useMotionPreference } from "@/hooks/use-motion-preference";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { useAppContext } from "@/features/context/use-app-context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rpcAddToBucket, rpcCreateThing } from "@/features/things/rpc";
import { useLists } from "@/features/lists/use-lists";
import { useBuckets } from "@/features/buckets/use-buckets";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { isPreviewMode } from "@/lib/session-mode";
import { KatalistIcon } from "./KatalistIcon";
import type { ThingFile, Person } from "@/domain/thing";
import { processFileForUpload, formatFileSize, getClipboardFiles } from "@/lib/file-utils";
import { acquireBlobUrl, releaseBlobUrl, releaseAllBlobUrlsForOwner } from "@/lib/owned-file-resources";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import { getDraft, setDraft, clearDraft } from "@/features/drafts/session-drafts";
import { MAGIC_BOX_FOCUS_EVENT, MAGIC_BOX_REFERENCES_EVENT, takePendingMagicBoxReferences } from "./magic-box-entry";
import { useThingNavigation } from "@/features/thing-references/use-open-thing";
import {
  mergeThingReferences,
  recoverLegacyThingDraft,
  parseClipboardThingReferences,
  sanitizeThingReferences,
  supportedThingOrigins,
  type ThingReference,
} from "@/features/thing-references/thing-reference";
import { MagicBoxClarification } from "./MagicBoxClarification";
import { MagicBoxAssistant } from "./MagicBoxAssistant";
import { useCoeyComposer } from "./coey/use-coey-composer";
import { CoeyChips } from "./coey/CoeyChips";
import { CoeyCommitError, commitCoeyItems, itemsForPlan, privateCaptureItem } from "./coey/commit";
import type { ComposerSelections } from "@/domain/coey/contract";
import { localParts, zonedInstant } from "@/domain/coey/calendar";

/** Explicit #List and /Bucket syntax the user typed or picked. Links are ignored. */
function explicitTag(text: string, sigil: "#" | "/"): string | null {
  const withoutUrls = text.replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, " ");
  const match = withoutUrls.match(sigil === "#" ? /(?:^|\s)#([A-Za-z0-9_ -]+?)(?=\s[@#/]|$|\s{2})/ : /(?:^|\s)\/([A-Za-z0-9_ -]+?)(?=\s[@#/]|$|\s{2})/);
  return match?.[1]?.trim() || null;
}

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
/** Draft metadata is untrusted shape: only well-formed, supported references are restored. */
function readDraftReferences(metadata: unknown): ThingReference[] {
  if (!metadata || typeof metadata !== "object") return [];
  return sanitizeThingReferences((metadata as { thingReferences?: unknown }).thingReferences);
}

// Loaded on first use: it pulls in the Thing read path, which the composer does not otherwise need.
const CompactThingReferenceCard = lazy(() =>
  import("@/features/thing-references/CompactThingReferenceCard").then((m) => ({ default: m.CompactThingReferenceCard })),
);


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

  const { openThing } = useThingNavigation();
  const [value, setValue] = useState(() => {
    const draft = getDraft<string>(qc, "magic-box", draftEntityId);
    return recoverLegacyThingDraft(draft?.value ?? "", readDraftReferences(draft?.metadata)).value;
  });
  const [references, setReferences] = useState<ThingReference[]>(() => {
    const draft = getDraft<string>(qc, "magic-box", draftEntityId);
    return recoverLegacyThingDraft(draft?.value ?? "", readDraftReferences(draft?.metadata)).references;
  });
  const suppressPasteTextRef = useRef(false);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [tossed, setTossed] = useState(false);
  const [motionHovered, setMotionHovered] = useState(false);
  const [motionFocused, setMotionFocused] = useState(false);
  const [motionAccent, setMotionAccent] = useState<"submitting" | "success" | "error" | "attachment" | "first-character" | null>(null);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const motionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionPhaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitHandoff, setSubmitHandoff] = useState(false);
  const [composerMode, setComposerMode] = useState<"toss" | "ask">("toss");
  const effectiveComposerMode = composerMode;
  // One semantic path (D12): Sarvam reads the draft; code places and validates it.
  const composer = useCoeyComposer({ text: value, mode: context, enabled: composerMode === "toss" && !isPreviewMode() });
  const plan = composer.plan;
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantQuery, setAssistantQuery] = useState<import("@/domain/coey/draft").DraftPlan["question"]>(null);
  const [assistantRequestKey, setAssistantRequestKey] = useState(0);

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
    replaceLength?: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestionId = useId();
  const [attachedFiles, setAttachedFiles] = useState<ThingFile[]>(
    () => (getDraft<string>(qc, "magic-box", draftEntityId)?.attachments as ThingFile[] | undefined) ?? [],
  );
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
  // Completion may arrive after the user starts their next capture in this
  // same destination. A successful old request must never erase newer edits.
  const draftFingerprint = JSON.stringify([value, attachedFiles, references, composer.selections]);
  const currentDraftFingerprint = useRef(draftFingerprint);
  currentDraftFingerprint.current = draftFingerprint;

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const textMirrorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // @-picker: accepted connections only; anyone else can be mentioned as text but never receives a Thing.
  const people = useMemo<Person[]>(
    () => composer.ctx.candidates.filter((c) => c.connected).map((c) => ({
      id: c.profileId, profileId: c.profileId, actorId: c.actorId, name: c.name,
      initials: c.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(), avatarUrl: c.avatarUrl,
    })),
    [composer.ctx.candidates],
  );
  void extraPeople;
  const { lists } = useLists();
  const { buckets } = useBuckets();

  // T03: register a blocker while there's unsent Magic Box text/files (or
  // a file still processing) so nothing (Morning Brief's auto-open, etc.)
  // can silently interrupt a mid-capture the way ThingDetailContent's own
  // comment composer already guards against.
  useBlockWhile(
    Boolean(value.trim()) || attachedFiles.length > 0 || references.length > 0 || processingFiles > 0 || failedAttachments.length > 0,
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
    const recovered = recoverLegacyThingDraft(draft?.value ?? "", readDraftReferences(draft?.metadata));
    setValue(recovered.value);
    composer.reset();
    setAttachedFiles((draft?.attachments as ThingFile[] | undefined) ?? []);
    setReferences(recovered.references);
    // Failed/in-flight uploads are transient per-composer-instance state,
    // not part of the persisted draft -- a validation failure against one
    // destination has no meaning once switched to a different one.
    setFailedAttachments([]);
    setProcessingFiles(0);
    setTrigger(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on destination change only
  }, [draftEntityId, qc]);

  // T09/E05: write-through -- every edit persists immediately, so typed
  // text, chosen assignees (embedded in the text itself), and already-
  // processed attachment upload handles all survive unmount/remount (e.g.
  // navigating away from a List and back) the same way ThingDetailContent's
  // comment composer already does for its own draft.
  useEffect(() => {
    if (!value && attachedFiles.length === 0 && references.length === 0) {
      clearDraft(qc, "magic-box", draftEntityId);
      return;
    }
    setDraft(qc, "magic-box", draftEntityId, {
      value,
      attachments: attachedFiles,
      metadata: references.length ? { thingReferences: references } : undefined,
    });
  }, [qc, draftEntityId, value, attachedFiles, references]);

  // One validation/dedupe path for paste and direct insertion. The destination (epochRef) is captured by the caller
  // before anything asynchronous, so a late insertion cannot land in a different draft.
  const addReferences = (incoming: ThingReference[], opEpoch: number = epochRef.current) => {
    if (epochRef.current !== opEpoch || incoming.length === 0) return;
    const merged = mergeThingReferences(references, incoming);
    if (merged.added > 0) setReferences(merged.references);
    if (merged.added > 0) flashMotion("attachment", 630);
    if (merged.duplicates > 0) {
      toast.info(merged.added > 0 ? "Some Things were already added." : "That Thing is already added.");
    }
    if (merged.overflow > 0) toast.error("A draft can hold up to 10 Things.");
  };
  const addReferencesRef = useRef(addReferences);
  addReferencesRef.current = addReferences;

  useEffect(() => {
    const consume = () => {
      const input = inputRef.current;
      // Only a visible Magic Box takes the request; a hidden one (the other breakpoint's tree) leaves it queued.
      if (!input || input.getClientRects().length === 0) return;
      const taken = takePendingMagicBoxReferences();
      if (taken.length) {
        addReferencesRef.current(taken);
        // Never pull focus out from behind an open dialog: the reference is staged, the dialog and its draft stay intact.
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) {
          toast.success("Added to Magic Box. Close this dialog to continue.");
        } else {
          input.focus();
        }
      }
    };
    window.addEventListener(MAGIC_BOX_REFERENCES_EVENT, consume);
    consume();
    return () => window.removeEventListener(MAGIC_BOX_REFERENCES_EVENT, consume);
  }, []);

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

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getClipboardFiles(e.clipboardData);
    if (!files.length) {
      // Copied Things arrive as canonical permalinks. Anything else stays an ordinary text paste.
      const pastedReferences = parseClipboardThingReferences(e.clipboardData.getData("text/plain"), supportedThingOrigins());
      if (pastedReferences) {
        e.preventDefault();
        addReferences(pastedReferences);
      }
      return;
    }
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

  // The composer measures only its own attachment layout; focus never repositions Coey.
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "0px";
      const height = Math.max(22, Math.min(132, input.scrollHeight));
      input.style.height = `${height}px`;
      boxRef.current?.parentElement?.style.setProperty("--magic-text-height", `${height}px`);
      input.style.overflowY = input.scrollHeight > height ? "auto" : "hidden";
      if (textMirrorRef.current) textMirrorRef.current.scrollTop = input.scrollTop;
    };
    resize();
    let width = input.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const nextWidth = input.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; resize(); }
    });
    observer?.observe(input);
    return () => observer?.disconnect();
  }, [value, desktop, references.length]);
  const animatedHeight = useRef<number | null>(null);
  const { reduceMotion } = useMotionPreference();
  useLayoutEffect(() => {
    const host = boxRef.current;
    return () => {
      host?.querySelectorAll<HTMLElement>("[data-reference-exit]").forEach((ghost) => {
        gsap.killTweensOf(ghost);
        ghost.remove();
      });
    };
  }, [draftEntityId]);
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    // One natural-size read per state change; the tween never measures layout per frame.
    element.style.height = "";
    const nextHeight = element.getBoundingClientRect().height;
    const previousHeight = animatedHeight.current;
    if (reduceMotion || previousHeight === null || Math.abs(previousHeight - nextHeight) < .5) {
      animatedHeight.current = nextHeight;
      return;
    }
    const tween = gsap.fromTo(element, { height: previousHeight }, {
      height: nextHeight, duration: .42, ease: "power3.out", overwrite: "auto",
      onUpdate: () => { animatedHeight.current = parseFloat(element.style.height); },
      onComplete: () => { animatedHeight.current = nextHeight; element.style.height = ""; },
    });
    return () => { tween.kill(); };
  }, [references.length, draftEntityId, desktop, reduceMotion]);
  const firstDraft = plan?.things[0]?.draft;
  const highlightedPhrases = [
    firstDraft?.pacePhrase ? { phrase: firstDraft.pacePhrase, kind: "pace" } : null,
    firstDraft?.actionTime?.source === "typed" && firstDraft.actionTime.phrase ? { phrase: firstDraft.actionTime.phrase, kind: "due" } : null,
    firstDraft?.eventTime?.phrase ? { phrase: firstDraft.eventTime.phrase, kind: "due" } : null,
  ].filter((item): item is { phrase: string; kind: string } => Boolean(item) && value.toLowerCase().includes(item!.phrase.toLowerCase()));

  const listTag = useMemo(() => explicitTag(value, "#"), [value]);
  const bucketTag = useMemo(() => explicitTag(value, "/"), [value]);
  const effectiveListId = useMemo(() => {
    if (listId) return listId;
    if (!listTag) return undefined;
    const tag = listTag.toLowerCase();
    return (lists.find((l) => l.name.toLowerCase() === tag) ?? lists.find((l) => l.name.toLowerCase().includes(tag)))?.id;
  }, [listId, listTag, lists]);

  const effectiveBucketId = useMemo(() => {
    if (!bucketTag) return undefined;
    const tag = bucketTag.toLowerCase();
    return (buckets.find((b) => b.name.toLowerCase() === tag) ?? buckets.find((b) => b.name.toLowerCase().includes(tag)))?.id;
  }, [bucketTag, buckets]);

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
    const suffix = value.slice(trigger.startIndex + 1 + (trigger.replaceLength ?? trigger.query.length));
    const firstName = person.name.split(" ")[0] || person.name;
    const namePart = people.filter((p) => p.name.split(" ")[0].toLowerCase() === firstName.toLowerCase()).length > 1
      ? person.name.replace(/\s+/g, ".") : firstName;
    const nextVal = `${prefix}@${namePart} ${suffix}`;
    setValue(nextVal);
    // An explicit pick is a constraint for every later reading of this draft.
    const mentionKey = namePart.toLowerCase().replace(/[._]+/g, " ").trim();
    composer.setSelections((sel) => ({ ...sel, people: { ...sel.people, [mentionKey]: person.profileId ?? person.id } }));
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

  type SendResult =
    | { kind: "created"; createdIds: string[]; title: string; bucketFailedIds: string[] }
    | { kind: "ask"; question: string; query: import("@/domain/coey/draft").DraftPlan["question"] }
    | { kind: "paused" }
    | { kind: "unavailable"; reason: string };

  const mutation = useMutation({
    mutationFn: async (input: { privateCapture?: boolean; selections?: ComposerSelections } = {}): Promise<SendResult> => {
      const files = attachedFiles.length > 0 ? attachedFiles : undefined;
      const common = { mode: context, listId: effectiveListId, files, checkIds: [] as string[] };
      const typed = value.trim();
      let items: Array<Record<string, unknown>>;
      let key: string;

      if (isPreviewMode()) {
        // Preview sessions are local-only demos: no interpretation service, no recipients.
        const title = typed || (attachedFiles[0]?.name ? `Attachment: ${attachedFiles[0].name}` : "");
        if (!title) return { kind: "paused" };
        const created = await rpcCreateThing({ title, context, listId: effectiveListId, files, references: references.length ? references : undefined });
        return { kind: "created", createdIds: created?.id ? [created.id] : [], title, bucketFailedIds: [] };
      }
      if (!typed) {
        if (!attachedFiles.length && !references.length) return { kind: "paused" };
        const title = attachedFiles[0]?.name ? `Attachment: ${attachedFiles[0].name}` : "Shared Things";
        items = [{ title, text_raw: title, kind: "task", mode: context, list_id: effectiveListId ?? null, lane: "next", rule_id: "C1+L8",
          notes: files ? JSON.stringify({ files }) : null }];
        key = composer.idempotencyKey({ dismissed: ["attachment-only"] });
      } else if (input.privateCapture) {
        items = [privateCaptureItem(value, common)];
        key = composer.idempotencyKey({ ...(input.selections ?? composer.selections), dismissed: ["private-capture"] });
      } else {
        const selections = input.selections ?? composer.selections;
        const decision = await composer.decideSend(selections);
        if (decision.kind === "ask") return { kind: "ask", question: decision.question, query: decision.query };
        if (decision.kind === "question" || decision.kind === "empty") return { kind: "paused" };
        if (decision.kind === "unavailable") return { kind: "unavailable", reason: decision.reason };
        const checkIds = [decision.plan.response.interrupt, ...decision.plan.response.chips, ...decision.plan.response.hints]
          .filter(Boolean).map((c) => c!.id);
        items = itemsForPlan(decision.plan, { ...common, checkIds, paceResolution: composer.paceResolution });
        if (!items.length) return { kind: "paused" };
        key = composer.idempotencyKey(selections);
      }

      const result = await commitCoeyItems(key, items, references.length ? references : undefined);
      const createdIds = result.things.map((t) => t.thing_id);
      const bucketFailedIds: string[] = [];
      if (effectiveBucketId && !result.replayed && !input.privateCapture) {
        const links = await Promise.allSettled(createdIds.map((id) => rpcAddToBucket(effectiveBucketId, id)));
        links.forEach((link, index) => { if (link.status === "rejected") bucketFailedIds.push(createdIds[index]!); });
      }
      return { kind: "created", createdIds, title: String(items[0]?.title ?? "New Thing"), bucketFailedIds };
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch, opEpoch: epochRef.current, draftFingerprint: currentDraftFingerprint.current }),
    onSuccess: async (result, _vars, mutationContext) => {
      if (!isEpochCurrent(qc, mutationContext.epoch)) return;
      if (result.kind === "ask") {
        setComposerMode("ask");
        setAssistantQuery(result.query ?? null);
        setAssistantQuestion(result.question);
        setAssistantRequestKey((k) => k + 1);
        return;
      }
      if (result.kind === "paused") {
        flashMotion("error", 400);
        return;
      }
      if (result.kind === "unavailable") {
        flashMotion("error", 650);
        if (result.reason === "people") toast.error("Couldn’t load your connections. Try again in a moment.");
        return;
      }
      await qc.invalidateQueries({ queryKey: keys.court("preview", context) });
      await qc.invalidateQueries({ queryKey: ["court"] });
      void qc.invalidateQueries({ queryKey: ["coey"] });
      if (effectiveListId) {
        await qc.invalidateQueries({ queryKey: ["list-things", effectiveListId] });
        await qc.invalidateQueries({ queryKey: ["lists"] });
      }
      if (effectiveBucketId) await qc.invalidateQueries({ queryKey: ["buckets"] });
      if (!isEpochCurrent(qc, mutationContext.epoch)) return;
      const stillSameDestination = epochRef.current === mutationContext.opEpoch;
      const stillSameDraft = currentDraftFingerprint.current === mutationContext.draftFingerprint;
      if (stillSameDestination && stillSameDraft) {
        setTossed(true);
        setValue("");
        composer.reset();
        releaseAllBlobUrlsForOwner(fileOwnerKey);
        setAttachedFiles([]);
        setReferences([]);
        setFailedAttachments([]);
        setTrigger(null);
        window.setTimeout(() => setTossed(false), 240);
      }
      if (stillSameDestination) flashMotion("success", 380);
      const count = result.createdIds.length;
      if (result.bucketFailedIds.length > 0 && effectiveBucketId) {
        const bucketId = effectiveBucketId;
        const failedIds = result.bucketFailedIds;
        const epoch = mutationContext.epoch;
        toast.warning("Saved, but it could not be added to the bucket.", {
          action: { label: "Retry bucket", onClick: () => {
            if (!isEpochCurrent(qc, epoch)) return;
            void Promise.all(failedIds.map((id) => rpcAddToBucket(bucketId, id)))
              .then(() => { void qc.invalidateQueries({ queryKey: ["buckets"] }); toast.success("Added to the bucket."); })
              .catch(() => toast.error("Bucket link failed. Your saved Things are unchanged."));
          } },
        });
      } else if (count === 1) {
        const thingId = result.createdIds[0]!;
        toast.success(`“${result.title}” tossed`, {
          action: onThingCreated ? { label: "Open", onClick: () => onThingCreated(thingId, result.title) } : undefined,
        });
      } else if (count > 1) {
        toast.success(`${count} Things tossed`);
      }
    },
    onError: (err, _vars, mutationContext) => {
      if (mutationContext && !isEpochCurrent(qc, mutationContext.epoch)) return;
      flashMotion("error", 650);
      // Nothing was created: the draft and the idempotency key stay for a safe retry.
      toast.error(err instanceof CoeyCommitError && err.forbidden
        ? "That person needs to accept your connection request first. Your draft is kept."
        : "Couldn’t save that. Your draft is kept — try again.");
    },
  });
  const canToss = (Boolean(value.trim()) || attachedFiles.length > 0 || references.length > 0) && !mutation.isPending;

  const question = composer.question;
  const runFix = async (optionId: string) => {
    const check = question?.check ?? null;
    const option = question?.options.find((o) => o.id === optionId);
    if (!option) return;
    try {
      const { outcome, next } = await composer.applyFix(option.fix, check);
      if (outcome === "date") setDuePickerOpen(true);
      else if (outcome === "send") mutation.mutate({ selections: next, privateCapture: option.fix.type === "save_private" });
      else if (option.fix.type === "connect") toast.success(`Request sent to ${option.fix.name.split(" ")[0]}. Toss again after they accept.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn’t work. Try again.");
    }
  };
  const runHintFix = async (option: import("@/domain/coey/validation").FixOption) => {
    const { outcome, next } = await composer.applyFix(option.fix, composer.hint);
    if (outcome === "date") setDuePickerOpen(true);
    else if (outcome === "send") mutation.mutate({ selections: next, privateCapture: option.fix.type === "save_private" });
  };

  const startAsk = (asked?: string) => {
    const q = (asked ?? value).trim();
    if (!q) return;
    setAssistantQuery(null);
    setComposerMode("ask");
    setAssistantQuestion(q);
    setAssistantRequestKey((key) => key + 1);
  };
  const startToss = () => {
    if (!canToss) return;
    flashMotion("submitting", 430);
    setSubmitHandoff(true);
    if (motionPhaseTimer.current) clearTimeout(motionPhaseTimer.current);
    motionPhaseTimer.current = setTimeout(() => setSubmitHandoff(false), 420);
    mutation.mutate({});
  };
  const pickManualTime = (local: string) => {
    // datetime-local is wall-clock time in the user's own calendar timezone.
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(local);
    if (!m) return;
    const at = zonedInstant(m[1]!, Number(m[2]) * 60 + Number(m[3]), composer.ctx.calendar.timezone);
    composer.setSelections((s) => ({ ...s, manualAction: { at, date: m[1]!, precision: "time", label: format(new Date(at), "EEE d MMM, h:mm a") } }));
    setDuePickerOpen(false);
  };
  const manualDefault = (() => {
    const anchor = plan?.things[0]?.draft.actionTime;
    const at = anchor?.at ?? Date.now() + 86_400_000;
    const p = localParts(at, composer.ctx.calendar.timezone);
    return `${p.date}T${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
  })();
  const interpretationStatus = composer.interpretation.state.status === "ready" && !plan ? "pending" : composer.interpretation.state.status;
  const failure = composer.interpretation.state.status === "failed"
    ? composer.interpretation.state.reason === "too_long" ? "That’s longer than Coey can read at once." : "Coey couldn’t read this right now."
    : null;

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
        "relative isolate w-full",
        !desktop && "mb-3",
      )}
    >
      {(motionFocused || (effectiveComposerMode === "ask" && assistantQuestion) || question) && (
        <div data-testid="magic-box-backdrop" aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-slate-950/30" />
      )}
      {question && !trigger && effectiveComposerMode === "toss" ? (
        <MagicBoxClarification
          id={`${suggestionId}-clarification`}
          questionKey={`${draftEntityId}:${value}:${question.check.id}`}
          question={question.check.message}
          detail={question.check.detail}
          choices={question.options.map((o) => ({ id: o.id, label: o.label, description: o.description }))}
          onContinue={(id) => void runFix(id)}
          onEdit={() => inputRef.current?.focus()}
        />
      ) : null}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[10px] font-medium text-muted-foreground" aria-label="Magic Box mode and destination">
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5" role="group" aria-label="Magic Box mode">
          <button type="button" onClick={() => setComposerMode("toss")} aria-pressed={effectiveComposerMode === "toss"} className={cn("rounded px-2 py-1 text-[10px] font-semibold transition", effectiveComposerMode === "toss" ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:text-slate-800")}>Toss</button>
          <button type="button" onClick={() => setComposerMode("ask")} aria-pressed={effectiveComposerMode === "ask"} className={cn("rounded px-2 py-1 text-[10px] font-semibold transition", effectiveComposerMode === "ask" ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:text-slate-800")}>Ask</button>
        </div>
      </div>
      {effectiveComposerMode === "ask" && assistantQuestion && (
        <MagicBoxAssistant
          question={assistantQuestion}
          requestKey={assistantRequestKey}
          listId={effectiveListId}
          bucketId={effectiveBucketId}
          context={context}
          onOpenThing={openThing}
          query={assistantQuery}
          onAsk={(next) => { setValue(next); setAssistantQuery(null); setAssistantQuestion(next); setAssistantRequestKey((key) => key + 1); }}
          onClose={() => { setAssistantQuestion(""); setValue(""); setComposerMode("toss"); }}
        />
      )}
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
          <div id={`${suggestionId}-person`} role="listbox" aria-label="Assign to Person" className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredPeople.length > 0 ? (
              filteredPeople.map((person, idx) => (
                <button
                  key={person.id}
                  id={`${suggestionId}-person-${idx}`}
                  role="option"
                  aria-selected={idx === activeIndex}
                  tabIndex={-1}
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
          <div id={`${suggestionId}-list`} role="listbox" aria-label="Add to List" className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredLists.length > 0 ? (
              filteredLists.map((item, idx) => (
                <button
                  key={item.id}
                  id={`${suggestionId}-list-${idx}`}
                  role="option"
                  aria-selected={idx === activeIndex}
                  tabIndex={-1}
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
          <div id={`${suggestionId}-bucket`} role="listbox" aria-label="Add to Bucket" className="max-h-[220px] overflow-y-auto space-y-0.5">
            {filteredBuckets.length > 0 ? (
              filteredBuckets.map((bucket, idx) => (
                <button
                  key={bucket.id}
                  id={`${suggestionId}-bucket-${idx}`}
                  role="option"
                  aria-selected={idx === activeIndex}
                  tabIndex={-1}
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
          "magic-box-root flex gap-2.5 transition-opacity duration-200",
          references.length > 0 ? "magic-box-with-references rounded-[16px] px-3 py-2" : "items-center",
          references.length > 0
            ? "font-composer"
            : desktop
              ? "min-h-[46px] rounded-[16px] px-3 py-2 font-composer"
              : "min-h-12 rounded-xl border border-border bg-card px-1.5 py-2",
          tossed && "opacity-60",
        )}
        data-state={motionState}
        data-accent={motionAccent ?? undefined}
        data-visible={documentVisible}
        data-handoff={submitHandoff}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/katalist-thing")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length > 0) return;
          const incoming = parseClipboardThingReferences(
            event.dataTransfer.getData("application/katalist-thing") || event.dataTransfer.getData("text/plain"),
            supportedThingOrigins(),
          );
          if (!incoming) return;
          event.preventDefault();
          event.stopPropagation();
          addReferences(incoming);
        }}
        onMouseEnter={() => setMotionHovered(true)}
        onMouseLeave={() => setMotionHovered(false)}
        ref={boxRef}
        onFocusCapture={() => setMotionFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMotionFocused(false);
        }}
      >
        <MagicBoxGlow />
        <div className="contents">
        <Sparkles className="magic-box-sparkle relative z-[1] h-4 w-4 shrink-0 text-primary" aria-hidden="true" />

        {/* ── Highlight mirror + input overlay ─────────────────────────────
            The mirror div renders @person #list /bucket tokens as colored bold
            spans. The real textarea sits on top with color:transparent so only
            the blinking caret is visible. Font metrics must match exactly. */}
        <div className="relative z-[1] min-w-0 flex-1">
          {/* Mirror — purely visual, no interaction */}
          <div
            ref={textMirrorRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap text-[13.5px] leading-[22px] [overflow-wrap:anywhere]"
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
          <textarea
            ref={inputRef}
            rows={1}
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
            if (e.nativeEvent.isComposing || (e.key === "Enter" && e.shiftKey)) return;
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

            if (e.key === "Enter" && effectiveComposerMode === "ask" && value.trim()) {
              e.preventDefault();
              startAsk();
              return;
            }

            if (e.key === "Enter" && effectiveComposerMode === "toss" && canToss) {
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
          placeholder={effectiveComposerMode === "ask" ? (listName ? `Ask about ${listName}…` : "Ask about your work…") : (listName ? `Toss into ${listName}…` : "Toss a thought...")}
          className="relative block min-h-[22px] max-h-[132px] w-full resize-none border-0 bg-transparent p-0 text-[13.5px] leading-[22px] outline-none placeholder:text-[#7e7a94] [overflow-wrap:anywhere]"
          style={{ color: "transparent", caretColor: "var(--foreground)" }}
          onScroll={(event) => { if (textMirrorRef.current) textMirrorRef.current.scrollTop = event.currentTarget.scrollTop; }}
          role={trigger ? "combobox" : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={Boolean(trigger)}
          aria-controls={trigger ? `${suggestionId}-${trigger.type}` : undefined}
          aria-activedescendant={trigger && (trigger.type === "person" ? filteredPeople : trigger.type === "list" ? filteredLists : filteredBuckets).length > 0 ? `${suggestionId}-${trigger.type}-${activeIndex}` : undefined}
          aria-label="Magic Box"
          aria-describedby={question && !trigger ? `${suggestionId}-clarification` : undefined}
        />
        </div>
      {/* Pasted Things stay compact. Removing one drops only the draft reference; opening one keeps the draft. */}
      {references.length > 0 && (
        <div className="magic-box-reference-tray relative z-[1] flex min-w-0 gap-2 overflow-x-auto" aria-label="Referenced Things">
          <Suspense fallback={<div className="h-8 w-56 shrink-0 rounded-lg border border-violet-100 bg-violet-50/40" aria-hidden="true" />}>
          {references.map((ref) => (
            <CompactThingReferenceCard
              key={`${draftEntityId}:${ref.thingId}`}
              variant="inline"
              thingId={ref.thingId}
              onOpen={openThing}
              onRemove={(thingId) => setReferences((prev) => prev.filter((r) => r.thingId !== thingId))}
            />
          ))}
          </Suspense>
        </div>
      )}

        </div>
        {desktop ? (
          <div className={cn("relative z-[1] flex items-center gap-1.5 shrink-0", references.length > 0 && "magic-box-reference-actions w-full")}>
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
              disabled={effectiveComposerMode === "ask"}
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
                  composer.reset();
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
              disabled={effectiveComposerMode === "ask" ? !value.trim() : !canToss}
              onClick={effectiveComposerMode === "ask" ? () => startAsk() : startToss}
              className="magic-box-toss inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-[#975ee2] px-4 text-[12px] font-medium text-white outline-none hover:brightness-95 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label={effectiveComposerMode === "ask" ? "Ask Coey" : "Toss Thing"}
              title={effectiveComposerMode === "ask" ? "Ask Coey" : "Toss Thing"}
            >
              {effectiveComposerMode === "ask" ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : <KatalistIcon name="send-toss" className="h-3.5 w-3.5" />}
              {effectiveComposerMode === "ask" ? "Ask" : "Toss"}
            </button>
          </div>
        ) : (
          <div className={cn("relative z-[1] flex items-center gap-1", references.length > 0 && "magic-box-reference-actions w-full")}>
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
              disabled={effectiveComposerMode === "ask" ? !value.trim() : !canToss}
              onClick={effectiveComposerMode === "ask" ? () => startAsk() : startToss}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground outline-none transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={effectiveComposerMode === "ask" ? "Ask Coey" : "Toss Thing"}
              title={effectiveComposerMode === "ask" ? "Ask Coey" : "Toss Thing"}
            >
              {effectiveComposerMode === "ask" ? "Ask" : "Toss"}
            </button>
          </div>
        )}
      </div>

      {effectiveComposerMode === "toss" && value.trim() && !isPreviewMode() ? (
        <CoeyChips
          plan={plan}
          status={interpretationStatus}
          failure={failure}
          calendar={composer.ctx.calendar}
          lane={composer.selections.lane}
          hint={question ? null : composer.hint}
          onLane={(lane) => composer.setSelections((sel) => ({ ...sel, lane }))}
          onAcceptInferred={() => composer.setSelections((sel) => ({ ...sel, acceptInferred: true }))}
          onPickDate={() => setDuePickerOpen(true)}
          onHintFix={(option) => void runHintFix(option)}
          onRetry={composer.interpretation.retry}
          onKeepPrivate={() => mutation.mutate({ privateCapture: true })}
          dateOpen={duePickerOpen}
          onDateOpenChange={setDuePickerOpen}
          dateEditor={(
            <>
              <label className="block text-xs font-semibold text-foreground" htmlFor="magic-box-due">When should this happen?</label>
              <input
                id="magic-box-due"
                type="datetime-local"
                defaultValue={manualDefault}
                onChange={(event) => pickManualTime(event.target.value)}
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs text-foreground"
              />
              {composer.selections.manualAction ? (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { composer.setSelections((sel) => ({ ...sel, manualAction: null })); setDuePickerOpen(false); }}>Use what I typed</button>
              ) : null}
            </>
          )}
        />
      ) : null}

    </div>
  );
}
