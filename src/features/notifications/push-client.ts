import { getFirebaseClientSettings, getFirebaseServiceWorkerUrl } from "@/features/notifications/firebase-config";

export type PushKind = "unavailable" | "unsupported" | "denied" | "default" | "enabled";
export type PushState = { kind: PushKind };

const TOKEN_STORAGE_KEY = "katalist_fcm_token";

export type PushSession = { access_token: string };

export type PushControllerDeps = {
  settings?: ReturnType<typeof getFirebaseClientSettings>;
  isSupported?: () => Promise<boolean> | boolean;
  notificationPermission?: () => NotificationPermission | "unsupported";
  requestPermission?: () => Promise<NotificationPermission>;
  registerServiceWorker?: (url: string) => Promise<ServiceWorkerRegistration>;
  getToken?: (input: { vapidKey: string; serviceWorkerRegistration: ServiceWorkerRegistration }) => Promise<string>;
  onMessage?: (handler: (payload: { data?: Record<string, string> }) => void) => () => void;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
};

function currentPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function browserSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function readStoredPushToken(storage: Pick<Storage, "getItem"> | null = typeof sessionStorage === "undefined" ? null : sessionStorage): string | null {
  if (!storage) return null;
  return storage.getItem(TOKEN_STORAGE_KEY);
}

export function createPushController(deps: PushControllerDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const storage = deps.storage;

  function currentState(): PushState {
    const settings = "settings" in deps ? deps.settings : getFirebaseClientSettings();
    if (!settings) return { kind: "unavailable" };
    const supported = deps.isSupported ? Boolean(deps.isSupported()) : browserSupported();
    if (!supported) return { kind: "unsupported" };
    const permission = deps.notificationPermission?.() ?? currentPermission();
    if (permission === "unsupported") return { kind: "unsupported" };
    if (permission === "denied") return { kind: "denied" };
    if (storage?.getItem(TOKEN_STORAGE_KEY) && permission === "granted") return { kind: "enabled" };
    return { kind: "default" };
  }

  async function registerToken(session: PushSession, token: string) {
    const response = await fetchImpl("/api/push/subscriptions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw new Error("Couldn’t register this browser for notifications.");
    storage?.setItem(TOKEN_STORAGE_KEY, token);
  }

  return {
    currentState,
    async enable(session: PushSession): Promise<PushState> {
      const settings = "settings" in deps ? deps.settings : getFirebaseClientSettings();
      if (!settings) return { kind: "unavailable" };
      const supported = deps.isSupported ? await deps.isSupported() : browserSupported();
      if (!supported) return { kind: "unsupported" };
      const permission = await (deps.requestPermission ?? (() => Notification.requestPermission()))();
      if (permission !== "granted") return { kind: permission === "denied" ? "denied" : "default" };
      const serviceWorkerRegistration = await (deps.registerServiceWorker ?? defaultRegister)(
        getFirebaseServiceWorkerUrl(settings.config),
      );
      const token = await (deps.getToken ?? (async () => ""))({
        vapidKey: settings.vapidKey,
        serviceWorkerRegistration,
      });
      if (!token) return { kind: "default" };
      await registerToken(session, token);
      return { kind: "enabled" };
    },
    async disable(session: PushSession): Promise<PushState> {
      const token = storage?.getItem(TOKEN_STORAGE_KEY);
      if (token && session.access_token) {
        try {
          await fetchImpl("/api/push/subscriptions", {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ token }),
          });
        } catch {
          // Revocation is best-effort; reassignment on next login is the safety net.
        }
      }
      storage?.removeItem(TOKEN_STORAGE_KEY);
      return currentState().kind === "denied" ? { kind: "denied" } : { kind: "default" };
    },
  };
}

async function defaultRegister(url: string): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(url);
}

export async function enablePush(session: PushSession): Promise<PushState> {
  return createBrowserController().enable(session);
}

export async function disablePush(session: PushSession): Promise<PushState> {
  return createBrowserController().disable(session);
}

export async function revokeCurrentPushToken(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const token = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    await fetchImpl("/api/push/subscriptions", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

function createBrowserController() {
  return createPushController({
    storage: typeof sessionStorage === "undefined" ? undefined : sessionStorage,
  });
}
