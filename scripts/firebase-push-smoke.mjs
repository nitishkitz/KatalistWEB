import assert from "node:assert/strict";

const REQUIRED = [
  "UAT_BASE_URL",
  "UAT_ACCESS_TOKEN",
  "UAT_FCM_TOKEN",
  "PUSH_DRAIN_URL",
  "PUSH_DRAIN_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function missingEnv() {
  return REQUIRED.filter((name) => !String(process.env[name] ?? "").trim());
}

function decodeJwtSub(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) throw new Error("access token is not a JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!payload.sub) throw new Error("access token is missing sub");
  return payload.sub;
}

async function main() {
  const missing = missingEnv();
  if (missing.length) {
    console.error(`Firebase push smoke: NOT RUN — missing ${missing.join(", ")}`);
    process.exit(2);
  }

  const base = String(process.env.UAT_BASE_URL).replace(/\/+$/, "");
  const accessToken = String(process.env.UAT_ACCESS_TOKEN);
  const fcmToken = String(process.env.UAT_FCM_TOKEN);
  const drainUrl = String(process.env.PUSH_DRAIN_URL);
  const drainSecret = String(process.env.PUSH_DRAIN_SECRET);
  const supabaseUrl = String(process.env.SUPABASE_URL).replace(/\/+$/, "");
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const profileId = decodeJwtSub(accessToken);

  const register = await fetch(`${base}/api/push/subscriptions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token: fcmToken }),
  });
  assert.equal(register.status, 200);

  const created = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
    method: "POST",
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({
      profile_id: profileId,
      kind: "smoke",
      title: "UAT push smoke",
      body: "Delivery check",
    }),
  });
  assert.equal(created.status, 201);
  const notifications = await created.json();
  const notificationCount = Array.isArray(notifications) ? notifications.length : 0;
  assert.equal(notificationCount, 1);
  const notificationId = notifications[0].id;

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: before, error } = await admin.rpc("notification_delivery_status", {
    p_notification_id: notificationId,
  });
  if (error) throw error;
  assert.equal(before.length, 1);
  const deliveryCount = before.length;

  const drain = await fetch(drainUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${drainSecret}`,
    },
    body: "{}",
  });
  assert.equal(drain.status, 200);
  const drainBody = await drain.json();
  assert.equal(drainBody.sent, 1);

  const { data: after, error: afterError } = await admin.rpc("notification_delivery_status", {
    p_notification_id: notificationId,
  });
  if (afterError) throw afterError;
  const delivery = after[0];
  assert.equal(delivery.status, "sent");
  assert.ok(delivery.fcm_message_id);
  assert.equal(deliveryCount, 1);

  console.log("Firebase push smoke: PASS");
}

main().catch((error) => {
  console.error("Firebase push smoke: FAIL");
  console.error(error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
