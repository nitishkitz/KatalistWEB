import type { Session } from "@supabase/supabase-js";
import { getStoredDemoSession } from "@/hooks/useSession";
import { demoEnabled } from "@/lib/demo-flag";
import { localFixedOtpEnabled } from "@/lib/fixed-otp";

export { demoEnabled };

/** Fixtures/local mutations are allowed only in explicit demo preview, never in production. */
export function isPreviewSession(session: Session | null | undefined): boolean {
  if (!demoEnabled() && !localFixedOtpEnabled()) return false;
  return session?.user?.app_metadata?.provider === "demo";
}

export function isPreviewMode(): boolean {
  if (!demoEnabled() && !localFixedOtpEnabled()) return false;
  if (typeof window === "undefined") return false;
  return Boolean(getStoredDemoSession());
}
