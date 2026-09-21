import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Push an incoming-call notification to a list's members (except the caller)
// who have registered device tokens. Reaches members even when the app is
// closed. In-app (app open) rings are handled separately via Realtime.
export const Route = createFileRoute("/api/calls/ring")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return json({ error: "unauthorized" }, 401);

        let body: { listId?: string; memberIds?: string[] } = {};
        try {
          body = (await request.json()) as { listId?: string; memberIds?: string[] };
        } catch {
          body = {};
        }
        const listId = body.listId;
        if (!listId) return json({ error: "listId required" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        const uid = userData?.user?.id;
        if (!uid) return json({ error: "unauthorized" }, 401);

        const { data: list } = await supabaseAdmin
          .from("lists")
          .select("id, name, owner_profile_id, kind")
          .eq("id", listId)
          .maybeSingle();
        if (!list) return json({ error: "not found" }, 404);

        // DM/group conversations live under /team; task Lists under /lists.
        const isHub = list.kind === "dm" || list.kind === "group";

        const { data: members } = await supabaseAdmin
          .from("list_members")
          .select("profile_id")
          .eq("list_id", listId);
        const memberIds = new Set<string>(
          [list.owner_profile_id, ...(members ?? []).map((m) => m.profile_id)].filter(Boolean) as string[],
        );
        if (!memberIds.has(uid)) return json({ error: "forbidden" }, 403);

        const { data: caller } = await supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("id", uid)
          .maybeSingle();
        const fromName = caller?.display_name || "Someone";

        // If the caller picked a subset of people to ring, only push to those —
        // but always intersect with actual list membership so a client can
        // never make this endpoint push to someone outside the list.
        const requested = Array.isArray(body.memberIds) ? new Set(body.memberIds) : null;
        const recipientIds = [...memberIds].filter(
          (id) => id !== uid && (!requested || requested.has(id)),
        );
        if (recipientIds.length === 0) return json({ sent: 0 });

        const { data: toks } = await supabaseAdmin
          .from("device_tokens")
          .select("token")
          .in("profile_id", recipientIds);
        const tokens = (toks ?? []).map((t) => t.token).filter(Boolean) as string[];

        const { sendPush } = await import("@/lib/fcm.server");
        const sent = await sendPush(
          tokens,
          { title: "Incoming call", body: `${fromName} started a call in ${list.name}` },
          {
            url: isHub ? `/team/${listId}` : `/lists/${listId}`,
            kind: "incoming_call",
            hub: isHub ? "1" : "0",
            listId,
          },
        );
        return json({ sent });
      },
    },
  },
});
