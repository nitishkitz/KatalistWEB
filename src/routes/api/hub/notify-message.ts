import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

        let body: { listId?: string; messageId?: string } = {};
        try {
          body = (await request.json()) as { listId?: string; messageId?: string };
        } catch {
          body = {};
        }
        const listId = body.listId;
        const messageId = body.messageId;
        if (!listId || !messageId || !UUID.test(listId) || !UUID.test(messageId)) {
          return json({ error: "Valid listId and messageId required" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        const uid = userData?.user?.id;
        if (!uid) return json({ error: "unauthorized" }, 401);

        const { data: list, error: listError } = await supabaseAdmin
          .from("lists")
          .select("id, name, owner_profile_id, kind")
          .eq("id", listId)
          .maybeSingle();
        if (listError) return json({ error: "list lookup failed" }, 503);
        if (!list) return json({ error: "not found" }, 404);
        const isHub = list.kind === "dm" || list.kind === "group";

        const { data: members, error: membersError } = await supabaseAdmin
          .from("list_members")
          .select("profile_id")
          .eq("list_id", listId);
        if (membersError) return json({ error: "membership lookup failed" }, 503);
        const memberIds = new Set<string>(
          [list.owner_profile_id, ...(members ?? []).map((m) => m.profile_id)].filter(Boolean) as string[],
        );
        if (!memberIds.has(uid)) return json({ error: "forbidden" }, 403);

        // The client cannot invent notification text, mentions or a different
        // author's message. The persisted, RLS-protected send is the source.
        const { data: message, error: messageError } = await supabaseAdmin
          .from("list_messages")
          .select("id,list_id,author_profile_id,body,kind,attachment,mentioned_profile_ids")
          .eq("id", messageId).eq("list_id", listId).is("deleted_at", null).maybeSingle();
        if (messageError) return json({ error: "message lookup failed" }, 503);
        if (!message) return json({ error: "message not found" }, 404);
        if (message.author_profile_id !== uid || message.kind !== "message") return json({ error: "forbidden" }, 403);

        const { data: sender } = await supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("id", uid)
          .maybeSingle();
        const fromName = sender?.display_name || "Someone";

        const recipientIds = [...memberIds].filter((id) => id !== uid);
        if (recipientIds.length === 0) return json({ sent: 0 });

        const { data: toks, error: tokensError } = await supabaseAdmin
          .from("device_tokens")
          .select("token, profile_id")
          .in("profile_id", recipientIds);
        if (tokensError) return json({ error: "device lookup failed" }, 503);
        const rows = (toks ?? []) as Array<{ token: string; profile_id: string }>;

        // Mentioned recipients get a distinct, more prominent notification —
        // everyone else gets the regular new-message preview. Only members of
        // this conversation who were actually mentioned count (a mention of
        // someone outside the list can't have a token to notify anyway).
        const mentioned = new Set((message.mentioned_profile_ids ?? []).filter((id) => memberIds.has(id) && id !== uid));
        const mentionedTokens = rows.filter((r) => mentioned.has(r.profile_id)).map((r) => r.token);
        const otherTokens = rows.filter((r) => !mentioned.has(r.profile_id)).map((r) => r.token);

        const url = isHub ? `/team/${listId}` : `/lists/${listId}`;
        const preview = (message.body || "").trim() || (message.attachment ? "📎 attachment" : "");
        // This ungenerated RPC runs with the service role and atomically
        // returns true for exactly one request per persisted message ID.
        type ClaimRpc = (name: "claim_list_message_push", args: { p_message_id: string }) => Promise<{
          data: boolean | null; error: { message: string } | null;
        }>;
        const claim = supabaseAdmin.rpc as unknown as ClaimRpc;
        const { data: accepted, error: claimError } = await claim("claim_list_message_push", { p_message_id: messageId });
        if (claimError) return json({ error: "notification claim failed" }, 503);
        if (!accepted) return json({ sent: 0, alreadyClaimed: true });
        const { sendPush } = await import("@/lib/fcm.server");

        let sent = 0;
        if (mentionedTokens.length > 0) {
          sent += await sendPush(
            mentionedTokens,
            { title: `${fromName} mentioned you`, body: (preview || "in a message").slice(0, 140) },
            { url, kind: "mention", hub: isHub ? "1" : "0", listId },
          );
        }
        if (otherTokens.length > 0) {
          // DM shows the sender as the title; a group shows the group name.
          const title = list.kind === "dm" ? fromName : list.name;
          const messageBody =
            list.kind === "dm"
              ? preview || "sent you a message"
              : `${fromName}: ${preview || "sent a message"}`;
          sent += await sendPush(
            otherTokens,
            { title, body: messageBody.slice(0, 140) },
            { url, kind: "message", hub: isHub ? "1" : "0", listId },
          );
        }
        return json({ sent });
      },
    },
  },
});
