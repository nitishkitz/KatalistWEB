import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Push a new-message notification to a conversation's other members who have
// registered device tokens. Reaches them even when the app is closed. In-app
// live refresh is handled separately via the per-list broadcast channel.
export const Route = createFileRoute("/api/hub/notify-message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return json({ error: "unauthorized" }, 401);

        let body: { listId?: string; preview?: string } = {};
        try {
          body = (await request.json()) as { listId?: string; preview?: string };
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
        const isHub = list.kind === "dm" || list.kind === "group";

        const { data: members } = await supabaseAdmin
          .from("list_members")
          .select("profile_id")
          .eq("list_id", listId);
        const memberIds = new Set<string>(
          [list.owner_profile_id, ...(members ?? []).map((m) => m.profile_id)].filter(Boolean) as string[],
        );
        if (!memberIds.has(uid)) return json({ error: "forbidden" }, 403);

        const { data: sender } = await supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("id", uid)
          .maybeSingle();
        const fromName = sender?.display_name || "Someone";

        const recipientIds = [...memberIds].filter((id) => id !== uid);
        if (recipientIds.length === 0) return json({ sent: 0 });

        const { data: toks } = await supabaseAdmin
          .from("device_tokens")
          .select("token")
          .in("profile_id", recipientIds);
        const tokens = (toks ?? []).map((t) => t.token).filter(Boolean) as string[];

        // DM shows the sender as the title; a group shows the group name.
        const title = list.kind === "dm" ? fromName : list.name;
        const preview = (body.preview || "").trim();
        const messageBody =
          list.kind === "dm"
            ? preview || "sent you a message"
            : `${fromName}: ${preview || "sent a message"}`;

        const { sendPush } = await import("@/lib/fcm.server");
        const sent = await sendPush(
          tokens,
          { title, body: messageBody.slice(0, 140) },
          { url: isHub ? `/team/${listId}` : `/lists/${listId}`, kind: "message", hub: isHub ? "1" : "0", listId },
        );
        return json({ sent });
      },
    },
  },
});
