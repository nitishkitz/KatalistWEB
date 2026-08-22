import { defaultGetUser, HttpError, jsonNoStore, requireSupabaseUser, type GetUserFn } from "@/lib/supabase-user.server";

const MAX_JSON_BYTES = 8192;

export type PushSubscriptionRpcs = {
  register: (profileId: string, token: string, userAgent: string | null) => Promise<void>;
  revoke: (profileId: string, token: string) => Promise<void>;
};

function normalizeFcmToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 20 || token.length > 4096) {
    throw new HttpError(400, "Check the information and try again.");
  }
  return token;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_JSON_BYTES) throw new HttpError(400, "Check the information and try again.");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "Check the information and try again.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Check the information and try again.");
  }
}

export async function createDefaultPushRpcs(): Promise<PushSubscriptionRpcs> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    async register(profileId, token, userAgent) {
      const { error } = await supabaseAdmin.rpc("register_push_subscription", {
        p_profile_id: profileId,
        p_fcm_token: token,
        p_user_agent: userAgent,
      });
      if (error) throw new HttpError(503, "Notification setup is unavailable.");
    },
    async revoke(profileId, token) {
      const { error } = await supabaseAdmin.rpc("revoke_push_subscription", {
        p_profile_id: profileId,
        p_fcm_token: token,
      });
      if (error) throw new HttpError(503, "Notification setup is unavailable.");
    },
  };
}

export function createPushSubscriptionHandler(options?: {
  getUser?: GetUserFn;
  rpcs?: PushSubscriptionRpcs;
}) {
  return async (request: Request) => {
    try {
      const getUser = options?.getUser ?? defaultGetUser;
      const user = await requireSupabaseUser(request, getUser);
      const rpcs = options?.rpcs ?? (await createDefaultPushRpcs());
      const body = await readJson(request);
      const token = normalizeFcmToken(body.token);
      const userAgent = request.headers.get("user-agent");
      if (request.method === "DELETE") {
        await rpcs.revoke(user.id, token);
        return jsonNoStore({ ok: true });
      }
      await rpcs.register(user.id, token, userAgent);
      return jsonNoStore({ ok: true });
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonNoStore(
          error.status === 401
            ? { error: "unauthorized", message: error.message }
            : { error: "invalid_request", message: error.message },
          error.status,
        );
      }
      return jsonNoStore({ error: "unavailable", message: "Notification setup is unavailable." }, 503);
    }
  };
}
