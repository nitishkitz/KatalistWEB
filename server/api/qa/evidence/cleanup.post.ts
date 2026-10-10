import { defineEventHandler, getHeader } from "h3";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { noStore, qaError } from "../../../lib/qa/http";

/**
 * Orphan sweep for abandoned pending uploads (older than a day). Guarded by CRON_SECRET; it is NOT
 * registered in vercel.json, so scheduling it is an explicit operations step.
 */
export default defineEventHandler(async (event) => {
  noStore(event);
  const secret = process.env.CRON_SECRET;
  if (!secret || getHeader(event, "authorization") !== `Bearer ${secret}`) throw qaError(401, "not_authenticated", "Unauthorized.");
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("qa_stale_pending_evidence", { p_older_than: "1 day" });
  if (error) throw qaError(500, "unknown", "Sweep failed.");
  const stale = (data ?? []) as Array<{ id: string; storage_key: string }>;
  if (stale.length) {
    const { error: removeError } = await admin.storage.from("qa-evidence").remove(stale.map((s) => s.storage_key));
    // Retain pending references until object deletion succeeds, so the next sweep can retry.
    if (removeError) throw qaError(502, "storage_unavailable", "Evidence cleanup could not remove the stored files.");
    const { error: deleteError } = await admin.from("qa_attempt_evidence").delete().in("id", stale.map((s) => s.id)).eq("status", "pending");
    if (deleteError) throw qaError(500, "unknown", "Evidence cleanup could not remove the pending records.");
  }
  return { removed: stale.length };
});
