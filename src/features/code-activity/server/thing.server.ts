import { failure, isUuid, mapRpcError } from "./service.server";
import type { ErrorCode, RpcClient, ServiceResult } from "./service.server";

/**
 * Confirmed Thing creation (G15). The browser sends what the person reviewed; the database function checks the
 * caller, the List, the change, the assignee, the revision and the idempotency key, and creates the Thing and its
 * receipt together. This module only validates shape and maps errors to neutral codes.
 */

const IMPORTANCE = ["now", "next", "later"] as const;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;
const SHA = /^[0-9a-f]{40,64}$/i;

function mapConfirmError(error: { code?: string; message: string }): ErrorCode {
  const code = error.code ?? "";
  if (code === "55000") return "source_changed";
  if (code === "23505") return "conflict"; // the key was already used for different content
  if (code === "22023") return "invalid_request";
  if (code === "CA001") return "consent_withdrawn"; // AI-written text while AI is off or consent is not given
  return mapRpcError(error);
}

export async function assigneeCandidates(input: { user: RpcClient; listId: string }): Promise<ServiceResult> {
  if (!isUuid(input.listId)) return failure("invalid_request");
  const { data, error } = await input.user.rpc("code_activity_assignee_candidates", { p_list_id: input.listId });
  if (error) return failure(mapRpcError(error));
  const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  if (rows.length === 0) return failure("not_allowed"); // not allowed to create here, or the feature is off: indistinguishable
  return {
    status: 200,
    body: {
      candidates: rows.map((r) => ({ actorId: r.actor_id, name: r.name, role: r.role, isSelf: r.is_self === true })),
    },
  };
}

export interface ConfirmInput {
  user: RpcClient;
  listId: unknown;
  changeId: unknown;
  key: unknown;
  title: unknown;
  notes: unknown;
  assigneeActorId: unknown;
  dueAt: unknown;
  importance: unknown;
  headSha: unknown;
  acknowledgeSourceChange: unknown;
  aiGenerated: unknown;
}

export async function confirmDraft(input: ConfirmInput): Promise<ServiceResult> {
  const { listId, changeId, key, assigneeActorId } = input;
  if (!isUuid(listId) || !isUuid(changeId) || !isUuid(key) || !isUuid(assigneeActorId)) return failure("invalid_request");
  if (typeof input.title !== "string" || input.title.trim().length === 0 || input.title.length > 300) return failure("invalid_request");
  if (input.notes !== null && input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 8000)) return failure("invalid_request");
  if (typeof input.importance !== "string" || !(IMPORTANCE as readonly string[]).includes(input.importance)) return failure("invalid_request");
  if (input.dueAt !== null && input.dueAt !== undefined && (typeof input.dueAt !== "string" || !ISO_INSTANT.test(input.dueAt) || Number.isNaN(Date.parse(input.dueAt)))) return failure("invalid_request");
  if (input.headSha !== null && input.headSha !== undefined && (typeof input.headSha !== "string" || !SHA.test(input.headSha))) return failure("invalid_request");
  if (typeof input.acknowledgeSourceChange !== "boolean" || typeof input.aiGenerated !== "boolean") return failure("invalid_request");

  const { data, error } = await input.user.rpc("confirm_code_activity_draft", {
    p_list_id: listId,
    p_change_id: changeId,
    p_idempotency_key: key,
    p_title: input.title,
    p_notes: typeof input.notes === "string" ? input.notes : null,
    p_assignee_actor_id: assigneeActorId,
    p_due_at: typeof input.dueAt === "string" ? input.dueAt : null,
    p_importance: input.importance,
    p_head_sha: typeof input.headSha === "string" ? input.headSha : null,
    p_acknowledge_source_change: input.acknowledgeSourceChange,
    p_ai_generated: input.aiGenerated,
  });
  if (error) return failure(mapConfirmError(error));
  const row = Array.isArray(data) ? (data[0] as { o_thing_id?: string | null; o_replayed?: boolean } | undefined) : undefined;
  if (!row) return failure("source_unavailable");
  return { status: 200, body: { thingId: row.o_thing_id ?? null, replayed: row.o_replayed === true } };
}

export interface WorkspaceConfirmInput {
  user: RpcClient;
  listId: unknown;
  sourceId: unknown;
  key: unknown;
  title: unknown;
  notes: unknown;
  assigneeActorId: unknown;
  dueAt: unknown;
  importance: unknown;
  reviewedSha: unknown;
  acknowledgeSourceChange: unknown;
}

/**
 * Manual creation from a registered workspace source. There is no AI input at all: the person's own words become the Thing.
 * The database function checks everything again; this validates shape and maps errors.
 */
export async function confirmWorkspaceThing(input: WorkspaceConfirmInput): Promise<ServiceResult> {
  const { listId, sourceId, key, assigneeActorId } = input;
  if (!isUuid(listId) || !isUuid(sourceId) || !isUuid(key) || !isUuid(assigneeActorId)) return failure("invalid_request");
  if (typeof input.title !== "string" || input.title.trim().length === 0 || input.title.length > 300) return failure("invalid_request");
  if (input.notes !== null && input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 8000)) return failure("invalid_request");
  if (typeof input.importance !== "string" || !(IMPORTANCE as readonly string[]).includes(input.importance)) return failure("invalid_request");
  if (input.dueAt !== null && input.dueAt !== undefined && (typeof input.dueAt !== "string" || !ISO_INSTANT.test(input.dueAt) || Number.isNaN(Date.parse(input.dueAt)))) return failure("invalid_request");
  if (input.reviewedSha !== null && input.reviewedSha !== undefined && (typeof input.reviewedSha !== "string" || !SHA.test(input.reviewedSha))) return failure("invalid_request");
  if (typeof input.acknowledgeSourceChange !== "boolean") return failure("invalid_request");

  const { data, error } = await input.user.rpc("confirm_code_activity_workspace_thing", {
    p_list_id: listId,
    p_source_id: sourceId,
    p_idempotency_key: key,
    p_title: input.title,
    p_notes: typeof input.notes === "string" ? input.notes : null,
    p_assignee_actor_id: assigneeActorId,
    p_due_at: typeof input.dueAt === "string" ? input.dueAt : null,
    p_importance: input.importance,
    p_reviewed_sha: typeof input.reviewedSha === "string" ? input.reviewedSha.toLowerCase() : null,
    p_acknowledge_source_change: input.acknowledgeSourceChange,
  });
  if (error) return failure(mapConfirmError(error));
  const row = Array.isArray(data) ? (data[0] as { o_thing_id?: string | null; o_replayed?: boolean } | undefined) : undefined;
  if (!row) return failure("source_unavailable");
  return { status: 200, body: { thingId: row.o_thing_id ?? null, replayed: row.o_replayed === true } };
}
