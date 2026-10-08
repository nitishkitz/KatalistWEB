import { call } from "./api";
import type { ApiResult } from "./api";
import type { CheckRun, CheckState, ChangeFile } from "../types";
import type { DeploymentState, WorkspaceAuthor, WorkspaceDetail, WorkspaceStats } from "../workspace/types";

/** Client for the workspace read endpoints. Every reply is parsed; a malformed reply is "unavailable", never a guess. */
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const q = (listId: string) => `listId=${encodeURIComponent(listId)}`;
const cursorQ = (c?: string | null) => (c ? `&cursor=${encodeURIComponent(c)}` : "");

const githubUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && (u.hostname === "github.com" || u.hostname.endsWith(".github.com")) ? s : null;
  } catch {
    return null;
  }
};
const httpsUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
};
const avatarUrl = (v: unknown): string | null => {
  const s = httpsUrl(v);
  if (!s) return null;
  const host = new URL(s).hostname;
  return host === "avatars.githubusercontent.com" || host.endsWith(".githubusercontent.com") || host === "github.com" ? s : null;
};

export interface BranchInfo { name: string; sha: string }
export interface BranchesPage { defaultBranch: string | null; branches: BranchInfo[]; nextCursor: string | null; complete: boolean }
export interface CompareInfo { head: BranchInfo; base: BranchInfo; status: "identical" | "ahead" | "behind" | "diverged"; ahead: number | null; behind: number | null; checkedAt: string }
export interface CommitInfo { sha: string; subject: string; authorName: string; authorLogin: string | null; avatarUrl: string | null; committedAt: string; url: string | null }
export interface CommitsPage { items: CommitInfo[]; nextCursor: string | null; windowComplete: boolean }
export interface StatsResult {
  id: string;
  status: "ok" | "unavailable";
  revision: string | null;
  additions: number | null;
  deletions: number | null;
  files: number | null;
  filesComplete: boolean;
  checkState: CheckState | null;
  checks: { passed: number; failing: number; pending: number; total: number } | null;
}
export interface DeploymentInfo { id: string; sha: string; ref: string; environment: string; createdAt: string; creator: string | null; description: string | null; state: DeploymentState | null; links: { log: string | null; target: string | null } }
export interface DeploymentsPage { permission: "ok" | "needed"; items: DeploymentInfo[]; nextCursor: string | null; windowComplete: boolean }

function parseBranch(raw: unknown): BranchInfo | null {
  const o = obj(raw);
  const name = o && str(o.name);
  const sha = o && str(o.sha);
  return name && sha && /^[0-9a-f]{40,64}$/.test(sha) ? { name, sha } : null;
}

export function parseBranchesPage(raw: unknown): BranchesPage | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.branches)) return null;
  const branches = o.branches.map(parseBranch);
  if (branches.some((b) => b === null)) return null;
  return { defaultBranch: str(o.defaultBranch), branches: branches as BranchInfo[], nextCursor: str(o.nextCursor), complete: o.complete !== false };
}

export function parseCompare(raw: unknown): CompareInfo | null {
  const o = obj(raw);
  if (!o) return null;
  const head = parseBranch(o.head);
  const base = parseBranch(o.base);
  const status = o.status;
  const checkedAt = str(o.checkedAt);
  if (!head || !base || !checkedAt || (status !== "identical" && status !== "ahead" && status !== "behind" && status !== "diverged")) return null;
  return { head, base, status, ahead: count(o.ahead), behind: count(o.behind), checkedAt };
}

export function parseCommitsPage(raw: unknown): CommitsPage | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.items)) return null;
  const items: CommitInfo[] = [];
  for (const entry of o.items) {
    const c = obj(entry);
    const sha = c && str(c.sha);
    const subject = c && str(c.subject);
    const committedAt = c && str(c.committedAt);
    if (!c || !sha || !subject || !committedAt || !/^[0-9a-f]{40,64}$/.test(sha) || Number.isNaN(Date.parse(committedAt))) return null;
    items.push({ sha, subject, authorName: str(c.authorName) ?? "Unknown author", authorLogin: str(c.authorLogin), avatarUrl: avatarUrl(c.avatarUrl), committedAt, url: githubUrl(c.url) });
  }
  return { items, nextCursor: str(o.nextCursor), windowComplete: o.windowComplete !== false };
}

const CHECK_STATES = new Set<string>(["passed", "failing", "pending", "none", "unavailable"]);
export function parseStats(raw: unknown): StatsResult[] | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.results)) return null;
  const out: StatsResult[] = [];
  for (const entry of o.results) {
    const r = obj(entry);
    const id = r && str(r.id);
    if (!r || !id || (r.status !== "ok" && r.status !== "unavailable")) return null;
    const checks = obj(r.checks);
    out.push({
      id,
      status: r.status,
      revision: str(r.revision),
      additions: count(r.additions),
      deletions: count(r.deletions),
      files: count(r.files),
      filesComplete: r.filesComplete === true,
      checkState: typeof r.checkState === "string" && CHECK_STATES.has(r.checkState) ? (r.checkState as CheckState) : null,
      checks: checks && count(checks.passed) !== null && count(checks.failing) !== null && count(checks.pending) !== null && count(checks.total) !== null ? { passed: count(checks.passed)!, failing: count(checks.failing)!, pending: count(checks.pending)!, total: count(checks.total)! } : null,
    });
  }
  return out;
}

const DEPLOY_STATES = new Set(["success", "failure", "error", "pending", "in_progress", "queued", "inactive"]);
export function parseDeploymentsPage(raw: unknown): DeploymentsPage | null {
  const o = obj(raw);
  if (!o) return null;
  if (o.permission === "needed") return { permission: "needed", items: [], nextCursor: null, windowComplete: true };
  if (o.permission !== "ok" || !Array.isArray(o.items)) return null;
  const items: DeploymentInfo[] = [];
  for (const entry of o.items) {
    const d = obj(entry);
    const sha = d && str(d.sha);
    const createdAt = d && str(d.createdAt);
    const environment = d && str(d.environment);
    if (!d || typeof d.id !== "number" || !sha || !createdAt || !environment || Number.isNaN(Date.parse(createdAt))) return null;
    const links = obj(d.links);
    items.push({
      id: String(d.id),
      sha,
      ref: str(d.ref) ?? "",
      environment,
      createdAt,
      creator: str(d.creator),
      description: str(d.description),
      state: typeof d.state === "string" && DEPLOY_STATES.has(d.state) ? (d.state as DeploymentState) : null,
      links: { log: httpsUrl(links?.log), target: httpsUrl(links?.target) },
    });
  }
  return { permission: "ok", items, nextCursor: str(o.nextCursor), windowComplete: o.windowComplete !== false };
}

const FILE_STATUS = new Set(["added", "removed", "modified", "renamed"]);
const PATCH_STATE = new Set(["available", "binary", "omitted", "truncated", "empty", "unavailable"]);
function parseFile(raw: unknown): ChangeFile | null {
  const f = obj(raw);
  const path = f && str(f.path);
  if (!f || !path || typeof f.status !== "string" || !FILE_STATUS.has(f.status) || typeof f.patchState !== "string" || !PATCH_STATE.has(f.patchState)) return null;
  return { path, status: f.status as ChangeFile["status"], additions: count(f.additions), deletions: count(f.deletions), patchState: f.patchState as ChangeFile["patchState"], patch: typeof f.patch === "string" ? f.patch : null };
}
const CHECK_STATUS = new Set(["queued", "in_progress", "completed"]);
function parseRun(raw: unknown): CheckRun | null {
  const r = obj(raw);
  const id = r && (typeof r.id === "string" || typeof r.id === "number" ? String(r.id) : null);
  const name = r && str(r.name);
  if (!r || !id || !name || typeof r.status !== "string" || !CHECK_STATUS.has(r.status)) return null;
  return { id, name, status: r.status as CheckRun["status"], conclusion: (typeof r.conclusion === "string" ? r.conclusion : null) as CheckRun["conclusion"], durationLabel: str(r.durationLabel), url: githubUrl(r.url) };
}

export function parseCommitDetail(raw: unknown): WorkspaceDetail | null {
  const root = obj(raw);
  const d = root && obj(root.detail);
  if (!d || d.kind !== "commit" || !str(d.id) || !str(d.title) || !str(d.occurredAt)) return null;
  const a = obj(d.author);
  const author: WorkspaceAuthor = { name: str(a?.name) ?? "Unknown author", login: str(a?.login), avatarUrl: avatarUrl(a?.avatarUrl) };
  if (!Array.isArray(d.files) || !Array.isArray(d.checks)) return null;
  const files = d.files.map(parseFile);
  const checks = d.checks.map(parseRun);
  if (files.some((f) => f === null) || checks.some((c) => c === null)) return null;
  const s = obj(d.stats);
  const stats: WorkspaceStats | null = s ? { additions: count(s.additions), deletions: count(s.deletions), files: count(s.files) } : null;
  return {
    kind: "commit",
    id: d.id as string,
    title: d.title as string,
    body: str(d.body),
    author,
    occurredAt: d.occurredAt as string,
    sha: str(d.sha),
    branch: str(d.branch),
    base: str(d.base),
    url: githubUrl(d.url),
    stats,
    statsComplete: d.statsComplete === true,
    files: files as ChangeFile[],
    filesPartial: d.filesPartial === true,
    filesUnavailableReason: null,
    checks: checks as CheckRun[],
    checkState: typeof d.checkState === "string" && CHECK_STATES.has(d.checkState) ? (d.checkState as CheckState) : "unavailable",
    checksRevision: str(d.checksRevision),
    checksPartial: d.checksPartial === true,
    deployment: null,
  };
}

export interface RegisteredSource { sourceId: string; revisionSha: string; title: string; url: string | null }
export function parseSource(raw: unknown): RegisteredSource | null {
  const o = obj(raw);
  const sourceId = o && str(o.sourceId);
  const revisionSha = o && str(o.revisionSha);
  const title = o && str(o.title);
  return sourceId && revisionSha && title && /^[0-9a-f]{40,64}$/.test(revisionSha) ? { sourceId, revisionSha, title, url: githubUrl(o.url) } : null;
}
export interface WorkspaceConfirmBody { listId: string; sourceId: string; key: string; title: string; notes: string | null; assigneeActorId: string; dueAt: string | null; importance: "now" | "next" | "later"; reviewedSha: string | null; acknowledgeSourceChange: boolean }

export interface CommitQueryParams { branch: string; cursor?: string | null; author?: string | null; path?: string | null; since?: string | null; until?: string | null }

export const workspaceApi = {
  branches: (listId: string, cursor?: string | null, signal?: AbortSignal): Promise<ApiResult<BranchesPage>> => call(`/api/code-activity/branches?${q(listId)}${cursorQ(cursor)}`, { signal }, parseBranchesPage),
  compare: (listId: string, head: string, base: string, signal?: AbortSignal): Promise<ApiResult<CompareInfo>> =>
    call(`/api/code-activity/compare?${q(listId)}&head=${encodeURIComponent(head)}&base=${encodeURIComponent(base)}`, { signal }, parseCompare),
  commits: (listId: string, p: CommitQueryParams, signal?: AbortSignal): Promise<ApiResult<CommitsPage>> => {
    const extra = (["author", "path", "since", "until"] as const).map((k) => (p[k] ? `&${k}=${encodeURIComponent(p[k] as string)}` : "")).join("");
    return call(`/api/code-activity/commits?${q(listId)}&branch=${encodeURIComponent(p.branch)}${cursorQ(p.cursor)}${extra}`, { signal }, parseCommitsPage);
  },
  stats: (listId: string, ids: readonly string[], signal?: AbortSignal): Promise<ApiResult<StatsResult[]>> =>
    call(`/api/code-activity/change-stats?${q(listId)}&items=${encodeURIComponent(ids.join(","))}`, { signal }, parseStats),
  deployments: (listId: string, cursor?: string | null, signal?: AbortSignal): Promise<ApiResult<DeploymentsPage>> => call(`/api/code-activity/deployments?${q(listId)}${cursorQ(cursor)}`, { signal }, parseDeploymentsPage),
  registerSource: (listId: string, kind: "commit" | "pull_request", key: string, signal?: AbortSignal): Promise<ApiResult<RegisteredSource>> =>
    call(`/api/code-activity/workspace-source`, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId, kind, key }) }, parseSource),
  confirm: (body: WorkspaceConfirmBody): Promise<ApiResult<{ thingId: string | null; replayed: boolean }>> =>
    call(`/api/code-activity/workspace-confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, (raw) => {
      const o = obj(raw);
      return o && (typeof o.thingId === "string" || o.thingId === null) ? { thingId: o.thingId as string | null, replayed: o.replayed === true } : null;
    }),
  commitDetail: (listId: string, sha: string, signal?: AbortSignal): Promise<ApiResult<WorkspaceDetail>> => call(`/api/code-activity/commit-detail?${q(listId)}&sha=${encodeURIComponent(sha)}`, { signal }, parseCommitDetail),
};
