import { createHash } from "node:crypto";

export type MagicBoxAiOperation = "correct" | "coey" | "transcribe";

export interface AiBudgetDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

const LIMITS: Record<MagicBoxAiOperation, { minute: number; day: number }> = {
  correct: { minute: 6, day: 40 },
  coey: { minute: 4, day: 20 },
  transcribe: { minute: 4, day: 30 },
};

export function hashUserOperation(userId: string, operation: MagicBoxAiOperation): string {
  return createHash("sha256").update(`${operation}:${userId}`).digest("hex");
}

export function createMemoryAiBudget(now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return async function enforceMemoryBudget(input: {
    userId: string;
    operation: MagicBoxAiOperation;
  }): Promise<AiBudgetDecision> {
    const key = hashUserOperation(input.userId, input.operation);
    const limits = LIMITS[input.operation];
    const t = now();
    const stamps = (hits.get(key) ?? []).filter((ts) => t - ts < 86_400_000);
    const minute = stamps.filter((ts) => t - ts < 60_000).length;
    const day = stamps.length;
    if (minute >= limits.minute || day >= limits.day) {
      return { allowed: false, retryAfterSeconds: minute >= limits.minute ? 60 : 86400 };
    }
    stamps.push(t);
    hits.set(key, stamps);
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

const processBudget = createMemoryAiBudget();

export async function consumeMagicBoxAiBudgetFromDb(input: {
  userId: string;
  operation: MagicBoxAiOperation;
}): Promise<boolean | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("consume_magic_box_ai_budget", {
    p_user_id: input.userId,
    p_operation: input.operation,
  });
  if (error) return null;
  if (typeof data === "boolean") return data;
  return null;
}

export function createPersistentAiBudget(options?: {
  consumeFromDb?: (input: { userId: string; operation: MagicBoxAiOperation }) => Promise<boolean | null>;
  fallback?: (input: { userId: string; operation: MagicBoxAiOperation }) => Promise<AiBudgetDecision>;
}) {
  const consumeFromDb = options?.consumeFromDb ?? consumeMagicBoxAiBudgetFromDb;
  const fallback = options?.fallback ?? processBudget;
  return async function persistentBudget(input: {
    userId: string;
    operation: MagicBoxAiOperation;
  }): Promise<AiBudgetDecision> {
    try {
      const allowed = await consumeFromDb(input);
      if (typeof allowed === "boolean") {
        return { allowed, retryAfterSeconds: allowed ? 0 : 60 };
      }
    } catch {
      // SQL not applied yet; keep a process-local budget so a missing table cannot fail open.
    }
    return fallback(input);
  };
}

/** Production default: database limiter first, in-process fallback only when SQL is unavailable. */
export const enforceAiBudget = createPersistentAiBudget();

export function aiFlags(env: NodeJS.ProcessEnv = process.env) {
  const on = (value: string | undefined, fallback: boolean) => {
    if (value == null || value === "") return fallback;
    return value === "true" || value === "1";
  };
  return {
    correction: on(env.MAGIC_BOX_AI_CORRECTION_ENABLED, true),
    coey: on(env.MAGIC_BOX_AI_COEY_ENABLED, false),
    stt: on(env.MAGIC_BOX_AI_STT_ENABLED, true),
  };
}
