/**
 * V-05: bounded, privacy-safe structured events for route load, query
 * timeout/error, mutation failure, realtime reconnect, and Morning Brief
 * claim/presentation/dismiss/action. There is no prior telemetry
 * infrastructure anywhere in this app (confirmed by search) -- this is the
 * minimal version of it: an in-memory ring buffer plus a `console.info`
 * sink, no new network call or analytics vendor.
 *
 * The event shape itself has no free-text field -- `scope` is a short,
 * non-identifying tag (e.g. "court", "list-detail"), never an entity ID,
 * message body, file URL, token, phone, or email. This is enforced by the
 * TYPE, not just by convention: there is no `details`/`meta`/`extra`
 * escape hatch a caller could smuggle anything through.
 */

export type TelemetryCategory =
  | "route_load"
  | "query_timeout"
  | "query_error"
  | "mutation_failure"
  | "realtime_reconnect"
  | "brief_claim"
  | "brief_presentation"
  | "brief_dismiss"
  | "brief_action";

export type TelemetryOutcome = "success" | "failure" | "timeout";

/** Only these short, non-identifying tags are allowed into the sink. */
export type TelemetryScope =
  | "court"
  | "auth"
  | "welcome"
  | "onboarding"
  | "lists"
  | "list-detail"
  | "buckets"
  | "bucket-detail"
  | "hub"
  | "team"
  | "me"
  | "nudges"
  | "bridge"
  | "other"
  | "realtime"
  | "morning-brief"
  | "morning-brief-manual";

export type TelemetryEvent = {
  category: TelemetryCategory;
  outcome: TelemetryOutcome;
  /** Non-identifying scope tag (e.g. a page/feature name), never content. */
  scope?: TelemetryScope;
  durationMs?: number;
  at: number;
};

const MAX_EVENTS = 200;
const buffer: TelemetryEvent[] = [];
const ALLOWED_SCOPES = new Set<TelemetryScope>([
  "court", "auth", "welcome", "onboarding", "lists", "list-detail",
  "buckets", "bucket-detail", "hub", "team", "me", "nudges", "bridge",
  "other", "realtime", "morning-brief", "morning-brief-manual",
]);

/** Convert a router pathname to a fixed route-family tag; never retain IDs,
 *  query strings, Bridge tokens, or arbitrary path segments in telemetry. */
export function telemetryScopeForPath(pathname: string): TelemetryScope {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  if (path === "/") return "court";
  if (path === "/auth") return "auth";
  if (path === "/welcome") return "welcome";
  if (path === "/onboarding") return "onboarding";
  if (path === "/lists") return "lists";
  if (/^\/lists\/[^/]+\/?$/.test(path)) return "list-detail";
  if (path === "/buckets") return "buckets";
  if (/^\/buckets\/[^/]+\/?$/.test(path)) return "bucket-detail";
  if (path === "/hub") return "hub";
  if (path === "/team") return "team";
  if (path === "/me") return "me";
  if (path === "/nudges") return "nudges";
  if (/^\/bridge(?:\/|$)/.test(path)) return "bridge";
  return "other";
}

function safeScope(scope: unknown): TelemetryScope | undefined {
  return typeof scope === "string" && ALLOWED_SCOPES.has(scope as TelemetryScope)
    ? scope as TelemetryScope
    : undefined;
}

export function logTelemetryEvent(event: Omit<TelemetryEvent, "at">): void {
  const full: TelemetryEvent = {
    category: event.category,
    outcome: event.outcome,
    scope: safeScope(event.scope),
    durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs!)) : undefined,
    at: Date.now(),
  };
  buffer.push(full);
  if (buffer.length > MAX_EVENTS) buffer.shift();
  // console.info, not console.error/warn -- these are informational
  // events, not application errors, and must not trip any error-reporting
  // integration that listens on the console's error channels.
  console.info("[telemetry]", full.category, full.outcome, {
    scope: full.scope,
    durationMs: full.durationMs,
  });
}

/** For tests/debugging only -- not a public data export surface. */
export function getRecentTelemetryEvents(): readonly TelemetryEvent[] {
  return buffer;
}

/** Test-only reset so one test's events don't leak into the next. */
export function clearTelemetryEvents(): void {
  buffer.length = 0;
}
