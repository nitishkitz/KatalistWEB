import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Push a "mentioned you" notification for a Thing comment. The in-app
// notification row is created by a database trigger when the comment is
// inserted (one per recipient per comment, deduplicated by a unique index);
// this route only delivers the matching push, and claims each row atomically
// so a retry or double call can never push the same mention twice.
export const Route = createFileRoute("/api/things/notify-mention")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return json({ error: "unauthorized" }, 401);

        let commentId: string | undefined;
        try {
          commentId = ((await request.json()) as { commentId?: string }).commentId;
        } catch {
          commentId = undefined;
        }
        if (!commentId || !UUID.test(commentId)) return json({ error: "Valid commentId required" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        const uid = userData?.user?.id;
        if (!uid) return json({ error: "unauthorized" }, 401);

        const { data: comment, error: commentError } = await supabaseAdmin
          .from("thing_comments")
          .select("id, thing_id, author_actor_id")
          .eq("id", commentId)
          .maybeSingle();
        if (commentError) return json({ error: "comment lookup failed" }, 503);
        if (!comment) return json({ error: "not found" }, 404);

        const { data: author } = await supabaseAdmin
          .from("actors")
          .select("profile_id")
          .eq("id", comment.author_actor_id)
          .maybeSingle();
        // Only the author can trigger delivery for their own comment.
        if (!author || author.profile_id !== uid) return json({ error: "forbidden" }, 403);

        const { data: pending, error: pendingError } = await supabaseAdmin
          .from("notifications")
          .select("id, profile_id, title, body, payload")
          .eq("kind", "mention")
          .eq("payload->>source_id", commentId);
        if (pendingError) return json({ error: "notification lookup failed" }, 503);

        const claimedProfiles: string[] = [];
        let title = "Someone mentioned you";
        let body = "";
        for (const row of pending ?? []) {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          if (payload.pushed_at) continue;
          // Conditional update = atomic claim: only one caller flips pushed_at.
          const { data: claimed } = await supabaseAdmin
            .from("notifications")
            .update({ payload: { ...payload, pushed_at: new Date().toISOString() } })
            .eq("id", row.id)
            .filter("payload->>pushed_at", "is", null)
            .select("id")
            .maybeSingle();
          if (!claimed) continue;
          claimedProfiles.push(row.profile_id);
          title = row.title;
          body = row.body ?? "";
        }
        if (claimedProfiles.length === 0) return json({ sent: 0 });

        const { data: toks, error: tokensError } = await supabaseAdmin
          .from("device_tokens")
          .select("token")
          .in("profile_id", claimedProfiles);
        if (tokensError) return json({ error: "device lookup failed" }, 503);
        const tokens = (toks ?? []).map((t) => t.token as string);
        if (tokens.length === 0) return json({ sent: 0 });

        const { sendPush } = await import("@/lib/fcm.server");
        const sent = await sendPush(
          tokens,
          { title, body: (body || "in a comment").slice(0, 140) },
          { url: `/?thing=${comment.thing_id}`, kind: "mention", hub: "0", listId: "" },
        );
        return json({ sent });
      },
    },
  },
});
