import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { keys } from "@/domain/query-keys";
import { useAppContext } from "@/features/context/use-app-context";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { rpcCreateThing } from "@/features/things/rpc";
import { useSession } from "@/hooks/useSession";
import { isPreviewMode } from "@/lib/session-mode";
import { useList } from "@/features/lists/use-lists";
import { useLists } from "@/features/lists/use-lists";
import { trackMagicBox, durationBucket, mimeCategory, sizeBucket } from "./analytics";
import { defaultTimeZone } from "./date-time";
import { recordPersonToss, readPersonHistory } from "./history";
import { resolveComposerKey, wrapIndex } from "./keyboard";
import { findActiveMention, replaceMention, bindingStillValid } from "./mention";
import { findActiveListToken, replaceListToken } from "./list-token";
import { buildFinalCreateThingInput, liveSafeAssigneeId } from "./payload";
import { canTossDraft, emptyMagicBoxState, reduceMagicBox, selectDraft, tossBlockReason } from "./reducer";
import { rankAssignablePeople } from "./ranking";
import { coeyFallback, type CoeyEvent } from "./coey-copy";
import { finalizeAttachments, removeStagedObject, stageAttachment, validateAttachmentBatch, abandonAttachment } from "./useMagicBoxAttachments";
import { useMagicBoxVoice } from "./useMagicBoxVoice";
import { useSarvamAssist } from "./useSarvamAssist";
import { tossMotionClass, tossMotionDurationMs } from "./toss-motion";
import { createTossGuard, runTossPipeline, submissionBlocksCreate } from "./submission";
import type { MagicBoxAction, MagicBoxDraft, RankedPerson } from "./types";
import type { Person } from "@/domain/thing";

export function useMagicBoxController(options: { listId?: string; listName?: string; surface: "court" | "list" }) {
  const { context } = useAppContext();
  const people = useAssignablePeople();
  const qc = useQueryClient();
  const { session } = useSession();
  const { list } = useList(options.listId);
  const { lists } = useLists();
  const [announce, setAnnounce] = useState("");
  const timeZone = useMemo(() => defaultTimeZone(), []);
  const [state, setState] = useState(emptyMagicBoxState);
  const [highlight, setHighlight] = useState(0);
  const [chipEditor, setChipEditor] = useState<null | "assignee" | "due" | "importance">(null);
  const [mentionMenuForcedClosed, setMentionMenuForcedClosed] = useState(false);
  const [listMenuForcedClosed, setListMenuForcedClosed] = useState(false);
  const [motionClass, setMotionClass] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const live = !isPreviewMode();
  const guardRef = useRef(createTossGuard());
  const [submission, setSubmission] = useState(() => guardRef.current.getState());
  const attachmentsRef = useRef(state.attachments);
  attachmentsRef.current = state.attachments;

  const syncSubmission = useCallback(() => {
    setSubmission({ ...guardRef.current.getState() });
  }, []);

  const ctx = useMemo(
    () => ({
      now: new Date(),
      timeZone,
      people,
      lists: lists.map((candidate) => ({ id: candidate.id, name: candidate.name })),
      listId: options.listId,
      listName: options.listName,
      context,
    }),
    [timeZone, people, lists, options.listId, options.listName, context],
  );

  const dispatch = useCallback(
    (action: MagicBoxAction) => {
      setState((prev) => reduceMagicBox(prev, action, { ...ctx, now: new Date() }));
    },
    [ctx],
  );

  const finishRecovery = useCallback(() => {
    guardRef.current.apply({ type: "RECOVERY_CLEARED" });
    syncSubmission();
    dispatch({ type: "RESET_AFTER_SUCCESS" });
    setAnnounce("Thing tossed.");
    void qc.invalidateQueries({ queryKey: keys.court("preview", context) }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["court"] }).catch(() => undefined);
    if (options.listId) {
      void qc.invalidateQueries({ queryKey: keys.listThings(options.listId) }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: keys.list(options.listId) }).catch(() => undefined);
    }
  }, [syncSubmission, dispatch, qc, context, options.listId]);

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
  const activeListToken = options.listId ? null : findActiveListToken(state.rawText, state.caret);
  const listBindingCoversActive = Boolean(activeListToken) && Boolean(state.listBinding) && state.listBinding?.start === activeListToken?.start;
  const listMenuOpen = Boolean(activeListToken) && !listBindingCoversActive && !listMenuForcedClosed && chipEditor === null;
  const rankedLists = useMemo(() => {
    const query = activeListToken?.query.toLocaleLowerCase() ?? "";
    return lists
      .filter((candidate) => !query || candidate.name.toLocaleLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [lists, activeListToken?.query]);

  const history = readPersonHistory(context);
  const ranked: RankedPerson[] = useMemo(
    () =>
      rankAssignablePeople({
        query: activeMention?.query ?? "",
        people,
        currentListMemberIds: new Set((list?.members ?? []).flatMap((m) => (m.actorId ? [m.actorId] : []))),
        recentActorIds: history.recentActorIds,
        frequencyByActorId: history.frequencyByActorId,
        sameContextActorIds: history.sameContextActorIds,
      }),
    [activeMention?.query, people, history, list],
  );

  useEffect(() => {
    setHighlight(0);
    setMentionMenuForcedClosed(false);
  }, [activeMention?.start, activeMention?.query]);

  useEffect(() => {
    setHighlight(0);
    setListMenuForcedClosed(false);
  }, [activeListToken?.start, activeListToken?.query]);

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

  const pending = submissionBlocksCreate(submission);
  const canToss = canTossDraft(draft, pending);

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

  const acceptList = useCallback((selected: { id: string; name: string }) => {
    const token = findActiveListToken(state.rawText, state.caret);
    if (!token) return;
    const replaced = replaceListToken(state.rawText, token, selected);
    dispatch({ type: "LIST_SELECTED", listId: selected.id, listName: selected.name, ...replaced });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [dispatch, state.rawText, state.caret]);

  const toss = useCallback(async () => {
    const reason = tossBlockReason(draft, submissionBlocksCreate(guardRef.current.getState()));
    if (reason === "unresolved-person") {
      void showCoey("PERSON_AMBIGUOUS");
      return;
    }
    if (reason) return;
    const snapshot = draft;
    const result = await runTossPipeline({
      guard: guardRef.current,
      snapshot,
      createThing: async () => mutation.mutateAsync(snapshot),
      finalize: async (thingId, snap) => {
        if (!snap.attachments.length) return { failedClientIds: [] };
        return finalizeAttachments({
          thingId,
          attachments: snap.attachments,
          accessToken: session?.access_token,
        });
      },
    });
    syncSubmission();
    if (result.status === "ignored") return;
    if (result.status === "create-failed") {
      trackMagicBox({ name: "magic_box_toss_failed", category: "backend" });
      void showCoey("TOSS_FAILED");
      return;
    }
    if (result.status === "recovery") {
      for (const clientId of result.failedClientIds) {
        dispatch({
          type: "ATTACHMENT_UPDATED",
          clientId,
          patch: { status: "recovery-failed", createdThingId: result.thingId, error: "finalize" },
        });
      }
      for (const attachment of snapshot.attachments) {
        if (!result.failedClientIds.includes(attachment.clientId)) {
          dispatch({ type: "ATTACHMENT_REMOVED", clientId: attachment.clientId });
        }
      }
      void showCoey("ATTACHMENT_FAILED");
      setAnnounce("Thing created. Retry or remove the remaining attachment.");
      return;
    }
    if (snapshot.assignee.status === "resolved") recordPersonToss(snapshot.assignee.person.id, snapshot.context);
    const delegated = snapshot.assignee.status === "resolved";
    const personName = snapshot.assignee.status === "resolved" ? snapshot.assignee.person.name : undefined;
    setMotionClass(tossMotionClass(delegated ? "delegated" : "self"));
    window.setTimeout(() => setMotionClass(""), tossMotionDurationMs(delegated ? "delegated" : "self"));
    dispatch({ type: "RESET_AFTER_SUCCESS" });
    setAnnounce("Thing tossed.");
    trackMagicBox({
      name: "magic_box_toss",
      assignment: delegated ? "delegated" : "self",
      due: snapshot.due.status === "resolved",
      importance: snapshot.ownerImportance,
      attachments: snapshot.attachments.length > 0,
      surface: options.listId ? "list" : "global",
    });
    void showCoey(delegated ? "THING_TOSSED_OTHER" : "THING_TOSSED_SELF", personName);
    void qc.invalidateQueries({ queryKey: keys.court("preview", context) }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["court"] }).catch(() => undefined);
    if (options.listId) {
      void qc.invalidateQueries({ queryKey: keys.listThings(options.listId) }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: keys.list(options.listId) }).catch(() => undefined);
    }
  }, [draft, mutation, showCoey, dispatch, qc, context, options.listId, syncSubmission, session?.access_token]);

  const onKeyDown = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      const result = resolveComposerKey(event.key, {
        mentionMenuOpen: mentionMenuOpen || listMenuOpen,
        chipEditorOpen: chipEditor !== null,
        canToss,
      });
      if (result.type === "none") return;
      event.preventDefault();
      if (result.type === "mention-move") {
        setHighlight((i) => wrapIndex(i, result.delta, listMenuOpen ? rankedLists.length : ranked.length));
        return;
      }
      if (result.type === "mention-accept") {
        if (listMenuOpen) {
          const selected = rankedLists[highlight];
          if (selected) acceptList(selected);
          return;
        }
        const person = ranked[highlight];
        if (person) acceptPerson(person, event.key === "Tab" ? "tab" : "enter", person.rank);
        return;
      }
      if (result.type === "mention-close") {
        if (listMenuOpen) setListMenuForcedClosed(true);
        else setMentionMenuForcedClosed(true);
        return;
      }
      if (result.type === "toss") void toss();
    },
    [mentionMenuOpen, listMenuOpen, chipEditor, canToss, ranked, rankedLists, highlight, acceptPerson, acceptList, toss],
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
      const { accepted, rejected } = validateAttachmentBatch(Array.from(files), state.attachments.length);
      for (const item of rejected) toast.error(item.reason);
      for (const file of accepted) {
        const clientId = crypto.randomUUID();
        dispatch({
          type: "ATTACHMENT_ADDED",
          attachment: { clientId, file, status: "uploading" },
        });
        setAnnounce(`Uploading ${file.name}.`);
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
        setAnnounce(staged.status === "failed" ? `${file.name} failed. Retry or remove it.` : `${file.name} uploaded.`);
        if (staged.status === "failed") await showCoey("ATTACHMENT_FAILED");
      }
    },
    [dispatch, session?.user?.id, state.attachments.length, showCoey],
  );

  const removeAttachment = useCallback(
    async (clientId: string) => {
      const attachment = state.attachments.find((item) => item.clientId === clientId);
      if (!attachment) return;
      if (attachment.status === "recovery-failed" || attachment.createdThingId) {
        await abandonAttachment({
          thingId: attachment.createdThingId ?? guardRef.current.getState().createdThingId ?? "",
          clientId: attachment.clientId,
          stagingKey: attachment.stagingKey,
          accessToken: session?.access_token,
        });
      } else {
        await removeStagedObject(attachment.stagingKey);
      }
      dispatch({ type: "ATTACHMENT_REMOVED", clientId });
      if (attachment.status === "recovery-failed" || attachment.createdThingId) {
        const remaining = state.attachments.filter((item) => item.clientId !== clientId && (item.status === "recovery-failed" || item.createdThingId));
        if (remaining.length === 0) finishRecovery();
      }
    },
    [dispatch, state.attachments, finishRecovery, session?.access_token],
  );

  const retryAttachment = useCallback(
    async (clientId: string) => {
      const attachment = state.attachments.find((item) => item.clientId === clientId);
      if (!attachment) return;
      if (attachment.createdThingId || attachment.status === "recovery-failed") {
        dispatch({ type: "ATTACHMENT_UPDATED", clientId, patch: { status: "finalizing", error: undefined } });
        const finalized = await finalizeAttachments({
          thingId: attachment.createdThingId ?? guardRef.current.getState().createdThingId ?? "",
          attachments: [{ ...attachment, status: "ready" }],
          accessToken: session?.access_token,
        });
        if (finalized.failedClientIds.length) {
          dispatch({ type: "ATTACHMENT_UPDATED", clientId, patch: { status: "recovery-failed", error: "finalize" } });
          return;
        }
        dispatch({ type: "ATTACHMENT_REMOVED", clientId });
        const remaining = state.attachments.filter((item) => item.clientId !== clientId && (item.status === "recovery-failed" || item.createdThingId));
        if (remaining.length === 0) finishRecovery();
        return;
      }
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
    [dispatch, session?.user?.id, session?.access_token, state.attachments, finishRecovery],
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
    onAnnounce: setAnnounce,
  });

  const assist = useSarvamAssist({
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

  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        if (!attachment.createdThingId && attachment.stagingKey) {
          void removeStagedObject(attachment.stagingKey);
        }
      }
    };
  }, []);

  return {
    draft,
    canToss,
    blockedPerson: draft.assignee.status === "unresolved",
    inputRef,
    ranked,
    highlight,
    mentionMenuOpen,
    listMenuOpen,
    activeListToken,
    rankedLists,
    activeMention,
    chipEditor,
    setChipEditor,
    motionClass,
    pending,
    submission,
    onTextChange,
    onKeyDown,
    toss,
    dispatch,
    acceptPerson,
    acceptList,
    addFiles,
    removeAttachment,
    retryAttachment,
    voice,
    assist,
    announce,
    people,
    listId: options.listId,
    listName: options.listName,
    focus: () => inputRef.current?.focus(),
  };
}
