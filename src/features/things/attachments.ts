import { supabase } from "@/integrations/supabase/client";
import type { ThingFile } from "@/domain/thing";
import { detectFileType, formatFileSize, MAX_THING_ATTACHMENT_BYTES } from "@/lib/file-utils";
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

export type SignedThingPath = { url?: string; error?: string };

/** Dedupe and cap private Storage signing requests for both detail files and
 * bounded overview previews. Every requested path receives an outcome. */
export async function signThingAttachmentPaths(
  paths: string[],
): Promise<Map<string, SignedThingPath>> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const signingByPath = new Map<string, SignedThingPath>();
  for (let offset = 0; offset < uniquePaths.length; offset += 100) {
    const batch = uniquePaths.slice(offset, offset + 100);
    // Storage can race session hydration immediately after sign-in. Keep the
    // attachment rows and let the authenticated server signer recover them.
    let data: Awaited<ReturnType<ReturnType<typeof supabase.storage.from>["createSignedUrls"]>>["data"] = null;
    try {
      const signed = await supabase.storage.from(BUCKET).createSignedUrls(batch, SIGNED_URL_TTL_SECONDS);
      if (!signed.error) data = signed.data;
    } catch {
      // The recovery endpoint below also covers a network failure here.
    }
    for (const entry of data ?? []) {
      const item = entry as {
        path: string;
        signedUrl?: string;
        error?: string | { message?: string };
      };
      const reason = item.error
        ? typeof item.error === "string"
          ? item.error
          : item.error.message
        : undefined;
      signingByPath.set(item.path, {
        url: item.signedUrl || undefined,
        error: reason || (!item.signedUrl ? "Preview unavailable for this file." : undefined),
      });
    }
  }
  const unresolved = uniquePaths.filter((path) => !signingByPath.get(path)?.url);
  if (unresolved.length) {
    try {
      const response = await authedFetch("/api/things/sign-attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: unresolved }),
      });
      if (response.ok) {
        const body = (await response.json()) as { urls?: Record<string, string> };
        for (const [path, url] of Object.entries(body.urls ?? {})) {
          if (typeof url === "string" && url) signingByPath.set(path, { url });
        }
      }
    } catch {
      // The client signing result remains the source of truth when the
      // recovery endpoint is unavailable.
    }
  }
  for (const path of uniquePaths) {
    if (!signingByPath.get(path)?.url) {
      const current = signingByPath.get(path);
      signingByPath.set(path, { error: current?.error || "Preview unavailable for this file." });
    }
  }
  return signingByPath;
}

/**
 * Real, persisted attachments for a batch of Things, with fresh signed URLs.
 * RLS on thing_attachments already scopes rows to Things the caller can view
 * and status='ready', so this is safe to call with any thingIds list.
 */
export async function fetchRealAttachments(thingIds: string[]): Promise<Map<string, ThingFile[]>> {
  const result = new Map<string, ThingFile[]>();
  if (!thingIds.length) return result;

  const readRows = () => supabase
    .from("thing_attachments")
    .select("id, thing_id, storage_key, file_name, mime_type, byte_size, created_at")
    .in("thing_id", thingIds)
    .order("created_at", { ascending: true });
  let { data: rows, error } = await readRows();
  if (error) {
    // A newly restored auth session can briefly fail an RLS-scoped read.
    // Retry once so Court does not cache an attachment-free success.
    await new Promise((resolve) => setTimeout(resolve, 300));
    ({ data: rows, error } = await readRows());
  }
  if (error) throw error;
  if (!rows?.length) return result;

  const typedRows = rows as AttachmentRow[];
  const signingByPath = await signThingAttachmentPaths(typedRows.map((row) => row.storage_key));

  const signed = typedRows.map((row) => {
    const signing = signingByPath.get(row.storage_key);
    const file: ThingFile = {
      id: row.id,
      name: row.file_name,
      type: detectFileType(row.file_name, row.mime_type ?? undefined),
      url: signing?.url,
      urlError: signing?.error ?? (!signing ? "Preview unavailable for this file." : undefined),
      sizeLabel: row.byte_size ? formatFileSize(row.byte_size) : undefined,
      mimeType: row.mime_type ?? undefined,
      storageKey: row.storage_key,
    };
    return { thingId: row.thing_id, file };
  });

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
  // H01: same 50MB cap as processFileForUpload (file-utils.ts) -- checked
  // here too since this is a separate upload path (real storage + the
  // reserve_thing_attachment RPC), not a caller of that function.
  if (file.size > MAX_THING_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 50 MB.`);
  }
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
    storageKey: reserved.storage_key,
  };
}

/**
 * H03: one-shot signed-URL refresh for a real (already-uploaded) attachment
 * -- goes through the same RLS-scoped `signThingAttachmentPaths` path as the
 * initial load, so a Thing the caller can no longer access still fails here
 * too (a resign is never a way to bypass a genuine denial).
 */
export async function resignThingAttachmentUrl(storageKey: string): Promise<string | undefined> {
  const signing = await signThingAttachmentPaths([storageKey]);
  return signing.get(storageKey)?.url;
}
