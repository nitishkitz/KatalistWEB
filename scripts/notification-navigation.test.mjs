import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { mapNotificationRow } from "@/features/notifications/use-notifications";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const thingId = "11111111-1111-4111-8111-111111111111";

test("notification mapping preserves Thing and List targets", () => {
  assert.deepEqual(
    mapNotificationRow({
      id: "n1",
      title: "Assigned",
      body: "Prepare notes",
      read_at: null,
      created_at: "2026-08-22T00:00:00Z",
      thing_id: thingId,
      list_id: null,
    }),
    {
      id: "n1",
      title: "Assigned",
      body: "Prepare notes",
      read: false,
      createdAt: "2026-08-22T00:00:00Z",
      path: `/?thing=${thingId}`,
    },
  );
});

test("Me notifications panel and sign-out use explicit push controls", () => {
  const meSource = readFileSync(join(root, "src/routes/me.tsx"), "utf8");
  const controlSource = readFileSync(join(root, "src/features/notifications/PushNotificationControl.tsx"), "utf8");
  const sessionSource = readFileSync(join(root, "src/hooks/useSession.ts"), "utf8");
  assert.match(meSource, /PushNotificationControl/);
  assert.match(controlSource, /Enable browser notifications/);
  assert.match(controlSource, /onClick=\{\(\) => void enable\(\)\}/);
  assert.match(sessionSource, /revokeCurrentPushToken/);
  assert.match(sessionSource, /supabase\.auth\.signOut/);
  const revokeAt = sessionSource.indexOf("revokeCurrentPushToken");
  const signOutAt = sessionSource.indexOf("supabase.auth.signOut");
  assert.ok(revokeAt >= 0 && signOutAt > revokeAt);
});
