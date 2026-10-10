import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { supabaseQaApi } from "./api";
import { previewQaApi, setPreviewQaUser } from "./preview-api";
import type { NumberCursor, QaApi, ScopeFilter } from "./api-types";
import { QA_PAGE_SIZE, QaOperationError, qaKeys } from "./qa-queries";
import type { QaCursor } from "./qa-queries";
import type { QaAccountInput, QaAttempt, QaCaseDraft, QaCaseFilter, QaHistoryFilter, QaRunFilter, QaRunInput, ImportStrategy, ImportRow, QaSavedView } from "./types";

/**
 * Persistent QA is available only to a signed-in, non-demo session. A demo session gets the clearly
 * marked in-memory adapter instead. A live failure never falls back to preview data.
 */
export function useQaAccess(listId: string) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const profileId = user?.id;
  useEffect(() => {
    setPreviewQaUser(preview ? (profileId ?? null) : null);
  }, [preview, profileId]);
  const api: QaApi = preview ? previewQaApi : supabaseQaApi;
  return { api, preview, profileId, available: Boolean(listId) && Boolean(profileId) };
}

const asError = (e: unknown) => (e instanceof QaOperationError ? e : e ? new QaOperationError("unknown", e instanceof Error ? e.message : "Something went wrong.") : null);

function useScoped<T>(listId: string, key: readonly unknown[], load: (api: QaApi, signal: AbortSignal) => Promise<T>, enabledExtra = true, staleTime = 15_000) {
  const { api, available, preview } = useQaAccess(listId);
  const query = useQuery({ queryKey: [...key, preview ? "preview" : "live"], queryFn: ({ signal }) => load(api, signal), enabled: available && enabledExtra, staleTime });
  return {
    data: query.data,
    isLoading: available && enabledExtra && query.isLoading,
    isPaused: available && query.fetchStatus === "paused",
    hasFetchedOnce: query.data !== undefined,
    error: asError(query.error),
    refetch: query.refetch,
  };
}

export const useQaApplications = (listId: string) => useScoped(listId, qaKeys.applications(listId), (api, s) => api.listApplications(listId, s), true, 30_000);
export const useQaEnvironments = (listId: string) => useScoped(listId, qaKeys.environments(listId), (api, s) => api.listEnvironments(listId, s), true, 30_000);
export const useQaVault = (listId: string) => useScoped(listId, qaKeys.vault(listId), (api, s) => api.vaultConfigured(s), true, 60_000);

export function useQaResources(listId: string, scope: ScopeFilter | null) {
  return useScoped(listId, qaKeys.resources(listId, scope?.applicationId ?? "", scope?.environmentId ?? ""), (api, s) => api.listResources(listId, scope as ScopeFilter, s), Boolean(scope));
}
export function useQaBuilds(listId: string, scope: { applicationId?: string; environmentId?: string } | null) {
  return useScoped(listId, qaKeys.builds(listId, scope?.applicationId ?? "", scope?.environmentId ?? ""), (api, s) => api.listBuilds(listId, scope ?? {}, s), Boolean(scope));
}
export function useQaAccounts(listId: string, scope: ScopeFilter | null) {
  return useScoped(listId, qaKeys.accounts(listId, scope?.applicationId ?? "", scope?.environmentId ?? ""), (api, s) => api.listAccounts(listId, scope as ScopeFilter, s), Boolean(scope));
}
export function useQaAccountAccess(listId: string) {
  const { profileId } = useQaAccess(listId);
  return useScoped(listId, qaKeys.access(listId, profileId), (api, s) => api.listAccountAccess(listId, s), true, 5_000);
}
export function useQaAccountGrants(listId: string, accountId: string | null) {
  return useScoped(listId, qaKeys.grants(listId, accountId ?? ""), (api, s) => api.getAccountGrants(listId, accountId as string, s), Boolean(accountId), 0);
}

function useQaInfinite<T, C>(listId: string, key: readonly unknown[], load: (api: QaApi, cursor: C | undefined, signal: AbortSignal) => Promise<{ items: T[]; nextCursor: C | undefined }>, enabledExtra = true) {
  const { api, available, preview } = useQaAccess(listId);
  const query = useInfiniteQuery({
    queryKey: [...key, preview ? "preview" : "live"],
    queryFn: ({ pageParam, signal }) => load(api, pageParam as C | undefined, signal),
    initialPageParam: undefined as C | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: available && enabledExtra,
    staleTime: 10_000,
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  return {
    items,
    isLoading: available && enabledExtra && query.isLoading,
    isFetching: query.isFetching,
    isPaused: available && query.fetchStatus === "paused",
    hasFetchedOnce: query.data !== undefined,
    error: asError(query.error),
    isFetchNextPageError: query.isFetchNextPageError,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export const useQaCases = (listId: string, filter: QaCaseFilter) =>
  useQaInfinite<import("./types").QaCase, NumberCursor>(listId, qaKeys.cases(listId, filter), (api, c, s) => api.listCases(listId, filter, c, QA_PAGE_SIZE, s));
export const useQaRuns = (listId: string) =>
  useQaInfinite<import("./types").QaRun, QaCursor>(listId, qaKeys.runs(listId), (api, c, s) => api.listRuns(listId, c, QA_PAGE_SIZE, s));
export const useQaRunCases = (listId: string, runId: string | null, filter: QaRunFilter) =>
  useQaInfinite<import("./types").QaRunCase, NumberCursor>(listId, qaKeys.runCases(listId, runId ?? "", filter), (api, c, s) => api.listRunCases(listId, runId as string, filter, c, QA_PAGE_SIZE, s), Boolean(runId));
export const useQaHistory = (listId: string, filter: QaHistoryFilter) =>
  useQaInfinite<import("./types").QaHistoryItem, QaCursor>(listId, qaKeys.history(listId, filter), (api, c, s) => api.listHistory(listId, filter, c, QA_PAGE_SIZE, s));

export const useQaRun = (listId: string, runId: string | null) => useScoped(listId, qaKeys.run(listId, runId ?? ""), (api, s) => api.getRun(listId, runId as string, s), Boolean(runId));
export const useQaTotals = (listId: string, runId: string | null) => useScoped(listId, qaKeys.totals(listId, runId ?? ""), (api, s) => api.getTotals(listId, runId as string, s), Boolean(runId), 3_000);
export const useQaAttempts = (listId: string, runCaseId: string | null) => useScoped(listId, qaKeys.attempts(listId, runCaseId ?? ""), (api, s) => api.listAttempts(listId, runCaseId as string, s), Boolean(runCaseId), 3_000);
export const useQaThingLinks = (listId: string) => useScoped(listId, qaKeys.links(listId), (api, s) => api.listThingLinks(listId, s), true, 5_000);
export function useQaSavedViews(listId: string) {
  const { profileId } = useQaAccess(listId);
  return useScoped(listId, qaKeys.views(listId, profileId), (api, s) => api.listSavedViews(listId, s), true, 30_000);
}
export function useQaEvidence(listId: string, attemptIds: readonly string[]) {
  const ids = useMemo(() => [...attemptIds].sort(), [attemptIds]);
  return useScoped(listId, qaKeys.evidence(listId, ids), (api, s) => api.listEvidence(listId, ids, s), ids.length > 0, 3_000);
}
/** Short-lived signed read URLs. Kept in query cache only for their short validity; never persisted. */
export function useQaEvidenceUrls(listId: string, evidenceIds: readonly string[]) {
  const ids = useMemo(() => [...evidenceIds].sort(), [evidenceIds]);
  return useScoped(listId, qaKeys.evidenceUrls(listId, ids), (api, s) => api.signEvidence(ids, s), ids.length > 0, 4 * 60_000);
}

/**
 * Mutations capture the identity epoch before the request and only invalidate caches when that
 * identity is still current, so a late completion after sign-out or an account switch cannot touch
 * the new identity's cache.
 */
export function useQaMutations(listId: string) {
  const qc = useQueryClient();
  const { api, available } = useQaAccess(listId);

  const guarded = <TVars, TData>(fn: (vars: TVars) => Promise<TData>, invalidate: (data: TData, vars: TVars) => void) => ({
    mutationFn: async (vars: TVars) => {
      if (!available) throw new QaOperationError("unavailable", "QA is unavailable in this session.");
      return fn(vars);
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (data: TData, vars: TVars, ctx: { epoch: number } | undefined) => {
      if (ctx && isEpochCurrent(qc, ctx.epoch)) invalidate(data, vars);
    },
  });
  const inv = (key: readonly unknown[]) => void qc.invalidateQueries({ queryKey: key });
  const refreshScope = () => {
    inv(qaKeys.applications(listId));
    inv(qaKeys.environments(listId));
    inv([...qaKeys.list(listId), "resources"]);
    inv(qaKeys.buildsPrefix(listId));
    inv(qaKeys.accountsPrefix(listId));
  };
  const refreshRuns = () => {
    inv(qaKeys.runs(listId));
    inv(qaKeys.runCasesPrefix(listId));
    inv([...qaKeys.list(listId), "totals"]);
    inv([...qaKeys.list(listId), "run"]);
    inv(qaKeys.historyPrefix(listId));
    inv(qaKeys.links(listId));
    inv([...qaKeys.list(listId), "attempts"]);
  };

  return {
    upsertApplication: useMutation(guarded((v: Parameters<QaApi["upsertApplication"]>[1]) => api.upsertApplication(listId, v), refreshScope)),
    upsertEnvironment: useMutation(guarded((v: Parameters<QaApi["upsertEnvironment"]>[1]) => api.upsertEnvironment(listId, v), refreshScope)),
    upsertResource: useMutation(guarded((v: Parameters<QaApi["upsertResource"]>[1]) => api.upsertResource(listId, v), refreshScope)),
    registerBuild: useMutation(guarded((v: Parameters<QaApi["registerBuild"]>[1]) => api.registerBuild(listId, v), refreshScope)),
    saveAccount: useMutation(guarded((v: QaAccountInput) => api.saveAccount(listId, v), (_d, v) => {
      refreshScope();
      inv(qaKeys.access(listId, undefined).slice(0, 3));
      if (v.id) inv(qaKeys.grants(listId, v.id));
    })),
    archiveAccount: useMutation(guarded((v: { accountId: string; archived: boolean }) => api.archiveAccount(v.accountId, v.archived), refreshScope)),
    saveCase: useMutation(guarded((v: QaCaseDraft) => api.saveCase(listId, v), () => inv(qaKeys.casesPrefix(listId)))),
    archiveCase: useMutation(guarded((v: { caseId: string; archived: boolean }) => api.archiveCase(v.caseId, v.archived), () => inv(qaKeys.casesPrefix(listId)))),
    bulkUpdate: useMutation(guarded((v: { caseIds: string[]; patch: Parameters<QaApi["bulkUpdateCases"]>[1] }) => api.bulkUpdateCases(v.caseIds, v.patch), () => inv(qaKeys.casesPrefix(listId)))),
    importCases: useMutation(guarded((v: { rows: ImportRow[]; strategy: ImportStrategy; atomic: boolean }) => api.importCases(listId, v.rows, v.strategy, v.atomic), () => inv(qaKeys.casesPrefix(listId)))),
    saveView: useMutation(guarded((v: Pick<QaSavedView, "viewKind" | "name" | "config">) => api.saveView(listId, v), () => inv([...qaKeys.list(listId), "views"]))),
    deleteView: useMutation(guarded((viewId: string) => api.deleteView(viewId), () => inv([...qaKeys.list(listId), "views"]))),
    createRun: useMutation(guarded((v: QaRunInput) => api.createRun(listId, v), refreshRuns)),
    createRetestRun: useMutation(guarded((v: { predecessorRunId: string; buildId: string; name: string; idempotencyKey: string }) => api.createRetestRun(v.predecessorRunId, v.buildId, v.name, v.idempotencyKey), refreshRuns)),
    recordAttempt: useMutation(guarded((v: { runCaseId: string; status: QaAttempt["status"]; actual: string; idempotencyKey: string }) => api.recordAttempt(v.runCaseId, v.status, v.actual, v.idempotencyKey), refreshRuns)),
    completeRun: useMutation(guarded((v: { runId: string; blocked: boolean; notRun: boolean }) => api.completeRun(v.runId, { blocked: v.blocked, notRun: v.notRun }), refreshRuns)),
    uploadEvidence: useMutation(guarded((v: { attemptId: string; file: File; signal?: AbortSignal }) => api.uploadEvidence(v.attemptId, v.file, v.signal), () => { inv(qaKeys.evidencePrefix(listId)); inv(qaKeys.historyPrefix(listId)); })),
    linkThing: useMutation(guarded((v: { runCaseId: string; attemptId: string | null; thingId: string }) => api.linkThing(v.runCaseId, v.attemptId, v.thingId), () => { inv(qaKeys.links(listId)); inv(qaKeys.runCasesPrefix(listId)); inv(qaKeys.historyPrefix(listId)); })),
    unlinkThing: useMutation(guarded((linkId: string) => api.unlinkThing(linkId), () => { inv(qaKeys.links(listId)); inv(qaKeys.runCasesPrefix(listId)); })),
  };
}
