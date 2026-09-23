import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSession } from "@/hooks/useSession";
import { getPushPermissionState, registerPushForUser } from "./push-registration";

/**
 * Re-registers this device's push token when signed in and permission was
 * ALREADY granted in a previous session -- so returning users don't need
 * to re-click "Enable notifications" every time. G06: this must never be
 * the thing that shows the browser's permission prompt itself -- an
 * earlier version requested that permission unconditionally on every
 * sign-in, which is exactly the unsolicited-prompt pattern this batch's
 * own instruction calls out. Requesting permission now only ever
 * happens from an explicit "Enable notifications" action (Me's settings
 * panel, via the same registerPushForUser this file calls), never from
 * this passive auto-reconnect effect.
 */
export function PushRegistrar() {
  const { user } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (getPushPermissionState() !== "granted") return; // no prompt -- only reconnect an already-decided "yes"

    let cancelled = false;
    void registerPushForUser(uid, (opts) => {
      if (!cancelled) void navigate(opts as never);
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id, navigate]);

  return null;
}
