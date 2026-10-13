import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { maintenanceActive, backgroundJobsEnabled, outboundDeliveryEnabled } from "../src/lib/reset-controls.server.ts";
import resetMaintenance from "../server/middleware/00-reset-maintenance.ts";

mock.module("@tanstack/react-router", { namedExports: { createFileRoute: () => config => config } });
// Any backend access in a disabled handler is a failure.
mock.module("@/integrations/supabase/client.server", { namedExports: {
  supabaseAdmin: new Proxy({}, { get() { throw new Error("disabled handler accessed backend"); } }),
} });
const keys = ["KATALIST_MAINTENANCE", "KATALIST_BACKGROUND_JOBS_ENABLED", "KATALIST_OUTBOUND_DELIVERY_ENABLED"];
const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
test.after(() => { for (const k of keys) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]; });

test("workers fail closed and maintenance overrides explicit enablement", () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    assert.equal(backgroundJobsEnabled({ KATALIST_BACKGROUND_JOBS_ENABLED: value }), false);
    assert.equal(outboundDeliveryEnabled({ KATALIST_OUTBOUND_DELIVERY_ENABLED: value }), false);
  }
  const enabled = { KATALIST_BACKGROUND_JOBS_ENABLED: "true", KATALIST_OUTBOUND_DELIVERY_ENABLED: "true" };
  assert.equal(backgroundJobsEnabled(enabled), true);
  assert.equal(outboundDeliveryEnabled(enabled), true);
  assert.equal(maintenanceActive({ KATALIST_MAINTENANCE: "true" }), true);
  assert.equal(backgroundJobsEnabled({ ...enabled, KATALIST_MAINTENANCE: "true" }), false);
  assert.equal(outboundDeliveryEnabled({ ...enabled, KATALIST_MAINTENANCE: "true" }), false);
});

test("maintenance middleware never invokes the application", async () => {
  process.env.KATALIST_MAINTENANCE = "true";
  const response = resetMaintenance({}, () => { throw new Error("application ran"); });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "maintenance" });
  delete process.env.KATALIST_MAINTENANCE;
  assert.equal(resetMaintenance({}, () => "continued"), "continued");
});

test("scheduled and manual calls are fenced before backend access, even with a valid secret", async () => {
  delete process.env.KATALIST_BACKGROUND_JOBS_ENABLED;
  for (const name of ["daily-maintenance", "escalate-nudges", "code-activity-drain"]) {
    const { Route } = await import(`../src/routes/api/jobs/${name}.ts`);
    for (const method of ["GET", "POST"]) {
      const request = new Request(`https://example.test/api/jobs/${name}`, { method, headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "test"}` } });
      const response = await Route.server.handlers[method]({ request });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "background_jobs_disabled" });
    }
  }
  const { Route } = await import("../src/routes/api/public/code-activity/github/webhook.ts");
  assert.equal((await Route.server.handlers.POST({ request: new Request("https://example.test", { method: "POST" }) })).status, 503);
});

test("disabled delivery never initializes Firebase or attempts a send", async () => {
  delete process.env.KATALIST_OUTBOUND_DELIVERY_ENABLED;
  const { sendPushDetailed } = await import("../src/lib/fcm.server.ts");
  assert.deepEqual(await sendPushDetailed(["test-token"], { title: "Test", body: "Test" }), { sent: 0, attempted: 0, reason: "delivery_disabled" });
});
