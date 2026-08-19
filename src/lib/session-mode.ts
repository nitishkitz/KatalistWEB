import type { Session } from "@supabase/supabase-js";
import { getStoredDemoSession } from "@/hooks/useSession";

/** Fixtures/local mutations are allowed only in explicit demo preview, never in production. */
export function isPreviewSession(session: Session | null | undefined): boolean {
  return import.meta.env.DEV && session?.user?.app_metadata?.provider === "demo";
}

export function isPreviewMode(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  return Boolean(getStoredDemoSession());
}
