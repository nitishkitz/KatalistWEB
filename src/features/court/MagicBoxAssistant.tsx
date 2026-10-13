import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronDown,
  Layers,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { useCoeyTurn, type CoeyTurnRequest } from "./assistant/use-coey-turn";
import { useSession } from "@/hooks/useSession";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { AssistantActionCard, type ActionCardHandle, type ActionPreview } from "./AssistantActionCard";
import { useNavigate } from "@tanstack/react-router";
import type { CoeyVoice } from "./assistant/use-coey-voice";
import {
  interpretSpokenReply,
  readbackText,
  resultText,
  type OpenTarget,
  type VisibleProposal,
} from "./assistant/voice-actions";
import { isLocalReply } from "../../../server/lib/assistant-voice-protocol";
import { useLists } from "@/features/lists/use-lists";
import { toProxiedUrl } from "@/integrations/supabase/proxy";
import type { Thing } from "@/domain/thing";

// Row UI pulls in the Court data layer, so it loads only when an answer has rows.
const AssistantAnswerGroups = lazy(() => import("./assistant/AssistantAnswerGroups"));

type ContextKind = "work" | "home";
type ScopeCandidate = {
  type: "list" | "bucket";
  id: string;
  label: string;
  detail?: string;
};
type ConversationTurn = { role: "user" | "assistant"; content: string };

// Avatar/file URL refreshes and read markers do not change the answer's facts.
function answerDataSnapshot(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const fields = (thing: Partial<Thing>) => [thing.id, thing.title, thing.workStatus,
    thing.acknowledgement, thing.dueAt, thing.assignee?.id, thing.owner?.id,
    thing.listId, thing.updatedAt, thing.cancelledAt];
  if ("things" in data && Array.isArray(data.things))
    return JSON.stringify(data.things.map(fields).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  if ("id" in data && "updatedAt" in data) return JSON.stringify(fields(data as Partial<Thing>));
  return data;
}

function ListCover({ name, src }: { name: string; src?: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageUrl = src
    ? toProxiedUrl(
        src,
        (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL ?? "",
      )
    : null;
  return (
    <span
      className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/5 bg-violet-100 text-violet-500"
      aria-hidden="true"
    >
      <Layers className="h-4 w-4" />
      {imageUrl && failedSrc !== imageUrl && (
        <img
          src={imageUrl}
          alt={`${name} cover`}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedSrc(imageUrl)}
        />
      )}
    </span>
  );
}

/** True once `active` has been continuously true for `ms`. Keeps instant answers free of flicker. */
function useDelayedFlag(active: boolean, ms: number) {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!active) {
      setFlag(false);
      return;
    }
    const timer = setTimeout(() => setFlag(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return flag;
}

function AnswerText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index} className="font-semibold text-slate-900">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export function MagicBoxAssistant({
  question,
  requestKey,
  listId,
  bucketId,
  context,
  onOpenThing,
  onAsk,
  onClose,
  voice,
  voiceTurnId = null,
  onProposalChange,
  query = null,
}: {
  /** Structured query when the Magic Box recognised a question; null for typed Ask mode. */
  query?: CoeyTurnRequest["query"];
  question: string;
  requestKey: number;
  listId?: string;
  bucketId?: string;
  context: ContextKind;
  onOpenThing: (thingId: string) => void;
  onAsk: (question: string) => void;
  onClose: () => void;
  /** Voice session, when the controls are mounted. Spoken replies act only on what this panel shows. */
  voice?: CoeyVoice;
  /** Set while this question came from a spoken turn; the panel then renders the voice turn's events. */
  voiceTurnId?: string | null;
  /** True while a spoken proposal waits for yes or no. */
  onProposalChange?: (pending: boolean) => void;
}) {
  const qc = useQueryClient();
  const { user } = useSession();
  const { lists } = useLists();
  const panelId = useId();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  // A List or Bucket chosen from a selection card, or named in an earlier answer,
  // stays in force for follow-ups until the Court scope or context changes.
  // The choice is tied to its request so a new question never inherits it.
  const [chosen, setChosen] = useState<{ requestKey: number; scope: ScopeCandidate } | null>(null);
  const choice = chosen?.requestKey === requestKey ? chosen.scope : null;
  const [chosenPerson, setChosenPerson] = useState<{ requestKey: number; actorId: string } | null>(null);
  const personChoice = chosenPerson?.requestKey === requestKey ? chosenPerson.actorId : undefined;
  // Read through a ref so pinning never changes the query key and refetches.
  const pinnedRef = useRef<ScopeCandidate | null>(null);
  const recordedRequestKey = useRef(0);
  const firstFetchRef = useRef("");
  const ownTurn = useCoeyTurn();
  const voiceDriven = Boolean(voice && voiceTurnId);
  const [voiceAnsweredAt, setVoiceAnsweredAt] = useState(0);
  const voiceAnswer = voice?.turn.answer ?? null;
  useEffect(() => {
    if (voiceAnswer) setVoiceAnsweredAt(Date.now());
  }, [voiceAnswer]);
  const turn = voiceDriven && voice
    ? {
        state: voice.turn,
        running: !voice.turn.terminal && (voice.phase === "transcribing" || voice.phase === "checking"),
        connecting: false,
        error: voice.turn.error?.message ?? null,
        answer: voice.turn.answer,
        facts: voice.turn.facts,
        answeredAt: voiceAnsweredAt,
        start: () => undefined,
        cancel: () => undefined,
      }
    : ownTurn;
  const historyRef = useRef(history);
  historyRef.current = history;
  const previousQueryRef = useRef<CoeyTurnRequest["previous_query"]>(null);
  const [courtChanged, setCourtChanged] = useState(false);
  const buildRequest = useCallback(
    (reuse: boolean) => {
      const pinned = pinnedRef.current;
      return {
        question,
        listId: pinned ? (pinned.type === "list" ? pinned.id : undefined) : listId,
        bucketId: pinned ? (pinned.type === "bucket" ? pinned.id : undefined) : bucketId,
        scopeChoice: choice ? { type: choice.type, id: choice.id } : undefined,
        personChoice,
        context,
        history: historyRef.current.slice(-6),
        reuse,
        // Follow-ups in the same panel are open questions again.
        query: historyRef.current.length === 0 ? query : null,
        previous_query: historyRef.current.length > 0 ? previousQueryRef.current : null,
      };
    },
    [question, listId, bucketId, choice, personChoice, context, query],
  );
  // One turn per question. Re-running is an explicit Refresh, never a timer.
  useEffect(() => {
    if (!requestKey || !question.trim() || voiceDriven) return;
    // Only the first fetch of a follow-up may reuse server-side facts; refreshes never do.
    const fetchKey = `${requestKey}:${choice?.id ?? ""}:${personChoice ?? ""}`;
    const reuse = historyRef.current.length > 0 && firstFetchRef.current !== fetchKey;
    firstFetchRef.current = fetchKey;
    setCourtChanged(false);
    ownTurn.start(buildRequest(reuse));
    return () => ownTurn.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/cancel are stable; buildRequest changes with the same inputs listed here
  }, [user?.id, context, listId, bucketId, choice?.id, personChoice, question, requestKey, voiceDriven]);
  const refresh = () => {
    setCourtChanged(false);
    // A spoken answer is refreshed through the typed path, which re-reads the Court.
    if (voiceDriven) return onAsk(question);
    ownTurn.start(buildRequest(false));
  };
  // A Court change never rewrites the answer on screen; it only offers a refresh.
  useEffect(() => {
    if (!turn.answeredAt) return;
    const answeredAt = turn.answeredAt;
    const cache = qc.getQueryCache();
    const observed = new Map(cache.getAll().map((query) => [query.queryHash, answerDataSnapshot(query.state.data)]));
    return cache.subscribe((event) => {
      const root = event.query.queryKey[0];
      if (
        event.type === "updated" &&
        event.action.type === "success" &&
        (root === "court" || root === "thing") &&
        event.query.state.dataUpdatedAt > answeredAt
      ) {
        const previous = observed.get(event.query.queryHash);
        const data = answerDataSnapshot(event.query.state.data);
        observed.set(event.query.queryHash, data);
        // A successful read with unchanged data is not a Court change.
        // New row queries also must not invalidate the answer that opened them.
        if ((previous !== undefined && previous !== data) || (previous === undefined && confirming))
          setCourtChanged(true);
      }
    });
  }, [qc, turn.answeredAt, confirming]);
  // A prepared confirmation never survives a Court change: the person reviews again.
  useEffect(() => {
    if (courtChanged) setConfirming(false);
  }, [courtChanged]);
  const slowConnect = useDelayedFlag(turn.connecting, 700);
  const result = useMemo(
    () =>
      turn.answer
        ? { answer: turn.answer, facts: turn.facts ?? { scope: null, things: [], nudge_recommendations: [] } }
        : undefined,
    [turn.answer, turn.facts],
  );
  useEffect(() => {
    if (!result || !requestKey || recordedRequestKey.current === requestKey) return;
    // A selection card is not an answer; the turn is recorded once the user picks a scope.
    if (result.answer.intent === "scope_selection_required" || result.answer.intent === "person_selection_required") return;
    recordedRequestKey.current = requestKey;
    previousQueryRef.current = result.answer.structured_query ?? null;
    const resolved = result.facts.scope;
    if (resolved && (resolved.type === "list" || resolved.type === "bucket") && resolved.id)
      pinnedRef.current = { type: resolved.type, id: resolved.id, label: resolved.label };
    const nextHistory: ConversationTurn[] = [
      ...history,
      { role: "user" as const, content: question },
      { role: "assistant" as const, content: result.answer.answer_markdown },
    ].slice(-6);
    setHistory(nextHistory);
  }, [history, result, question, requestKey]);
  const answer = result?.answer;
  // ---- Spoken actions: the card, the speech and the server stay in step. ----
  const navigate = useNavigate();
  const cardRefs = useRef(new Map<string, ActionCardHandle>());
  const previews = useRef(new Map<string, ActionPreview>());
  const [proposal, setProposal] = useState<(VisibleProposal & { actionId: string }) | null>(null);
  const queuedSpeech = useRef<{ text: string; actionId?: string } | null>(null);
  const voiceActive = Boolean(voice?.active);
  const openTargets: OpenTarget[] = (answer?.actions ?? []).flatMap((action) =>
    action.type === "open_thing" || action.type === "open_list" || action.type === "open_bucket"
      ? [{ type: action.type.slice(5) as OpenTarget["type"], id: action.target_ids[0] }]
      : [],
  );
  const openTargetKey = openTargets.map((t) => `${t.type}:${t.id}`).join(",");
  const writeActions = (answer?.actions ?? []).filter((a) =>
    ["set_status", "set_due", "assign_person"].includes(a.type),
  );
  const nudgeActions = (answer?.actions ?? []).filter((a) => a.type === "prepare_nudge");
  const setHint = voice?.setHint;
  // Any new question, answer or Court change retires a pending spoken proposal.
  useEffect(() => {
    setProposal(null);
    queuedSpeech.current = null;
    previews.current.clear();
  }, [requestKey, question, turn.answeredAt, context, listId, bucketId]);
  useEffect(() => {
    if (courtChanged) setProposal(null);
  }, [courtChanged]);
  useEffect(() => {
    onProposalChange?.(Boolean(proposal));
    return () => onProposalChange?.(false);
  }, [proposal, onProposalChange]);
  useEffect(() => {
    setHint?.({ awaitingConfirmation: voiceActive && Boolean(proposal), openTarget: voiceActive && openTargets.length === 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openTargetKey stands in for openTargets
  }, [setHint, voiceActive, proposal, openTargetKey]);
  // Prepare exactly one spoken write proposal; several or a nudge are left to the screen.
  useEffect(() => {
    if (!voiceDriven || !voiceActive || !turn.answeredAt || !answer) return;
    if (writeActions.length === 1) {
      const action = writeActions[0];
      const handle = window.setTimeout(() => {
        const card = cardRefs.current.get(action.id);
        if (!card) return;
        void card.prepare().then(() => {
          const preview = previews.current.get(action.id);
          if (preview?.token) queuedSpeech.current = { text: readbackText(preview), actionId: action.id };
          setSpeechTick((n) => n + 1);
        });
      }, 0);
      return () => window.clearTimeout(handle);
    }
    if (writeActions.length > 1) queuedSpeech.current = { text: "I found several changes. Choose one on screen." };
    else if (nudgeActions.length)
      queuedSpeech.current = { text: "Review the nudge on screen, then confirm it there. Nothing is sent until you do." };
    setSpeechTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per answer
  }, [turn.answeredAt, voiceDriven, voiceActive]);
  const [speechTick, setSpeechTick] = useState(0);
  // Readback waits until the spoken answer has finished, so it never cuts Coey off.
  useEffect(() => {
    const queued = queuedSpeech.current;
    if (!queued || !voice || voice.phase !== "listening" || !voice.sessionId) return;
    queuedSpeech.current = null;
    voice.speak(queued.text);
    if (queued.actionId) {
      const preview = previews.current.get(queued.actionId);
      const expires = preview?.action.expiresAt ? Date.parse(preview.action.expiresAt) : Date.now() + 5 * 60_000;
      setProposal({ actionId: queued.actionId, proposalId: queued.actionId, sessionId: voice.sessionId, expiresAt: expires });
    }
  }, [speechTick, voice, voice?.phase]);
  // Short spoken replies ("yes", "no", "open it") act only on what is visible and unexpired.
  const handledReply = useRef<string | null>(null);
  useEffect(() => {
    const transcript = voice?.transcript;
    if (!voice || !transcript || handledReply.current === transcript.turnId) return;
    handledReply.current = transcript.turnId;
    if (!isLocalReply(transcript.text, { awaitingConfirmation: voiceActive && Boolean(proposal), openTarget: voiceActive && openTargets.length === 1 }))
      return;
    const reply = interpretSpokenReply(transcript.text, {
      proposal,
      sessionId: voice.sessionId,
      now: Date.now(),
      openTargets,
    });
    const card = proposal ? cardRefs.current.get(proposal.actionId) : undefined;
    if (reply.kind === "confirm") void card?.confirm();
    else if (reply.kind === "cancel") {
      card?.cancel();
      setProposal(null);
      voice.speak("Cancelled. Nothing was changed.");
    } else if (reply.kind === "open") {
      if (reply.target.type === "thing") onOpenThing(reply.target.id);
      else if (reply.target.type === "list") void navigate({ to: "/lists/$listId", params: { listId: reply.target.id } });
      else void navigate({ to: "/buckets/$bucketId", params: { bucketId: reply.target.id } });
    } else if (reply.kind === "expired" || reply.kind === "stale_session") {
      card?.cancel();
      setProposal(null);
      voice.speak("That request expired. Nothing was changed. Ask again if you still want it.");
    } else if (reply.kind === "no_proposal") voice.speak("There is nothing to confirm right now.");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to a new transcript only
  }, [voice?.transcript]);
  useEffect(() => {
    setExpanded(null);
    setSelected([]);
    setConfirming(false);
    setNotice(null);
    setSentIds([]);
  }, [requestKey, question, listId, bucketId, context]);
  useEffect(() => {
    pinnedRef.current = null;
  }, [listId, bucketId, context]);
  const things = result?.facts?.things ?? [];
  const shownScope = result?.facts?.scope;
  const recommendations = (result?.facts?.nudge_recommendations ?? [])
    .map((row) => ({
      ...row,
      eligible_thing_ids: row.eligible_thing_ids.filter((id) => !sentIds.includes(id)),
    }))
    .filter((row) => row.can_nudge && row.eligible_thing_ids.length > 0);
  const activeRow = recommendations.find((row) => row.actor_id === expanded);
  const selectedIds = selected.filter((id) => activeRow?.eligible_thing_ids.includes(id));
  // A realtime change invalidates any previously prepared confirmation.
  useEffect(() => {
    setConfirming(false);
    // Retain the optimistic mask only until the server confirms cooldown.
    // A Thing can become eligible again later without reopening Ask.
    const eligible = new Set(
      result?.facts?.nudge_recommendations.flatMap((row) => row.eligible_thing_ids) ?? [],
    );
    setSentIds((current) => current.filter((id) => eligible.has(id)));
  }, [result]);

  const sendNudge = async () => {
    if (!activeRow || !selectedIds.length || sending) return;
    const recipient = activeRow;
    const epoch = getIdentityEpoch(qc).epoch;
    setSending(true);
    setNotice(null);
    try {
      const response = await authedFetch("/api/assistant/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thingIds: selectedIds, actorId: recipient.actor_id }),
      });
      const body = (await response.json()) as {
        sent?: Array<{ thingId: string }>;
        failed?: Array<{ thingId: string }>;
        message?: string;
      };
      if (!isEpochCurrent(qc, epoch)) return;
      if (!response.ok) throw new Error(body.message || "The nudge could not be sent.");
      const sent = body.sent ?? [];
      const failed = body.failed ?? [];
      if (!sent.length) throw new Error("No nudges were sent. Refresh and try again.");
      setSentIds((current) => [...new Set([...current, ...sent.map((item) => item.thingId)])]);
      setSelected(failed.map((item) => item.thingId));
      setConfirming(false);
      const message = `${sent.length} nudge${sent.length === 1 ? "" : "s"} sent to ${recipient.display_name}.${failed.length ? ` ${failed.length} could not be sent; review the remaining Things.` : ""}`;
      setNotice(message);
      if (failed.length) toast.warning(message);
      else toast.success(message);
    } catch (cause) {
      if (isEpochCurrent(qc, epoch)) {
        const message = cause instanceof Error ? cause.message : "The nudge could not be sent.";
        setNotice(message);
        toast.error(message);
        setConfirming(false);
      }
    } finally {
      if (isEpochCurrent(qc, epoch)) {
        setSending(false);
        void Promise.all(
          [
            "assistant",
            "nudges",
            "nudge-history",
            "catchup",
            "court",
            "thing",
            "thing-activity",
            "notifications",
            "list-things",
          ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
        );
      }
    }
  };

  return (
    <section
      className="mb-3 flex flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-[0_12px_40px_rgba(54,32,92,0.16)]"
      style={{ maxHeight: "min(58dvh, calc(100dvh - var(--magic-text-height, 22px) - 180px), 540px)" }}
      aria-label="Magic Box assistant"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-slate-100 bg-violet-50/60 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900" title={question}>
            {question}
          </p>
          <p className="text-xs text-slate-500">Coey</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={turn.running || sending}
          className="rounded-lg p-2 text-slate-400 hover:bg-violet-100 hover:text-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
          aria-label="Refresh answer"
        >
          <RefreshCw className={`h-4 w-4 ${turn.running ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-violet-100 hover:text-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500"
          aria-label="Close assistant answer"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
        {turn.running && !answer && !turn.error && (
          <div role="status" aria-live="polite">
            {turn.state.status ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {turn.state.status.text}
              </div>
            ) : slowConnect ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Connecting
              </div>
            ) : null}
            {turn.state.draft && <AnswerText text={turn.state.draft} />}
          </div>
        )}
        {turn.error && (
          <div className="flex items-start gap-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            <span className="min-w-0 flex-1">{turn.error}</span>
            <button
              type="button"
              onClick={refresh}
              className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-red-800 underline focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Try again
            </button>
          </div>
        )}
        {courtChanged && answer && !turn.running && (
          <p className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600" role="status">
            <span className="flex-1">Court changed since this answer.</span>
            <button
              type="button"
              onClick={refresh}
              className="rounded-md px-2 py-0.5 font-semibold text-violet-700 underline focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              Update answer
            </button>
          </p>
        )}
        {notice && (
          <p
            className="mb-3 rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800"
            role="status"
          >
            {notice}
          </p>
        )}
        {answer && !turn.error && (
          <>
            {answer.notice && (
              <p
                className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800"
                role="status"
              >
                {answer.notice}
              </p>
            )}
            {(shownScope?.type === "list" || shownScope?.type === "bucket") && (
              <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                <Layers className="h-3 w-3" aria-hidden="true" />
                {shownScope.label} · {shownScope.type === "list" ? "List" : "Bucket"}
              </p>
            )}
            {answer.intent === "nudge_recommendation" && recommendations.length ? (
              <p className="mb-3 text-sm text-slate-600">
                Choose a person, then select the Things you want to follow up on.
              </p>
            ) : (
              <AnswerText text={answer.answer_markdown} />
            )}
            {(answer.groups?.length ?? 0) > 0 && (
              <Suspense
                fallback={
                  <p className="mt-3 flex items-center gap-2 text-xs text-slate-500" role="status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading Things…
                  </p>
                }
              >
                <AssistantAnswerGroups
                  groups={answer.groups!}
                  answeredAt={turn.answeredAt}
                  onOpenThing={onOpenThing}
                />
              </Suspense>
            )}
            {answer.intent === "scope_selection_required" && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Choose a place">
                {(answer.scope_candidates ?? []).map((candidate) => (
                  <button
                    key={`${candidate.type}-${candidate.id}`}
                    type="button"
                    disabled={turn.running}
                    onClick={() => setChosen({ requestKey, scope: candidate })}
                    className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-left text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
                  >
                    {candidate.label} · {candidate.type === "list" ? "List" : "Bucket"}
                    {candidate.detail && (
                      <span className="block text-xs font-normal text-slate-500">
                        {candidate.detail}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {answer.intent === "person_selection_required" && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Confirm person">
                {(answer.person_candidates ?? []).map(person => (
                  <button key={person.actor_id} type="button" disabled={turn.running}
                    onClick={() => setChosenPerson({ requestKey, actorId: person.actor_id })}
                    className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-left text-sm font-semibold text-violet-700 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500">
                    {answer.person_candidates?.length === 1 ? "Yes, " : ""}{person.display_name}
                  </button>
                ))}
              </div>
            )}
            {answer.intent === "nudge_recommendation" && (
              <div className="space-y-3">
                {recommendations.map((row) => {
                  const eligibleThings = things.filter((thing) =>
                    row.eligible_thing_ids.includes(thing.id),
                  );
                  const isExpanded = expanded === row.actor_id;
                  const overdueCount = eligibleThings.filter((thing) => thing.is_overdue).length;
                  return (
                    <div
                      key={row.actor_id}
                      className={`overflow-hidden rounded-xl border ${isExpanded ? "border-violet-300" : "border-slate-200"}`}
                    >
                      <button
                        type="button"
                        disabled={sending}
                        aria-expanded={isExpanded}
                        aria-controls={`${panelId}-${row.actor_id}`}
                        onClick={() => {
                          setExpanded(isExpanded ? null : row.actor_id);
                          setSelected([]);
                          setConfirming(false);
                        }}
                        className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-violet-50/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 disabled:opacity-60"
                      >
                        <PersonAvatar
                          name={row.display_name}
                          src={row.avatar_url}
                          size={36}
                          className="ring-2 ring-white"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900">
                            {row.display_name}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {eligibleThings.length} Thing{eligibleThings.length === 1 ? "" : "s"} to
                            follow up{overdueCount ? ` · ${overdueCount} overdue` : ""}
                          </span>
                        </span>
                        <span className="text-xs font-semibold text-violet-600">
                          {isExpanded ? "Hide" : "Choose Things"}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-violet-500 transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>
                      {isExpanded && (
                        <div
                          id={`${panelId}-${row.actor_id}`}
                          className="border-t border-violet-100 bg-slate-50/60"
                        >
                          <div className="flex items-center justify-between px-4 py-2.5">
                            <span className="text-xs font-medium text-slate-500">
                              {selectedIds.length} selected
                            </span>
                            <button
                              type="button"
                              disabled={sending}
                              onClick={() => {
                                setSelected(
                                  selectedIds.length === Math.min(20, eligibleThings.length)
                                    ? []
                                    : eligibleThings.slice(0, 20).map((thing) => thing.id),
                                );
                                setConfirming(false);
                              }}
                              className="rounded px-2 py-1 text-xs font-semibold text-violet-600 hover:bg-violet-100 focus-visible:ring-2 focus-visible:ring-violet-500"
                            >
                              {selectedIds.length === Math.min(20, eligibleThings.length)
                                ? "Clear selection"
                                : eligibleThings.length > 20
                                  ? "Select first 20"
                                  : "Select all"}
                            </button>
                          </div>
                          <div className="max-h-[min(24dvh,200px)] space-y-1 overflow-y-auto overscroll-contain px-2 pb-2">
                            {eligibleThings.map((thing) => {
                              const list = thing.list_id
                                ? lists.find((candidate) => candidate.id === thing.list_id)
                                : undefined;
                              return (
                                <div
                                  key={thing.id}
                                  className={`flex items-start gap-2 rounded-lg px-2 py-2.5 ${selectedIds.includes(thing.id) ? "bg-violet-50" : "hover:bg-white"}`}
                                >
                                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.includes(thing.id)}
                                      disabled={
                                        sending ||
                                        (!selectedIds.includes(thing.id) &&
                                          selectedIds.length >= 20)
                                      }
                                      onChange={(event) => {
                                        setSelected((current) =>
                                          event.target.checked
                                            ? [...current, thing.id]
                                            : current.filter((id) => id !== thing.id),
                                        );
                                        setConfirming(false);
                                      }}
                                      className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
                                    />
                                    {list && <ListCover name={list.name} src={list.coverUrl} />}
                                    <span className="min-w-0 flex-1">
                                      <span className="block break-words text-sm font-medium leading-snug text-slate-800">
                                        {thing.title}
                                      </span>
                                      {list && (
                                        <span className="mt-0.5 block truncate text-xs font-medium text-violet-600">
                                          {list.name}
                                        </span>
                                      )}
                                      <span
                                        className={`mt-1 block text-xs ${thing.is_overdue ? "text-red-600" : "text-slate-500"}`}
                                      >
                                        {thing.is_overdue
                                          ? "Overdue"
                                          : thing.acknowledgement === "waiting_for_catch"
                                            ? "Waiting for Catch"
                                            : "Ready for a follow-up"}
                                        {thing.due_at
                                          ? ` · Due ${new Date(thing.due_at).toLocaleDateString([], { month: "short", day: "numeric", timeZone: answer.freshness.timezone })}`
                                          : ""}
                                      </span>
                                    </span>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => onOpenThing(thing.id)}
                                    className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-violet-600 focus-visible:ring-2 focus-visible:ring-violet-500"
                                    aria-label={`Open ${thing.title}`}
                                  >
                                    <ArrowUpRight className="h-4 w-4" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                          <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white px-4 py-3">
                            {confirming ? (
                              <>
                                <p className="mb-2 text-xs leading-relaxed text-slate-600">
                                  Send {selectedIds.length} nudge
                                  {selectedIds.length === 1 ? "" : "s"} to {row.display_name}? Each
                                  selected Thing receives one nudge.
                                </p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={sending || !selectedIds.length || turn.running}
                                    onClick={() => void sendNudge()}
                                    className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50"
                                  >
                                    {sending ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Send className="h-3.5 w-3.5" />
                                    )}{" "}
                                    {sending
                                      ? "Sending…"
                                      : `Confirm ${selectedIds.length} nudge${selectedIds.length === 1 ? "" : "s"}`}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={sending}
                                    onClick={() => setConfirming(false)}
                                    className="rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-100"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs text-slate-500">
                                  {selectedIds.length
                                    ? "Only your selected Things will be nudged."
                                    : "Select at least one Thing."}
                                </span>
                                <button
                                  type="button"
                                  disabled={!selectedIds.length || sending || turn.running}
                                  onClick={() => setConfirming(true)}
                                  className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-40"
                                >
                                  <Send className="h-3.5 w-3.5" /> Review {selectedIds.length || ""}{" "}
                                  nudge{selectedIds.length === 1 ? "" : "s"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {(() => {
              // One tap runs the question, so nobody has to type it.
              const offered =
                (answer.groups?.length ?? 0) > 0
                  ? []
                  : answer.intent === "unsupported" || answer.intent === "clarification"
                    ? [
                        "Who needs a nudge?",
                        "What is overdue?",
                        "What needs my attention?",
                        "What changed this week?",
                      ]
                    : [];
              return offered.length ? (
                <div
                  className="mt-3 flex flex-wrap gap-2"
                  role="group"
                  aria-label="Suggested questions"
                >
                  {offered.map((text) => (
                    <button
                      key={text}
                      type="button"
                      disabled={turn.running}
                      onClick={() => onAsk(text)}
                      className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              ) : null;
            })()}
            {answer.intent !== "nudge_recommendation" &&
              (answer.actions ?? [])
                .filter((action) => action.type !== "open_thing" && action.type !== "prepare_nudge")
                .map((action) => (
                  <AssistantActionCard
                    key={action.id}
                    ref={(handle) => {
                      if (handle) cardRefs.current.set(action.id, handle);
                      else cardRefs.current.delete(action.id);
                    }}
                    action={action}
                    onOpenThing={onOpenThing}
                    onPreview={(preview) => previews.current.set(action.id, preview)}
                    onResult={(results) => {
                      setProposal(null);
                      // Spoken only after the server has answered Confirm.
                      if (voiceActive) voice?.speak(resultText(results));
                    }}
                    onError={(message) => {
                      setProposal(null);
                      if (voiceActive) voice?.speak(`That did not work. ${message}`.slice(0, 300));
                    }}
                  />
                ))}
            {(answer.freshness.is_partial || answer.sources?.some((source) => source.kind === "activity")) && (
              <details className="mt-3 rounded-lg border border-slate-100 text-xs text-slate-500">
                <summary className="cursor-pointer rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
                  Answer details{answer.freshness.is_partial ? " · limited data" : ""}
                </summary>
                <div className="space-y-2 border-t border-slate-100 px-3 py-2">
                  {answer.freshness.is_partial && <p>{answer.freshness.partial_reason || "Some available data was outside the result limit."}</p>}
                  {(answer.sources ?? []).map((source, index) => <p key={`${source.kind}-${index}`}>{source.label} · {source.count}</p>)}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
