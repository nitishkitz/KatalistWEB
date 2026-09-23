import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";

/**
 * F02: the presentation-receipt adapter, live and preview/demo. The RPCs
 * (claim_morning_brief/dismiss_morning_brief) are prepared in
 * supabase/migrations/20260923100000_morning_brief_receipts.sql but not
 * yet applied to any database -- calling the live adapter before that
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

type ClaimRpcRow = {
  claimed: boolean;
  local_date: string;
  timezone: string;
  presented_at: string;
};

export async function claimMorningBriefLive(
  context: "work" | "home",
  clientTimezone: string,
): Promise<MorningBriefClaimResult> {
  const { data, error } = await callUngeneratedRpc("claim_morning_brief", {
    p_context: context,
    p_client_timezone: clientTimezone,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as ClaimRpcRow | undefined;
  if (!row) throw new Error("claim_morning_brief returned no row");
  return { claimed: row.claimed, localDate: row.local_date, timezone: row.timezone, presentedAt: row.presented_at };
}

export async function dismissMorningBriefLive(context: "work" | "home", clientTimezone: string): Promise<void> {
  const { error } = await callUngeneratedRpc("dismiss_morning_brief", {
    p_context: context,
    p_client_timezone: clientTimezone,
  });
  if (error) throw error;
}

// ── Preview/demo adapter ─────────────────────────────────────────────────────
// Same visible behavior (once per identity/context/local-date), but backed
// by localStorage instead of a real database -- so it can only provide a
// same-browser lock, not cross-device atomicity. The Web Locks API (where
// supported) closes the same-browser same-tab-group race the live RPC's
// ON CONFLICT DO NOTHING closes across real devices/processes; where it
// isn't supported, this falls back to a plain check-then-set, which is a
// real (if narrow) same-browser race window -- acceptable for a local demo
// receipt, not represented as equivalent to the live adapter's guarantee.

type StoredReceipt = { presentedAt: string; dismissedAt?: string };

function previewReceiptKey(actorId: string, context: "work" | "home", localDate: string): string {
  return `katalist.morning_brief.${actorId}.${context}.${localDate}`;
}

function readStoredReceipt(key: string): StoredReceipt | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredReceipt) : null;
  } catch {
    return null;
  }
}

function writeStoredReceipt(key: string, receipt: StoredReceipt): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(receipt));
  } catch {
    // Storage unavailable (quota/privacy mode) -- the claim still resolves
    // in-memory for this call; a later call in the same session may
    // re-claim since nothing persisted, which is the same "at most a
    // narrow race window" tradeoff already accepted for this adapter.
  }
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
    return locks.request(key, async () => doClaim());
  }
  return doClaim();
}

export function dismissMorningBriefPreview(actorId: string, context: "work" | "home", localDate: string): void {
  const key = previewReceiptKey(actorId, context, localDate);
  const existing = readStoredReceipt(key);
  if (!existing || existing.dismissedAt) return;
  writeStoredReceipt(key, { ...existing, dismissedAt: new Date().toISOString() });
}
