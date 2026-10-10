import { defineEventHandler, readBody } from "h3";
import { requireUser } from "../../../lib/require-user";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { fromRpcError, isUuid, noStore, qaError } from "../../../lib/qa/http";

const BUCKET = "qa-evidence";

/**
 * Step 2: confirm the object really exists with the declared size before the row becomes visible
 * to other members. A missing or mismatched object aborts the pending row and removes any bytes.
 */
export default defineEventHandler(async (event) => {
  noStore(event);
  const { userId, client } = await requireUser(event);
  const body = (await readBody(event)) as { evidenceId?: unknown } | null;
  if (!body || !isUuid(body.evidenceId)) throw qaError(400, "invalid_input", "evidenceId is required.");

  const { data: pending, error: readError } = await client
    .from("qa_attempt_evidence")
    .select("id, storage_key, size_bytes, status, created_by")
    .eq("id", body.evidenceId)
    .maybeSingle();
  if (readError || !pending) throw qaError(404, "not_found", "Evidence not found.");
  if (pending.created_by !== userId) throw qaError(403, "forbidden", "Only the uploader can finalize this evidence.");
  if (pending.status === "ready") return { evidenceId: pending.id, status: "ready" };

  const storage = getSupabaseAdmin().storage.from(BUCKET);
  const slash = pending.storage_key.lastIndexOf("/");
  const { data: listed, error: listError } = await storage.list(pending.storage_key.slice(0, slash), {
    search: pending.storage_key.slice(slash + 1),
    limit: 5,
  });
  const object = listed?.find((o) => o.name === pending.storage_key.slice(slash + 1));
  const size = Number((object?.metadata as { size?: number } | null | undefined)?.size ?? NaN);
  if (listError || !object || size !== Number(pending.size_bytes)) {
    await client.rpc("qa_abort_evidence", { p_evidence_id: pending.id });
    if (object) await storage.remove([pending.storage_key]);
    throw qaError(422, "upload_incomplete", "The upload did not complete correctly. Attach the file again.");
  }
  const { data, error } = await getSupabaseAdmin().rpc("qa_finalize_evidence", { p_evidence_id: pending.id, p_actor_id: userId });
  if (error || !data) throw fromRpcError(error, "The evidence could not be saved.");
  return { evidenceId: pending.id, status: "ready" };
});
