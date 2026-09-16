import { supabase } from "@/integrations/supabase/client";
import type { ThingFile } from "@/domain/thing";
import { detectFileType, formatFileSize } from "@/lib/file-utils";
import { authedFetch } from "@/lib/authed-fetch";

const BUCKET = "thing-attachments";
const SIGNED_URL_TTL_SECONDS = 3600;

type AttachmentRow = {
  id: string;
  thing_id: string;
  storage_key: string;
  file_name: string;
  mime_type: string | null;
  byte_size: number | null;
  created_at: string;
};

/**
 * Real, persisted attachments for a batch of Things, with fresh signed URLs.
 * RLS on thing_attachments already scopes rows to Things the caller can view
 * and status='ready', so this is safe to call with any thingIds list.
 */
export async function fetchRealAttachments(thingIds: string[]): Promise<Map<string, ThingFile[]>> {
  const result = new Map<string, ThingFile[]>();
  if (!thingIds.length) return result;

  const { data: rows, error } = await supabase
    .from("thing_attachments")
    .select("id, thing_id, storage_key, file_name, mime_type, byte_size, created_at")
    .in("thing_id", thingIds)
    .order("created_at", { ascending: true });

  if (error || !rows?.length) return result;

  const signed = await Promise.all(
    (rows as AttachmentRow[]).map(async (row) => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_key, SIGNED_URL_TTL_SECONDS);
      const file: ThingFile = {
        id: row.id,
        name: row.file_name,
        type: detectFileType(row.file_name, row.mime_type ?? undefined),
        url: data?.signedUrl,
        sizeLabel: row.byte_size ? formatFileSize(row.byte_size) : undefined,
        mimeType: row.mime_type ?? undefined,
      };
      return { thingId: row.thing_id, file };
    }),
  );

  for (const { thingId, file } of signed) {
    const existing = result.get(thingId);
    if (existing) existing.push(file);
    else result.set(thingId, [file]);
  }
  return result;
}

/**
 * Uploads a File to a private per-user staging path, reserves it against a
 * Thing, then finalizes it via the server (moving staging -> its final
 * things/{thingId}/... path requires elevated storage privilege the client
 * doesn't have). Returns the real, persisted ThingFile - never a blob: URL.
 */
export async function uploadThingAttachment(thingId: string, file: File): Promise<ThingFile> {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) throw new Error("Sign in to attach files.");

  const clientId = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";
  const stagingKey = `staging/${authData.user.id}/${clientId}/${safeName}`;

  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(stagingKey, file, {
    contentType: file.type || undefined,
  });
  if (uploadErr) throw uploadErr;

  const { data: reservedRaw, error: reserveErr } = await supabase.rpc("reserve_thing_attachment", {
    p_thing_id: thingId,
    p_client_id: clientId,
    p_staging_key: stagingKey,
    p_file_name: file.name,
  });
  if (reserveErr) throw reserveErr;
  const reserved = (Array.isArray(reservedRaw) ? reservedRaw[0] : reservedRaw) as {
    id: string;
    storage_key: string;
  };

  const res = await authedFetch("/api/things/complete-attachment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      attachmentId: reserved.id,
      stagingKey,
      storageKey: reserved.storage_key,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to finalize attachment (${res.status})`);
  }

  const { data: signedData } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(reserved.storage_key, SIGNED_URL_TTL_SECONDS);

  return {
    id: reserved.id,
    name: file.name,
    type: detectFileType(file.name, file.type),
    url: signedData?.signedUrl,
    sizeLabel: formatFileSize(file.size),
    mimeType: file.type || undefined,
    isNew: true,
  };
}
