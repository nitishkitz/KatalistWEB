import { defineEventHandler, readBody, createError } from "h3";
import { requireUser } from "../../lib/require-user";
import { getSupabaseAdmin } from "../../lib/supabase-admin";

const BUCKET = "thing-attachments";

export default defineEventHandler(async (event) => {
  const { client, userId } = await requireUser(event);

  const body = (await readBody(event)) as {
    attachmentId?: string;
    stagingKey?: string;
    storageKey?: string;
  } | null;

  const { attachmentId, stagingKey, storageKey } = body || {};
  if (!attachmentId || !stagingKey || !storageKey) {
    throw createError({ statusCode: 400, message: "attachmentId, stagingKey and storageKey are required." });
  }

  // Re-verify the attachment belongs to this caller and is still pending
  // before touching storage with elevated privilege - never trust the
  // client-supplied staging/storage keys blindly.
  const { data: actorRow } = await client
    .from("actors")
    .select("id")
    .eq("profile_id", userId)
    .eq("kind", "user")
    .maybeSingle();
  if (!actorRow) {
    throw createError({ statusCode: 403, message: "Could not resolve caller identity." });
  }

  const admin = getSupabaseAdmin();
  const { data: attachment, error: fetchErr } = await admin
    .from("thing_attachments")
    .select("id, uploaded_by_actor_id, staging_key, storage_key, status")
    .eq("id", attachmentId)
    .maybeSingle();

  if (fetchErr || !attachment) {
    throw createError({ statusCode: 404, message: "Attachment not found." });
  }
  if (attachment.uploaded_by_actor_id !== actorRow.id) {
    throw createError({ statusCode: 403, message: "You did not upload this attachment." });
  }
  if (attachment.staging_key !== stagingKey || attachment.storage_key !== storageKey) {
    throw createError({ statusCode: 400, message: "Staging/storage key mismatch." });
  }
  if (attachment.status !== "pending") {
    // Already finalized (e.g. a retried request) - idempotent no-op.
    return { ok: true, attachment };
  }

  const { error: moveErr } = await admin.storage.from(BUCKET).move(stagingKey, storageKey);
  if (moveErr) {
    throw createError({ statusCode: 500, message: moveErr.message || "Failed to move attachment into place." });
  }

  // Delegate finalization to the RPC (via the caller's own client) so its
  // own authorization/consistency checks run too, not just this endpoint's.
  const { data: completed, error: completeErr } = await client.rpc("complete_thing_attachment", {
    p_attachment_id: attachmentId,
    p_storage_key: storageKey,
  });
  if (completeErr) {
    throw createError({ statusCode: 500, message: completeErr.message || "Failed to finalize attachment." });
  }

  return { ok: true, attachment: completed };
});
