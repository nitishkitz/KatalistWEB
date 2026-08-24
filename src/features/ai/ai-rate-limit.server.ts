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
  return async function enforceAiBudget(input: {
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

export async function enforceAiBudget(input: {
  userId: string;
  operation: MagicBoxAiOperation;
}): Promise<AiBudgetDecision> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("consume_magic_box_ai_budget", {
      p_user_id: input.userId,
      p_operation: input.operation,
    });
    if (!error && typeof data === "boolean") {
      return { allowed: data, retryAfterSeconds: data ? 0 : 60 };
    }
  } catch {
    // SQL not applied yet; keep a process-local budget so a missing table cannot fail open.
  }
  return processBudget(input);
}

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
