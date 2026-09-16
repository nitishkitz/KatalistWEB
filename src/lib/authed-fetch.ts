import { supabase } from "@/integrations/supabase/client";

/**
 * fetch() that forwards the current Supabase session's access token as a
 * Bearer Authorization header. Required for any /api/* route that resolves
 * the caller via server/lib/require-user.ts.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(url, { ...init, headers });
}
