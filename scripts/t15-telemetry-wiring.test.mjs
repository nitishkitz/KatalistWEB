import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * T15/V-05: confirms `logTelemetryEvent` (telemetry.test.mjs covers its own
 * full behavior) is actually wired into the exact hook points named in the
 * plan -- source assertions here, since most of these call sites already
 * have their own dedicated behavioral test files exercising the
 * surrounding logic for real (use-morning-brief.test.mjs,
 * use-list-call-lifecycle.test.mjs, etc.); this only needs to confirm the
 * telemetry call itself is present at each site, not re-derive their whole
 * existing test suites.
 */
const readRequest = readFileSync(new URL("../src/lib/read-request.ts", import.meta.url), "utf8");
const realtimeProvider = readFileSync(new URL("../src/features/realtime/RealtimeInvalidationProvider.tsx", import.meta.url), "utf8");
const morningBrief = readFileSync(new URL("../src/features/catchup/use-morning-brief.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("../src/router.tsx", import.meta.url), "utf8");
const rootRoute = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const indexRoute = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const courtDesktop = readFileSync(new URL("../src/features/court/CourtDesktop.tsx", import.meta.url), "utf8");

test("a read's own 15s deadline logs query_timeout exactly once, inside the shared primitive every read goes through", () => {
  assert.match(readRequest, /import \{ logTelemetryEvent \} from "\.\/telemetry"/);
  assert.match(readRequest, /category: "query_timeout", outcome: "timeout"/);
});

test("a Realtime reconnect logs realtime_reconnect", () => {
  assert.match(realtimeProvider, /category: "realtime_reconnect", outcome: "success"/);
});

test("Morning Brief logs claim/presentation/dismiss at every real outcome, not just the happy path", () => {
  assert.match(morningBrief, /category: "brief_claim", outcome: result\.claimed \? "success" : "failure"/);
  assert.match(morningBrief, /category: "brief_claim", outcome: "failure"/);
  assert.match(morningBrief, /category: "brief_presentation", outcome: "success", scope: "morning-brief"/);
  assert.match(morningBrief, /category: "brief_presentation", outcome: "success", scope: "morning-brief-manual"/);
  assert.match(morningBrief, /category: "brief_dismiss", outcome: "success"/);
  assert.match(morningBrief, /category: "brief_dismiss", outcome: "failure"/);
});

test("opening a Thing from the Morning Brief overlay logs brief_action, on both the mobile and desktop entry points", () => {
  assert.match(indexRoute, /category: "brief_action", outcome: "success"/);
  assert.match(courtDesktop, /category: "brief_action", outcome: "success"/);
});

test("every query/mutation failure is logged app-wide via one QueryCache/MutationCache hook, skipping a timeout to avoid double-counting it", () => {
  assert.match(router, /queryCache: new QueryCache\(\{/);
  assert.match(router, /mutationCache: new MutationCache\(\{/);
  assert.match(router, /if \(isReadTimeoutError\(err\)\) return;/);
  assert.match(router, /category: "query_error", outcome: "failure"/);
  assert.match(router, /category: "mutation_failure", outcome: "failure"/);
});

test("route loads are logged via the router's own onBeforeLoad/onLoad pair, reduced to a safe route-family scope", () => {
  assert.match(rootRoute, /router\.subscribe\("onBeforeLoad"/);
  assert.match(rootRoute, /router\.subscribe\("onLoad"/);
  assert.match(rootRoute, /category: "route_load"/);
  assert.match(rootRoute, /scope: telemetryScopeForPath\(event\.toLocation\.pathname\)/);
  assert.match(rootRoute, /import \{ logTelemetryEvent, telemetryScopeForPath \} from "@\/lib\/telemetry"/);
});
