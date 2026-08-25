const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RETRY_MINUTES = [1, 2, 5, 10, 30, 60, 180, 360];

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function notificationPath(input: { thingId: string | null; listId: string | null }): string {
  if (isUuid(input.thingId)) return `/?thing=${input.thingId}`;
  if (isUuid(input.listId)) return `/lists/${input.listId}`;
  return "/";
}

export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(Math.trunc(attempt) || 1, 1), RETRY_MINUTES.length) - 1;
  const base = RETRY_MINUTES[index] * 60 * 1000;
  const jitter = base * 0.2 * (random() * 2 - 1);
  return Math.round(base + jitter);
}

export function classifyFirebaseError(code: string): "retry" | "dead-token" | "dead" {
  const normalized = String(code ?? "").toLowerCase();
  if (
    normalized.includes("registration-token-not-registered") ||
    normalized.includes("invalid-registration-token") ||
    normalized.includes("unregistered")
  ) {
    return "dead-token";
  }
  if (
    normalized.includes("server-unavailable") ||
    normalized.includes("unavailable") ||
    normalized.includes("internal") ||
    normalized.includes("quota") ||
    normalized.includes("timeout") ||
    normalized.includes("rate-limit")
  ) {
    return "retry";
  }
  return "dead";
}

export function trustedNotificationPath(path: string | null | undefined): string {
  if (typeof path !== "string") return "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://") || path.includes("\\")) {
    return "/";
  }
  if (path === "/") return "/";
  if (path === "/team") return "/team";
  if (/^\/\?thing=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(path)) {
    return path;
  }
  if (/^\/lists\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(path)) {
    return path;
  }
  return "/";
}
