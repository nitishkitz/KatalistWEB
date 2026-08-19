import type { Session } from "@supabase/supabase-js";
import { getStoredDemoSession } from "@/hooks/useSession";

export function demoEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_KATALIST_DEMO_MODE === "true";
}

/** Fixtures/local mutations are allowed only in explicit demo preview, never in production. */
export function isPreviewSession(session: Session | null | undefined): boolean {
  if (!demoEnabled()) return false;
  return session?.user?.app_metadata?.provider === "demo";
}

export function isPreviewMode(): boolean {
  if (!demoEnabled()) return false;
  if (typeof window === "undefined") return false;
  return Boolean(getStoredDemoSession());
}
