import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

export class FirebaseAdminConfigError extends Error {
  constructor() {
    super("Push delivery is not configured.");
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new FirebaseAdminConfigError();
  return value;
}

let messaging: Messaging | undefined;

export function getFirebaseMessaging(): Messaging {
  if (messaging) return messaging;
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: required("FIREBASE_ADMIN_PROJECT_ID"),
        clientEmail: required("FIREBASE_ADMIN_CLIENT_EMAIL"),
        privateKey: required("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
      }),
    });
  }
  messaging = getMessaging();
  return messaging;
}
