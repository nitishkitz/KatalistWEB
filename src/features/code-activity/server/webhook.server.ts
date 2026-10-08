import { createHmac, timingSafeEqual } from "node:crypto";
import { isUuid } from "./service.server";
import type { RpcClient, ServiceResult } from "./service.server";

/**
 * GitHub webhook intake (G11). Verifies the HMAC over the RAW bytes (bounded) before any JSON parsing, stores
 * compact identifiers only, and answers quickly. No titles, bodies, patches or payload copies are kept, and nothing
 * here calls GitHub or touches a connection: all processing happens later from the queue.
 */

export const WEBHOOK_LIMITS = {
  /** 2 MiB: well inside the host's 4.5 MB request cap. Larger events are rejected, never silently truncated. */
  bodyBytes: 2_097_152,
} as const;

const HANDLED = ["push", "pull_request", "check_run", "status", "installation", "installation_repositories"] as const;
export type HandledEvent = (typeof HANDLED)[number];

const reply = (status: number, error?: string): ServiceResult => ({ status, body: error ? { error } : { ok: true } });

/** Reads at most `limit` bytes. Returns null when the body is larger, without buffering the excess. */
export async function readBoundedBody(request: Request, limit: number = WEBHOOK_LIMITS.bodyBytes): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** `X-Hub-Signature-256: sha256=<hex>` over the raw body, compared in constant time. */
export function verifySignature(secret: string, body: Uint8Array, header: string | null): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const posInt = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
const SHA = /^[0-9a-f]{40,64}$/i;

export interface ExtractedDelivery {
  action: string | null;
  installationId: number;
  repositoryId: number | null;
  /** Identifiers only. At most 4 KiB, enforced again by the database. */
  refetch: Record<string, unknown>;
  /** installation_repositories "removed": EVERY id, never a truncated list. Stored in chunks by the database. */
  removedRepositoryIds?: number[];
  /** More removals than can be listed: processed fail-closed instead of guessed at. */
  removedOverflow?: boolean;
}

/** The most ids intake will pass on. Beyond this the removal is recorded as an overflow (fail closed). */
export const REMOVAL_ID_LIMIT = 20_000;

/** Pulls the compact identifiers out of a payload. Null means the payload lacks what processing needs. */
export function extractDelivery(event: HandledEvent, payload: unknown): ExtractedDelivery | null {
  if (!isObject(payload)) return null;
  const installationId = isObject(payload.installation) ? posInt(payload.installation.id) : null;
  if (installationId === null) return null;
  const action = text(payload.action, 64);
  const repositoryId = isObject(payload.repository) ? posInt(payload.repository.id) : null;
  const base = { action, installationId, repositoryId };

  switch (event) {
    case "push": {
      const ref = text(payload.ref, 250);
      const before = text(payload.before, 64);
      const after = text(payload.after, 64);
      if (repositoryId === null || !ref || !before || !after || !SHA.test(after)) return null;
      const head = isObject(payload.head_commit) ? text(payload.head_commit.timestamp, 40) : null;
      const sender = isObject(payload.sender) ? text(payload.sender.login, 100) : null;
      return { ...base, refetch: { ref, before, after, timestamp: head, sender, deleted: payload.deleted === true } };
    }
    case "pull_request": {
      const number = posInt(payload.number);
      if (repositoryId === null || number === null) return null;
      return { ...base, refetch: { number } };
    }
    case "check_run": {
      const sha = isObject(payload.check_run) ? text(payload.check_run.head_sha, 64) : null;
      if (repositoryId === null || !sha || !SHA.test(sha)) return null;
      return { ...base, refetch: { sha } };
    }
    case "status": {
      const sha = text(payload.sha, 64);
      if (repositoryId === null || !sha || !SHA.test(sha)) return null;
      return { ...base, refetch: { sha } };
    }
    case "installation":
      return { ...base, repositoryId: null, refetch: {} };
    case "installation_repositories": {
      // Nothing is dropped. The ids are split into rows of 200 by the database, all in one transaction.
      const listed = Array.isArray(payload.repositories_removed) ? payload.repositories_removed : [];
      const ids = listed.map((r) => (isObject(r) ? posInt(r.id) : null)).filter((id): id is number => id !== null);
      if (action === "removed" && (listed.length > REMOVAL_ID_LIMIT || ids.length !== listed.length)) {
        // Too many to list, or an entry that could not be read: do not guess which repositories lost access.
        return { ...base, repositoryId: null, refetch: {}, removedOverflow: true };
      }
      return { ...base, repositoryId: null, refetch: {}, removedRepositoryIds: ids };
    }
  }
}

export interface WebhookDeps {
  secret: string | null;
  admin: () => RpcClient;
}

export async function handleWebhook(deps: WebhookDeps, request: Request): Promise<ServiceResult> {
  if (request.method !== "POST") return reply(405, "method_not_allowed");
  if (!deps.secret) return reply(503, "not_configured");

  const body = await readBoundedBody(request);
  if (body === null) return reply(413, "too_large");
  // The signature is checked before the body is parsed or any field is trusted.
  if (!verifySignature(deps.secret, body, request.headers.get("x-hub-signature-256"))) return reply(401, "unauthorized");

  const event = request.headers.get("x-github-event");
  const delivery = request.headers.get("x-github-delivery");
  if (event === "ping") return reply(200);
  if (!event || !(HANDLED as readonly string[]).includes(event)) return reply(202); // verified but not subscribed: nothing to store
  if (!delivery || !isUuid(delivery)) return reply(400, "bad_request");

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return reply(400, "bad_request");
  }
  const extracted = extractDelivery(event as HandledEvent, payload);
  if (!extracted) return reply(202); // verified, but missing the identifiers processing needs: nothing to do

  if (event === "installation_repositories" && extracted.action === "removed") {
    const removal = await deps.admin().rpc("code_activity_server_record_removal", {
      p_delivery_id: delivery,
      p_installation_id: extracted.installationId,
      p_repository_ids: extracted.removedRepositoryIds ?? [],
      p_overflow: extracted.removedOverflow === true,
    });
    if (removal.error) return reply(503, "unavailable");
    if (removal.data === "recorded") return reply(202);
    if (removal.data === "duplicate") return reply(200);
    return reply(503, "disabled");
  }
  if (event === "installation_repositories") return reply(202); // "added": nothing to do

  const recorded = await deps.admin().rpc("code_activity_server_record_delivery", {
    p_delivery_id: delivery,
    p_event: event,
    p_action: extracted.action,
    p_installation_id: extracted.installationId,
    p_repository_id: extracted.repositoryId,
    p_refetch: extracted.refetch,
  });
  if (recorded.error) return reply(503, "unavailable");
  if (recorded.data === "recorded") return reply(202);
  if (recorded.data === "duplicate") return reply(200);
  // "disabled": nothing was stored. A 503 makes GitHub show the delivery as failed so it can be redelivered later.
  return reply(503, "disabled");
}
