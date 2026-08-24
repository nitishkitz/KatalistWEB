import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isPreviewMode } from "@/lib/session-mode";

export type ThingAttachmentRow = {
  id: string;
  thing_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
  storage_key: string | null;
};

export function useThingAttachments(thingId: string | undefined) {
  return useQuery({
    queryKey: ["thing-attachments", thingId],
    enabled: Boolean(thingId) && !isPreviewMode(),
    queryFn: async (): Promise<ThingAttachmentRow[]> => {
      const { data, error } = await supabase.rpc("list_thing_attachments", { p_thing_id: thingId! });
      if (error) throw error;
      return ((data ?? []) as ThingAttachmentRow[]).filter((row) => row.file_name);
    },
  });
}

export async function requestAttachmentDownload(thingId: string, attachmentId: string, accessToken: string) {
  const res = await fetch(`/api/things/${thingId}/attachments/${attachmentId}/download`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("That file isn’t available.");
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("That file isn’t available.");
  return json.url;
}
