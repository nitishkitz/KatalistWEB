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
    await admin.from("qa_account_secrets").delete().eq("account_id", account.id);
    await admin.from("qa_accounts").update({ has_secret: false, secret_updated_at: null }).eq("id", account.id);
  }
  await audit({ listId: account.list_id, accountId: account.id, actorId: userId, action: "credential_archive", outcome: "success", details: { archived: body.archived } });
  return { ok: true };
});
