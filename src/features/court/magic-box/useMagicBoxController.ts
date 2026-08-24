import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { keys } from "@/domain/query-keys";
import { useAppContext } from "@/features/context/use-app-context";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { rpcCreateThing } from "@/features/things/rpc";
import { useSession } from "@/hooks/useSession";
import { isPreviewMode } from "@/lib/session-mode";
import { trackMagicBox, durationBucket, mimeCategory, sizeBucket } from "./analytics";
import { defaultTimeZone } from "./date-time";
import { recordPersonToss, readPersonHistory } from "./history";
import { resolveComposerKey, wrapIndex } from "./keyboard";
import { findActiveMention, replaceMention, bindingStillValid } from "./mention";
import { buildFinalCreateThingInput, liveSafeAssigneeId } from "./payload";
import { canTossDraft, emptyMagicBoxState, reduceMagicBox, selectDraft, tossBlockReason } from "./reducer";
import { rankAssignablePeople } from "./ranking";
import { coeyFallback, type CoeyEvent } from "./coey-copy";
import { finalizeAttachments, stageAttachment, validateAttachment } from "./useMagicBoxAttachments";
import { useMagicBoxVoice } from "./useMagicBoxVoice";
import { useSarvamAssist } from "./useSarvamAssist";
import { tossMotionClass, tossMotionDurationMs } from "./toss-motion";
import type { MagicBoxAction, MagicBoxDraft, RankedPerson } from "./types";
import type { Person } from "@/domain/thing";

export function useMagicBoxController(options: { listId?: string; listName?: string; surface: "court" | "list" }) {
  const { context } = useAppContext();
  const people = useAssignablePeople();
  const qc = useQueryClient();
  const { session } = useSession();
  const timeZone = useMemo(() => defaultTimeZone(), []);
  const [state, setState] = useState(emptyMagicBoxState);
  const [highlight, setHighlight] = useState(0);
  const [chipEditor, setChipEditor] = useState<null | "assignee" | "due" | "importance">(null);
  const [mentionMenuForcedClosed, setMentionMenuForcedClosed] = useState(false);
  const [motionClass, setMotionClass] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const live = !isPreviewMode();

  const ctx = useMemo(
    () => ({
      now: new Date(),
      timeZone,
      people,
      listId: options.listId,
      listName: options.listName,
      context,
    }),
    [timeZone, people, options.listId, options.listName, context],
  );

  const dispatch = useCallback(
    (action: MagicBoxAction) => {
      setState((prev) => reduceMagicBox(prev, action, { ...ctx, now: new Date() }));
    },
    [ctx],
  );

  const draft: MagicBoxDraft = useMemo(
    () => selectDraft(state, { ...ctx, now: new Date() }),
    [state, ctx],
  );

  const activeMention = findActiveMention(state.rawText, state.caret);
  const bindingCoversActive =
    Boolean(activeMention) &&
    bindingStillValid(state.rawText, state.mentionBinding) &&
    state.mentionBinding?.start === activeMention?.start;
  const mentionMenuOpen = Boolean(activeMention) && !bindingCoversActive && !mentionMenuForcedClosed && chipEditor === null;

  const history = readPersonHistory();
  const ranked: RankedPerson[] = useMemo(
    () =>
      rankAssignablePeople({
        query: activeMention?.query ?? "",
        people,
        recentActorIds: history.recentActorIds,
        frequencyByActorId: history.frequencyByActorId,
      }),
    [activeMention?.query, people, history],
  );

  useEffect(() => {
    setHighlight(0);
    setMentionMenuForcedClosed(false);
  }, [activeMention?.start, activeMention?.query]);

  const mutation = useMutation({
    mutationFn: async (draftSnapshot: MagicBoxDraft) => {
      const built = buildFinalCreateThingInput(draftSnapshot, false);
      if ("error" in built) throw new Error(built.error);
      const assigneeActorId = liveSafeAssigneeId(built.assigneeActorId, live);
      return rpcCreateThing({
        title: built.title,
        context: built.context,
        ownerImportance: built.ownerImportance,
        listId: built.listId,
        assigneeActorId,
        dueAt: built.dueAt,
        dueHasTime: built.dueHasTime,
      });
    },
  });

  const canToss = canTossDraft(draft, mutation.isPending);

  const showCoey = useCallback(
    async (event: CoeyEvent, personName?: string) => {
      const fallback = coeyFallback(event, personName);
      const token = session?.access_token;
      if (!token || token.startsWith("demo-")) {
        if (event.startsWith("THING_TOSSED")) toast.success(fallback);
        else toast.error(fallback);
        return;
      }
      try {
        const res = await fetch("/api/magic-box/coey", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ event, personName }),
        });
        const json = (await res.json()) as { text?: string };
        const text = json.text || fallback;
        if (event.startsWith("THING_TOSSED")) toast.success(text);
        else toast.error(text);
      } catch {
        if (event.startsWith("THING_TOSSED")) toast.success(fallback);
        else toast.error(fallback);
      }
    },
    [session?.access_token],
  );

  const acceptPerson = useCallback(
    (person: Person, method: "tab" | "enter" | "click" | "chip", rank: number) => {
      if (!person) return;
      const mention = findActiveMention(state.rawText, state.caret);
      if (method === "chip" || !mention) {
        dispatch({ type: "ASSIGNEE_SELECTED", person, source: "manual" });
      } else {
        const replaced = replaceMention(state.rawText, mention, person);
        dispatch({
          type: "ASSIGNEE_SELECTED",
          person,
          source: "mention",
          binding: replaced.binding,
          text: replaced.text,
          caret: replaced.caret,
        });
      }
      trackMagicBox({ name: "magic_box_person_selected", method, rank });
      setChipEditor(null);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    },
    [dispatch, state.rawText, state.caret],
  );

  const toss = useCallback(async () => {
    const reason = tossBlockReason(draft, mutation.isPending);
    if (reason === "unresolved-person") {
      await showCoey("PERSON_AMBIGUOUS");
      return;
    }
    if (reason) return;
    const snapshot = draft;
    try {
      const created = await mutation.mutateAsync(snapshot);
      const thingId =
        created && typeof created === "object" && "id" in created ? String((created as { id: string }).id) : "";
      if (thingId && snapshot.attachments.length) {
        const finalized = await finalizeAttachments({ thingId, attachments: snapshot.attachments });
        if (finalized.failedClientIds.length) await showCoey("ATTACHMENT_FAILED");
      }
      if (snapshot.assignee.status === "resolved") recordPersonToss(snapshot.assignee.person.id);
      const delegated = snapshot.assignee.status === "resolved";
      const personName = snapshot.assignee.status === "resolved" ? snapshot.assignee.person.name : undefined;
      setMotionClass(tossMotionClass(delegated ? "delegated" : "self"));
      window.setTimeout(() => setMotionClass(""), tossMotionDurationMs(delegated ? "delegated" : "self"));
      await showCoey(delegated ? "THING_TOSSED_OTHER" : "THING_TOSSED_SELF", personName);
      trackMagicBox({
        name: "magic_box_toss",
        assignment: delegated ? "delegated" : "self",
        due: snapshot.due.status === "resolved",
        importance: snapshot.ownerImportance,
        attachments: snapshot.attachments.length > 0,
        surface: options.listId ? "list" : "global",
      });
      dispatch({ type: "RESET_AFTER_SUCCESS" });
      await qc.invalidateQueries({ queryKey: keys.court("preview", context) });
      await qc.invalidateQueries({ queryKey: ["court"] });
      if (options.listId) {
        await qc.invalidateQueries({ queryKey: keys.listThings(options.listId) });
        await qc.invalidateQueries({ queryKey: keys.list(options.listId) });
      }
    } catch {
      trackMagicBox({ name: "magic_box_toss_failed", category: "backend" });
      await showCoey("TOSS_FAILED");
    }
  }, [draft, mutation, showCoey, dispatch, qc, context, options.listId]);

  const onKeyDown = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      const result = resolveComposerKey(event.key, {
        mentionMenuOpen,
        chipEditorOpen: chipEditor !== null,
        canToss,
      });
      if (result.type === "none") return;
      event.preventDefault();
      if (result.type === "mention-move") {
        setHighlight((i) => wrapIndex(i, result.delta, ranked.length));
        return;
      }
      if (result.type === "mention-accept") {
        const person = ranked[highlight];
        if (person) acceptPerson(person, event.key === "Tab" ? "tab" : "enter", person.rank);
        return;
      }
      if (result.type === "mention-close") {
        setMentionMenuForcedClosed(true);
        return;
      }
      if (result.type === "toss") void toss();
    },
    [mentionMenuOpen, chipEditor, canToss, ranked, highlight, acceptPerson, toss],
  );

  const onTextChange = useCallback(
    (text: string, caret: number) => {
      dispatch({ type: "TEXT_CHANGED", text, caret });
    },
    [dispatch],
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const userId = session?.user?.id ?? "preview";
      for (const file of Array.from(files)) {
        const error = validateAttachment(file, state.attachments.length);
        if (error) {
          toast.error(error);
          continue;
        }
        const clientId = crypto.randomUUID();
        dispatch({
          type: "ATTACHMENT_ADDED",
          attachment: { clientId, file, status: "uploading" },
        });
        trackMagicBox({
          name: "magic_box_attachment_added",
          mime_category: mimeCategory(file.type),
          size_bucket: sizeBucket(file.size),
        });
        const staged = await stageAttachment({ userId, clientId, file });
        dispatch({
          type: "ATTACHMENT_UPDATED",
          clientId,
          patch: { status: staged.status, stagingKey: staged.stagingKey, error: staged.error },
        });
        if (staged.status === "failed") await showCoey("ATTACHMENT_FAILED");
      }
    },
    [dispatch, session?.user?.id, state.attachments.length, showCoey],
  );

  const retryAttachment = useCallback(
    async (clientId: string) => {
      const attachment = state.attachments.find((item) => item.clientId === clientId);
      if (!attachment) return;
      dispatch({ type: "ATTACHMENT_UPDATED", clientId, patch: { status: "uploading", error: undefined } });
      const staged = await stageAttachment({
        userId: session?.user?.id ?? "preview",
        clientId,
        file: attachment.file,
      });
      dispatch({
        type: "ATTACHMENT_UPDATED",
        clientId,
        patch: { status: staged.status, stagingKey: staged.stagingKey, error: staged.error },
      });
    },
    [dispatch, session?.user?.id, state.attachments],
  );

  const voice = useMagicBoxVoice({
    accessToken: session?.access_token,
    onTranscript: (text) => {
      const next = state.rawText.trim() ? `${state.rawText.trim()} ${text}` : text;
      dispatch({ type: "TEXT_CHANGED", text: next, caret: next.length });
      void showCoey("VOICE_CAPTURED");
      trackMagicBox({ name: "magic_box_voice_result", success: true, duration_bucket: durationBucket(0) });
    },
    onError: () => {
      void showCoey("VOICE_FAILED");
      trackMagicBox({ name: "magic_box_voice_result", success: false, duration_bucket: durationBucket(0) });
    },
  });

  useSarvamAssist({
    text: state.rawText,
    enabled: Boolean(session?.access_token) && !session?.access_token?.startsWith("demo-") && state.rawText.trim().length >= 8,
    accessToken: session?.access_token,
    onSuggestion: (text, requestId) => {
      dispatch({ type: "AI_CORRECTION_RECEIVED", text, requestId });
      trackMagicBox({ name: "magic_box_ai_assist", result: "offered" });
    },
  });

  useEffect(() => {
    const onFocusShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const target = event.target as HTMLElement | null;
        if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onFocusShortcut);
    return () => window.removeEventListener("keydown", onFocusShortcut);
  }, []);

  useEffect(() => {
    if (draft.due.status === "ambiguous") trackMagicBox({ name: "magic_box_date_ambiguous", category: "numeric" });
  }, [draft.due.status]);

  return {
    draft,
    canToss,
    blockedPerson: draft.assignee.status === "unresolved",
    inputRef,
    ranked,
    highlight,
    mentionMenuOpen,
    activeMention,
    chipEditor,
    setChipEditor,
    motionClass,
    pending: mutation.isPending,
    onTextChange,
    onKeyDown,
    toss,
    dispatch,
    acceptPerson,
    addFiles,
    retryAttachment,
    voice,
    people,
    listId: options.listId,
    listName: options.listName,
    focus: () => inputRef.current?.focus(),
  };
}
