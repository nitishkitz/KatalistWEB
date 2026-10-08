import { useCallback, useEffect, useRef, useState } from "react";
import { codeActivityApi } from "./api";
import type { ApiResult } from "./api";
import { mergeRepositoryPages, parseReturnOutcome } from "./parse";
import type { AiStatus, ConnectionView, ProofRepository, ReturnOutcome } from "./parse";

export type ConnectionPhase =
  | { kind: "loading" }
  /** The feature is not available for this List (or the caller): neutral, no detail about why. */
  | { kind: "unavailable" }
  /** The feature is on for this List but the operator has not finished setting up GitHub. */
  | { kind: "setup_pending" }
  | { kind: "error"; message: string }
  | { kind: "ready"; connection: ConnectionView }
  | { kind: "selecting"; repositories: ProofRepository[] | null; nextCursor: string | null; loadingMore: boolean };

export interface ConnectionNotice {
  tone: "info" | "warn" | "bad";
  text: string;
}

const OUTCOME_NOTICE: Partial<Record<ReturnOutcome, ConnectionNotice>> = {
  denied: { tone: "warn", text: "GitHub authorization was cancelled. Nothing was connected." },
  error: { tone: "bad", text: "GitHub authorization could not be completed. Nothing was connected. Try again." },
  too_many: { tone: "warn", text: "This GitHub account reaches too many repositories. Install the GitHub App on selected repositories only, then try again." },
  continue: { tone: "info", text: "GitHub access was updated. Continue to choose a repository." },
  timed_out: { tone: "warn", text: "GitHub did not respond in time. Nothing was connected. Try again." },
};

function failureText(code: string): string {
  if (code === "rate_limited") return "Too many attempts. Try again in a few minutes.";
  if (code === "already_connected") return "A repository is already connected to this List.";
  if (code === "not_allowed" || code === "disabled") return "This action is not available.";
  if (code === "timed_out") return "GitHub did not respond in time. Try again.";
  return "GitHub could not be reached. Try again.";
}

/**
 * Connection flow state for one List. Requests are cancelled on List change, a failure stays inside this
 * feature, and nothing is invented: every state comes from a validated server reply.
 */
export function useConnection(listId: string, isOwner: boolean) {
  const [phase, setPhase] = useState<ConnectionPhase>({ kind: "loading" });
  const [notice, setNotice] = useState<ConnectionNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus>({ available: false, consent: false });
  const [tick, setTick] = useState(0);
  const outcome = useRef<ReturnOutcome | null>(null);

  useEffect(() => {
    // Read once, then remove the parameter so a reload does not repeat it.
    if (typeof window === "undefined") return;
    const found = parseReturnOutcome(window.location.search);
    if (!found) return;
    outcome.current = found;
    const url = new URL(window.location.href);
    url.searchParams.delete("codeActivity");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [listId]);

  useEffect(() => {
    const controller = new AbortController();
    setPhase({ kind: "loading" });
    setActionError(null);
    (async () => {
      const caps = await codeActivityApi.capabilities(listId, controller.signal);
      if (controller.signal.aborted) return;
      if (!caps.ok) return setPhase({ kind: "error", message: failureText(caps.code) });
      // Two different truths, two different messages: "not available for this List" and "operator setup unfinished".
      if (!caps.data.enabled) return setPhase({ kind: "unavailable" });
      if (!caps.data.configured) return setPhase({ kind: "setup_pending" });
      setAi(caps.data.ai);
      const returned = outcome.current;
      outcome.current = null;
      if (returned === "select" && isOwner) {
        setPhase({ kind: "selecting", repositories: null, nextCursor: null, loadingMore: false });
        const repos = await codeActivityApi.repositories(listId, controller.signal);
        if (controller.signal.aborted) return;
        if (repos.ok) return setPhase({ kind: "selecting", repositories: repos.data.items, nextCursor: repos.data.nextCursor, loadingMore: false });
        setNotice({ tone: "bad", text: "The repository list could not be loaded. Try connecting again." });
      } else if (returned) {
        setNotice(OUTCOME_NOTICE[returned] ?? null);
      }
      const connection = await codeActivityApi.connection(listId, controller.signal);
      if (controller.signal.aborted) return;
      if (!connection.ok) return setPhase({ kind: "error", message: failureText(connection.code) });
      setPhase({ kind: "ready", connection: connection.data });
    })().catch((error: unknown) => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setPhase({ kind: "error", message: "Code Activity could not be loaded." });
    });
    return () => controller.abort();
  }, [listId, isOwner, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const run = useCallback(async <T>(action: () => Promise<ApiResult<T>>, onOk: (data: T) => void) => {
    setBusy(true);
    setActionError(null);
    const result = await action().catch(() => ({ ok: false as const, status: 0, code: "source_unavailable" }));
    setBusy(false);
    if (result.ok) onOk(result.data);
    else setActionError(failureText(result.code));
  }, []);

  /** Starts GitHub authorization or installation. Navigates away to github.com on success. */
  const startFlow = useCallback(
    (flow: "oauth" | "install") => run(() => codeActivityApi.start(listId, flow), (url) => window.location.assign(url)),
    [listId, run],
  );

  const connectProof = useCallback(
    (proofId: string) => run(() => codeActivityApi.connect(listId, proofId), () => reload()),
    [listId, reload, run],
  );

  /** Fetches the next page of verified repositories and appends it. A failure keeps what is already listed. */
  const loadMore = useCallback(async () => {
    if (phase.kind !== "selecting" || phase.repositories === null || phase.nextCursor === null || phase.loadingMore) return;
    const { nextCursor, repositories } = phase;
    setActionError(null);
    setPhase({ ...phase, loadingMore: true });
    const page = await codeActivityApi.repositories(listId, undefined, nextCursor).catch(() => null);
    if (page && page.ok) {
      setPhase({ kind: "selecting", repositories: mergeRepositoryPages(repositories, page.data.items), nextCursor: page.data.nextCursor, loadingMore: false });
    } else {
      setPhase({ kind: "selecting", repositories, nextCursor, loadingMore: false });
      setActionError("More repositories could not be loaded. Try again.");
    }
  }, [listId, phase]);

  /** Owner only. The database re-checks; the new value is shown only after the server confirms it. */
  const setConsent = useCallback(
    (enabled: boolean) => run(() => codeActivityApi.setConsent(listId, enabled), (value) => setAi((prev) => ({ ...prev, consent: value }))),
    [listId, run],
  );

  const disconnect = useCallback(() => run(() => codeActivityApi.disconnect(listId), () => reload()), [listId, reload, run]);

  return { phase, notice, busy, actionError, ai, setConsent, startFlow, connectProof, loadMore, disconnect, reload, cancelSelecting: reload };
}
