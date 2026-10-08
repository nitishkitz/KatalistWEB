import { boundPatch, deriveCheckState } from "../format";
import { CODE_ACTIVITY_LIMITS } from "../limits";
import { parseActivityChange } from "../types";
import type { ChangeFile, CheckRun, CheckState } from "../types";
import { createMeter } from "./budget.server";
import { GITHUB_LIMITS, GitHubError } from "./github.server";
import type { ChecksRead, CommitDetail, PullRequestSummary, PushSummary, RawFile } from "./github-read.server";
import { failure, isUuid, mapGitHubError, mapRpcError } from "./service.server";
import type { Deps, RpcClient, ServiceResult } from "./service.server";

/**
 * Real activity (G07 to G09): manual Refresh, the feed, and one change's detail. Authorization always
 * comes first (user-scoped database function), then the connection is read through a server-only function,
 * and only then does any GitHub request happen. Failures never fall back to sample data.
 */

export const ACTIVITY_LIMITS = {
  /** Most recent rows whose check state is read during a refresh. */
  checkReads: 15,
  /** Whole refresh, across every provider request. PROVISIONAL. */
  refreshDeadlineMs: 40_000,
  /** One change's detail. PROVISIONAL. */
  detailDeadlineMs: 20_000,
  /** Total patch text returned for one change (512 KiB). */
  patchTotalBytes: 524_288,
  feedPage: 25,
} as const;

const NIL_UUID_MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// ---- pure helpers (exported for tests) -------------------------------------------------------------

export interface FeedItem {
  kind: "pull_request" | "push";
  provider_key: string;
  pr_number?: number;
  pr_state?: string;
  title: string;
  head_sha: string;
  before_sha?: string;
  head_ref: string | null;
  base_ref?: string | null;
  author_login: string | null;
  author_kind: string;
  source_url: string | null;
  provider_updated_at: string;
  last_activity_at: string;
  check_state?: string;
  checks_revision?: string;
}

export function pullRequestItem(p: PullRequestSummary): FeedItem {
  return {
    kind: "pull_request",
    provider_key: String(p.number),
    pr_number: p.number,
    pr_state: p.state,
    title: p.title.slice(0, CODE_ACTIVITY_LIMITS.feedTitleMax),
    head_sha: p.headSha,
    head_ref: p.headRef,
    base_ref: p.baseRef,
    author_login: p.authorLogin,
    author_kind: p.authorKind,
    source_url: p.url,
    provider_updated_at: p.updatedAt,
    last_activity_at: p.updatedAt,
  };
}

export function pushItem(p: PushSummary, fullName: string): FeedItem {
  return {
    kind: "push",
    provider_key: p.key,
    title: `Push to ${p.branch}`.slice(0, CODE_ACTIVITY_LIMITS.feedTitleMax),
    head_sha: p.after,
    before_sha: p.before,
    head_ref: p.branch,
    author_login: p.authorLogin,
    author_kind: p.authorKind,
    source_url: `https://github.com/${fullName}/commit/${p.after}`,
    provider_updated_at: p.timestamp,
    last_activity_at: p.timestamp,
  };
}

/** Newest first, as the feed shows them. Ties break on the key so the order is stable. */
export function sortByActivity<T extends { last_activity_at: string; provider_key: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at) || (a.provider_key < b.provider_key ? -1 : 1));
}

export function toChangeFile(file: RawFile, state: { bytes: number }): ChangeFile {
  const base = { path: file.path, status: file.status, additions: file.additions, deletions: file.deletions };
  if (file.patch === null) {
    // GitHub sends no patch for binary files, very large diffs, or pure renames. Say only what is known.
    const noTextChange = file.additions === 0 && file.deletions === 0 && (file.status === "renamed" || file.status === "removed");
    return { ...base, patchState: noTextChange ? "empty" : "unavailable", patch: null };
  }
  const bounded = boundPatch(file.patch);
  if (bounded.text === null) return { ...base, patchState: bounded.state, patch: null };
  const size = new TextEncoder().encode(bounded.text).length;
  if (state.bytes + size > ACTIVITY_LIMITS.patchTotalBytes) return { ...base, patchState: "omitted", patch: null };
  state.bytes += size;
  return { ...base, patchState: bounded.state, patch: bounded.text };
}

export function toChangeFiles(files: readonly RawFile[]): ChangeFile[] {
  const state = { bytes: 0 };
  return files.slice(0, CODE_ACTIVITY_LIMITS.filesMax).map((f) => toChangeFile(f, state));
}

/**
 * One honest check state for a revision. A failing or pending check is shown whatever else is missing,
 * but "passed" or "none" is claimed only when every source was read in full.
 */
export function checkStateFor(read: Pick<ChecksRead, "runs" | "complete">): CheckState {
  const known = deriveCheckState(read.runs);
  if (known === "failing" || known === "pending") return known;
  return read.complete ? known : "unavailable";
}

const sumOrNull = (files: readonly RawFile[], key: "additions" | "deletions"): number | null =>
  files.some((f) => f[key] === null) ? null : files.reduce((total, f) => total + (f[key] as number), 0);

// ---- E18 manual refresh and scheduled reconcile -----------------------------------------------------

export interface RefreshLease {
  connectionId: string;
  generation: number;
  leaseToken: string;
}

export async function refresh(deps: Deps, input: { user: RpcClient; listId: string }): Promise<ServiceResult> {
  if (!deps.config.configured || !deps.github) return failure("not_configured");
  if (!isUuid(input.listId)) return failure("invalid_request");

  // 1. Authorization and the lease come from the database, as the caller.
  const begun = await input.user.rpc("code_activity_begin_refresh", { p_list_id: input.listId });
  if (begun.error) return failure(mapRpcError(begun.error));
  const row = Array.isArray(begun.data) ? (begun.data[0] as { o_connection_id?: string; o_generation?: number; o_lease_token?: string } | undefined) : undefined;
  if (!row || !isUuid(row.o_connection_id) || !isUuid(row.o_lease_token) || typeof row.o_generation !== "number") {
    return failure("source_unavailable");
  }
  return runRefresh(deps, { listId: input.listId, lease: { connectionId: row.o_connection_id, generation: row.o_generation, leaseToken: row.o_lease_token }, interactive: true });
}

/** The provider read and write-back of a refresh. Shared by the user's Refresh and the scheduled reconcile. */
export async function runRefresh(deps: Deps, input: { listId: string; lease: RefreshLease; interactive: boolean }): Promise<ServiceResult> {
  if (!deps.config.configured || !deps.github) return failure("not_configured");
  const { lease, listId } = input;
  const finish = (status: "ok" | "partial" | "unavailable", fullName: string | null, items: FeedItem[] | null) =>
    deps.admin().rpc("code_activity_server_finish_refresh", {
      p_connection_id: lease.connectionId,
      p_generation: lease.generation,
      p_lease_token: lease.leaseToken,
      p_status: status,
      p_full_name: fullName,
      p_items: items,
    });

  let fullName: string | null = null;
  try {
    // 2. The connection (installation and repository) is read server-side, only while active and generation-matched.
    const conn = await deps.admin().rpc("code_activity_server_connection_for_provider", { p_list_id: listId, p_expected_generation: lease.generation, p_expected_connection_id: lease.connectionId });
    const row = Array.isArray(conn.data) ? (conn.data[0] as { o_installation_id?: number | string; o_repository_id?: number | string } | undefined) : undefined;
    const installationId = Number(row?.o_installation_id);
    const repositoryId = Number(row?.o_repository_id);
    if (conn.error || !row || !Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId)) {
      await finish("unavailable", null, null);
      return failure(conn.error ? mapRpcError(conn.error) : "not_allowed");
    }

    // 3. Read from GitHub with a token narrowed to this repository, inside one total time budget.
    // Every request below is counted against the installation's hourly budget (interactive reads have their own reserve),
    // including token minting and each page. When the budget is spent no further request is made.
    const github = deps.github.withDeadline(deps.refreshDeadlineMs ?? ACTIVITY_LIMITS.refreshDeadlineMs).withMeter(createMeter(deps.admin, installationId, input.interactive));
    const token = (await github.mintInstallationToken({ installationId, repositoryId })).token;
    fullName = await github.resolveRepository(token, repositoryId);
    if (fullName === null) {
      await finish("unavailable", null, null);
      return failure("source_unavailable");
    }
    const prs = await github.listPullRequests(token, fullName);
    let partial = false;
    let pushes: PushSummary[] = [];
    try {
      const read = await github.listPushes(token, fullName);
      pushes = read.pushes;
      if (read.skipped > 0) partial = true; // some entries could not be understood: shown as a partial sync
    } catch (error) {
      // Push history is best effort: a missing or unreadable activity feed must not hide pull requests.
      if (error instanceof GitHubError && (error.kind === "timeout" || error.kind === "rate_limited")) throw error;
      partial = true;
    }
    const items = sortByActivity<FeedItem>([...prs.map(pullRequestItem), ...pushes.map((p) => pushItem(p, fullName as string))]).slice(0, 200);

    // 4. Check state for the most recent rows only (bounded). Others stay "unavailable" until opened.
    for (const item of items.slice(0, ACTIVITY_LIMITS.checkReads)) {
      try {
        const checks = await github.listChecks(token, fullName, item.head_sha);
        item.check_state = checkStateFor(checks);
        item.checks_revision = item.head_sha;
        if (!checks.complete) partial = true;
      } catch (error) {
        if (error instanceof GitHubError && (error.kind === "timeout" || error.kind === "rate_limited")) throw error;
        partial = true;
      }
    }

    const done = await finish(partial ? "partial" : "ok", fullName, items);
    if (done.error) return failure(mapRpcError(done.error));
    if (done.data !== true) return failure("not_allowed"); // the lease or generation changed under us
    return { status: 200, body: { syncStatus: partial ? "partial" : "ok", pullRequests: prs.length, pushes: pushes.length } };
  } catch (error) {
    // A failed refresh keeps the last good rows; it only records that GitHub was unavailable. A rate limit also
    // blocks the installation until GitHub says it may be used again.
    if (error instanceof GitHubError && error.kind === "rate_limited") {
      const conn = await deps.admin().rpc("code_activity_server_connection_for_provider", { p_list_id: listId, p_expected_generation: lease.generation, p_expected_connection_id: lease.connectionId });
      const installation = Array.isArray(conn.data) ? Number((conn.data[0] as { o_installation_id?: number | string } | undefined)?.o_installation_id) : NaN;
      if (Number.isSafeInteger(installation)) {
        await Promise.resolve(deps.admin().rpc("code_activity_server_block_installation", { p_installation_id: installation, p_seconds: error.retryAfterSeconds ?? 60 })).catch(() => undefined);
      }
    }
    await Promise.resolve(finish("unavailable", null, null)).catch(() => undefined);
    return failure(mapGitHubError(error));
  }
}

// ---- E7 feed --------------------------------------------------------------------------------------

const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\|([0-9a-f-]{36})$/i;
export const encodeCursor = (at: string, id: string) => `${at}|${id}`;

export async function feed(input: { user: RpcClient; listId: string; cursor?: string | null }): Promise<ServiceResult> {
  if (!isUuid(input.listId)) return failure("invalid_request");
  let beforeAt: string | null = null;
  let beforeId: string | null = null;
  if (input.cursor) {
    const match = CURSOR.exec(input.cursor);
    if (!match || !isUuid(match[2]) || Number.isNaN(Date.parse(match[1]))) return failure("invalid_request");
    beforeAt = match[1];
    beforeId = match[2];
  }
  const [rows, status] = await Promise.all([
    input.user.rpc("code_activity_feed", { p_list_id: input.listId, p_before_at: beforeAt, p_before_id: beforeId ?? (beforeAt ? NIL_UUID_MAX : null), p_limit: ACTIVITY_LIMITS.feedPage }),
    input.user.rpc("code_activity_connection_status", { p_list_id: input.listId }),
  ]);
  if (rows.error) return failure(mapRpcError(rows.error));
  if (status.error) return failure(mapRpcError(status.error));
  const connection = Array.isArray(status.data) ? (status.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!connection || (connection.status !== "active" && connection.status !== "suspended") || connection.needs_reverification === true) return failure("not_allowed");
  const list = Array.isArray(rows.data) ? (rows.data as Array<Record<string, unknown>>) : [];

  const changes = list.map((r) => {
    const headSha = typeof r.head_sha === "string" ? r.head_sha : null;
    const revision = typeof r.checks_revision === "string" ? r.checks_revision : null;
    const login = typeof r.author_login === "string" ? r.author_login : null;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      number: typeof r.pr_number === "number" ? r.pr_number : null,
      prState: r.kind === "pull_request" ? r.pr_state : null,
      author: { name: login ?? "Unknown author", kind: login === null ? "unknown" : r.author_kind },
      headBranch: r.head_ref ?? null,
      baseBranch: r.base_ref ?? null,
      headSha,
      updatedAt: r.last_activity_at,
      additions: null,
      deletions: null,
      changedFiles: null,
      sourceUrl: r.kind === "pull_request" ? (r.source_url ?? null) : null,
      commitUrl: r.kind === "push" ? (r.source_url ?? null) : null,
      description: null,
      checkState: r.check_state,
      checksRevision: revision,
      checksStale: revision !== null && revision !== headSha,
      checks: [],
      checksPartial: false,
      files: [],
      filesPartial: false,
      gap: null,
    };
  });
  const last = list.length === ACTIVITY_LIMITS.feedPage ? list[list.length - 1] : null;
  const body = {
    repositoryFullName: typeof connection.repository_full_name === "string" ? connection.repository_full_name : "",
    freshness: { lastSyncedAt: connection.last_synced_at ?? null, syncStatus: connection.sync_status ?? "unavailable" },
    changes,
    nextCursor: last ? encodeCursor(String(last.last_activity_at), String(last.id)) : null,
    connectionStatus: connection.status,
  };
  return { status: 200, body };
}

// ---- E8/E9 one change: description, files, patches and checks ---------------------------------------

export async function changeDetail(deps: Deps, input: { user: RpcClient; listId: string; changeId: string }): Promise<ServiceResult> {
  if (!deps.config.configured || !deps.github) return failure("not_configured");
  if (!isUuid(input.listId) || !isUuid(input.changeId)) return failure("invalid_request");

  // 1. The caller must be allowed to read this List's change. Nothing else is trusted from the request.
  const read = await input.user.rpc("code_activity_change_for_read", { p_list_id: input.listId, p_change_id: input.changeId });
  if (read.error) return failure(mapRpcError(read.error));
  const stored = Array.isArray(read.data) ? (read.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!stored || typeof stored.generation !== "number") return failure("not_allowed");

  // 2. The authorized connection, read server-side before any provider call.
  const conn = await deps.admin().rpc("code_activity_server_connection_for_provider", { p_list_id: input.listId, p_expected_generation: stored.generation, p_expected_connection_id: stored.connection_id });
  const row = Array.isArray(conn.data) ? (conn.data[0] as { o_installation_id?: number | string; o_repository_id?: number | string } | undefined) : undefined;
  const installationId = Number(row?.o_installation_id);
  const repositoryId = Number(row?.o_repository_id);
  if (conn.error || !row || !Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId)) {
    return failure(conn.error ? mapRpcError(conn.error) : "source_unavailable");
  }

  try {
    // Detail reads spend the same interactive budget as Refresh: they are not a way around it.
    const github = deps.github.withDeadline(deps.detailDeadlineMs ?? ACTIVITY_LIMITS.detailDeadlineMs).withMeter(createMeter(deps.admin, installationId, true));
    const token = (await github.mintInstallationToken({ installationId, repositoryId })).token;
    const fullName = await github.resolveRepository(token, repositoryId);
    if (fullName === null) return failure("source_unavailable");

    const kind = stored.kind;
    const storedSha = typeof stored.head_sha === "string" ? stored.head_sha : null;
    let title = String(stored.title ?? "");
    let description: string | null = null;
    let headSha = storedSha;
    let additions: number | null = null;
    let deletions: number | null = null;
    let changedFiles: number | null = null;
    let rawFiles: RawFile[] = [];
    let filesPartial = false;
    let filesUnavailableReason: "revision_changed" | null = null;
    let prState = typeof stored.pr_state === "string" ? stored.pr_state : null;
    let sourceUrl = typeof stored.source_url === "string" ? stored.source_url : null;
    let commitUrl: string | null = null;
    let author = { name: typeof stored.author_login === "string" ? stored.author_login : "Unknown author", kind: typeof stored.author_login === "string" ? String(stored.author_kind) : "unknown" };

    if (kind === "pull_request" && typeof stored.pr_number === "number") {
      const { pr, files, truncated, consistent } = await github.getPullRequestWithFiles(token, fullName, stored.pr_number);
      title = pr.title;
      description = pr.body && pr.body.length > 0 ? pr.body : null;
      headSha = pr.headSha;
      prState = pr.state;
      additions = pr.additions;
      deletions = pr.deletions;
      changedFiles = pr.changedFiles;
      sourceUrl = pr.url ?? sourceUrl;
      rawFiles = files;
      filesPartial = truncated || (pr.changedFiles !== null && pr.changedFiles > files.length);
      // If the head commit kept moving, no file list is better than patches that may belong to another revision.
      if (!consistent) {
        filesUnavailableReason = "revision_changed";
        filesPartial = true;
      }
    } else if (kind === "push" && storedSha && typeof stored.before_sha === "string") {
      const push: CommitDetail = await github.getPushDetail(token, fullName, stored.before_sha, storedSha);
      description = push.message;
      title = push.message ? push.message.split("\n")[0].slice(0, CODE_ACTIVITY_LIMITS.feedTitleMax) || title : title;
      rawFiles = push.files;
      filesPartial = push.filesTruncated;
      commitUrl = push.url ?? `https://github.com/${fullName}/commit/${storedSha}`;
      changedFiles = filesPartial ? null : push.files.length;
      additions = filesPartial ? null : sumOrNull(push.files, "additions");
      deletions = filesPartial ? null : sumOrNull(push.files, "deletions");
      if (push.authorLogin) author = { name: push.authorLogin, kind: push.authorKind };
    } else {
      return failure("source_unavailable");
    }

    // Checks are bound to the revision just read. A source that failed makes the state "unavailable", never "none".
    let checks: CheckRun[] = [];
    let checksPartial = false;
    let checkState: CheckState = "unavailable";
    if (headSha) {
      const result = await github.listChecks(token, fullName, headSha);
      checks = result.runs.slice(0, CODE_ACTIVITY_LIMITS.checksMax);
      checksPartial = result.partial || result.runs.length > CODE_ACTIVITY_LIMITS.checksMax;
      checkState = checkStateFor({ runs: result.runs, complete: result.complete && !checksPartial });
    }
    const reachable = checkState !== "unavailable";

    const change = {
      id: input.changeId,
      kind,
      title,
      number: kind === "pull_request" && typeof stored.pr_number === "number" ? stored.pr_number : null,
      prState: kind === "pull_request" ? prState : null,
      author,
      headBranch: stored.head_ref ?? null,
      baseBranch: stored.base_ref ?? null,
      headSha,
      updatedAt: stored.last_activity_at,
      additions,
      deletions,
      changedFiles,
      sourceUrl: kind === "pull_request" ? sourceUrl : null,
      commitUrl,
      description,
      checkState,
      checksRevision: reachable ? headSha : null,
      checksStale: false,
      checks,
      checksPartial,
      files: toChangeFiles(rawFiles),
      filesPartial,
      filesUnavailableReason,
      gap: null,
    };
    const parsed = parseActivityChange(change);
    if (!parsed.ok) return failure("source_unavailable");
    return { status: 200, body: { change: parsed.value as unknown as Record<string, unknown> } };
  } catch (error) {
    return failure(mapGitHubError(error));
  }
}

export { GITHUB_LIMITS };
