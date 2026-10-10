import { defineEventHandler, readBody } from "h3";
import { requireUser } from "../../../lib/require-user";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { fromRpcError, isUuid, noStore, qaError } from "../../../lib/qa/http";

/** Cancels a pending upload (user cancel or client-side failure) and removes any partial object. */
export default defineEventHandler(async (event) => {
  noStore(event);
  const { client } = await requireUser(event);
  const body = (await readBody(event)) as { evidenceId?: unknown } | null;
  if (!body || !isUuid(body.evidenceId)) throw qaError(400, "invalid_input", "evidenceId is required.");
  const { data, error } = await client.rpc("qa_abort_evidence", { p_evidence_id: body.evidenceId });
  if (error) throw fromRpcError(error, "The upload could not be cancelled.");
  if (typeof data === "string") await getSupabaseAdmin().storage.from("qa-evidence").remove([data]);
  return { ok: true };
});
