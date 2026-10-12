/**
 * Per-instance guards for the assistant: rate limiting and a short-lived facts
 * cache. State is in memory, so on serverless hosting each instance keeps its
 * own counters. That bounds abuse per instance; it is not a global quota.
 */

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

export const ASSISTANT_QUERY_LIMIT = { limit: 20, windowMs: 60_000 };
export const ASSISTANT_ACTION_LIMIT = { limit: 30, windowMs: 60_000 };

export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);
  if (bucket.hits.length >= limit)
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000)) };
  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > 2000)
    for (const [k, b] of buckets) if (!b.hits.some((at) => now - at < windowMs)) buckets.delete(k);
  return { ok: true };
}

export function resetRateLimits() {
  buckets.clear();
}

const FACTS_TTL_MS = 20_000;
const FACTS_MAX = 200;
const facts = new Map<string, { at: number; userId: string; value: unknown }>();

export function factsCacheKey(parts: Array<string | undefined | null>): string {
  return parts.map((part) => part ?? "-").join("|");
}

export function getCachedFacts<T>(key: string, now = Date.now()): T | undefined {
  const hit = facts.get(key);
  if (!hit) return undefined;
  if (now - hit.at > FACTS_TTL_MS) {
    facts.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function setCachedFacts(key: string, userId: string, value: unknown, now = Date.now()) {
  facts.set(key, { at: now, userId, value });
  if (facts.size > FACTS_MAX) {
    const oldest = [...facts.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) facts.delete(oldest[0]);
  }
}

/** Called after any assistant-driven mutation (nudge, status, assignment, due date). */
export function invalidateAssistantFacts(userId: string) {
  for (const [key, entry] of facts) if (entry.userId === userId) facts.delete(key);
}

export async function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineError(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class DeadlineError extends Error {}

export class PayloadTooLargeError extends Error {}

/** Reads a JSON body without trusting Content-Length alone. Invalid JSON throws SyntaxError. */
export async function readBoundedJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new PayloadTooLargeError("too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new PayloadTooLargeError("too large");
  return JSON.parse(text);
}
