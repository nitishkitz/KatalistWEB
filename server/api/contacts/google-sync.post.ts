import { defineEventHandler, readBody, getHeader, createError, setResponseHeader } from "h3";
import { requireUser } from "../../lib/require-user";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { googleContactsConfig, readGoogleContacts } from "../../lib/contacts/google";

export default defineEventHandler(async event => {
  const { userId } = await requireUser(event);
  setResponseHeader(event, "Cache-Control", "no-store");
  const config = googleContactsConfig();
  if (!config) throw createError({ statusCode: 503, message: "Google Contacts sync is not configured yet." });
  if (getHeader(event, "origin") !== config.origin || getHeader(event, "x-requested-with") !== "KatalistGoogleContacts") {
    throw createError({ statusCode: 403, message: "Invalid contacts sync request." });
  }
  const body = await readBody<{ code?: unknown } | null>(event);
  if (typeof body?.code !== "string" || !body.code.trim() || body.code.length > 4096) {
    throw createError({ statusCode: 400, message: "A Google authorization code is required." });
  }
  let contacts;
  try { contacts = await readGoogleContacts(body.code, config); }
  catch (error) { throw createError({ statusCode: 502, message: error instanceof Error ? error.message : "Google Contacts sync failed." }); }
  const admin = getSupabaseAdmin();
  // Only server-fetched Google contacts reach this service-only atomic matching RPC.
  const { data, error } = await admin.rpc("sync_google_contact_matches", { p_owner: userId, p_contacts: contacts });
  if (error) throw createError({ statusCode: 503, message: "Contacts could not be saved. Your previous contacts were kept." });
  return { ok: true, contactCount: contacts.length, matchedCount: Number(data ?? 0) };
});
