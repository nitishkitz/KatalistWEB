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

        let body: { listId?: string; memberIds?: string[]; callType?: string } = {};
        try {
          body = (await request.json()) as { listId?: string; memberIds?: string[]; callType?: string };
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

        // The ring itself is written by the database as this user (auth.uid() is the caller),
        // which also decides who may be rung: participants only, no block either way,
        // connected for DMs. In-app delivery is the resulting call_rings rows.
        const { createClient } = await import("@supabase/supabase-js");
        const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!url || !anonKey) return json({ error: "not configured" }, 500);
        const asUser = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
        const requested = Array.isArray(body.memberIds) ? body.memberIds.filter((id) => typeof id === "string").slice(0, 50) : [];
        const { data: rung, error: ringError } = await (asUser.rpc as unknown as (
          fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
          "ring_call", { p_list_id: listId, p_recipients: requested, p_call_type: body.callType === "audio" || body.callType === "video" ? body.callType : null },
        );
        if (ringError) return json({ error: "could not start the call" }, /not found/i.test(ringError.message) ? 404 : 500);
        const recipientIds = (Array.isArray(rung) ? rung : []) as string[];
        if (recipientIds.length === 0) return json({ sent: 0, rung: 0 });

        const { data: caller } = await supabaseAdmin
          .from("profiles")
          .select("display_name, avatar_url")
          .eq("id", uid)
          .maybeSingle();
        const fromName = caller?.display_name || "Someone";
        const callType = body.callType === "audio" || body.callType === "video" ? body.callType : "";

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
            // Lets an open app render the full incoming-call card from the
            // push alone when its Realtime ring never arrived.
            listName: list.name ?? "",
            fromName,
            fromUserId: uid,
            fromAvatarUrl: caller?.avatar_url ?? "",
            callType,
            listKind: list.kind ?? "list",
          },
        );
        return json({ sent, rung: recipientIds.length });
      },
    },
  },
});
