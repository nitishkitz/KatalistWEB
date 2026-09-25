import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import type { Identity } from "@/features/realtime/identity-cache-policy";

/**
 * F02/T10-02: the presentation-receipt adapter, live and preview/demo. The
 * RPCs (claim_morning_brief/dismiss_morning_brief) are prepared in
 * supabase/migrations/20260923100000_morning_brief_receipts.sql (plus the
 * additive exact-dismiss overload in
 * supabase/migrations/20260925110000_morning_brief_exact_dismiss.sql) but
 * not yet applied to any database -- calling the live adapter before that
 * migration is deployed will fail with a normal "function does not
 * exist" Postgres error, which callers must treat as "service
 * unavailable, skip automatic opening, keep manual access" (see
 * use-morning-brief.ts), not a crash.
 */
export type MorningBriefClaimResult = {
  claimed: boolean;
  localDate: string;
  timezone: string;
  presentedAt: string;
};

/**
 * T10-02: a typed reference to the exact receipt THIS review presented --
 * enough to dismiss precisely that row later (see
 * `dismissMorningBriefLive`'s `exactLocalDate` argument) even if a newer
 * day's row has since been claimed for the same profile/context. Deliberately
 * separate from a surfaced-moment receipt (see use-catchup.ts's
 * `surfaceMoment`) -- these are different records with different purposes.
 */
export type PresentedReceiptRef = {
  identityKind: Identity["kind"] & ("live" | "preview");
  identityId: string;
  epoch: number;
  context: "work" | "home";
  localDate: string;
  timezone: string;
  presentedAt: string;
};

type ClaimRpcRow = {
  claimed: boolean;
  local_date: string;
  timezone: string;
  presented_at: string;
};

// ── Error classification ─────────────────────────────────────────────────────
// T10-02 (gap #5): the RPC layer throws whatever Supabase/PostgREST hands
// back on error, which is a plain `{ message, code, details, hint }` object,
// NOT an `instanceof Error`. Consumers used to check `err instanceof Error`
// to recognize the server's "before morning threshold" rejection, which is
// always false for the raw shape actually thrown -- so a legitimate
// before-threshold rejection was silently treated as a fatal claim failure
// instead of "retry later today". `classifyClaimError` inspects the
// message/code regardless of the thrown value's type, so both a raw
// PostgREST error object and a real Error with the same text classify
// identically. An ordinary error whose text doesn't match any known server
// rejection (e.g. a network failure) classifies as `null` and is rethrown
// completely unchanged by the callers below -- "ordinary network error
// stays ordinary" is deliberate: this adapter must not wrap or reinterpret
// failures it doesn't specifically recognize.
export type ClaimRejectionReason = "before-threshold" | "unauthorized" | "unavailable";

export class MorningBriefClaimRejected extends Error {
  readonly reason: ClaimRejectionReason;
  readonly cause?: unknown;
  constructor(reason: ClaimRejectionReason, message: string, cause?: unknown) {
    super(message);
    this.name = "MorningBriefClaimRejected";
    this.reason = reason;
    this.cause = cause;
  }
}

function extractMessageAndCode(err: unknown): { message: string; code: string | null } {
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    const message = typeof rec.message === "string" ? rec.message : "";
    const code = typeof rec.code === "string" ? rec.code : null;
    return { message, code };
  }
  if (typeof err === "string") return { message: err, code: null };
  return { message: "", code: null };
}

/**
 * Matches the actual threshold contract narrowly: the specific message
 * `claim_morning_brief` raises for its 07:00 gate (see the migration), not
 * any message that merely contains the word "threshold". `42501` is
 * Postgres's `insufficient_privilege` SQLSTATE; "not authenticated" is the
 * RPC's own explicit `RAISE EXCEPTION` text for a missing `auth.uid()`.
 * `42883` (`undefined_function`) and "does not exist" cover the RPC not
 * being deployed yet -- reported as `unavailable`, matching this adapter's
 * documented "migration not deployed" contract, not a crash.
 */
function classifyClaimError(err: unknown): ClaimRejectionReason | null {
  const { message, code } = extractMessageAndCode(err);
  const lower = message.toLowerCase();
  if (lower.includes("before morning threshold")) return "before-threshold";
  if (lower.includes("not authenticated") || code === "42501" || lower.includes("permission denied")) {
    return "unauthorized";
  }
  if (code === "42883" || lower.includes("does not exist")) return "unavailable";
  return null;
}

function rejectOrRethrow(err: unknown): never {
  const reason = classifyClaimError(err);
  if (reason) {
    const { message } = extractMessageAndCode(err);
    throw new MorningBriefClaimRejected(reason, message || reason, err);
  }
  throw err;
}

/**
 * Validates the RPC's returned row shape before it is trusted as a real
 * receipt (T10-02: "reject malformed date/timezone/result shapes as
 * unavailable"). A malformed row (wrong types, an unparseable date, an
 * empty timezone) must never be silently accepted as a valid claim.
 */
function validateClaimRow(row: ClaimRpcRow | undefined): asserts row is ClaimRpcRow {
  if (!row) throw new MorningBriefClaimRejected("unavailable", "claim_morning_brief returned no row");
  if (typeof row.claimed !== "boolean") {
    throw new MorningBriefClaimRejected("unavailable", "claim_morning_brief returned a non-boolean claimed field");
  }
  if (typeof row.local_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.local_date)) {
    throw new MorningBriefClaimRejected("unavailable", "claim_morning_brief returned a malformed local_date");
  }
  if (typeof row.timezone !== "string" || row.timezone.trim() === "") {
    throw new MorningBriefClaimRejected("unavailable", "claim_morning_brief returned an empty timezone");
  }
  if (typeof row.presented_at !== "string" || Number.isNaN(Date.parse(row.presented_at))) {
    throw new MorningBriefClaimRejected("unavailable", "claim_morning_brief returned an unparseable presented_at");
  }
}

export async function claimMorningBriefLive(
  context: "work" | "home",
  clientTimezone: string,
): Promise<MorningBriefClaimResult> {
  const { data, error } = await callUngeneratedRpc("claim_morning_brief", {
    p_context: context,
    p_client_timezone: clientTimezone,
  });
  if (error) rejectOrRethrow(error);
  const row = (Array.isArray(data) ? data[0] : data) as ClaimRpcRow | undefined;
  validateClaimRow(row);
  return { claimed: row.claimed, localDate: row.local_date, timezone: row.timezone, presentedAt: row.presented_at };
}

/**
 * T10-02: `dismiss_morning_brief`'s original (context, timezone) form
 * targets "the caller's most recent undismissed row for this context" --
 * verified against supabase/migrations/20260923100000_morning_brief_receipts.sql,
 * which has no local_date filter at all. If a new day's claim has already
 * landed by the time a review dismisses YESTERDAY's still-open receipt (a
 * tab left open across local midnight, or a second tab/device), that call
 * would dismiss the WRONG (newer) row instead of the one this review
 * actually owns. Passing `exactLocalDate` (from a `PresentedReceiptRef`
 * captured at claim time) targets the additive
 * supabase/migrations/20260925110000_morning_brief_exact_dismiss.sql
 * overload instead, which matches on profile/context/local_date exactly.
 * Omitting it preserves the original best-effort behavior for any existing
 * caller that has no exact receipt reference to dismiss.
 */
export async function dismissMorningBriefLive(
  context: "work" | "home",
  clientTimezone: string,
  exactLocalDate?: string,
): Promise<void> {
  const args: Record<string, unknown> = { p_context: context, p_client_timezone: clientTimezone };
  if (exactLocalDate) args.p_local_date = exactLocalDate;
  const { error } = await callUngeneratedRpc("dismiss_morning_brief", args);
  if (error) throw error;
}

// ── Preview/demo adapter ─────────────────────────────────────────────────────
// Same visible behavior (once per identity/context/local-date), but backed
// by localStorage instead of a real database -- so it can only provide a
// same-browser lock, not cross-device atomicity. The Web Locks API (where
// supported) closes the same-browser same-tab-group race the live RPC's
// ON CONFLICT DO NOTHING closes across real devices/processes; where it
// isn't supported, this falls back to an in-process serialization queue
// (see `withKeySerialized` below), which still guarantees a single winner
// for concurrent same-realm callers -- e.g. two intra-page callers racing
// in the same JS event loop, such as two mounted controllers or a Strict
// Mode double-invoke -- but cannot prove cross-tab or cross-device
// atomicity the way a real Postgres constraint or the cross-process Web
// Locks API can.

type StoredReceipt = { presentedAt: string; dismissedAt?: string };

function previewReceiptKey(actorId: string, context: "work" | "home", localDate: string): string {
  return `katalist.morning_brief.${actorId}.${context}.${localDate}`;
}

function isStoredReceipt(value: unknown): value is StoredReceipt {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.presentedAt !== "string" || Number.isNaN(Date.parse(rec.presentedAt))) return false;
  if (rec.dismissedAt !== undefined && (typeof rec.dismissedAt !== "string" || Number.isNaN(Date.parse(rec.dismissedAt)))) {
    return false;
  }
  return true;
}

// T10-02: a bounded same-session fallback used when localStorage itself
// throws on read or write (quota exceeded, privacy mode, a throwing Storage
// stub in tests) -- without this, a storage failure silently loses the
// receipt and a remount (or a second read in the same session) could claim
// again even though this session already presented it once. Bounded to a
// small fixed size with FIFO eviction so a long-lived session with many
// identities/contexts/dates can't grow this without limit; the oldest
// tracked receipt is evicted first, matching the existing narrow-race
// tradeoff already accepted for this adapter (a very old evicted entry may
// re-claim, same as if storage had never captured it at all).
const SESSION_FALLBACK_LIMIT = 64;
const sessionFallback = new Map<string, StoredReceipt>();

function sessionFallbackSet(key: string, receipt: StoredReceipt): void {
  sessionFallback.delete(key); // re-insert at the end (most-recently-used)
  sessionFallback.set(key, receipt);
  while (sessionFallback.size > SESSION_FALLBACK_LIMIT) {
    const oldestKey = sessionFallback.keys().next().value;
    if (oldestKey === undefined) break;
    sessionFallback.delete(oldestKey);
  }
}

function readStoredReceipt(key: string): StoredReceipt | null {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(key);
      // A successful read (even "nothing stored", or malformed JSON/shape
      // that is deliberately not trusted as a receipt) is authoritative --
      // it must NOT fall through to the same-session fallback, which exists
      // only to cover a storage READ/WRITE that actually throws, not to
      // override a working store's honest "not present" answer.
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return isStoredReceipt(parsed) ? parsed : null;
    } catch {
      // Storage read failed (or JSON.parse threw on corrupt content) --
      // fall through to the same-session fallback below.
    }
  }
  return sessionFallback.get(key) ?? null;
}

function writeStoredReceipt(key: string, receipt: StoredReceipt): void {
  sessionFallbackSet(key, receipt); // always kept, so a throwing store below still survives this session
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(receipt));
  } catch {
    // Storage unavailable (quota/privacy mode) -- the same-session fallback
    // above still has it, so a remount within this session will not
    // re-claim; a fresh session (real reload, storage never having
    // persisted) may re-claim since nothing survived across sessions,
    // which is the same "at most a narrow, disclosed tradeoff" already
    // accepted for this adapter.
  }
}

// T10-02: an in-process, per-key serialization queue guaranteeing a single
// winner for same-realm concurrent claims even without the Web Locks API
// (e.g. this repo's jsdom test environment, or a browser that doesn't
// implement it). Each call for a given key is chained after the previous
// one settles, so the check-then-set in `doClaim` below can never
// interleave with itself for the same key.
const keyQueues = new Map<string, Promise<unknown>>();

function withKeySerialized<T>(key: string, fn: () => T): Promise<T> {
  const previous = keyQueues.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Swallow rejection for chaining purposes only; the real result/error is
  // still returned to this call's own caller via `next` below.
  keyQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export async function claimMorningBriefPreview(
  actorId: string,
  context: "work" | "home",
  localDate: string,
  timezone: string,
): Promise<MorningBriefClaimResult> {
  const key = previewReceiptKey(actorId, context, localDate);
  const doClaim = (): MorningBriefClaimResult => {
    const existing = readStoredReceipt(key);
    if (existing) return { claimed: false, localDate, timezone, presentedAt: existing.presentedAt };
    const presentedAt = new Date().toISOString();
    writeStoredReceipt(key, { presentedAt });
    return { claimed: true, localDate, timezone, presentedAt };
  };

  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks && typeof locks.request === "function") {
    // Web Locks already serializes across same-realm callers (and, where
    // truly supported, across tabs); still route through the in-process
    // queue too so behavior is uniform whether or not this environment
    // actually honors Web Locks contention correctly.
    return locks.request(key, async () => withKeySerialized(key, doClaim));
  }
  return withKeySerialized(key, doClaim);
}

export function dismissMorningBriefPreview(actorId: string, context: "work" | "home", localDate: string): void {
  const key = previewReceiptKey(actorId, context, localDate);
  const existing = readStoredReceipt(key);
  if (!existing || existing.dismissedAt) return;
  writeStoredReceipt(key, { ...existing, dismissedAt: new Date().toISOString() });
}
