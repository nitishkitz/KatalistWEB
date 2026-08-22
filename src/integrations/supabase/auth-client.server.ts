import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Publishable-key client used only to exchange a UAT phone+password for a
 * real session. persistSession is false so the server never writes tokens.
 */
export function createSupabasePasswordClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY.");
  }
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storage: undefined,
    },
  });
}
