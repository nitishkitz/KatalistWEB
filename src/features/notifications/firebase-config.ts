export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export type FirebaseClientSettings = {
  config: FirebaseWebConfig;
  vapidKey: string;
};

const WEB_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

function read(env: Record<string, unknown> | undefined, key: string): string {
  const value = env?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function getFirebaseClientSettings(
  env: Record<string, unknown> = import.meta.env,
): FirebaseClientSettings | null {
  const apiKey = read(env, "VITE_FIREBASE_API_KEY");
  const authDomain = read(env, "VITE_FIREBASE_AUTH_DOMAIN");
  const projectId = read(env, "VITE_FIREBASE_PROJECT_ID");
  const storageBucket = read(env, "VITE_FIREBASE_STORAGE_BUCKET");
  const messagingSenderId = read(env, "VITE_FIREBASE_MESSAGING_SENDER_ID");
  const appId = read(env, "VITE_FIREBASE_APP_ID");
  const vapidKey = read(env, "VITE_FIREBASE_VAPID_KEY");
  if (
    !apiKey ||
    !authDomain ||
    !projectId ||
    !storageBucket ||
    !messagingSenderId ||
    !appId ||
    !vapidKey
  ) {
    return null;
  }
  return {
    config: { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId },
    vapidKey,
  };
}

export function getFirebaseServiceWorkerUrl(config: FirebaseWebConfig): string {
  const params = new URLSearchParams();
  params.set("apiKey", config.apiKey);
  params.set("authDomain", config.authDomain);
  params.set("projectId", config.projectId);
  params.set("storageBucket", config.storageBucket);
  params.set("messagingSenderId", config.messagingSenderId);
  params.set("appId", config.appId);
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export { WEB_KEYS };
