import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { COVER_BUCKET, COVER_SIGNED_URL_SECONDS, COVER_SIGN_BATCH_LIMIT, type CoverDeps } from "./covers";
import { DesignOperationError, toDesignError } from "./design-queries";

type StorageError = { message?: string; statusCode?: string | number };

function coverUploadError(error: StorageError): DesignOperationError {
  const text = (error.message ?? "").toLowerCase();
  if (text.includes("row-level security") || text.includes("unauthorized") || String(error.statusCode) === "403") {
    return new DesignOperationError("forbidden", "You don't have permission to change this design's cover.");
  }
  if (text.includes("exceeded") || text.includes("too large") || text.includes("payload") || String(error.statusCode) === "413") {
    return new DesignOperationError("invalid_input", "That image is too large. Choose one under 5 MB.");
  }
  if (text.includes("mime") || text.includes("not supported") || text.includes("invalid")) {
    return new DesignOperationError("invalid_input", "That image type is not supported. Use PNG, JPEG or WebP.");
  }
  if (text.includes("bucket not found")) {
    return new DesignOperationError("migration_missing", "Cover storage is not set up on this database yet.");
  }
  return new DesignOperationError("unknown", "The image could not be uploaded. Your current cover is unchanged. Try again.");
}

/** Supabase-backed storage and RPC calls for cover images. */
export const supabaseCoverDeps: CoverDeps = {
  async upload(key, file, contentType) {
    const { error } = await supabase.storage.from(COVER_BUCKET).upload(key, file, { contentType, upsert: false });
    if (error) throw coverUploadError(error as StorageError);
  },
  async remove(keys) {
    const { error } = await supabase.storage.from(COVER_BUCKET).remove(keys);
    if (error) throw new Error(error.message);
  },
  async setCover(resourceId, key) {
    const { data, error } = await callUngeneratedRpc("set_design_cover", { p_resource_id: resourceId, p_storage_key: key });
    if (error) throw toDesignError(error as { message: string; hint?: string; code?: string });
    return (data as string | null) ?? null;
  },
  async clearCover(resourceId) {
    const { data, error } = await callUngeneratedRpc("clear_design_cover", { p_resource_id: resourceId });
    if (error) throw toDesignError(error as { message: string; hint?: string; code?: string });
    return (data as string | null) ?? null;
  },
  newId: () => crypto.randomUUID(),
};

/** Signed read URLs for cover keys; storage policies authorize each key by List membership. */
export async function signDesignCovers(keys: readonly string[], querySignal?: AbortSignal): Promise<Map<string, string>> {
  const unique = [...new Set(keys.filter(Boolean))].slice(0, COVER_SIGN_BATCH_LIMIT);
  const out = new Map<string, string>();
  if (unique.length === 0 || querySignal?.aborted) return out;
  const { data, error } = await supabase.storage.from(COVER_BUCKET).createSignedUrls(unique, COVER_SIGNED_URL_SECONDS);
  if (error) throw new DesignOperationError("unknown", "Cover images could not be loaded.");
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) out.set(entry.path, entry.signedUrl);
  }
  return out;
}
