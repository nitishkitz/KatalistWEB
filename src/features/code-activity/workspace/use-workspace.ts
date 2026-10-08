import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { codeActivityApi } from "../live/api";
import { workspaceApi } from "../live/workspace-api";
import type { BranchInfo, CommitsPage, CompareInfo, DeploymentsPage, StatsResult } from "../live/workspace-api";
import { useLiveFeed } from "../live/use-feed";
import { applyStats, detailFromChange, fromCommit, fromDeployment, fromSaved } from "./adapt";
import { activeFilterCount, dateBounds, EMPTY_FILTERS, issuesFor, matchItem, normalizePath } from "./filters";
import type { WorkspaceFilters } from "./filters";
import { deriveCheckItems, mergeSources, sourcesFor } from "./merge";
import type { SourceState } from "./merge";
import type { WorkspaceCategory, WorkspaceDetail, WorkspaceItem } from "./types";

const message = (code: string): string =>
  code === "rate_limited" ? "GitHub is limiting requests. Try again in a moment." : code === "timed_out" ? "GitHub did not respond in time." : code === "not_allowed" ? "This is not available to you right now." : "GitHub could not be reached.";

type Phase<T> = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: T };

export type DetailPhase = { kind: "none" } | { kind: "loading"; id: string } | { kind: "error"; id: string; message: string } | { kind: "ready"; id: string; detail: WorkspaceDetail };

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MAX_KNOWN_PATHS = 60;
const STATS_FIRST = 10;

/**
 * The workspace's data: branches and comparison, three sources merged into one feed, filters, search, background stats and
 * the selected change's detail. Every request is cancelled when its inputs change, a late reply is dropped, and nothing
 * shown is ever invented: an unknown number stays unknown.
 */
export function useWorkspace(listId: string, repositoryKey: string, canRefresh: boolean) {
  const feed = useLiveFeed(listId, canRefresh);
  const scope = `${listId}|${repositoryKey}`;

  // ---- branches ------------------------------------------------------------------------------------
  const [branches, setBranches] = useState<Phase<{ defaultBranch: string | null; items: BranchInfo[]; nextCursor: string | null; complete: boolean }>>({ kind: "idle" });
  const [branch, setBranchState] = useState<string | null>(null);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [compare, setCompare] = useState<Phase<CompareInfo>>({ kind: "idle" });
  const [branchTick, setBranchTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setBranches({ kind: "loading" });
    setBranchState(null);
    setCompareBase(null);
    workspaceApi
      .branches(listId, null, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        if (!r.ok) return setBranches({ kind: "error", message: message(r.code) });
        setBranches({ kind: "ready", data: { defaultBranch: r.data.defaultBranch, items: r.data.branches, nextCursor: r.data.nextCursor, complete: r.data.complete } });
        setBranchState(r.data.defaultBranch ?? r.data.branches[0]?.name ?? null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && !(e instanceof DOMException)) setBranches({ kind: "error", message: "Branches could not be loaded." });
      });
    return () => controller.abort();
  }, [scope, listId, branchTick]);

  const loadMoreBranches = useCallback(async () => {
    if (branches.kind !== "ready" || !branches.data.nextCursor) return;
    const r = await workspaceApi.branches(listId, branches.data.nextCursor).catch(() => null);
    if (!r || !r.ok) return;
    setBranches((prev) => {
      if (prev.kind !== "ready") return prev;
      const seen = new Set(prev.data.items.map((b) => b.name));
      return { kind: "ready", data: { ...prev.data, items: [...prev.data.items, ...r.data.branches.filter((b) => !seen.has(b.name))], nextCursor: r.data.nextCursor, complete: r.data.complete } };
    });
  }, [branches, listId]);

  const defaultBranch = branches.kind === "ready" ? branches.data.defaultBranch : null;
  const setBranch = useCallback((name: string) => {
    setBranchState(name);
    setCompareBase(null);
  }, []);

  // With no base chosen, a branch is compared with the repository's default branch.
  const effectiveBase = compareBase ?? defaultBranch;
  useEffect(() => {
    if (!branch || !effectiveBase || effectiveBase === branch) {
      setCompare({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setCompare({ kind: "loading" });
    workspaceApi
      .compare(listId, branch, effectiveBase, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setCompare(r.ok ? { kind: "ready", data: r.data } : { kind: "error", message: r.status === 404 ? "One of the branches no longer exists." : message(r.code) });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && !(e instanceof DOMException)) setCompare({ kind: "error", message: "The comparison could not be loaded." });
      });
    return () => controller.abort();
  }, [listId, branch, effectiveBase]);

  // ---- filters ---------------------------------------------------------------------------------------
  const [category, setCategory] = useState<WorkspaceCategory>("all");
  const [filters, setFilters] = useState<WorkspaceFilters>(EMPTY_FILTERS);
  // Clear filters clears everything the filter row and the search box set, including the branch (back to the default).
  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    if (defaultBranch) {
      setBranchState(defaultBranch);
      setCompareBase(null);
    }
  }, [defaultBranch]);
  const issues = useMemo(() => issuesFor(filters), [filters]);

  // Commit history is filtered by GitHub where it can be (author, path, dates); everything else is filtered here.
  const push = useMemo(() => {
    const author = filters.authors.length === 1 && LOGIN.test(filters.authors[0]) ? filters.authors[0] : null;
    const path = issues.path ? null : normalizePath(filters.path).path;
    const bounds = issues.date ? { fromMs: null, toMs: null } : dateBounds(filters.dateFrom, filters.dateTo);
    return {
      author,
      path,
      since: bounds.fromMs !== null ? new Date(bounds.fromMs).toISOString() : null,
      until: bounds.toMs !== null ? new Date(bounds.toMs).toISOString() : null,
    };
  }, [filters.authors, filters.path, filters.dateFrom, filters.dateTo, issues]);
  const pushKey = JSON.stringify(push);

  // ---- commits source -----------------------------------------------------------------------------
  const [commits, setCommits] = useState<{ key: string; page: CommitsPage | null; items: WorkspaceItem[]; error: string | null; loading: boolean; loadingMore: boolean }>({ key: "", page: null, items: [], error: null, loading: false, loadingMore: false });
  const commitKey = `${scope}|${branch}|${pushKey}`;
  const [commitTick, setCommitTick] = useState(0);
  useEffect(() => {
    if (!branch) return;
    const controller = new AbortController();
    setCommits((previous) => previous.key === commitKey ? { ...previous, error: null, loading: true } : { key: commitKey, page: null, items: [], error: null, loading: true, loadingMore: false });
    workspaceApi
      .commits(listId, { branch, ...push }, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        if (!r.ok) return setCommits((previous) => ({ ...previous, error: r.status === 404 ? "This branch no longer exists." : message(r.code), loading: false, loadingMore: false }));
        setCommits({ key: commitKey, page: r.data, items: r.data.items.map((c) => fromCommit(c, branch)), error: null, loading: false, loadingMore: false });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && !(e instanceof DOMException)) setCommits((previous) => ({ ...previous, error: "Commits could not be loaded.", loading: false, loadingMore: false }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitKey, commitTick]);

  const loadMoreCommits = useCallback(async (signal: AbortSignal) => {
    if (!branch || commits.key !== commitKey || !commits.page?.nextCursor || commits.loadingMore) return true;
    const cursor = commits.page.nextCursor;
    const key = commitKey;
    setCommits((c) => ({ ...c, loadingMore: true }));
    const r = await workspaceApi.commits(listId, { branch, ...push, cursor }, signal).catch(() => null);
    if (signal.aborted) {
      setCommits((c) => c.key === key ? { ...c, loadingMore: false } : c);
      return false;
    }
    setCommits((c) => {
      if (c.key !== key) return c; // the branch or filter changed while this page was in flight
      if (!r || !r.ok) return { ...c, loadingMore: false, error: "More commits could not be loaded." };
      const seen = new Set(c.items.map((i) => i.id));
      return { ...c, page: r.data, items: [...c.items, ...r.data.items.map((x) => fromCommit(x, branch)).filter((i) => !seen.has(i.id))], loadingMore: false, error: null };
    });
    return Boolean(r?.ok);
  }, [branch, commitKey, commits, listId, push]);

  // ---- deployments source ----------------------------------------------------------------------------
  const wantsDeployments = category === "all" || category === "deployments";
  const [deployments, setDeployments] = useState<{ scope: string; page: DeploymentsPage | null; items: WorkspaceItem[]; error: string | null; loading: boolean }>({ scope: "", page: null, items: [], error: null, loading: false });
  const [deployTick, setDeployTick] = useState(0);
  useEffect(() => {
    if (!wantsDeployments) return;
    const controller = new AbortController();
    setDeployments({ scope, page: null, items: [], error: null, loading: true });
    workspaceApi
      .deployments(listId, null, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        if (!r.ok) return setDeployments({ scope, page: null, items: [], error: message(r.code), loading: false });
        setDeployments({ scope, page: r.data, items: r.data.items.map(fromDeployment), error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && !(e instanceof DOMException)) setDeployments({ scope, page: null, items: [], error: "Deployments could not be loaded.", loading: false });
      });
    return () => controller.abort();
  }, [scope, listId, wantsDeployments, deployTick]);

  const loadMoreDeployments = useCallback(async (signal: AbortSignal) => {
    if (deployments.scope !== scope || !deployments.page?.nextCursor) return true;
    const key = scope;
    const r = await workspaceApi.deployments(listId, deployments.page.nextCursor, signal).catch(() => null);
    if (signal.aborted) return false;
    setDeployments((d) => {
      if (d.scope !== key) return d;
      if (!r || !r.ok) return { ...d, error: "More deployments could not be loaded." };
      const seen = new Set(d.items.map((i) => i.id));
      return { ...d, error: null, page: r.data, items: [...d.items, ...r.data.items.map(fromDeployment).filter((i) => !seen.has(i.id))] };
    });
    return Boolean(r?.ok);
  }, [deployments.page, deployments.scope, listId, scope]);

  // ---- stats enrichment ---------------------------------------------------------------------------
  const [stats, setStats] = useState<ReadonlyMap<string, StatsResult>>(new Map());
  const asked = useRef<Set<string>>(new Set());
  useEffect(() => {
    asked.current = new Set();
    setStats(new Map());
  }, [scope]);

  // ---- merge, filter ----------------------------------------------------------------------------------
  const savedItems = useMemo(() => (feed.phase.kind === "ready" ? feed.phase.data.changes.map(fromSaved).filter((i): i is WorkspaceItem => i !== null) : []), [feed.phase]);
  const commitsCurrent = commits.key === commitKey;
  const sources: SourceState[] = useMemo(() => {
    const want = new Set(sourcesFor(category));
    // A failed source counts as read with nothing in it, so it cannot hold the other sources back.
    const out: SourceState[] = [];
    if (want.has("commits")) out.push({ loaded: branches.kind === "error" || (branches.kind === "ready" && branch === null) || (commitsCurrent && !commits.loading), items: commitsCurrent ? commits.items : [], hasMore: commitsCurrent && commits.page?.nextCursor != null });
    if (want.has("saved")) out.push({ loaded: feed.phase.kind !== "loading", items: savedItems, hasMore: feed.phase.kind === "ready" && feed.phase.nextCursor !== null });
    if (want.has("deployments")) out.push({ loaded: deployments.scope === scope && !deployments.loading, items: deployments.scope === scope ? deployments.items : [], hasMore: deployments.page?.nextCursor != null });
    return out;
  }, [category, commitsCurrent, commits, feed.phase, savedItems, deployments, scope, branches.kind, branch]);

  const [knownPaths, setKnownPaths] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
  useEffect(() => setKnownPaths(new Map()), [scope]);

  const merged = useMemo(() => {
    const base = mergeSources(sources, { progressive: true });
    const enriched = base.items.map((i) => {
      const s = stats.get(i.id);
      return s ? applyStats(i, s) : i;
    });
    // The selected branch applies to every source, not just commits: a pull request belongs to a branch when it is the
    // head or the base, a push or deployment when its ref is that branch. Rows with no branch recorded cannot be matched
    // and are left out rather than shown under the wrong branch.
    const onBranch = (i: WorkspaceItem) => branch === null || i.kind === "commit" || i.branch === branch || (i.kind === "pull_request" && i.baseBranch === branch);
    const scoped = enriched.filter(onBranch);
    const items = category === "checks" ? deriveCheckItems(scoped) : scoped;
    return { items, source: scoped, heldBack: base.heldBack, moreAvailable: base.moreAvailable };
  }, [sources, stats, category, branch]);

  const visible = useMemo(() => {
    const pathPushed = push.path !== null;
    const results = merged.items.map((item) => {
      // Commits were already filtered by path on GitHub, so they are not "unchecked".
      const effective = pathPushed && item.kind === "commit" ? { ...filters, path: "" } : filters;
      return { item, ...matchItem(item, effective, { knownPaths }) };
    });
    return { items: results.filter((r) => r.match).map((r) => r.item), unchecked: new Set(results.filter((r) => r.match && !r.pathChecked).map((r) => r.item.id)) };
  }, [merged.items, filters, knownPaths, push.path]);

  // ---- selection and detail -----------------------------------------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [scope, branch]);
  const selected = useMemo(() => merged.items.find((i) => i.id === selectedId) ?? null, [merged.items, selectedId]);

  useEffect(() => {
    if (selectedId === null || selected !== null) return;
    // A verified commit can replace its saved push wrapper when the slower commit source arrives.
    // Transfer the selection by revision, never by title or position. Category/filter changes may otherwise retire it.
    const previous = savedItems.find((i) => i.id === selectedId) ?? commits.items.find((i) => i.id === selectedId);
    const replacement = previous?.sha ? merged.items.find((i) => i.sha === previous.sha) : null;
    if (replacement) setSelectedId(replacement.id);
    else if (sources.every((s) => s.loaded)) setSelectedId(null);
  }, [selectedId, selected, savedItems, commits.items, merged.items, sources]);

  useEffect(() => {
    const need: string[] = [];
    // In Checks the rows are derived from results that must be fetched first, so ask about the underlying commits and pull
    // requests (a bounded number, a batch at a time) instead of the check rows, which have nothing to enrich yet.
    const pool = category === "checks" ? merged.source : visible.items.slice(0, STATS_FIRST);
    const candidates = [category === "checks" ? null : selected, ...pool].filter((i): i is WorkspaceItem => i !== null);
    for (const i of candidates) {
      if ((i.kind === "commit" || i.kind === "pull_request") && i.statsStatus !== "loaded" && !asked.current.has(i.id) && !need.includes(i.id)) need.push(i.id);
    }
    const first = need.slice(0, 10);
    if (first.length === 0 || asked.current.size > 150) return;
    first.forEach((id) => asked.current.add(id));
    const controller = new AbortController();
    let settled = false;
    workspaceApi
      .stats(listId, first, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        settled = true;
        if (!r.ok) return first.forEach((id) => asked.current.delete(id));
        setStats((prev) => {
          const next = new Map(prev);
          r.data.forEach((s) => next.set(s.id, s));
          return next;
        });
      })
      .catch(() => { settled = true; first.forEach((id) => asked.current.delete(id)); });
    return () => {
      controller.abort();
      if (!settled) first.forEach((id) => asked.current.delete(id)); // cancelled: allow a later retry
    };
  }, [visible.items, merged.source, category, selected, listId]);

  const [detail, setDetail] = useState<DetailPhase>({ kind: "none" });
  const [detailTick, setDetailTick] = useState(0);
  useEffect(() => {
    if (!selected) return setDetail({ kind: "none" });
    const item = selected;
    if (item.kind === "deployment") {
      setDetail({
        kind: "ready",
        id: item.id,
        detail: { kind: "deployment", id: item.id, title: item.title, body: item.deployment?.description ?? null, author: item.author, occurredAt: item.occurredAt, sha: item.sha, branch: item.branch, base: null, url: item.url, stats: null, statsComplete: false, files: [], filesPartial: false, filesUnavailableReason: null, checks: [], checkState: "none", checksRevision: null, checksPartial: false, deployment: item.deployment },
      });
      return;
    }
    const controller = new AbortController();
    setDetail({ kind: "loading", id: item.id });
    const fail = (code: string) => !controller.signal.aborted && setDetail({ kind: "error", id: item.id, message: message(code) });
    const run = async () => {
      if (item.savedId) {
        const r = await codeActivityApi.detail(listId, item.savedId, controller.signal);
        if (controller.signal.aborted) return;
        return r.ok ? setDetail({ kind: "ready", id: item.id, detail: detailFromChange(r.data) }) : fail(r.code);
      }
      if (!item.sha) return fail("source_unavailable");
      const r = await workspaceApi.commitDetail(listId, item.sha, controller.signal);
      if (controller.signal.aborted) return;
      if (!r.ok) return fail(r.code);
      setDetail({ kind: "ready", id: item.id, detail: r.data });
      setKnownPaths((prev) => {
        if (prev.size >= MAX_KNOWN_PATHS) return prev;
        return new Map(prev).set(item.id, r.data.files.map((f) => f.path));
      });
    };
    run().catch((e: unknown) => {
      if (!(e instanceof DOMException)) fail("source_unavailable");
    });
    return () => controller.abort();
  }, [selected?.id, listId, detailTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = useCallback(async () => {
    asked.current = new Set();
    setStats(new Map());
    await feed.refresh();
    setCommitTick((n) => n + 1);
    setDeployTick((n) => n + 1);
  }, [feed]);

  const sourceErrors = [
    category !== "pull_requests" && category !== "deployments" && branches.kind === "error" ? { source: "commits" as const, message: branches.message } : null,
    category !== "pull_requests" && category !== "deployments" && commitsCurrent && commits.error ? { source: "commits" as const, message: commits.error } : null,
    wantsDeployments && deployments.scope === scope && deployments.error ? { source: "deployments" as const, message: deployments.error } : null,
    feed.phase.kind === "error" ? { source: "saved" as const, message: feed.phase.message } : null,
  ].filter((e): e is { source: "commits" | "deployments" | "saved"; message: string } => e !== null);

  // One admission gate covers both the observer and the manual fallback, including same-frame double triggers.
  const pagingScope = `${commitKey}|${category}`;
  const pageRequest = useRef<AbortController | null>(null);
  const [paging, setPaging] = useState<{ key: string; loading: boolean; error: boolean }>({ key: "", loading: false, error: false });
  const loadMoreSaved = feed.loadMore;
  useEffect(() => () => {
    pageRequest.current?.abort();
    pageRequest.current = null;
  }, [pagingScope]);
  const loadMore = useCallback(async () => {
    if (pageRequest.current !== null) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setPaging({ key: pagingScope, loading: true, error: false });
    try {
      const wanted = sourcesFor(category);
      const results = await Promise.all([
        wanted.includes("commits") ? loadMoreCommits(controller.signal) : true,
        wanted.includes("saved") ? loadMoreSaved(controller.signal) : true,
        wanted.includes("deployments") ? loadMoreDeployments(controller.signal) : true,
      ]);
      if (!controller.signal.aborted) setPaging({ key: pagingScope, loading: false, error: results.some((r) => r === false) });
    } finally {
      if (pageRequest.current === controller) pageRequest.current = null;
    }
  }, [pagingScope, category, loadMoreCommits, loadMoreDeployments, loadMoreSaved]);
  const wantedPages = sourcesFor(category);
  const paginationKey = JSON.stringify([
    pagingScope,
    wantedPages.includes("commits") && commitsCurrent ? commits.page?.nextCursor : null,
    wantedPages.includes("saved") && feed.phase.kind === "ready" ? feed.phase.nextCursor : null,
    wantedPages.includes("deployments") && deployments.scope === scope ? deployments.page?.nextCursor : null,
  ]);

  return {
    feed,
    branches,
    branch,
    defaultBranch,
    setBranch,
    loadMoreBranches,
    compareBase,
    setCompareBase,
    compare,
    category,
    setCategory,
    filters,
    setFilters,
    clearFilters,
    // The branch counts as a filter once it is not the default, so Clear filters is offered for it.
    filterCount: activeFilterCount(filters) + (branch !== null && defaultBranch !== null && branch !== defaultBranch ? 1 : 0),
    issues,
    items: visible.items,
    pathUnchecked: visible.unchecked,
    totalLoaded: merged.items.length,
    heldBack: merged.heldBack,
    moreAvailable: merged.moreAvailable,
    hasMorePages: sources.some((s) => s.loaded && s.hasMore),
    loadingMore: paging.key === pagingScope && paging.loading,
    pageError: paging.key === pagingScope && paging.error,
    paginationKey,
    loading: sources.some((s) => !s.loaded),
    sourceErrors,
    commitsWindowComplete: commits.page?.windowComplete !== false,
    deploymentsPermissionNeeded: wantsDeployments && deployments.scope === scope && deployments.page?.permission === "needed",
    loadMore,
    retrySource: (s: "commits" | "deployments" | "saved") => (s === "commits" ? (branches.kind === "error" ? setBranchTick((n) => n + 1) : setCommitTick((n) => n + 1)) : s === "deployments" ? setDeployTick((n) => n + 1) : feed.reload()),
    selectedId,
    select: setSelectedId,
    selected,
    detail,
    retryDetail: () => setDetailTick((n) => n + 1),
    refreshAll,
    knownPaths,
  };
}
