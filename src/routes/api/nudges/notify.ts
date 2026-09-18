import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Push a nudge to a Thing's current assignee (if they have device tokens),
// reaching them even when the app is closed. The nudge itself is recorded by the
// SECURITY DEFINER `nudge_thing` RPC; this endpoint only sends the notification.
export const Route = createFileRoute("/api/nudges/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return json({ error: "unauthorized" }, 401);

        let body: { thingId?: string } = {};
        try {
          body = (await request.json()) as { thingId?: string };
        } catch {
          body = {};
        }
        const thingId = body.thingId;
        if (!thingId) return json({ error: "thingId required" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        const uid = userData?.user?.id;
        if (!uid) return json({ error: "unauthorized" }, 401);

        const { data: thing } = await supabaseAdmin
          .from("things")
          .select("id, title, current_assignee_actor_id, owner_actor_id")
          .eq("id", thingId)
          .maybeSingle();
        if (!thing) return json({ error: "not found" }, 404);

        // Only the owner may nudge; confirm the caller is the owner.
        const { data: myActor } = await supabaseAdmin
          .from("actors")
          .select("id")
          .eq("profile_id", uid)
          .maybeSingle();
        if (!myActor?.id || myActor.id !== thing.owner_actor_id) {
          return json({ error: "forbidden" }, 403);
        }

        // Resolve the assignee actor to a profile, and never notify yourself.
        const { data: assigneeActor } = await supabaseAdmin
          .from("actors")
          .select("profile_id")
          .eq("id", thing.current_assignee_actor_id)
          .maybeSingle();
        const assigneeProfile = assigneeActor?.profile_id;
        if (!assigneeProfile || assigneeProfile === uid) return json({ sent: 0 });

        const { data: sender } = await supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("id", uid)
          .maybeSingle();
        const fromName = sender?.display_name || "Someone";

        const { data: toks } = await supabaseAdmin
          .from("device_tokens")
          .select("token")
          .eq("profile_id", assigneeProfile);
        const tokens = (toks ?? []).map((t) => t.token).filter(Boolean) as string[];

        const { sendPush } = await import("@/lib/fcm.server");
        const sent = await sendPush(
          tokens,
          { title: "Nudge", body: `${fromName} nudged you: ${thing.title}`.slice(0, 140) },
          { url: "/court", kind: "nudge", thingId },
        );
        return json({ sent });
      },
    },
  },
});
