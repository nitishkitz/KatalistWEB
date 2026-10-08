import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityChange, ActivityFeedData, AssigneeCandidate } from "../types";
import { codeActivityApi } from "./api";

export type FeedPhase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ActivityFeedData; nextCursor: string | null; connectionStatus: string };

const message = (code: string): string =>
  code === "rate_limited"
    ? "Too many requests. Try again in a moment."
    : code === "busy"
      ? "A refresh is already running."
      : code === "timed_out"
        ? "GitHub did not respond in time."
        : code === "not_allowed" || code === "disabled"
          ? "This is not available to you right now."
          : "GitHub could not be reached.";

/**
 * The live feed for one List: saved rows from Katalist, a manual Refresh that asks the server to read
 * GitHub, and paging. Requests are cancelled on List change. A failed Refresh or page never discards rows
 * already shown. No fixture is ever used.
 */
export function useLiveFeed(listId: string, canRefresh: boolean) {
  const [phase, setPhase] = useState<FeedPhase>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const autoSynced = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setNotice(null);
    codeActivityApi
      .feed(listId, null, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) setPhase({ kind: "ready", data: result.data.data, nextCursor: result.data.nextCursor, connectionStatus: result.data.connectionStatus });
        else setPhase((prev) => (prev.kind === "ready" ? prev : { kind: "error", message: message(result.code) }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setPhase((prev) => (prev.kind === "ready" ? prev : { kind: "error", message: "Activity could not be loaded." }));
      });
    return () => controller.abort();
  }, [listId, tick]);

  const reload = useCallback(() => {
    // A retry of an empty failed read needs immediate feedback; a reload with saved rows must not blank them.
    setPhase((previous) => previous.kind === "ready" ? previous : { kind: "loading" });
    setTick((n) => n + 1);
  }, []);

  /** Reads GitHub through the server, then reloads the saved rows. Existing rows stay visible throughout. */
  const refresh = useCallback(async () => {
    if (!canRefresh) return;
    setRefreshing(true);
    setNotice(null);
    const result = await codeActivityApi.refresh(listId).catch(() => ({ ok: false as const, status: 0, code: "source_unavailable" }));
    if (!result.ok) setNotice(`Refresh did not finish. ${message(result.code)} Showing saved activity.`);
    setRefreshing(false);
    reload();
  }, [canRefresh, listId, reload]);

  // The first time a List is opened with nothing synced yet, run one refresh so the owner sees real activity.
  useEffect(() => {
    if (phase.kind !== "ready" || !canRefresh || phase.data.freshness.lastSyncedAt !== null) return;
    if (phase.connectionStatus !== "active" || autoSynced.current === listId) return;
    autoSynced.current = listId;
    void refresh();
  }, [phase, canRefresh, listId, refresh]);

  const loadMore = useCallback(async (signal?: AbortSignal) => {
    if (phase.kind !== "ready" || phase.nextCursor === null || loadingMore) return true;
    setLoadingMore(true);
    const page = await codeActivityApi.feed(listId, phase.nextCursor, signal).catch(() => null);
    setLoadingMore(false);
    if (signal?.aborted) return false;
    if (!page || !page.ok) { setNotice("More activity could not be loaded. Try again."); return false; }
    setNotice(null);
    setPhase((previous) => {
      if (previous.kind !== "ready" || previous.nextCursor !== phase.nextCursor) return previous;
      const seen = new Set(previous.data.changes.map((c) => c.id));
      const more = page.data.data.changes.filter((c) => !seen.has(c.id));
      return { ...previous, data: { ...previous.data, changes: [...previous.data.changes, ...more] }, nextCursor: page.data.nextCursor };
    });
    return true;
  }, [listId, loadingMore, phase]);

  return { phase, refreshing, loadingMore, notice, refresh, loadMore, reload };
}

export type DetailPhase = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; change: ActivityChange };

/** One change's description, files, patches and checks. Cancelled when another change is chosen. */
export function useChangeDetail(listId: string, changeId: string) {
  const [phase, setPhase] = useState<DetailPhase>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPhase({ kind: "loading" });
    codeActivityApi
      .detail(listId, changeId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setPhase(result.ok ? { kind: "ready", change: result.data } : { kind: "error", message: message(result.code) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setPhase({ kind: "error", message: "The change could not be loaded." });
      });
    return () => controller.abort();
  }, [listId, changeId, tick]);
  return { phase, retry: useCallback(() => setTick((n) => n + 1), []) };
}

/** The owner and current collaborators who can be assigned, loaded once for people who may create Things. */
export function useAssigneeCandidates(listId: string, enabled: boolean) {
  const [state, setState] = useState<{ listId: string; candidates: AssigneeCandidate[]; loading: boolean; error: string | null; retryable: boolean }>({ listId, candidates: [], loading: enabled, error: null, retryable: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState({ listId, candidates: [], loading: false, error: null, retryable: false });
      return;
    }
    const controller = new AbortController();
    setState({ listId, candidates: [], loading: true, error: null, retryable: false });
    const fail = (code: string) => {
      if (controller.signal.aborted) return;
      const permanent = code === "not_configured" || code === "not_allowed" || code === "disabled";
      const error = code === "not_configured"
        ? "Creating Things from Code Activity is not set up yet. Katalist’s operator needs to enable the database functions."
        : code === "not_allowed" || code === "disabled"
          ? "Assignees are not available for this action. Check your List access with the owner."
          : "List assignees could not be loaded. Try again; your draft is kept.";
      setState({ listId, candidates: [], loading: false, error, retryable: !permanent });
    };
    codeActivityApi
      .candidates(listId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) return fail(result.code);
        if (result.data.length === 0) {
          setState({ listId, candidates: [], loading: false, error: "No eligible List assignees were returned. Ask the List owner to check membership.", retryable: true });
          return;
        }
        setState({ listId, candidates: result.data, loading: false, error: null, retryable: false });
      })
      .catch(() => {
        fail("source_unavailable");
      });
    return () => controller.abort();
  }, [listId, enabled, tick]);
  const current = enabled && state.listId === listId ? state : { candidates: [], loading: enabled, error: null, retryable: false };
  return { ...current, retry: useCallback(() => setTick((n) => n + 1), []) };
}
