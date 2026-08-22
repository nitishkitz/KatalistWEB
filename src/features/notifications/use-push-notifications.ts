import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSession } from "@/hooks/useSession";
import { keys } from "@/domain/query-keys";
import { createPushController, type PushState } from "@/features/notifications/push-client";
import { getFirebaseClientSettings } from "@/features/notifications/firebase-config";

export function usePushNotifications() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [state, setState] = useState<PushState>({ kind: "unavailable" });

  useEffect(() => {
    const controller = createPushController({
      storage: typeof sessionStorage === "undefined" ? undefined : sessionStorage,
    });
    setState(controller.currentState());
  }, []);

  const enable = useCallback(async () => {
    if (!session?.access_token) return { kind: "unavailable" } as PushState;
    const settings = getFirebaseClientSettings();
    if (!settings) {
      const next = { kind: "unavailable" } as const;
      setState(next);
      return next;
    }

    const next = await createPushController({
      settings,
      storage: sessionStorage,
      async isSupported() {
        if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
          return false;
        }
        const messaging = await import("firebase/messaging");
        return messaging.isSupported();
      },
      requestPermission: () => Notification.requestPermission(),
      registerServiceWorker: (url) => navigator.serviceWorker.register(url),
      async getToken({ vapidKey, serviceWorkerRegistration }) {
        const [{ initializeApp, getApps }, messaging] = await Promise.all([
          import("firebase/app"),
          import("firebase/messaging"),
        ]);
        const app = getApps()[0] ?? initializeApp(settings.config);
        const instance = messaging.getMessaging(app);
        messaging.onMessage(instance, (payload) => {
          void qc.invalidateQueries({ queryKey: keys.notifications(session.user?.id) });
          void qc.invalidateQueries({ queryKey: ["notifications-unread", session.user?.id] });
          const title = payload.data?.title || "Katalist";
          const body = payload.data?.body || "";
          toast(title, { description: body || undefined });
        });
        return messaging.getToken(instance, { vapidKey, serviceWorkerRegistration });
      },
    }).enable({ access_token: session.access_token });
    setState(next);
    return next;
  }, [qc, session]);

  const disable = useCallback(async () => {
    if (!session?.access_token) {
      const next = { kind: "default" } as const;
      setState(next);
      return next;
    }
    const next = await createPushController({
      storage: sessionStorage,
    }).disable({ access_token: session.access_token });
    setState(next);
    return next;
  }, [session]);

  return { state, enable, disable };
}
