import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createError, getHeader, type H3Event } from "h3";

/**
 * Verifies the caller's Supabase session from the Authorization header and
 * returns a client scoped to that user (auth.uid() resolves correctly for
 * RLS and SECURITY DEFINER RPCs). Throws 401 if the header is missing or the
 * token doesn't verify - every handler that mutates data on a caller's
 * behalf must call this before touching the database.
 */
export async function requireUser(event: H3Event): Promise<{ userId: string; client: SupabaseClient }> {
  const authHeader = getHeader(event, "authorization");
  const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    throw createError({ statusCode: 401, message: "Authentication required." });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in the environment.");
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw createError({ statusCode: 401, message: "Invalid or expired session." });
  }

  return { userId: data.user.id, client };
}
