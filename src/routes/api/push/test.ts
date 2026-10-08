import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Authenticated end-to-end diagnostic: server -> FCM -> this user's Chrome. */
export const Route = createFileRoute("/api/push/test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return json({ error: "Sign in again, then retry." }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        const uid = userData?.user?.id;
        if (!uid) return json({ error: "Sign in again, then retry." }, 401);

        const { data: rows, error } = await supabaseAdmin
          .from("device_tokens")
          .select("token")
          .eq("profile_id", uid);
        if (error) return json({ error: "Couldn't read this device's notification registration." }, 503);

        const { sendPushDetailed } = await import("@/lib/fcm.server");
        const result = await sendPushDetailed(
          (rows ?? []).map((row) => row.token),
          { title: "Katalist notifications work", body: "Chrome is connected and ready." },
          { url: "/me", kind: "test" },
        );
        if (result.sent > 0) return json(result);
        if (result.reason === "not_configured") {
          return json({ error: "Push delivery is not configured on the server." }, 503);
        }
        if (result.reason === "no_tokens") {
          return json({ error: "This Chrome device is not registered. Disable and enable notifications, then retry." }, 409);
        }
        return json({ error: "Firebase rejected the test notification. Re-enable notifications and retry." }, 502);
      },
    },
  },
});
