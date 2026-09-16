import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for the narrow set of operations that genuinely require
 * elevated privilege (e.g. auth.admin.createUser). Never falls back to a
 * hardcoded key - misconfigured environments must fail loudly, not silently
 * authenticate with a credential baked into source.
 */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
