import type { CheckRun, CheckState, ChangeFile, PullRequestState } from "../types";

/**
 * The workspace's own item model. It is NOT an `ActivityChange`: commits, checks and deployments are new kinds that the
 * saved-feed table and its parsers do not know, and they must never be squeezed into a "push". Saved pull requests and
 * pushes are adapted into this shape; the legacy parsers stay as they are.
 */
export type WorkspaceKind = "commit" | "pull_request" | "push" | "check" | "deployment";
export type WorkspaceCategory = "all" | "commits" | "pull_requests" | "checks" | "deployments";
export type StatsStatus = "loaded" | "loading" | "unavailable" | "unknown";

export interface WorkspaceAuthor {
  name: string;
  /** GitHub login when known. Katalist members are never matched to GitHub identities by name. */
  login: string | null;
  avatarUrl: string | null;
}

/** Each number is null when unknown. Unknown is never zero. */
export interface WorkspaceStats {
  additions: number | null;
  deletions: number | null;
  files: number | null;
}

export interface WorkspaceDeployment {
  id: string;
  environment: string;
  ref: string;
  /** The latest recorded status, not the request. Null when no status was read. */
  state: DeploymentState | null;
  description: string | null;
  links: { log: string | null; target: string | null };
}
export type DeploymentState = "success" | "failure" | "error" | "pending" | "in_progress" | "queued" | "inactive";

export interface WorkspaceItem {
  /** Stable identity: commit:<sha>, pr:<number>, push:<saved id>, deployment:<id>, check:<sha>. */
  id: string;
  kind: WorkspaceKind;
  title: string;
  author: WorkspaceAuthor;
  /** ISO timestamp of the activity. */
  occurredAt: string;
  branch: string | null;
  /** Base branch, pull requests only. */
  baseBranch: string | null;
  /** Full SHA. The pill shows seven characters; copy copies this. */
  sha: string | null;
  number: number | null;
  prState: PullRequestState | null;
  checkState: CheckState | null;
  /** Revision the check state belongs to. Equal to `sha` when current. */
  checksRevision: string | null;
  checks: { passed: number; failing: number; pending: number; total: number } | null;
  stats: WorkspaceStats | null;
  statsStatus: StatsStatus;
  url: string | null;
  /** Saved feed row id: the existing detail route reads pull requests and pushes by it. */
  savedId: string | null;
  deployment: WorkspaceDeployment | null;
}

export interface WorkspaceDetail {
  kind: WorkspaceKind;
  id: string;
  title: string;
  /** The rest of a commit message, or a pull request description. Text, never markup. */
  body: string | null;
  author: WorkspaceAuthor;
  occurredAt: string;
  sha: string | null;
  branch: string | null;
  base: string | null;
  url: string | null;
  stats: WorkspaceStats | null;
  /** True when every file was listed, so the totals are exact. */
  statsComplete: boolean;
  files: ChangeFile[];
  filesPartial: boolean;
  filesUnavailableReason: "revision_changed" | null;
  checks: CheckRun[];
  checkState: CheckState;
  checksRevision: string | null;
  checksPartial: boolean;
  deployment: WorkspaceDeployment | null;
}

export type WorkspaceStatus = string;

/** What the Status filter compares: PR state, deployment state or check state, whichever the item carries. */
export function statusOf(item: WorkspaceItem): string {
  if (item.kind === "pull_request") return item.prState ?? "unknown";
  if (item.kind === "deployment") return item.deployment?.state ?? "unknown";
  return item.checkState ?? "unknown";
}
