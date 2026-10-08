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
    // Accept the plain JSON used locally and base64 JSON, which is much less
    // error-prone to paste into deployment dashboards. Also repair escaped
    // newlines used by some secret managers for the PEM private key.
    const decoded = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw.trim(), "base64").toString("utf8");
    const credJson = JSON.parse(decoded) as ServiceAccount & { private_key?: string; privateKey?: string };
    if (credJson.private_key) credJson.private_key = credJson.private_key.replace(/\\n/g, "\n");
    if (credJson.privateKey) credJson.privateKey = credJson.privateKey.replace(/\\n/g, "\n");
    return initializeApp({ credential: cert(credJson) });
  } catch (error) {
    console.error("[push] FIREBASE_SERVICE_ACCOUNT is invalid", error);
    return null;
  }
}

export type PushSendResult = {
  sent: number;
  attempted: number;
  reason?: "not_configured" | "no_tokens" | "send_failed";
};

export async function sendPushDetailed(
  tokens: string[],
  notification: { title: string; body: string },
  data?: Record<string, string>,
): Promise<PushSendResult> {
  const clean = [...new Set(tokens.filter(Boolean))];
  if (clean.length === 0) return { sent: 0, attempted: 0, reason: "no_tokens" };
  const app = getAdminApp();
  if (!app) return { sent: 0, attempted: clean.length, reason: "not_configured" };
  try {
    const res = await getMessaging(app).sendEachForMulticast({
      tokens: clean,
      notification,
      data,
      webpush: { fcmOptions: { link: data?.url || "/" } },
    });
    if (res.failureCount) {
      console.error("[push] FCM rejected notifications", res.responses
        .filter((response) => !response.success)
        .map((response) => response.error?.code ?? "unknown"));
    }
    return { sent: res.successCount, attempted: clean.length };
  } catch (error) {
    console.error("[push] FCM send failed", error);
    return { sent: 0, attempted: clean.length, reason: "send_failed" };
  }
}

export async function sendPush(
  tokens: string[],
  notification: { title: string; body: string },
  data?: Record<string, string>,
): Promise<number> {
  return (await sendPushDetailed(tokens, notification, data)).sent;
}
