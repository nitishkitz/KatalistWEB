import { defineEventHandler, readBody } from "h3";
import { requireUser } from "../../../lib/require-user";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { audit, fromRpcError, fromVaultError, isUuid, noStore, qaError, throttleSecretRelease } from "../../../lib/qa/http";
import { decryptSecret, fromByteaHex, loadVaultConfig } from "../../../lib/qa/vault";

/**
 * Releases ONE plaintext password for an explicit reveal or copy. The caller's current List
 * membership and specific `use` grant are re-checked in the database on every call, so a revoked
 * member is denied even when their browser still holds the account metadata. Every outcome is
 * audited (action and outcome only, never the value).
 */
export default defineEventHandler(async (event) => {
  noStore(event);
  const { userId, client } = await requireUser(event);
  const body = (await readBody(event)) as { accountId?: unknown; action?: unknown } | null;
  if (!body || !isUuid(body.accountId) || (body.action !== "reveal" && body.action !== "copy")) {
    throw qaError(400, "invalid_input", "accountId and action (reveal or copy) are required.");
  }
  throttleSecretRelease(userId);
  const action = body.action === "reveal" ? "credential_reveal" : "credential_copy";

  const { data: access, error: accessError } = await client.rpc("qa_account_access", { p_account_id: body.accountId });
  if (accessError || !access) throw fromRpcError(accessError, "The account could not be checked.");
  const info = access as { list_id: string; archived: boolean; has_secret: boolean; can_use: boolean };
  if (info.archived) throw qaError(404, "not_found", "Account not found.");
  if (!info.can_use) {
    await audit({ listId: info.list_id, accountId: body.accountId, actorId: userId, action, outcome: "denied" });
    throw qaError(403, "forbidden", "You do not have permission to use this account's credentials.");
  }
  if (!info.has_secret) throw qaError(409, "no_secret", "No password is stored for this account.");

  try {
    const config = loadVaultConfig();
    const { data: row, error } = await getSupabaseAdmin()
      .from("qa_account_secrets")
      .select("ciphertext, iv, auth_tag, key_version")
      .eq("account_id", body.accountId)
      .eq("list_id", info.list_id)
      .maybeSingle();
    if (error || !row) throw new Error("missing secret row");
    const secret = decryptSecret(
      { ciphertext: fromByteaHex(row.ciphertext), iv: fromByteaHex(row.iv), authTag: fromByteaHex(row.auth_tag), keyVersion: row.key_version },
      { listId: info.list_id, accountId: body.accountId },
      config,
    );
    await audit({ listId: info.list_id, accountId: body.accountId, actorId: userId, action, outcome: "success" });
    return { secret };
  } catch (error) {
    const mapped = fromVaultError(error);
    await audit({ listId: info.list_id, accountId: body.accountId, actorId: userId, action, outcome: mapped?.statusCode === 503 ? "unavailable" : "error" });
    throw mapped ?? qaError(500, "secret_unreadable", "The stored credential could not be read.");
  }
});
