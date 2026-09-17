import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { firebaseConfig, VAPID_KEY } from "./push-config";

/**
 * Registers the browser for FCM web push when signed in: registers the service
 * worker, requests notification permission, obtains a device token, and stores
 * it in device_tokens. Foreground messages surface as a toast (background
 * messages are handled by public/firebase-messaging-sw.js). Best-effort — any
 * failure (unsupported browser, denied permission) is swallowed silently.
 */
export function PushRegistrar() {
  const { user } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    void (async () => {
      try {
        const [{ initializeApp, getApps }, messagingMod] = await Promise.all([
          import("firebase/app"),
          import("firebase/messaging"),
        ]);
        const { getMessaging, getToken, onMessage, isSupported } = messagingMod;
        if (!(await isSupported()) || cancelled) return;

        const app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
        const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        const permission = await Notification.requestPermission();
        if (permission !== "granted" || cancelled) return;

        const messaging = getMessaging(app);
        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: reg,
        });
        if (!token || cancelled) return;

        await supabase.from("device_tokens").upsert(
          { profile_id: uid, token },
          { onConflict: "token" },
        );

        onMessage(messaging, (payload) => {
          const title = payload.notification?.title || payload.data?.title || "Katalist";
          const body = payload.notification?.body || payload.data?.body || "";
          const data = payload.data ?? {};
          if (data.kind === "incoming_call" && data.listId) {
            const listId = data.listId;
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
                  void navigate({ to: "/lists/$listId", params: { listId } });
                },
              },
            });
          } else {
            toast(title, { description: body });
          }
        });
      } catch {
        // Push is optional; never block the app on it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return null;
}
