import { defineEventHandler, readBody } from "h3";
import { requireUser } from "../../../lib/require-user";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { isUuid, noStore, qaError } from "../../../lib/qa/http";

const BUCKET = "qa-evidence";
const TTL_SECONDS = 300;
const MAX_IDS = 50;

/**
 * Signs short-lived read URLs only for evidence rows the caller's RLS-scoped read can see
 * (ready rows in a List they belong to). Arbitrary storage paths are never accepted.
 */
export default defineEventHandler(async (event) => {
  noStore(event);
  const { client } = await requireUser(event);
  const body = (await readBody(event)) as { evidenceIds?: unknown } | null;
  const ids = [...new Set(Array.isArray(body?.evidenceIds) ? (body?.evidenceIds as unknown[]).filter(isUuid).slice(0, MAX_IDS) : [])];
  if (!ids.length) return { urls: {} };
  const { data: rows, error } = await client.from("qa_attempt_evidence").select("id, storage_key").eq("status", "ready").in("id", ids);
  if (error) throw qaError(500, "unknown", "Evidence could not be checked.");
  if (!rows?.length) return { urls: {} };
  const { data, error: signError } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_key), TTL_SECONDS);
  if (signError) throw qaError(502, "storage_unavailable", "Evidence storage is unavailable.");
  const byPath = new Map((data ?? []).filter((d) => d.path && d.signedUrl).map((d) => [d.path as string, d.signedUrl]));
  return { urls: Object.fromEntries(rows.flatMap((r) => (byPath.has(r.storage_key) ? [[r.id, byPath.get(r.storage_key)]] : []))) };
});
