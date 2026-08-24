import { supabase } from "@/integrations/supabase/client";
import { isPreviewMode } from "@/lib/session-mode";
import { MAGIC_BOX_ATTACHMENT_LIMITS, type DraftAttachment } from "./types";

function stagingKey(userId: string, clientId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(0, 80);
  return `staging/${userId}/${clientId}/${safe}`;
}

export function validateAttachment(file: File, existingCount: number): string | null {
  if (existingCount >= MAGIC_BOX_ATTACHMENT_LIMITS.maxFiles) return "You can attach up to 5 files.";
  if (file.size > MAGIC_BOX_ATTACHMENT_LIMITS.maxBytes) return "Each file must be 20 MB or smaller.";
  return null;
}

export async function stageAttachment(input: {
  userId: string;
  clientId: string;
  file: File;
}): Promise<{ status: DraftAttachment["status"]; stagingKey?: string; error?: string }> {
  if (isPreviewMode()) return { status: "ready", stagingKey: `preview/${input.clientId}` };
  try {
    const key = stagingKey(input.userId, input.clientId, input.file.name);
    const { error } = await supabase.storage.from("thing-attachments").upload(key, input.file, {
      upsert: true,
      contentType: input.file.type || "application/octet-stream",
    });
    if (error) return { status: "failed", error: "upload" };
    return { status: "ready", stagingKey: key };
  } catch {
    return { status: "failed", error: "upload" };
  }
}

export async function finalizeAttachments(input: {
  thingId: string;
  attachments: DraftAttachment[];
}): Promise<{ failedClientIds: string[] }> {
  if (isPreviewMode()) return { failedClientIds: [] };
  const failedClientIds: string[] = [];
  for (const attachment of input.attachments) {
    if (!attachment.stagingKey || attachment.status !== "ready") continue;
    try {
      const { error } = await supabase.rpc("finalize_thing_attachment", {
        p_thing_id: input.thingId,
        p_storage_key: attachment.stagingKey,
        p_file_name: attachment.file.name,
        p_mime_type: attachment.file.type || "application/octet-stream",
        p_byte_size: attachment.file.size,
      });
      if (error) failedClientIds.push(attachment.clientId);
    } catch {
      failedClientIds.push(attachment.clientId);
    }
  }
  return { failedClientIds };
}
