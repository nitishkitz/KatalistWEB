import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Verifies a Supabase access token and returns a client scoped to that user (RLS applies). Null when invalid. */
export async function authenticateAssistantToken(token: string): Promise<{ userId: string; client: SupabaseClient } | null> {
  const url = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey || !token) return null;
  const client = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, client };
}

export async function requireAssistantUser(request: Request): Promise<{ userId: string; client: SupabaseClient }> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) throw new Response(JSON.stringify({ message: "Authentication required." }), { status: 401, headers: { "content-type": "application/json" } });
  const url = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new Response(JSON.stringify({ message: "Supabase is not configured." }), { status: 500, headers: { "content-type": "application/json" } });
  const client = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Response(JSON.stringify({ message: "Invalid or expired session." }), { status: 401, headers: { "content-type": "application/json" } });
  return { userId: data.user.id, client };
}

export function assistantJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
