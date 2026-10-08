import type { ActivityChange } from "../types";
import type { CommitInfo, DeploymentInfo, StatsResult } from "../live/workspace-api";
import type { WorkspaceDetail, WorkspaceItem } from "./types";

const EMPTY = { checkState: null, checksRevision: null, checks: null, stats: null, statsStatus: "unknown" as const, deployment: null, savedId: null, baseBranch: null, number: null, prState: null, branch: null };

export function fromCommit(c: CommitInfo, branch: string): WorkspaceItem {
  return { ...EMPTY, id: `commit:${c.sha}`, kind: "commit", title: c.subject, author: { name: c.authorName, login: c.authorLogin, avatarUrl: c.avatarUrl }, occurredAt: c.committedAt, branch, sha: c.sha, url: c.url };
}

/** Saved pull requests and pushes. Gaps are history markers, not activity, so they are not rows. */
export function fromSaved(c: ActivityChange): WorkspaceItem | null {
  if (c.kind === "gap") return null;
  const base = {
    ...EMPTY,
    title: c.title,
    author: { name: c.author.name, login: c.author.kind === "user" ? c.author.name : null, avatarUrl: null },
    occurredAt: c.updatedAt,
    branch: c.headBranch,
    baseBranch: c.baseBranch,
    sha: c.headSha,
    checkState: c.checkState,
    checksRevision: c.checksRevision,
    stats: c.additions === null && c.deletions === null && c.changedFiles === null ? null : { additions: c.additions, deletions: c.deletions, files: c.changedFiles },
    statsStatus: (c.additions === null && c.deletions === null ? "unknown" : "loaded") as WorkspaceItem["statsStatus"],
    url: c.sourceUrl ?? c.commitUrl,
    savedId: c.id,
  };
  return c.kind === "pull_request"
    ? { ...base, id: `pr:${c.number}`, kind: "pull_request", number: c.number, prState: c.prState }
    : { ...base, id: `push:${c.id}`, kind: "push" };
}

export function fromDeployment(d: DeploymentInfo): WorkspaceItem {
  return {
    ...EMPTY,
    id: `deployment:${d.id}`,
    kind: "deployment",
    title: `${d.environment} deployment`,
    author: { name: d.creator ?? "Unknown", login: d.creator, avatarUrl: null },
    occurredAt: d.createdAt,
    branch: d.ref || null,
    sha: d.sha,
    url: d.links.target ?? d.links.log,
    deployment: { id: d.id, environment: d.environment, ref: d.ref, state: d.state, description: d.description, links: d.links },
  };
}

/** Applies a stats result without ever turning an unknown into zero. */
export function applyStats(item: WorkspaceItem, r: StatsResult): WorkspaceItem {
  if (r.status !== "ok") return { ...item, statsStatus: "unavailable" };
  return {
    ...item,
    stats: { additions: r.additions, deletions: r.deletions, files: r.files },
    statsStatus: "loaded",
    checkState: r.checkState ?? item.checkState,
    checksRevision: r.checkState ? r.revision : item.checksRevision,
    checks: r.checks ?? item.checks,
  };
}

/** A saved change detail as a workspace detail, so one view renders both. */
export function detailFromChange(c: ActivityChange): WorkspaceDetail {
  return {
    kind: c.kind === "pull_request" ? "pull_request" : "push",
    id: c.kind === "pull_request" ? `pr:${c.number}` : `push:${c.id}`,
    title: c.title,
    body: c.description,
    author: { name: c.author.name, login: c.author.kind === "user" ? c.author.name : null, avatarUrl: null },
    occurredAt: c.updatedAt,
    sha: c.headSha,
    branch: c.headBranch,
    base: c.baseBranch,
    url: c.sourceUrl ?? c.commitUrl,
    stats: { additions: c.additions, deletions: c.deletions, files: c.changedFiles },
    statsComplete: !c.filesPartial,
    files: c.files,
    filesPartial: c.filesPartial,
    filesUnavailableReason: c.filesUnavailableReason ?? null,
    checks: c.checks,
    checkState: c.checkState,
    checksRevision: c.checksRevision,
    checksPartial: c.checksPartial,
    deployment: null,
  };
}
