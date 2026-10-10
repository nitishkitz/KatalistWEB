import { defineEventHandler, readBody } from "h3";
import { requireUser } from "../../../lib/require-user";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { audit, fromRpcError, fromVaultError, isUuid, noStore, qaError } from "../../../lib/qa/http";
import { encryptSecret, loadVaultConfig, toByteaHex, validateSecret, type VaultConfig } from "../../../lib/qa/vault";

type Body = {
  listId?: unknown;
  accountId?: unknown;
  applicationId?: unknown;
  environmentId?: unknown;
  label?: unknown;
  testRole?: unknown;
  username?: unknown;
  instructions?: unknown;
  /** Omit or send an empty string on edit to keep the stored password. */
  password?: unknown;
  useRoles?: unknown;
  manageRoles?: unknown;
  useProfiles?: unknown;
  manageProfiles?: unknown;
};

const ROLES = new Set(["owner", "collaborator", "view_only"]);
const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
const roleList = (v: unknown) => (Array.isArray(v) && v.every((r) => typeof r === "string" && ROLES.has(r)) ? (v as string[]) : null);
const uuidList = (v: unknown) => (Array.isArray(v) && v.length <= 200 && v.every(isUuid) ? (v as string[]) : null);

/**
 * Creates or edits an account: metadata and grants through the caller's own session (so the
 * database enforces membership and manage rights), then the password, when one is supplied,
 * encrypted here and written with the service role. The password is never returned.
 */
export default defineEventHandler(async (event) => {
  noStore(event);
  const { userId, client } = await requireUser(event);
  const body = (await readBody(event)) as Body | null;
  if (!body || !isUuid(body.listId) || !isUuid(body.applicationId) || !isUuid(body.environmentId)) {
    throw qaError(400, "invalid_input", "listId, applicationId and environmentId are required.");
  }
  const accountId = body.accountId == null ? null : isUuid(body.accountId) ? body.accountId : undefined;
  const label = text(body.label, 120);
  const testRole = text(body.testRole ?? "", 80);
  const username = text(body.username ?? "", 320);
  const instructions = body.instructions == null ? "" : text(body.instructions, 2000);
  const useRoles = roleList(body.useRoles ?? []);
  const manageRoles = roleList(body.manageRoles ?? []);
  const useProfiles = uuidList(body.useProfiles ?? []);
  const manageProfiles = uuidList(body.manageProfiles ?? []);
  if (accountId === undefined || !label?.trim() || testRole === null || username === null || instructions === null || !useRoles || !manageRoles || !useProfiles || !manageProfiles) {
    throw qaError(400, "invalid_input", "Check the account fields and try again.");
  }
  const hasPassword = typeof body.password === "string" && body.password.length > 0;
  if (accountId === null && !hasPassword) throw qaError(400, "password_required", "Enter a password for a new account.");
  if (body.password != null && typeof body.password !== "string") throw qaError(400, "invalid_secret", "Enter a password.");

  // Resolve vault configuration BEFORE touching the database, so an unconfigured server cannot
  // leave a half-saved account that looks complete.
  let config: VaultConfig | null = null;
  if (hasPassword) {
    try {
      validateSecret(body.password);
      config = loadVaultConfig();
    } catch (error) {
      await audit({ listId: body.listId, accountId, actorId: userId, action: "credential_secret_set", outcome: "unavailable" });
      throw fromVaultError(error) ?? error;
    }
  }

  const { data, error } = await client.rpc("qa_save_account", {
    p_list_id: body.listId,
    p_id: accountId,
    p_application_id: body.applicationId,
    p_environment_id: body.environmentId,
    p_label: label,
    p_test_role: testRole,
    p_username: username,
    p_instructions: instructions,
    p_use_roles: useRoles,
    p_manage_roles: manageRoles,
    p_use_profiles: useProfiles,
    p_manage_profiles: manageProfiles,
  });
  if (error || !data) {
    await audit({ listId: body.listId, accountId, actorId: userId, action: accountId ? "credential_update" : "credential_create", outcome: "denied" });
    throw fromRpcError(error, "The account could not be saved.");
  }
  const account = data as { id: string; list_id: string; has_secret: boolean };
  await audit({ listId: account.list_id, accountId: account.id, actorId: userId, action: accountId ? "credential_update" : "credential_create", outcome: "success" });
  await audit({ listId: account.list_id, accountId: account.id, actorId: userId, action: "credential_grants_change", outcome: "success", details: { useRoles: useRoles.length, manageRoles: manageRoles.length, useProfiles: useProfiles.length, manageProfiles: manageProfiles.length } });

  let secretStored = account.has_secret;
  if (hasPassword && config) {
    try {
      const sealed = encryptSecret({ plaintext: body.password as string, listId: account.list_id, accountId: account.id }, config);
      const admin = getSupabaseAdmin();
      const now = new Date().toISOString();
      const { error: writeError } = await admin.from("qa_account_secrets").upsert(
        {
          account_id: account.id,
          list_id: account.list_id,
          ciphertext: toByteaHex(sealed.ciphertext),
          iv: toByteaHex(sealed.iv),
          auth_tag: toByteaHex(sealed.authTag),
          key_version: sealed.keyVersion,
          updated_by: userId,
          updated_at: now,
        },
        { onConflict: "account_id" },
      );
      if (writeError) throw new Error("secret write failed");
      const { error: flagError } = await admin.from("qa_accounts").update({ has_secret: true, secret_updated_at: now }).eq("id", account.id);
      if (flagError) throw new Error("secret flag failed");
      secretStored = true;
      await audit({ listId: account.list_id, accountId: account.id, actorId: userId, action: "credential_secret_set", outcome: "success", details: { keyVersion: sealed.keyVersion } });
    } catch {
      await audit({ listId: account.list_id, accountId: account.id, actorId: userId, action: "credential_secret_set", outcome: "error" });
      // Metadata is saved; say so honestly so the member can retry the password from Edit.
      throw qaError(502, "secret_not_stored", "The account details were saved, but the password could not be stored. Edit the account to set it again.");
    }
  }
  return { account: { id: account.id }, secretStored };
});
