import { createHash } from "node:crypto";
import { checkStateFor, toChangeFiles } from "./activity.server";
import { createMeter } from "./budget.server";
import { GitHubError } from "./github.server";
import type { GitHubClient } from "./github.server";
import { READ_LIMITS, encodeRefPath, validRefName } from "./github-read.server";
import type { CommitFull, CommitRow, DeploymentRow } from "./github-read.server";
import { failure, isUuid, mapGitHubError, mapRpcError } from "./service.server";
import type { Deps, RpcClient, ServiceResult } from "./service.server";
import { countChecks } from "../format";
import type { CheckRun } from "../types";

/**
 * Read endpoints for the workspace (branches, comparison, commits, change stats, deployments, commit detail).
 *
 * Every one follows the same order: the caller is authorized in the database FIRST, then the connection is read by a
 * server-only function, then a metered, narrowed GitHub client reads, and finally the connection is checked again so a
 * disconnect or reconnect during the read discards the result. The browser sends a List id and validated selectors only,
 * never an installation, repository, token or provider URL.
 */

export const WORKSPACE_LIMITS = {
  /** Whole read sequence for one request. */
  deadlineMs: 25_000,
  commitWindow: 200,
  deploymentWindow: 50,
  statsBatch: 10,
  statsConcurrency: 2,
  branchNames: 300,
} as const;

interface ProviderContext {
  listId: string;
  connectionId: string;
  generation: number;
  github: GitHubClient;
  token: string;
  fullName: string;
  repositoryId: number;
}

const sha256hex = (text: string) => createHash("sha256").update(text).digest("hex");

/** Opaque cursor bound to a scope: a cursor made for one branch or filter cannot be replayed against another. */
export function encodeCursor(page: number, scope: unknown): string {
  const s = sha256hex(JSON.stringify(scope)).slice(0, 12);
  return `v1.${Buffer.from(JSON.stringify({ p: page, s })).toString("base64url")}`;
}

export function decodeCursor(cursor: string | null | undefined, scope: unknown): { page: number } | "invalid" {
  if (cursor === null || cursor === undefined || cursor === "") return { page: 1 };
  if (!/^v1\.[A-Za-z0-9_-]{1,200}$/.test(cursor)) return "invalid";
  try {
    const parsed = JSON.parse(Buffer.from(cursor.slice(3), "base64url").toString("utf8")) as { p?: unknown; s?: unknown };
    if (typeof parsed.p !== "number" || !Number.isSafeInteger(parsed.p) || parsed.p < 1 || parsed.p > 20) return "invalid";
    return parsed.s === sha256hex(JSON.stringify(scope)).slice(0, 12) ? { page: parsed.p } : "invalid";
  } catch {
    return "invalid";
  }
}

type Authorized = { ok: true; installationId: number; repositoryId: number; connectionId: string; generation: number } | { ok: false; result: ServiceResult };

export async function authorizeProviderRead(deps: Deps, user: RpcClient, listId: string): Promise<Authorized> {
  if (!deps.config.configured || !deps.github) return { ok: false, result: failure("not_configured") };
  if (!isUuid(listId)) return { ok: false, result: failure("invalid_request") };
  // 1. The database decides, as the caller. Membership and the feature flags are enforced inside this function.
  const status = await user.rpc("code_activity_connection_status", { p_list_id: listId });
  if (status.error) return { ok: false, result: failure(mapRpcError(status.error)) };
  const row = Array.isArray(status.data) ? (status.data[0] as { status?: string; needs_reverification?: boolean } | undefined) : undefined;
  if (!row || row.needs_reverification === true) return { ok: false, result: failure("not_allowed") };
  if (row.status === "suspended") return { ok: false, result: failure("source_unavailable") };
  if (row.status !== "active") return { ok: false, result: failure("not_allowed") };
  // 2. Only now is the connection read, by a server-only function.
  const conn = await deps.admin().rpc("code_activity_server_connection_for_provider", { p_list_id: listId, p_expected_generation: null, p_expected_connection_id: null });
  const c = Array.isArray(conn.data) ? (conn.data[0] as { o_connection_id?: string; o_installation_id?: number | string; o_repository_id?: number | string; o_generation?: number } | undefined) : undefined;
  const installationId = Number(c?.o_installation_id);
  const repositoryId = Number(c?.o_repository_id);
  if (conn.error || !c || !isUuid(c.o_connection_id) || typeof c.o_generation !== "number" || !Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId)) {
    return { ok: false, result: failure(conn.error ? mapRpcError(conn.error) : "not_allowed") };
  }
  return { ok: true, installationId, repositoryId, connectionId: c.o_connection_id, generation: c.o_generation };
}

/** Runs one provider read inside the whole authorization and containment sequence. */
export async function withProvider(
  deps: Deps,
  user: RpcClient,
  listId: string,
  run: (ctx: ProviderContext) => Promise<ServiceResult>,
  options: { deployments?: boolean; onMintRefused?: () => ServiceResult } = {},
): Promise<ServiceResult> {
  const auth = await authorizeProviderRead(deps, user, listId);
  if (!auth.ok) return auth.result;
  try {
    const github = (deps.github as GitHubClient)
      .withDeadline(deps.workspaceDeadlineMs ?? WORKSPACE_LIMITS.deadlineMs)
      .withMeter(createMeter(deps.admin, auth.installationId, true));
    let token: string;
    try {
      token = (await github.mintInstallationToken({ installationId: auth.installationId, repositoryId: auth.repositoryId, deployments: options.deployments === true })).token;
    } catch (error) {
      // Only a refusal of the optional permission is reported as "permission needed"; everything else stays an error.
      if (options.onMintRefused && error instanceof GitHubError && (error.status === 403 || error.status === 422)) return options.onMintRefused();
      throw error;
    }
    const fullName = await github.resolveRepository(token, auth.repositoryId);
    if (fullName === null) return failure("source_unavailable");
    const result = await run({ listId, connectionId: auth.connectionId, generation: auth.generation, github, token, fullName, repositoryId: auth.repositoryId });
    if (result.status !== 200) return result;
    // The connection that was authorized must still be THIS connection, at THIS generation, or the result is discarded.
    const still = await deps.admin().rpc("code_activity_server_connection_for_provider", { p_list_id: listId, p_expected_generation: auth.generation, p_expected_connection_id: auth.connectionId });
    const same = !still.error && Array.isArray(still.data) && still.data.length === 1;
    return same ? result : failure("not_allowed");
  } catch (error) {
    return failure(mapGitHubError(error));
  }
}

// ---- branches -----------------------------------------------------------------------------------------

export async function branches(deps: Deps, input: { user: RpcClient; listId: string; cursor?: string | null }): Promise<ServiceResult> {
  const scope = { k: "branches" };
  const cursor = decodeCursor(input.cursor, scope);
  if (cursor === "invalid") return failure("invalid_request");
  return withProvider(deps, input.user, input.listId, async ({ github, token, fullName }) => {
    const page = await github.listBranches(token, fullName, cursor.page);
    const defaultBranch = cursor.page === 1 ? await github.getDefaultBranch(token, fullName) : null;
    const more = page.hasMore && cursor.page < READ_LIMITS.branchPages;
    return {
      status: 200,
      body: {
        defaultBranch,
        branches: page.branches,
        nextCursor: more ? encodeCursor(cursor.page + 1, scope) : null,
        // false when the repository has more branches than the 300 listed here
        complete: !(page.hasMore && !more),
      },
    };
  });
}

// ---- comparison ---------------------------------------------------------------------------------------

export async function compare(deps: Deps, input: { user: RpcClient; listId: string; head: unknown; base: unknown }): Promise<ServiceResult> {
  if (!validRefName(input.head) || !validRefName(input.base)) return failure("invalid_request");
  const { head, base } = input;
  return withProvider(deps, input.user, input.listId, async ({ github, token, fullName }) => {
    // Both names are resolved to immutable SHAs first, so the answer describes exactly those commits.
    const [h, b] = await Promise.all([github.resolveBranch(token, fullName, head), github.resolveBranch(token, fullName, base)]);
    if (!h || !b) return { status: 404, body: { error: "ref_not_found", which: !h && !b ? "both" : !h ? "head" : "base" } };
    if (h.sha === b.sha) {
      return { status: 200, body: { head: h, base: b, status: "identical", ahead: 0, behind: 0, checkedAt: new Date().toISOString() } };
    }
    const summary = await github.compareRefs(token, fullName, b.sha, h.sha);
    return { status: 200, body: { head: h, base: b, status: summary.status, ahead: summary.aheadBy, behind: summary.behindBy, checkedAt: new Date().toISOString() } };
  });
}

// ---- commits ------------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

export async function commits(
  deps: Deps,
  input: { user: RpcClient; listId: string; branch: unknown; cursor?: string | null; author?: string | null; path?: string | null; since?: string | null; until?: string | null },
): Promise<ServiceResult> {
  if (!validRefName(input.branch)) return failure("invalid_request");
  const branch = input.branch;
  const author = input.author?.trim() || null;
  if (author !== null && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(author)) return failure("invalid_request");
  const path = input.path?.trim() || null;
  if (path !== null && (path.length > 255 || path.includes("..") || path.startsWith("/"))) return failure("invalid_request");
  for (const date of [input.since, input.until]) if (date && !DATE.test(date)) return failure("invalid_request");
  const scope = { k: "commits", branch, author, path, since: input.since ?? null, until: input.until ?? null };
  const cursor = decodeCursor(input.cursor, scope);
  if (cursor === "invalid") return failure("invalid_request");
  return withProvider(deps, input.user, input.listId, async ({ github, token, fullName }) => {
    const page = await github.listCommits(token, fullName, { branch, page: cursor.page, author: author ?? undefined, path: path ?? undefined, since: input.since ?? undefined, until: input.until ?? undefined });
    const windowPages = WORKSPACE_LIMITS.commitWindow / READ_LIMITS.commitsPerPage;
    const more = page.hasMore && cursor.page < windowPages;
    return {
      status: 200,
      body: {
        items: page.commits.map((c: CommitRow) => ({ ...c })),
        nextCursor: more ? encodeCursor(cursor.page + 1, scope) : null,
        // false when older commits exist beyond the window the browser may read without narrowing the search
        windowComplete: !(page.hasMore && !more),
      },
    };
  });
}

// ---- change stats -------------------------------------------------------------------------------------

const ITEM = /^(commit:[0-9a-f]{40,64}|pr:[1-9][0-9]{0,8})$/;

export function parseStatsItems(raw: string | null | undefined): string[] | "invalid" {
  if (!raw) return "invalid";
  const items = raw.split(",");
  if (items.length < 1 || items.length > WORKSPACE_LIMITS.statsBatch || new Set(items).size !== items.length) return "invalid";
  return items.every((i) => ITEM.test(i)) ? items : "invalid";
}

function checkSummary(runs: CheckRun[]) {
  const c = countChecks(runs);
  return { passed: c.passed, failing: c.failing, pending: c.pending, total: c.total };
}

async function mapPool<T, R>(items: readonly T[], width: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}

export async function changeStats(deps: Deps, input: { user: RpcClient; listId: string; items: string | null | undefined }): Promise<ServiceResult> {
  const ids = parseStatsItems(input.items);
  if (ids === "invalid") return failure("invalid_request");
  return withProvider(deps, input.user, input.listId, async ({ github, token, fullName }) => {
    let budgetSpent = false;
    const results = await mapPool(ids, WORKSPACE_LIMITS.statsConcurrency, async (id) => {
      const unavailable = (reason: string) => ({ id, revision: null, status: "unavailable", reason, additions: null, deletions: null, files: null, filesComplete: false, checkState: null, checks: null, checksComplete: false });
      if (budgetSpent) return unavailable("budget");
      try {
        let revision: string;
        let additions: number | null;
        let deletions: number | null;
        let files: number | null;
        let filesComplete: boolean;
        if (id.startsWith("commit:")) {
          const full = await github.getCommitFull(token, fullName, id.slice(7));
          revision = full.sha;
          additions = full.additions;
          deletions = full.deletions;
          files = full.filesComplete ? full.files.length : null; // 300 or more on the first page: the count is not claimed
          filesComplete = full.filesComplete;
        } else {
          const pr = await github.getPullRequest(token, fullName, Number(id.slice(3)));
          revision = pr.headSha;
          additions = pr.additions;
          deletions = pr.deletions;
          files = pr.changedFiles;
          filesComplete = pr.changedFiles !== null;
        }
        const checks = await github.listChecks(token, fullName, revision).catch((error: unknown) => {
          if (error instanceof GitHubError && (error.kind === "budget" || error.kind === "timeout" || error.kind === "rate_limited")) throw error;
          return null;
        });
        return {
          id,
          revision,
          status: "ok",
          additions,
          deletions,
          files,
          filesComplete,
          checkState: checks ? checkStateFor(checks) : "unavailable",
          checks: checks ? checkSummary(checks.runs) : null,
          checksComplete: checks ? checks.complete : false,
        };
      } catch (error) {
        if (error instanceof GitHubError && error.kind === "budget") {
          budgetSpent = true;
          return unavailable("budget");
        }
        return unavailable(error instanceof GitHubError ? error.kind : "error");
      }
    });
    return { status: 200, body: { results } };
  });
}

// ---- deployments --------------------------------------------------------------------------------------

export async function deployments(deps: Deps, input: { user: RpcClient; listId: string; cursor?: string | null }): Promise<ServiceResult> {
  const scope = { k: "deployments" };
  const cursor = decodeCursor(input.cursor, scope);
  if (cursor === "invalid") return failure("invalid_request");
  return withProvider(
    deps,
    input.user,
    input.listId,
    async ({ github, token, fullName }) => {
      const page = await github.listDeployments(token, fullName, cursor.page);
      const pages = WORKSPACE_LIMITS.deploymentWindow / READ_LIMITS.deploymentsPerPage;
      const more = page.hasMore && cursor.page < pages;
      return {
        status: 200,
        body: {
          permission: "ok",
          items: page.deployments.map((d: DeploymentRow) => ({
            id: d.id,
            sha: d.sha,
            ref: d.ref,
            environment: d.environment,
            createdAt: d.createdAt,
            creator: d.creator,
            description: d.statusDescription ?? d.description,
            state: d.state,
            links: { log: d.logUrl, target: d.targetUrl },
          })),
          nextCursor: more ? encodeCursor(cursor.page + 1, scope) : null,
          windowComplete: !(page.hasMore && !more),
        },
      };
    },
    {
      deployments: true,
      // GitHub refusing the optional permission is a state of the Deployments pane, not an error of the feature.
      onMintRefused: () => ({ status: 200, body: { permission: "needed", items: [], nextCursor: null, windowComplete: true } }),
    },
  );
}

// ---- commit detail ------------------------------------------------------------------------------------

export async function commitDetail(deps: Deps, input: { user: RpcClient; listId: string; sha: unknown }): Promise<ServiceResult> {
  if (typeof input.sha !== "string" || !/^[0-9a-f]{40,64}$/i.test(input.sha)) return failure("invalid_request");
  const sha = input.sha.toLowerCase();
  return withProvider(deps, input.user, input.listId, async ({ github, token, fullName }) => {
    const full: CommitFull = await github.getCommitFull(token, fullName, sha);
    const checks = await github.listChecks(token, fullName, full.sha).catch((error: unknown) => {
      if (error instanceof GitHubError && (error.kind === "budget" || error.kind === "timeout" || error.kind === "rate_limited")) throw error;
      return null;
    });
    const files = toChangeFiles(full.files);
    const detail = {
      kind: "commit",
      id: `commit:${full.sha}`,
      title: full.subject,
      body: full.body,
      author: { name: full.authorName, login: full.authorLogin, avatarUrl: full.avatarUrl },
      occurredAt: full.committedAt,
      sha: full.sha,
      branch: null,
      base: null,
      url: full.url,
      // GitHub's own totals are exact even when more files exist than were listed.
      stats: { additions: full.additions, deletions: full.deletions, files: full.filesComplete ? full.files.length : null },
      statsComplete: full.filesComplete,
      files,
      filesPartial: !full.filesComplete,
      filesUnavailableReason: null,
      checks: checks ? checks.runs : [],
      checkState: checks ? checkStateFor(checks) : "unavailable",
      checksRevision: checks ? full.sha : null,
      checksPartial: checks ? checks.partial : false,
      deployment: null,
    };
    return { status: 200, body: { detail } };
  });
}

// ---- sources for Thing creation ---------------------------------------------------------------------------

/**
 * Registers the commit (or pull request) the person is about to create a Thing from. The browser names it; the server reads
 * it from GitHub for THIS List's own connection first, and only then records it, so a source can never be made up. The reply
 * carries the id to confirm against and the exact revision that was read, which is the revision the person reviews.
 */
export async function registerSource(deps: Deps, input: { user: RpcClient; listId: string; kind: unknown; key: unknown }): Promise<ServiceResult> {
  const kind = input.kind;
  const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
  if (kind === "commit" ? !/^[0-9a-f]{40,64}$/.test(key) : kind === "pull_request" ? !/^[1-9][0-9]{0,8}$/.test(key) : true) return failure("invalid_request");
  return withProvider(deps, input.user, input.listId, async (ctx) => {
    let title: string;
    let revision: string;
    let url: string | null;
    if (kind === "commit") {
      const full = await ctx.github.getCommitFull(ctx.token, ctx.fullName, key);
      title = full.subject;
      revision = full.sha;
      url = full.url;
    } else {
      const pr = await ctx.github.getPullRequest(ctx.token, ctx.fullName, Number(key));
      title = pr.title;
      revision = pr.headSha;
      url = pr.url;
    }
    const recorded = await deps.admin().rpc("code_activity_server_record_workspace_source", {
      p_list_id: ctx.listId,
      p_connection_id: ctx.connectionId,
      p_generation: ctx.generation,
      p_kind: kind,
      p_provider_key: key,
      p_revision_sha: revision,
      p_title: title.slice(0, 300),
      p_source_url: url,
    });
    if (recorded.error) return failure(mapRpcError(recorded.error));
    if (!isUuid(recorded.data)) return failure("source_unavailable");
    return { status: 200, body: { sourceId: recorded.data, revisionSha: revision, title, url } };
  });
}

export { encodeRefPath };
