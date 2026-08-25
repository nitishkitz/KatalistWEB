import { timingSafeEqual } from "node:crypto";

import { FirebaseAdminConfigError, getFirebaseMessaging } from "@/features/notifications/firebase-admin.server";
import { classifyFirebaseError, notificationPath, retryDelayMs, trustedNotificationPath } from "@/features/notifications/push-delivery";
import { jsonNoStore } from "@/lib/supabase-user.server";

export type ClaimedPushDelivery = {
  delivery_id: string;
  subscription_id: string;
  notification_id: string;
  fcm_token: string;
  attempt_count: number;
  kind: string;
  title: string;
  body: string | null;
  thing_id: string | null;
  list_id: string | null;
  path?: string | null;
};

export type DrainSummary = { claimed: number; sent: number; retry: number; dead: number };

export type FinishDeliveryInput = {
  deliveryId: string;
  result: "sent" | "retry" | "dead";
  messageId?: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  nextAttemptAt?: string | null;
  revoke?: boolean;
};

export type DrainDeps = {
  claim: (limit: number, leaseSeconds: number) => Promise<ClaimedPushDelivery[]>;
  send: (message: { token: string; data: Record<string, string> }) => Promise<string>;
  finish: (input: FinishDeliveryInput) => Promise<void>;
  now?: () => Date;
  random?: () => number;
  log?: (operation: string, code: string, deliveryId: string) => void;
};

const MAX_ATTEMPTS = 8;

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { code?: string; errorInfo?: { code?: string } };
    return String(record.code ?? record.errorInfo?.code ?? "unknown");
  }
  return "unknown";
}

export async function drainPushDeliveries(deps: DrainDeps, limit = 25): Promise<DrainSummary> {
  const claimed = await deps.claim(Math.max(1, limit), 30);
  const summary: DrainSummary = { claimed: claimed.length, sent: 0, retry: 0, dead: 0 };
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  for (const delivery of claimed) {
    if (delivery.attempt_count > MAX_ATTEMPTS) {
      await deps.finish({ deliveryId: delivery.delivery_id, result: "dead", errorCode: "max_attempts" });
      summary.dead += 1;
      continue;
    }

    const data = {
      notificationId: delivery.notification_id,
      kind: delivery.kind,
      path: delivery.path
        ? trustedNotificationPath(delivery.path)
        : notificationPath({ thingId: delivery.thing_id, listId: delivery.list_id }),
      title: delivery.title,
      body: delivery.body ?? "",
    };

    try {
      const messageId = await deps.send({ token: delivery.fcm_token, data });
      await deps.finish({ deliveryId: delivery.delivery_id, result: "sent", messageId });
      summary.sent += 1;
    } catch (error) {
      const code = errorCode(error);
      const classified = classifyFirebaseError(code);
      deps.log?.("push_drain", classified, delivery.delivery_id);
      if (classified === "dead-token") {
        await deps.finish({
          deliveryId: delivery.delivery_id,
          result: "dead",
          errorCode: code,
          revoke: true,
        });
        summary.dead += 1;
      } else if (classified === "retry" && delivery.attempt_count < MAX_ATTEMPTS) {
        const delay = retryDelayMs(delivery.attempt_count, random);
        await deps.finish({
          deliveryId: delivery.delivery_id,
          result: "retry",
          errorCode: code,
          nextAttemptAt: new Date(now().getTime() + delay).toISOString(),
        });
        summary.retry += 1;
      } else {
        await deps.finish({ deliveryId: delivery.delivery_id, result: "dead", errorCode: code });
        summary.dead += 1;
      }
    }
  }

  return summary;
}

export async function createDefaultDrainDeps(): Promise<DrainDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    async claim(limit, leaseSeconds) {
      const { data, error } = await supabaseAdmin.rpc("claim_notification_deliveries", {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw error;
      return (data ?? []) as ClaimedPushDelivery[];
    },
    async send({ token, data }) {
      const messaging = getFirebaseMessaging();
      return messaging.send({
        token,
        data,
        webpush: { headers: { Urgency: "high" } },
      });
    },
    async finish(input) {
      const { error } = await supabaseAdmin.rpc("finish_notification_delivery", {
        p_delivery_id: input.deliveryId,
        p_result: input.result,
        p_fcm_message_id: input.messageId ?? null,
        p_error_code: input.errorCode ?? null,
        p_error_detail: input.errorDetail ?? null,
        p_next_attempt_at: input.nextAttemptAt ?? null,
        p_revoke: Boolean(input.revoke),
      });
      if (error) throw error;
    },
    log(operation, code, deliveryId) {
      console.info(JSON.stringify({ op: operation, code, deliveryId }));
    },
  };
}

function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createDrainHandler(options?: { env?: Record<string, string | undefined>; deps?: DrainDeps }) {
  return async (request: Request) => {
    const env = options?.env ?? process.env;
    const expected = env.PUSH_DRAIN_SECRET?.trim() ?? "";
    if (!expected) return jsonNoStore({ error: "not_found" }, 404);

    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/.exec(header.trim());
    const supplied = match?.[1] ?? "";
    if (!supplied || !secretsEqual(supplied, expected)) {
      return jsonNoStore({ error: "unauthorized" }, 401);
    }

    try {
      const deps = options?.deps ?? (await createDefaultDrainDeps());
      const summary = await drainPushDeliveries(deps, 25);
      return jsonNoStore(summary);
    } catch (error) {
      if (error instanceof FirebaseAdminConfigError) {
        return jsonNoStore({ error: "unavailable", message: "Push delivery is not configured." }, 503);
      }
      return jsonNoStore({ error: "unavailable", message: "Push delivery is temporarily unavailable." }, 503);
    }
  };
}
