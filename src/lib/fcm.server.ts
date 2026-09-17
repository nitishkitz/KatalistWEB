import { getApps, initializeApp, cert, type App, type ServiceAccount } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

/**
 * Firebase Admin sender (server-only). Credentials come from the
 * FIREBASE_SERVICE_ACCOUNT env var (the service-account JSON, as a string).
 * If it isn't set, every call is a safe no-op so the app still works.
 */
function getAdminApp(): App | null {
  const existing = getApps();
  if (existing.length) return existing[0]!;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const credJson = JSON.parse(raw) as ServiceAccount;
    return initializeApp({ credential: cert(credJson) });
  } catch {
    return null;
  }
}

export async function sendPush(
  tokens: string[],
  notification: { title: string; body: string },
  data?: Record<string, string>,
): Promise<number> {
  const app = getAdminApp();
  const clean = [...new Set(tokens.filter(Boolean))];
  if (!app || clean.length === 0) return 0;
  try {
    const res = await getMessaging(app).sendEachForMulticast({
      tokens: clean,
      notification,
      data,
      webpush: { fcmOptions: { link: data?.url || "/" } },
    });
    return res.successCount;
  } catch {
    return 0;
  }
}
