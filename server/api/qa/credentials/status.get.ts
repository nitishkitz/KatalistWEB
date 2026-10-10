import { defineEventHandler } from "h3";
import { requireUser } from "../../../lib/require-user";
import { isVaultConfigured } from "../../../lib/qa/vault";
import { noStore } from "../../../lib/qa/http";

/** Whether protected storage is configured. Reveals nothing about keys or providers. */
export default defineEventHandler(async (event) => {
  noStore(event);
  await requireUser(event);
  return { vaultConfigured: isVaultConfigured() };
});
