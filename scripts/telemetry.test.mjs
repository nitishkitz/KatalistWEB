import assert from "node:assert/strict";
import { test, mock } from "node:test";

const { logTelemetryEvent, getRecentTelemetryEvents, clearTelemetryEvents, telemetryScopeForPath } = await import("@/lib/telemetry");

test("the ring buffer is bounded -- logging past the max size drops the oldest event, not grows unbounded", () => {
  clearTelemetryEvents();
  const infoSpy = mock.method(console, "info", () => {});
  for (let i = 0; i < 205; i++) {
    logTelemetryEvent({ category: "route_load", outcome: "success", scope: "court", durationMs: i });
  }
  const events = getRecentTelemetryEvents();
  assert.equal(events.length, 200, "the buffer must never exceed its bound");
  assert.equal(events[0].durationMs, 5, "the oldest events must be dropped, keeping the most recent 200");
  assert.equal(events[events.length - 1].durationMs, 204);
  infoSpy.mock.restore();
});

test("every logged event carries a real timestamp and the exact category/outcome passed in", () => {
  clearTelemetryEvents();
  const infoSpy = mock.method(console, "info", () => {});
  const before = Date.now();
  logTelemetryEvent({ category: "query_timeout", outcome: "timeout", scope: "list-detail", durationMs: 15000 });
  const [event] = getRecentTelemetryEvents();
  assert.equal(event.category, "query_timeout");
  assert.equal(event.outcome, "timeout");
  assert.equal(event.scope, "list-detail");
  assert.equal(event.durationMs, 15000);
  assert.ok(event.at >= before);
  infoSpy.mock.restore();
});

test("logging uses console.info, never console.error/warn -- a telemetry event is not an application error", () => {
  clearTelemetryEvents();
  const infoSpy = mock.method(console, "info", () => {});
  const errorSpy = mock.method(console, "error", () => {});
  const warnSpy = mock.method(console, "warn", () => {});
  logTelemetryEvent({ category: "mutation_failure", outcome: "failure", scope: "court" });
  assert.equal(infoSpy.mock.callCount(), 1);
  assert.equal(errorSpy.mock.callCount(), 0);
  assert.equal(warnSpy.mock.callCount(), 0);
  infoSpy.mock.restore();
  errorSpy.mock.restore();
  warnSpy.mock.restore();
});

test("the event shape has no free-text field -- only category/outcome/scope/durationMs/at ever reach the console sink", () => {
  clearTelemetryEvents();
  let loggedArgs = null;
  const infoSpy = mock.method(console, "info", (...args) => {
    loggedArgs = args;
  });
  // A caller casting past the type system (the only way to smuggle an
  // unexpected field in, since TypeScript itself already prevents this at
  // compile time for every real call site) must still not have that field
  // forwarded to the sink -- only the known fields are ever read out.
  // Plain JS (no TypeScript enforcement in this .mjs test file) --
  // deliberately attaches a field the real type never allows, to prove
  // the SINK itself, not just the type system, only ever forwards the
  // known fields.
  logTelemetryEvent({
    category: "brief_dismiss",
    outcome: "success",
    scope: "morning-brief",
    taskBody: "this must never be logged",
  });
  const loggedPayload = loggedArgs[loggedArgs.length - 1];
  assert.deepEqual(Object.keys(loggedPayload).sort(), ["durationMs", "scope"]);
  assert.ok(!JSON.stringify(loggedArgs).includes("this must never be logged"));
  infoSpy.mock.restore();
});

test("route scope collapses entity IDs and Bridge tokens into fixed route-family labels", () => {
  assert.equal(telemetryScopeForPath("/lists/real-thing-id?private=secret"), "list-detail");
  assert.equal(telemetryScopeForPath(`/bridge/${"a".repeat(64)}`), "bridge");
  assert.equal(telemetryScopeForPath("/unknown/private/path"), "other");
});

test("runtime sink rejects arbitrary scope data even when an untyped caller bypasses TypeScript", () => {
  clearTelemetryEvents();
  const infoSpy = mock.method(console, "info", () => {});
  logTelemetryEvent({
    category: "route_load",
    outcome: "success",
    scope: "user@example.com?token=private",
  });
  const [event] = getRecentTelemetryEvents();
  assert.equal(event.scope, undefined);
  assert.ok(!JSON.stringify(infoSpy.mock.calls).includes("user@example.com"));
  infoSpy.mock.restore();
});
