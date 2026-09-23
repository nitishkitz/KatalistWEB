import { createContext, useContext } from "react";
import type { Identity } from "@/features/realtime/identity-cache-policy";

/**
 * The current identity, for any consumer inside IdentityBoundary that
 * needs it directly rather than re-deriving it from useSession() (e.g.
 * P7's realtime controller, gating itself to only own a subscription
 * for a resolved live/preview identity). Only ever provided with
 * `gate.status === "ready"`'s identity -- consumers rendered at all
 * are, by construction, already inside a settled, non-pending,
 * non-aligning identity.
 *
 * Kept in its own file (not IdentityBoundary.tsx) so that file exports
 * only the component, per react-refresh/only-export-components.
 */
export const IdentityContext = createContext<Identity | null>(null);

export function useCurrentIdentity(): Identity {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useCurrentIdentity must be used within IdentityBoundary's ready subtree");
  return value;
}
