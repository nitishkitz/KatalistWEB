import { createFileRoute } from "@tanstack/react-router";
import { staticPhoneLogin } from "../../../../server/lib/phone-auth";
import { getSupabaseAdmin } from "../../../../server/lib/supabase-admin";
import { maintenanceActive } from "@/lib/reset-controls.server";

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

function clientAddress(request: Request): string {
  return (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "").trim();
}

/** Temporary static-code sign-in. The code is checked here, never in the browser. */
export const Route = createFileRoute("/api/auth/phone-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { phone?: unknown; otp?: unknown } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Invalid sign-in request.", code: "invalid_phone" }, 400);
        }
        const result = await staticPhoneLogin({
          admin: getSupabaseAdmin(),
          phone: body.phone,
          code: body.otp,
          ip: clientAddress(request),
          maintenance: maintenanceActive(),
        });
        if (!result.ok) {
          return json({ error: result.message, code: result.code }, result.status,
            result.retryAfterSec ? { "retry-after": String(result.retryAfterSec) } : {});
        }
        return json({ token_hash: result.token_hash, email: result.email });
      },
    },
  },
});
