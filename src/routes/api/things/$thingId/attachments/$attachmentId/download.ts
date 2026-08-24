import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { defaultGetUser, jsonNoStore, requireSupabaseUser } from "@/lib/supabase-user.server";

export const Route = createFileRoute("/api/things/$thingId/attachments/$attachmentId/download")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await requireSupabaseUser(request, defaultGetUser);
          const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
          const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
          const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
          const userClient = createClient(url, key, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await userClient.rpc("list_thing_attachments", { p_thing_id: params.thingId });
          if (error) return jsonNoStore({ error: "not_found" }, 404);
          const row = ((data ?? []) as Array<{ id: string; storage_key: string | null }>).find((item) => item.id === params.attachmentId);
          if (!row?.storage_key) return jsonNoStore({ error: "not_found" }, 404);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const signed = await supabaseAdmin.storage.from("thing-attachments").createSignedUrl(row.storage_key, 60);
          if (signed.error || !signed.data?.signedUrl) return jsonNoStore({ error: "not_found" }, 404);
          return jsonNoStore({ url: signed.data.signedUrl });
        } catch {
          return jsonNoStore({ error: "unauthorized" }, 401);
        }
      },
    },
  },
});
