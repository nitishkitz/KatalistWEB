import { createClient } from "@supabase/supabase-js";

const AUTH_REQUEST_TIMEOUT_MS = 15_000;

/** Keep server-side auth-admin calls from hanging until the hosting platform
 * terminates the request. Preserve Supabase's own cancellation signal. */
export function authRequestFetch(input: RequestInfo | URL, init?: RequestInit) {
  const timeoutSignal = AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}

export function isTransientAuthFailure(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /fetch failed|network|timeout|ECONNRESET|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|AbortError/i.test(text);
}

/** Retry reads and disposable magic-link generation once after a transport
 * failure. Callers must not use this for one-time token exchange or createUser. */
export async function withAuthNetworkRetry<T>(operation: () => Promise<T>, stage: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientAuthFailure(error)) throw error;
    console.warn("[phone-auth] retrying Supabase request", { stage });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return operation();
  }
}

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
    global: { fetch: authRequestFetch },
  });
}
