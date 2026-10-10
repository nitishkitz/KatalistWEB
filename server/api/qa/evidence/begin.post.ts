import { defineEventHandler, readBody } from "h3";
import { requireUser } from "../../../lib/require-user";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { fromRpcError, isUuid, noStore, qaError } from "../../../lib/qa/http";

export const QA_EVIDENCE_BUCKET = "qa-evidence";

/**
 * Step 1 of an evidence upload. The caller's session authorises the attempt (membership, role,
 * run state, type, size and count rules all live in qa_begin_evidence); only then does the service
 * role mint a single-object signed upload URL. The browser never gets bucket-wide access.
 */
export default defineEventHandler(async (event) => {
  noStore(event);
  const { client } = await requireUser(event);
  const body = (await readBody(event)) as { attemptId?: unknown; fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown; checksum?: unknown } | null;
  if (!body || !isUuid(body.attemptId) || typeof body.fileName !== "string" || typeof body.mimeType !== "string" || typeof body.sizeBytes !== "number") {
    throw qaError(400, "invalid_input", "attemptId, fileName, mimeType and sizeBytes are required.");
  }
  const { data, error } = await client.rpc("qa_begin_evidence", {
    p_attempt_id: body.attemptId,
    p_file_name: body.fileName,
    p_mime_type: body.mimeType,
    p_size_bytes: Math.floor(body.sizeBytes),
    p_checksum: typeof body.checksum === "string" ? body.checksum : null,
  });
  if (error || !data) throw fromRpcError(error, "The upload could not be started.");
  const row = data as { id: string; storage_key: string };
  const { data: signed, error: signError } = await getSupabaseAdmin().storage.from(QA_EVIDENCE_BUCKET).createSignedUploadUrl(row.storage_key);
  if (signError || !signed) {
    await client.rpc("qa_abort_evidence", { p_evidence_id: row.id });
    throw qaError(502, "storage_unavailable", "Evidence storage is unavailable. Try again shortly.");
  }
  return { evidenceId: row.id, bucket: QA_EVIDENCE_BUCKET, path: row.storage_key, token: signed.token };
});
