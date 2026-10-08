import { GitHubError } from "./github.server";
import type { Caller } from "./github.server";
import type { AuthorKind, CheckRun, CheckRunConclusion, FileStatus, PullRequestState } from "../types";

/**
 * Read-only GitHub reads for activity (G07 to G09). Every call takes an installation token that was
 * narrowed to one repository, validates the reply shape, and is bounded in pages. Nothing here writes to GitHub.
 */

export const READ_LIMITS = {
  pullRequestPages: 2,
  perPage: 100,
  pushPerPage: 50,
  filePages: 3,
  checkPages: 2,
  /** GitHub shows at most 300 files on the FIRST page of a comparison, and has no further pages for them. */
  compareFiles: 300,
  /** Attempts to read a pull request and its files against one unchanged head commit. */
  consistencyAttempts: 3,
  branchPages: 3,
  commitsPerPage: 50,
  deploymentsPerPage: 10,
} as const;

const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40,64}$/i;
export const ZERO_SHA = /^0+$/;

export interface PullRequestSummary {
  number: number;
  title: string;
  state: PullRequestState;
  authorLogin: string | null;
  authorKind: AuthorKind;
  headRef: string | null;
  headSha: string;
  baseRef: string | null;
  url: string | null;
  updatedAt: string;
}

export interface PushSummary {
  /** "ref@after", the stable key for a push. */
  key: string;
  branch: string;
  before: string;
  after: string;
  authorLogin: string | null;
  authorKind: AuthorKind;
  timestamp: string;
}

export interface PullRequestDetail {
  title: string;
  body: string | null;
  state: PullRequestState;
  headSha: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  url: string | null;
}

export interface RawFile {
  path: string;
  status: FileStatus;
  additions: number | null;
  deletions: number | null;
  /** Undefined when GitHub sent no patch (binary, too large, or no textual change). */
  patch: string | null;
}

export interface CommitDetail {
  message: string | null;
  url: string | null;
  authorLogin: string | null;
  authorKind: AuthorKind;
  files: RawFile[];
  filesTruncated: boolean;
}

export interface PushRead {
  pushes: PushSummary[];
  /** Entries GitHub sent that could not be understood. They are counted, never guessed at. */
  skipped: number;
}

export interface ChecksRead {
  /** Check runs followed by commit statuses, as one list. */
  runs: CheckRun[];
  /** More checks or statuses exist than were read. */
  partial: boolean;
  /** Both sources were read in full. False means a missing "passed" must not be claimed. */
  complete: boolean;
}

export interface PullRequestWithFiles {
  pr: PullRequestDetail;
  files: RawFile[];
  truncated: boolean;
  /** False when the head commit kept changing; then `files` is empty rather than possibly mismatched. */
  consistent: boolean;
}

export interface BranchRef {
  name: string;
  sha: string;
}

export interface CompareSummary {
  status: "identical" | "ahead" | "behind" | "diverged";
  /** Commits the head has that the base lacks. Null when GitHub did not say. */
  aheadBy: number | null;
  /** Commits the base has that the head lacks. */
  behindBy: number | null;
}

export interface CommitRow {
  sha: string;
  /** First line of the message. */
  subject: string;
  /** The git author's display name. The git e-mail address is never read. */
  authorName: string;
  authorLogin: string | null;
  avatarUrl: string | null;
  committedAt: string;
  url: string | null;
}

export interface CommitQuery {
  branch: string;
  page: number;
  author?: string;
  path?: string;
  since?: string;
  until?: string;
}

export interface CommitFull {
  sha: string;
  subject: string;
  body: string | null;
  authorName: string;
  authorLogin: string | null;
  avatarUrl: string | null;
  committedAt: string;
  url: string | null;
  /** GitHub's own totals for the commit: exact even when more than 300 files exist. */
  additions: number | null;
  deletions: number | null;
  files: RawFile[];
  /** True when the first page held fewer than 300 files, so `files` is the whole list. */
  filesComplete: boolean;
}

export interface DeploymentRow {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  createdAt: string;
  creator: string | null;
  description: string | null;
  /** The LATEST recorded status, or null when none was read. */
  state: "success" | "failure" | "error" | "pending" | "in_progress" | "queued" | "inactive" | null;
  statusDescription: string | null;
  logUrl: string | null;
  targetUrl: string | null;
}

export interface GitHubReader {
  /** The repository's default branch name. */
  getDefaultBranch(token: string, fullName: string): Promise<string | null>;
  listBranches(token: string, fullName: string, page: number): Promise<{ branches: BranchRef[]; hasMore: boolean }>;
  /** Null when the branch does not exist. */
  resolveBranch(token: string, fullName: string, name: string): Promise<BranchRef | null>;
  compareRefs(token: string, fullName: string, baseSha: string, headSha: string): Promise<CompareSummary>;
  listCommits(token: string, fullName: string, query: CommitQuery): Promise<{ commits: CommitRow[]; hasMore: boolean }>;
  getCommitFull(token: string, fullName: string, sha: string): Promise<CommitFull>;
  listDeployments(token: string, fullName: string, page: number): Promise<{ deployments: DeploymentRow[]; hasMore: boolean }>;
  /** The repository's CURRENT full name, from the installation's own list. Null when the token cannot reach it. */
  resolveRepository(token: string, repositoryId: number): Promise<string | null>;
  listPullRequests(token: string, fullName: string): Promise<PullRequestSummary[]>;
  listPushes(token: string, fullName: string): Promise<PushRead>;
  getPullRequest(token: string, fullName: string, number: number): Promise<PullRequestDetail>;
  /** One pull request in the same shape as a list entry (for a webhook refetch). */
  getPullRequestSummary(token: string, fullName: string, number: number): Promise<PullRequestSummary>;
  listPullFiles(token: string, fullName: string, number: number): Promise<{ files: RawFile[]; truncated: boolean }>;
  /** Pull request metadata and files that belong to the SAME head commit, or no files at all. */
  getPullRequestWithFiles(token: string, fullName: string, number: number): Promise<PullRequestWithFiles>;
  /** Commit (new branch) or comparison (existing branch) for a push. */
  getPushDetail(token: string, fullName: string, before: string, after: string): Promise<CommitDetail>;
  /** Check runs and commit statuses for one revision. */
  listChecks(token: string, fullName: string, sha: string): Promise<ChecksRead>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const bad = (): never => {
  throw new GitHubError("bad_response");
};

function author(user: unknown): { login: string | null; kind: AuthorKind } {
  if (!isObject(user)) return { login: null, kind: "unknown" };
  const login = str(user.login);
  return { login, kind: login === null ? "unknown" : user.type === "Bot" ? "bot" : "user" };
}

function prState(p: Record<string, unknown>): PullRequestState {
  if (p.merged_at && typeof p.merged_at === "string") return "merged";
  if (p.merged === true) return "merged";
  if (p.state === "closed") return "closed";
  if (p.draft === true) return "draft";
  if (p.state === "open") return "open";
  return bad();
}

const branch = (ref: unknown) => (isObject(ref) ? str(ref.ref) : null);
const httpUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === "github.com" ? v : null;
  } catch {
    return null;
  }
};

// ---- parsers (pure; exported for tests) --------------------------------------------------------

export function parsePullRequestList(body: unknown): PullRequestSummary[] {
  if (!Array.isArray(body)) return bad();
  return body.map((p) => {
    if (!isObject(p) || typeof p.number !== "number" || !Number.isSafeInteger(p.number) || p.number <= 0) return bad();
    const title = str(p.title);
    const updatedAt = str(p.updated_at);
    const head = isObject(p.head) ? p.head : null;
    const headSha = head ? str(head.sha) : null;
    if (title === null || updatedAt === null || Number.isNaN(Date.parse(updatedAt)) || headSha === null || !SHA.test(headSha)) return bad();
    const a = author(p.user);
    return {
      number: p.number,
      title,
      state: prState(p),
      authorLogin: a.login,
      authorKind: a.kind,
      headRef: head ? str(head.ref) : null,
      headSha,
      baseRef: branch(p.base),
      url: httpUrl(p.html_url),
      updatedAt,
    };
  });
}

/** Activity types that are a code change on a branch. Deletions and merges (shown as pull requests) are not. */
const PUSH_TYPES: readonly string[] = ["push", "force_push", "branch_creation"];

/**
 * Accepts the documented shape (`timestamp`, `actor`) and the older example shape (`pushed_at`, `pusher`).
 * An entry that cannot be understood is skipped and counted; one bad entry never hides the rest.
 */
export function parsePushActivities(body: unknown): PushRead {
  if (!Array.isArray(body)) return bad();
  const pushes: PushSummary[] = [];
  let skipped = 0;
  for (const item of body) {
    if (!isObject(item)) {
      skipped += 1;
      continue;
    }
    const type = str(item.activity_type);
    if (type !== null && !PUSH_TYPES.includes(type)) continue; // not a code change: ignored, not skipped
    const ref = str(item.ref);
    const before = str(item.before);
    const after = str(item.after);
    const timestamp = str(item.timestamp) ?? str(item.pushed_at);
    if (ref === null || before === null || after === null || timestamp === null || Number.isNaN(Date.parse(timestamp)) || !SHA.test(after) || !(SHA.test(before) || ZERO_SHA.test(before))) {
      skipped += 1;
      continue;
    }
    if (!ref.startsWith("refs/heads/") || ZERO_SHA.test(after)) continue; // tags and branch deletions
    const actor = isObject(item.actor) ? item.actor : isObject(item.pusher) ? item.pusher : null;
    const login = actor ? (str(actor.login) ?? str(actor.name)) : null;
    const name = ref.slice("refs/heads/".length);
    pushes.push({
      key: `${name}@${after}`,
      branch: name,
      before,
      after,
      authorLogin: login,
      authorKind: login === null ? "unknown" : actor && actor.type === "Bot" ? "bot" : "user",
      timestamp,
    });
  }
  return { pushes, skipped };
}

export function parsePullRequestDetail(body: unknown): PullRequestDetail {
  if (!isObject(body)) return bad();
  const head = isObject(body.head) ? body.head : null;
  const headSha = head ? str(head.sha) : null;
  const title = str(body.title);
  if (title === null || headSha === null || !SHA.test(headSha)) return bad();
  return {
    title,
    body: str(body.body),
    state: prState(body),
    headSha,
    additions: count(body.additions),
    deletions: count(body.deletions),
    changedFiles: count(body.changed_files),
    url: httpUrl(body.html_url),
  };
}

const FILE_STATUS: Record<string, FileStatus> = { added: "added", removed: "removed", modified: "modified", renamed: "renamed" };

export function parseFiles(body: unknown): RawFile[] {
  if (!Array.isArray(body)) return bad();
  return body.map((f) => {
    if (!isObject(f)) return bad();
    const path = str(f.filename);
    if (path === null || path.length === 0) return bad();
    return {
      path,
      status: FILE_STATUS[String(f.status)] ?? "modified", // copied, changed, unchanged read as modified
      additions: count(f.additions),
      deletions: count(f.deletions),
      patch: typeof f.patch === "string" ? f.patch : null,
    };
  });
}

const CONCLUSIONS: readonly string[] = ["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"];

function duration(start: unknown, end: unknown): string | null {
  const a = typeof start === "string" ? Date.parse(start) : NaN;
  const b = typeof end === "string" ? Date.parse(end) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const s = Math.round((b - a) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function parseCheckRuns(body: unknown): CheckRun[] {
  if (!isObject(body) || !Array.isArray(body.check_runs)) return bad();
  return body.check_runs.map((r) => {
    if (!isObject(r) || (typeof r.id !== "number" && typeof r.id !== "string") || str(r.name) === null) return bad();
    const status = r.status === "queued" || r.status === "in_progress" || r.status === "completed" ? r.status : null;
    if (status === null) return bad();
    const conclusion = typeof r.conclusion === "string" && CONCLUSIONS.includes(r.conclusion) ? (r.conclusion as CheckRunConclusion) : null;
    return {
      id: String(r.id),
      name: String(r.name),
      status,
      conclusion: status === "completed" ? conclusion : null,
      durationLabel: duration(r.started_at, r.completed_at),
      url: httpUrl(r.html_url),
    };
  });
}

/** Commit statuses (the older CI reporting) as check-like rows. `pending` also covers "no result yet". */
export function parseCombinedStatus(body: unknown): { runs: CheckRun[]; total: number } {
  if (!isObject(body) || !Array.isArray(body.statuses)) return bad();
  const runs = body.statuses.map((r): CheckRun => {
    if (!isObject(r) || (typeof r.id !== "number" && typeof r.id !== "string") || str(r.context) === null) return bad();
    const state = str(r.state);
    if (state !== "success" && state !== "failure" && state !== "error" && state !== "pending") return bad();
    const target = str(r.target_url);
    let url: string | null = null;
    try {
      url = target && new URL(target).protocol === "https:" ? target : null;
    } catch {
      url = null;
    }
    return {
      id: `status-${r.id}`,
      name: String(r.context),
      status: state === "pending" ? "in_progress" : "completed",
      conclusion: state === "success" ? "success" : state === "pending" ? null : "failure",
      durationLabel: null,
      url,
    };
  });
  return { runs, total: typeof body.total_count === "number" ? body.total_count : runs.length };
}

export function parseCommit(body: unknown): CommitDetail {
  if (!isObject(body)) return bad();
  const commit = isObject(body.commit) ? body.commit : null;
  const a = author(body.author);
  return {
    message: commit ? str(commit.message) : null,
    url: httpUrl(body.html_url),
    authorLogin: a.login,
    authorKind: a.kind,
    files: Array.isArray(body.files) ? parseFiles(body.files) : [],
    filesTruncated: false,
  };
}

export function parseCompare(body: unknown): CommitDetail {
  if (!isObject(body)) return bad();
  const commits = Array.isArray(body.commits) ? body.commits : [];
  const last = commits.length > 0 && isObject(commits[commits.length - 1]) ? (commits[commits.length - 1] as Record<string, unknown>) : null;
  const lastCommit = last && isObject(last.commit) ? last.commit : null;
  const a = author(last?.author);
  return {
    message: lastCommit ? str(lastCommit.message) : null,
    url: httpUrl(body.html_url),
    authorLogin: a.login,
    authorKind: a.kind,
    files: Array.isArray(body.files) ? parseFiles(body.files) : [],
    filesTruncated: false,
  };
}

// ---- workspace parsers (branches, comparison, commits, deployments) ------------------------------------------

/** Per-segment path encoding that keeps the slashes of a branch name such as `feature/x` and escapes everything else. */
export function encodeRefPath(name: string): string {
  return name.split("/").map(encodeURIComponent).join("/");
}

/** A branch or ref name we are willing to put in a URL. Everything else is refused before any request. */
export function validRefName(name: unknown): name is string {
  // eslint-disable-next-line no-control-regex
  return typeof name === "string" && name.length >= 1 && name.length <= 255 && !/[\u0000-\u001f\u007f\\]/.test(name) && !name.includes("..") && !name.startsWith("-") && !name.startsWith("/") && !name.endsWith("/") && !/[ ~^:?*[]/.test(name) && !name.includes("@{") && !name.includes("//") && !name.endsWith(".") && !name.endsWith(".lock") && name !== "@";
}

const safeHttps = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
};
const avatar = (v: unknown): string | null => {
  const url = safeHttps(v);
  if (!url) return null;
  const host = new URL(url).hostname;
  return host === "avatars.githubusercontent.com" || host.endsWith(".githubusercontent.com") || host === "github.com" ? url : null;
};

export function parseBranches(body: unknown): BranchRef[] {
  if (!Array.isArray(body)) return bad();
  return body.map((b) => {
    const name = isObject(b) ? str(b.name) : null;
    const sha = isObject(b) && isObject(b.commit) ? str(b.commit.sha) : null;
    if (name === null || sha === null || !SHA.test(sha) || !validRefName(name)) return bad();
    return { name, sha };
  });
}

export function parseBranch(body: unknown): BranchRef {
  const [one] = parseBranches([body]);
  return one;
}

export function parseCompare2(body: unknown): CompareSummary {
  if (!isObject(body)) return bad();
  const status = body.status;
  if (status !== "identical" && status !== "ahead" && status !== "behind" && status !== "diverged") return bad();
  return { status, aheadBy: count(body.ahead_by), behindBy: count(body.behind_by) };
}

export function parseCommitList(body: unknown): CommitRow[] {
  if (!Array.isArray(body)) return bad();
  return body.map((c) => {
    if (!isObject(c)) return bad();
    const sha = str(c.sha);
    const commit = isObject(c.commit) ? c.commit : null;
    const message = commit ? str(commit.message) : null;
    if (sha === null || !SHA.test(sha) || message === null) return bad();
    const gitAuthor = commit && isObject(commit.author) ? commit.author : null;
    const committer = commit && isObject(commit.committer) ? commit.committer : null;
    const when = (gitAuthor ? str(gitAuthor.date) : null) ?? (committer ? str(committer.date) : null);
    if (when === null || Number.isNaN(Date.parse(when))) return bad();
    const account = isObject(c.author) ? c.author : null;
    const login = account ? str(account.login) : null;
    const name = (gitAuthor ? str(gitAuthor.name) : null) ?? login ?? "Unknown author";
    return {
      sha,
      subject: message.split("\n")[0].trim().slice(0, 300) || "(no message)",
      authorName: name.slice(0, 100),
      authorLogin: login,
      avatarUrl: account ? avatar(account.avatar_url) : null,
      committedAt: when,
      url: httpUrl(c.html_url),
    } satisfies CommitRow;
  });
}

export function parseCommitFull(body: unknown): CommitFull {
  if (!isObject(body)) return bad();
  const [row] = parseCommitList([body]);
  const message = isObject(body.commit) ? (str(body.commit.message) ?? "") : "";
  const rest = message.split("\n").slice(1).join("\n").trim();
  const stats = isObject(body.stats) ? body.stats : null;
  const files = Array.isArray(body.files) ? parseFiles(body.files) : [];
  return {
    sha: row.sha,
    subject: row.subject,
    body: rest === "" ? null : rest,
    authorName: row.authorName,
    authorLogin: row.authorLogin,
    avatarUrl: row.avatarUrl,
    committedAt: row.committedAt,
    url: row.url,
    additions: stats ? count(stats.additions) : null,
    deletions: stats ? count(stats.deletions) : null,
    files,
    filesComplete: files.length < READ_LIMITS.compareFiles,
  };
}

const DEPLOY_STATES: readonly string[] = ["success", "failure", "error", "pending", "in_progress", "queued", "inactive"];

export function parseDeployments(body: unknown): Array<Omit<DeploymentRow, "state" | "statusDescription" | "logUrl" | "targetUrl">> {
  if (!Array.isArray(body)) return bad();
  return body.map((d) => {
    if (!isObject(d) || typeof d.id !== "number" || !Number.isSafeInteger(d.id)) return bad();
    const sha = str(d.sha);
    const ref = str(d.ref);
    const createdAt = str(d.created_at);
    if (sha === null || !SHA.test(sha) || ref === null || createdAt === null || Number.isNaN(Date.parse(createdAt))) return bad();
    return {
      id: d.id,
      sha,
      ref: ref.slice(0, 255),
      environment: (str(d.environment) ?? "unknown").slice(0, 100),
      createdAt,
      creator: isObject(d.creator) ? str(d.creator.login) : null,
      description: str(d.description)?.slice(0, 300) ?? null,
    };
  });
}

/** The newest status wins by its own timestamp, whatever order GitHub listed them in. */
export function parseLatestDeploymentStatus(body: unknown): Pick<DeploymentRow, "state" | "statusDescription" | "logUrl" | "targetUrl"> {
  if (!Array.isArray(body)) return bad();
  let latest: Record<string, unknown> | null = null;
  for (const s of body) {
    if (!isObject(s) || typeof s.state !== "string" || !DEPLOY_STATES.includes(s.state)) return bad();
    const at = Date.parse(str(s.created_at) ?? "");
    const best = latest ? Date.parse(str(latest.created_at) ?? "") : -Infinity;
    if (latest === null || (!Number.isNaN(at) && at >= best)) latest = s;
  }
  if (!latest) return { state: null, statusDescription: null, logUrl: null, targetUrl: null };
  return {
    state: latest.state as DeploymentRow["state"],
    statusDescription: str(latest.description)?.slice(0, 300) ?? null,
    logUrl: safeHttps(latest.log_url),
    targetUrl: safeHttps(latest.environment_url) ?? safeHttps(latest.target_url),
  };
}

// ---- reader ------------------------------------------------------------------------------------

export function createGitHubReader(call: Caller): GitHubReader {
  const api = "https://api.github.com";
  const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
  const repoPath = (fullName: string) => {
    if (!FULL_NAME.test(fullName)) throw new GitHubError("bad_response");
    return `${api}/repos/${fullName}`;
  };
  const shaPart = (sha: string) => {
    if (!SHA.test(sha)) throw new GitHubError("bad_response");
    return sha;
  };

  async function pagedFiles(token: string, base: string, extra: string, maxPages: number) {
    const files: RawFile[] = [];
    let truncated = false;
    for (let page = 1; page <= maxPages; page += 1) {
      const batch = parseFiles(await call(`${base}${extra}per_page=${READ_LIMITS.perPage}&page=${page}`, auth(token)));
      files.push(...batch);
      if (batch.length < READ_LIMITS.perPage) return { files, truncated };
    }
    truncated = true;
    return { files, truncated };
  }

  const reader: GitHubReader = {
    async resolveRepository(token, repositoryId) {
      const body = await call(`${api}/installation/repositories?per_page=${READ_LIMITS.perPage}`, auth(token));
      if (!isObject(body) || !Array.isArray(body.repositories)) return bad();
      for (const r of body.repositories) {
        if (isObject(r) && r.id === repositoryId) {
          const name = str(r.full_name);
          return name !== null && FULL_NAME.test(name) ? name : bad();
        }
      }
      return null;
    },

    async listPullRequests(token, fullName) {
      const out: PullRequestSummary[] = [];
      for (let page = 1; page <= READ_LIMITS.pullRequestPages; page += 1) {
        const batch = parsePullRequestList(
          await call(`${repoPath(fullName)}/pulls?state=all&sort=updated&direction=desc&per_page=${READ_LIMITS.perPage}&page=${page}`, auth(token)),
        );
        out.push(...batch);
        if (batch.length < READ_LIMITS.perPage) break;
      }
      return out;
    },

    async listPushes(token, fullName) {
      // Unfiltered on purpose: the filter would drop force pushes and branch creations, which are code changes too.
      return parsePushActivities(await call(`${repoPath(fullName)}/activity?per_page=${READ_LIMITS.pushPerPage}`, auth(token)));
    },

    async getPullRequest(token, fullName, number) {
      if (!Number.isSafeInteger(number) || number <= 0) throw new GitHubError("bad_response");
      return parsePullRequestDetail(await call(`${repoPath(fullName)}/pulls/${number}`, auth(token)));
    },

    async getPullRequestSummary(token, fullName, number) {
      if (!Number.isSafeInteger(number) || number <= 0) throw new GitHubError("bad_response");
      const [summary] = parsePullRequestList([await call(`${repoPath(fullName)}/pulls/${number}`, auth(token))]);
      return summary;
    },

    async listPullFiles(token, fullName, number) {
      if (!Number.isSafeInteger(number) || number <= 0) throw new GitHubError("bad_response");
      return pagedFiles(token, `${repoPath(fullName)}/pulls/${number}/files`, "?", READ_LIMITS.filePages);
    },

    async getPushDetail(token, fullName, before, after) {
      shaPart(after);
      // Both reads return the files of the first page only: at most 300 for a comparison, and 300 on the first
      // page of a commit. Reaching 300 means "at least", so it is reported as truncated, never as complete.
      const detail = ZERO_SHA.test(before)
        ? parseCommit(await call(`${repoPath(fullName)}/commits/${after}`, auth(token)))
        : parseCompare(await call(`${repoPath(fullName)}/compare/${shaPart(before)}...${after}`, auth(token)));
      const files = detail.files.slice(0, READ_LIMITS.compareFiles);
      return { ...detail, files, filesTruncated: detail.files.length >= READ_LIMITS.compareFiles };
    },

    async getPullRequestWithFiles(token, fullName, number) {
      // The metadata and the files come from separate requests, so a push in between could pair patches with
      // the wrong revision. Read the metadata again after the files; accept only an unchanged head commit.
      let latest: PullRequestDetail | null = null;
      for (let attempt = 0; attempt < READ_LIMITS.consistencyAttempts; attempt += 1) {
        const before = await reader.getPullRequest(token, fullName, number);
        const listed = await reader.listPullFiles(token, fullName, number);
        const after = await reader.getPullRequest(token, fullName, number);
        latest = after;
        if (before.headSha === after.headSha) return { pr: after, files: listed.files, truncated: listed.truncated, consistent: true };
      }
      return { pr: latest as PullRequestDetail, files: [], truncated: false, consistent: false };
    },

    async getDefaultBranch(token, fullName) {
      const body = await call(repoPath(fullName), auth(token));
      const name = isObject(body) ? str(body.default_branch) : null;
      return name !== null && validRefName(name) ? name : null;
    },

    async listBranches(token, fullName, page) {
      if (!Number.isSafeInteger(page) || page < 1 || page > READ_LIMITS.branchPages) throw new GitHubError("bad_response");
      const branches = parseBranches(await call(`${repoPath(fullName)}/branches?per_page=${READ_LIMITS.perPage}&page=${page}`, auth(token)));
      return { branches, hasMore: branches.length === READ_LIMITS.perPage };
    },

    async resolveBranch(token, fullName, name) {
      if (!validRefName(name)) return null;
      try {
        return parseBranch(await call(`${repoPath(fullName)}/branches/${encodeRefPath(name)}`, auth(token)));
      } catch (error) {
        if (error instanceof GitHubError && error.kind === "not_found") return null;
        throw error;
      }
    },

    async compareRefs(token, fullName, baseSha, headSha) {
      // Immutable SHAs, never moving names. per_page=1 keeps the reply small: only the counts are wanted here.
      return parseCompare2(await call(`${repoPath(fullName)}/compare/${shaPart(baseSha)}...${shaPart(headSha)}?per_page=1`, auth(token)));
    },

    async listCommits(token, fullName, query) {
      if (!validRefName(query.branch) || !Number.isSafeInteger(query.page) || query.page < 1) throw new GitHubError("bad_response");
      const params = new URLSearchParams({ sha: query.branch, per_page: String(READ_LIMITS.commitsPerPage), page: String(query.page) });
      if (query.author) params.set("author", query.author);
      if (query.path) params.set("path", query.path);
      if (query.since) params.set("since", query.since);
      if (query.until) params.set("until", query.until);
      const commits = parseCommitList(await call(`${repoPath(fullName)}/commits?${params.toString()}`, auth(token)));
      return { commits, hasMore: commits.length === READ_LIMITS.commitsPerPage };
    },

    async getCommitFull(token, fullName, sha) {
      return parseCommitFull(await call(`${repoPath(fullName)}/commits/${shaPart(sha)}`, auth(token)));
    },

    async listDeployments(token, fullName, page) {
      if (!Number.isSafeInteger(page) || page < 1) throw new GitHubError("bad_response");
      const rows = parseDeployments(await call(`${repoPath(fullName)}/deployments?per_page=${READ_LIMITS.deploymentsPerPage}&page=${page}`, auth(token)));
      const deployments: DeploymentRow[] = [];
      for (const row of rows) {
        // Latest status per deployment: the request is not the outcome.
        const status = parseLatestDeploymentStatus(await call(`${repoPath(fullName)}/deployments/${row.id}/statuses?per_page=5`, auth(token)));
        deployments.push({ ...row, ...status });
      }
      return { deployments, hasMore: rows.length === READ_LIMITS.deploymentsPerPage };
    },

    async listChecks(token, fullName, sha) {
      shaPart(sha);
      const runs: CheckRun[] = [];
      let partial = false;
      let complete = true;
      // A timeout or rate limit ends the whole read; any other failure of one source makes the result incomplete.
      const guarded = async (read: () => Promise<void>) => {
        try {
          await read();
        } catch (error) {
          if (error instanceof GitHubError && (error.kind === "timeout" || error.kind === "rate_limited")) throw error;
          complete = false;
        }
      };
      await guarded(async () => {
        for (let page = 1; page <= READ_LIMITS.checkPages; page += 1) {
          const batch = parseCheckRuns(await call(`${repoPath(fullName)}/commits/${sha}/check-runs?filter=latest&per_page=${READ_LIMITS.perPage}&page=${page}`, auth(token)));
          runs.push(...batch);
          if (batch.length < READ_LIMITS.perPage) return;
        }
        partial = true;
      });
      await guarded(async () => {
        const status = parseCombinedStatus(await call(`${repoPath(fullName)}/commits/${sha}/status?per_page=${READ_LIMITS.perPage}`, auth(token)));
        runs.push(...status.runs);
        if (status.total > status.runs.length) partial = true;
      });
      return { runs, partial, complete: complete && !partial };
    },
  };
  return reader;
}
