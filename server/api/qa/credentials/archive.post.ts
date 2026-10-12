import { defineEventHandler, readBody } from "h3";
import { requireUser } from "../../../lib/require-user";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { audit, fromRpcError, isUuid, noStore, qaError } from "../../../lib/qa/http";

/** Archiving an account also destroys its stored ciphertext; restoring requires setting a password again. */
export default defineEventHandler(async (event) => {
  noStore(event);
  const { userId, client } = await requireUser(event);
  const body = (await readBody(event)) as { accountId?: unknown; archived?: unknown } | null;
  if (!body || !isUuid(body.accountId) || typeof body.archived !== "boolean") {
    throw qaError(400, "invalid_input", "accountId and archived are required.");
  }
  const { data, error } = await client.rpc("qa_archive_account", { p_account_id: body.accountId, p_archived: body.archived });
  if (error || !data) throw fromRpcError(error, "The account could not be updated.");
  const account = data as { id: string; list_id: string };
  if (body.archived) {
    const admin = getSupabaseAdmin();
    const { error: deleteError } = await admin.from("qa_account_secrets").delete().eq("account_id", account.id);
    if (deleteError) {
      await audit({ listId: account.list_id, accountId: account.id, actorId: userId, action: "credential_archive", outcome: "error", details: { archived: body.archived } });
      throw qaError(502, "credential_cleanup_failed", "The account was archived, but its stored credential could not be removed. Try again.");
    }
    const { error: flagError } = await admin.from("qa_accounts").update({ has_secret: false, secret_updated_at: null }).eq("id", account.id);
    if (flagError) {
      await audit({ listId: account.list_id, accountId: account.id, actorId: userId, action: "credential_archive", outcome: "error", details: { archived: body.archived } });
      throw qaError(502, "credential_cleanup_failed", "The account was archived, but its credential status could not be updated. Try again.");
    }
  }
  await audit({ listId: account.list_id, accountId: account.id, actorId: userId, action: "credential_archive", outcome: "success", details: { archived: body.archived } });
  return { ok: true };
});
