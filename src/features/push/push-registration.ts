import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestAutojoin } from "@/features/calls/autojoin-signal";
import { firebaseConfig, VAPID_KEY } from "./push-config";

/**
 * G06: the actual notification permission state, for the Me settings
 * panel to display honestly instead of the previous static "in-app
 * notifications only" copy (which was simply false -- real browser push
 * already existed, it just auto-requested permission on every sign-in
 * with no user-facing control at all).
 */
export type PushPermissionState = "unsupported" | "default" | "granted" | "denied";

export function getPushPermissionState(): PushPermissionState {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  return Notification.permission;
}

type RegisterResult = { ok: true } | { ok: false; reason: "unsupported" | "denied" | "error" };

/**
 * The actual service-worker-register + permission-request + FCM-token +
 * device_tokens upsert flow, extracted from PushRegistrar so it can be
 * called from an explicit "Enable notifications" action (Me's settings
 * panel) as well as PushRegistrar's own auto-reconnect path (which only
 * ever calls this when permission is ALREADY granted -- see that file's
 * own comment for why it never triggers the browser's permission prompt
 * unsolicited).
 */
export async function registerPushForUser(
  uid: string,
  navigate: (opts: unknown) => void,
): Promise<RegisterResult> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "unsupported" };
  }
  try {
    const [{ initializeApp, getApps }, messagingMod] = await Promise.all([
      import("firebase/app"),
      import("firebase/messaging"),
    ]);
    const { getMessaging, getToken, onMessage, isSupported } = messagingMod;
    if (!(await isSupported())) return { ok: false, reason: "unsupported" };

    const app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    if (!token) return { ok: false, reason: "error" };

    await supabase.from("device_tokens").upsert({ profile_id: uid, token }, { onConflict: "token" });

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || payload.data?.title || "Katalist";
      const body = payload.notification?.body || payload.data?.body || "";
      const data = payload.data ?? {};
      if (data.kind === "incoming_call" && data.listId) {
        const listId = data.listId;
        const isHub = data.hub === "1";
        toast(title, {
          description: body,
          duration: 30000,
          action: {
            label: "Join",
            onClick: () => {
              try {
                sessionStorage.setItem(`katalist.autojoin.${listId}`, "1");
              } catch {
                /* ignore */
              }
              requestAutojoin(listId);
              if (isHub) {
                navigate({
                  to: "/team/$conversationId",
                  params: { conversationId: listId },
                  search: { call: "1" },
                });
              } else {
                navigate({ to: "/lists/$listId", params: { listId } });
              }
            },
          },
        });
      } else {
        toast(title, { description: body });
      }
    });

    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}
