import { createError, defineEventHandler, readBody } from "h3";
import { requireUser } from "../../lib/require-user";
import { getSupabaseAdmin } from "../../lib/supabase-admin";

const BUCKET = "thing-attachments";
const TTL_SECONDS = 60 * 60;
const MAX_PATHS = 100;

type Body = { paths?: unknown };

/**
 * Signs files only after the caller's RLS-scoped attachment read confirms
 * access. This keeps private Storage URLs available after an auth refresh
 * without allowing arbitrary bucket paths to be signed by the service role.
 */
export default defineEventHandler(async (event) => {
  const { client } = await requireUser(event);
  const body = (await readBody(event)) as Body | null;
  const paths = [
    ...new Set(
      (Array.isArray(body?.paths) ? body.paths : [])
        .filter((path): path is string => typeof path === "string" && path.length > 0)
        .slice(0, MAX_PATHS),
    ),
  ];

  if (!paths.length) return { urls: {} };
  if (!paths.every((path) => path.startsWith("things/"))) {
    throw createError({ statusCode: 400, message: "Invalid attachment path." });
  }

  const { data: visible, error: visibilityError } = await client
    .from("thing_attachments")
    .select("storage_key")
    .eq("status", "ready")
    .in("storage_key", paths);
  if (visibilityError) throw createError({ statusCode: 500, message: visibilityError.message });

  const allowed = (visible ?? [])
    .map((row) => row.storage_key)
    .filter((path): path is string => typeof path === "string");
  if (!allowed.length) return { urls: {} };

  const { data, error } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrls(allowed, TTL_SECONDS);
  if (error) throw createError({ statusCode: 500, message: error.message });

  return {
    urls: Object.fromEntries(
      (data ?? [])
        .filter((entry) => entry.path && entry.signedUrl)
        .map((entry) => [entry.path, entry.signedUrl]),
    ),
  };
});
