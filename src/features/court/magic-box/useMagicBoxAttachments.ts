import { supabase } from "@/integrations/supabase/client";
import { isPreviewMode } from "@/lib/session-mode";
import { MAGIC_BOX_ATTACHMENT_LIMITS, type DraftAttachment } from "./types";

export function stagingKey(userId: string, clientId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";
  return `staging/${userId}/${clientId}/${safe}`;
}

export function validateAttachment(file: File, existingCount: number): string | null {
  if (existingCount >= MAGIC_BOX_ATTACHMENT_LIMITS.maxFiles) return "You can attach up to 5 files.";
  if (file.size > MAGIC_BOX_ATTACHMENT_LIMITS.maxBytes) return "Each file must be 20 MB or smaller.";
  return null;
}

export function validateAttachmentBatch(
  files: readonly File[],
  existingCount: number,
): { accepted: File[]; rejected: Array<{ file: File; reason: string }> } {
  const accepted: File[] = [];
  const rejected: Array<{ file: File; reason: string }> = [];
  let remaining = MAGIC_BOX_ATTACHMENT_LIMITS.maxFiles - existingCount;
  for (const file of files) {
    if (file.size > MAGIC_BOX_ATTACHMENT_LIMITS.maxBytes) {
      rejected.push({ file, reason: "Each file must be 20 MB or smaller." });
      continue;
    }
    if (remaining <= 0) {
      rejected.push({ file, reason: "You can attach up to 5 files." });
      continue;
    }
    accepted.push(file);
    remaining -= 1;
  }
  return { accepted, rejected };
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

export async function removeStagedObject(stagingKeyValue: string | undefined): Promise<void> {
  if (!stagingKeyValue || isPreviewMode() || stagingKeyValue.startsWith("preview/")) return;
  try {
    await supabase.storage.from("thing-attachments").remove([stagingKeyValue]);
  } catch {
    // best-effort
  }
}

export async function abandonAttachment(input: {
  stagingKey?: string;
  attachmentId?: string;
  accessToken?: string | null;
}): Promise<void> {
  if (isPreviewMode()) return;
  if (input.stagingKey && !input.attachmentId) {
    await removeStagedObject(input.stagingKey);
    return;
  }
  try {
    await fetch("/api/magic-box/attachments/remove", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}),
      },
      body: JSON.stringify({ attachmentId: input.attachmentId, stagingKey: input.stagingKey }),
    });
  } catch {
    if (input.stagingKey) await removeStagedObject(input.stagingKey);
  }
}

export async function finalizeAttachments(input: {
  thingId: string;
  attachments: DraftAttachment[];
  accessToken?: string | null;
}): Promise<{ failedClientIds: string[] }> {
  if (isPreviewMode()) return { failedClientIds: [] };
  const failedClientIds: string[] = [];
  for (const attachment of input.attachments) {
    if (!attachment.stagingKey || (attachment.status !== "ready" && attachment.status !== "finalizing" && attachment.status !== "recovery-failed")) {
      continue;
    }
    try {
      const res = await fetch("/api/magic-box/attachments/finalize", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}),
        },
        body: JSON.stringify({
          thingId: input.thingId,
          clientId: attachment.clientId,
          stagingKey: attachment.stagingKey,
          fileName: attachment.file.name,
          mimeType: attachment.file.type || "application/octet-stream",
        }),
      });
      if (!res.ok) failedClientIds.push(attachment.clientId);
    } catch {
      failedClientIds.push(attachment.clientId);
    }
  }
  return { failedClientIds };
}
