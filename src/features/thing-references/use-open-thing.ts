import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { THING_PERMALINK_PARAM } from "./thing-reference";

/**
 * Navigation helpers that tolerate a missing router (isolated component renders), so the shared Thing surfaces never
 * depend on being mounted under one. In-app navigation keeps in-memory drafts alive; the hard-navigation fallback does not.
 */
export function useThingNavigation() {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined;
  const openCourt = useCallback(() => {
    if (router) void router.navigate({ to: "/" });
    else if (typeof window !== "undefined") window.location.assign("/");
  }, [router]);
  const openThing = useCallback(
    (thingId: string) => {
      if (router) void router.navigate({ to: "/", search: { [THING_PERMALINK_PARAM]: thingId } as never });
      else if (typeof window !== "undefined") window.location.assign(`/?${THING_PERMALINK_PARAM}=${encodeURIComponent(thingId)}`);
    },
    [router],
  );
  return { openCourt, openThing };
}
