import { createMeter } from "./budget.server";
import { safeEqual } from "./crypto.server";
import { runRefresh, checkStateFor, pushItem, pullRequestItem } from "./activity.server";
import type { FeedItem } from "./activity.server";
import { GitHubError } from "./github.server";
import type { GitHubClient } from "./github.server";
import type { Deps, RpcClient } from "./service.server";

/**
 * Durable processing and recovery (G12): claims queued webhook deliveries under a global lease cap, applies
 * each one by REFETCHING current state from GitHub (never trusting the payload for content), then reconciles
 * connections that are due for a full refresh. Safe to run concurrently and repeatedly: leases fence every write,
 * rows never move backwards in time, and a crashed run's work is claimed again when its lease expires.
 */

export const DRAIN_LIMITS = {
  deliveriesPerRun: 4,
  perDeliveryDeadlineMs: 30_000,
  /** Stop starting new work after this long so a serverless run ends before the host's own limit. */
  runBudgetMs: 90_000,
  reconcilePerRun: 1,
} as const;

/** Constant-time check of the scheduler credential. Accepts `Authorization: Bearer` or `x-cron-secret`. */
export function authorizeDrain(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const bearer = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  return safeEqual(bearer, `Bearer ${secret}`) || safeEqual(header, secret);
}

interface Claimed {
  o_delivery_id: string;
  o_event: string;
  o_action: string | null;
  o_installation_id: number | string;
  o_repository_id: number | string | null;
  o_refetch: Record<string, unknown>;
  o_attempts: number;
  o_lease_token: string;
}

type Outcome = { outcome: "processed" | "ignored" | "retry" | "dead"; code?: string };

export interface DrainResult {
  claimed: number;
  processed: number;
  ignored: number;
  retried: number;
  dead: number;
  reconciled: number;
  pruned: number;
}

async function processDelivery(deps: Deps, d: Claimed): Promise<Outcome> {
  const admin = deps.admin();
  const installationId = Number(d.o_installation_id);
  const refetch = d.o_refetch ?? {};

  // Every write below carries THIS delivery's lease token; the database refuses it once the lease is gone.
  const lease = { p_delivery_id: d.o_delivery_id, p_lease_token: d.o_lease_token };
  const failed = (error: { code?: string }): Outcome => ({ outcome: "retry", code: error.code === "40001" ? "lease_lost" : "database" });

  if (d.o_event === "installation" || d.o_event === "installation_repositories") {
    let action: string | null = null;
    if (d.o_event === "installation") action = d.o_action;
    else if (d.o_action === "removed" || d.o_action === "removed_overflow") action = d.o_action;
    if (!action || !["suspend", "unsuspend", "deleted", "removed", "removed_overflow"].includes(action)) return { outcome: "ignored" };
    const removed = Array.isArray(refetch.removed) ? (refetch.removed as number[]) : null;
    const result = await admin.rpc("code_activity_server_apply_installation_event", { p_installation_id: installationId, p_action: action, p_removed_repository_ids: removed, ...lease });
    return result.error ? failed(result.error) : { outcome: "processed" };
  }

  const repositoryId = Number(d.o_repository_id);
  if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId)) return { outcome: "ignored" };
  const found = await admin.rpc("code_activity_server_connections_for_event", { p_installation_id: installationId, p_repository_id: repositoryId });
  if (found.error) return { outcome: "retry", code: "database" };
  const connections = Array.isArray(found.data) ? (found.data as Array<{ o_connection_id: string; o_generation: number }>) : [];
  if (connections.length === 0) return { outcome: "ignored" }; // nobody follows this repository (any more)

  // Tags and branch deletions are not code changes: decided from the stored identifiers, before any provider work.
  if (d.o_event === "push") {
    const ref = String(refetch.ref ?? "");
    if (!ref.startsWith("refs/heads/") || refetch.deleted === true || /^0+$/.test(String(refetch.after ?? ""))) return { outcome: "ignored" };
  }

  if (!deps.config.configured || !deps.github) return { outcome: "retry", code: "not_configured" };
  try {
    // Every provider request of this delivery is counted against the installation's background budget.
    const github: GitHubClient = deps.github.withDeadline(DRAIN_LIMITS.perDeliveryDeadlineMs).withMeter(createMeter(deps.admin, installationId, false));
    const token = (await github.mintInstallationToken({ installationId, repositoryId })).token;
    const fullName = await github.resolveRepository(token, repositoryId);
    if (fullName === null) return { outcome: "retry", code: "repository_unreachable" };

    let items: FeedItem[] = [];
    let checkSha: string | null = null;
    if (d.o_event === "push") {
      const ref = String(refetch.ref ?? "");
      const after = String(refetch.after ?? "");
      const branch = ref.slice("refs/heads/".length);
      const stamp = typeof refetch.timestamp === "string" && !Number.isNaN(Date.parse(refetch.timestamp)) ? refetch.timestamp : new Date().toISOString();
      const sender = typeof refetch.sender === "string" ? refetch.sender : null;
      items = [pushItem({ key: `${branch}@${after}`, branch, before: String(refetch.before ?? ""), after, authorLogin: sender, authorKind: sender ? "user" : "unknown", timestamp: stamp }, fullName)];
      checkSha = after;
    } else if (d.o_event === "pull_request") {
      const pr = await github.getPullRequestSummary(token, fullName, Number(refetch.number));
      items = [pullRequestItem(pr)];
      checkSha = pr.headSha;
    } else {
      checkSha = typeof refetch.sha === "string" ? refetch.sha : null; // check_run and status
    }

    let state: string | null = null;
    if (checkSha) {
      const checks = await github.listChecks(token, fullName, checkSha);
      state = checkStateFor(checks);
      for (const item of items) {
        item.check_state = state;
        item.checks_revision = checkSha;
      }
    }

    for (const connection of connections) {
      if (items.length > 0) {
        const applied = await admin.rpc("code_activity_server_apply_items", { p_connection_id: connection.o_connection_id, p_generation: connection.o_generation, p_items: items, ...lease });
        if (applied.error) return failed(applied.error);
      } else if (checkSha && state) {
        const applied = await admin.rpc("code_activity_server_set_check_state", { p_connection_id: connection.o_connection_id, p_generation: connection.o_generation, p_sha: checkSha, p_state: state, ...lease });
        if (applied.error) return failed(applied.error);
      }
    }
    return { outcome: "processed" };
  } catch (error) {
    if (error instanceof GitHubError) {
      if (error.kind === "budget") return { outcome: "retry", code: "budget" };
      if (error.kind === "rate_limited") {
        await Promise.resolve(admin.rpc("code_activity_server_block_installation", { p_installation_id: installationId, p_seconds: error.retryAfterSeconds ?? 60 })).catch(() => undefined);
      }
      return { outcome: "retry", code: `github_${error.kind}` };
    }
    return { outcome: "retry", code: "error" };
  }
}

export async function drain(deps: Deps, options: { limit?: number; now?: () => number } = {}): Promise<DrainResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const result: DrainResult = { claimed: 0, processed: 0, ignored: 0, retried: 0, dead: 0, reconciled: 0, pruned: 0 };
  const admin: RpcClient = deps.admin();

  // Claim ONE delivery at a time, immediately before working on it. Claiming a batch up front would start every lease
  // clock together while the deliveries are processed one after another, so later ones could outlive their lease.
  const limit = Math.min(Math.max(options.limit ?? DRAIN_LIMITS.deliveriesPerRun, 0), DRAIN_LIMITS.deliveriesPerRun);
  for (let i = 0; i < limit; i += 1) {
    if (now() - started > DRAIN_LIMITS.runBudgetMs) break; // leave the rest queued for the next run
    const claimed = await admin.rpc("code_activity_server_claim_deliveries", { p_limit: 1 });
    const row = !claimed.error && Array.isArray(claimed.data) ? (claimed.data[0] as Claimed | undefined) : undefined;
    if (!row) break;
    result.claimed += 1;
    const outcome: Outcome = await processDelivery(deps, row).catch((): Outcome => ({ outcome: "retry", code: "error" }));
    const finished = await admin.rpc("code_activity_server_finish_delivery", {
      p_delivery_id: row.o_delivery_id,
      p_lease_token: row.o_lease_token,
      p_outcome: outcome.outcome,
      p_error_code: outcome.code ?? null,
    });
    if (finished.error || finished.data !== true) continue; // the lease was lost; the new holder owns the outcome
    if (outcome.outcome === "processed") result.processed += 1;
    else if (outcome.outcome === "ignored") result.ignored += 1;
    else if (outcome.outcome === "dead") result.dead += 1;
    else result.retried += 1;
  }

  // Reconcile connections that are due (never synced, or stale), using the same read as the user's Refresh.
  if (now() - started < DRAIN_LIMITS.runBudgetMs) {
    const due = await admin.rpc("code_activity_server_begin_reconcile", { p_limit: DRAIN_LIMITS.reconcilePerRun, p_stale_after_minutes: 360 });
    const leases = !due.error && Array.isArray(due.data) ? (due.data as Array<{ o_connection_id: string; o_list_id: string; o_generation: number; o_lease_token: string }>) : [];
    for (const lease of leases) {
      const done = await runRefresh(deps, { listId: lease.o_list_id, lease: { connectionId: lease.o_connection_id, generation: lease.o_generation, leaseToken: lease.o_lease_token }, interactive: false });
      if (done.status === 200) result.reconciled += 1;
    }
  }

  const pruned = await admin.rpc("code_activity_server_prune_deliveries", {});
  if (!pruned.error && typeof pruned.data === "number") result.pruned = pruned.data;
  return result;
}
