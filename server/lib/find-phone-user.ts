import type { SupabaseClient, User } from "@supabase/supabase-js";
import { withAuthNetworkRetry } from "./supabase-admin";

const USERS_PER_PAGE = 1_000;
const MAX_USER_PAGES = 100;

/** Prefer the indexed profile phone field. Paginated auth lookup remains as a
 * fallback for older accounts whose profile metadata was not normalized. */
export async function findAuthUserByPhone(admin: SupabaseClient, phone: string): Promise<User | null> {
  const cleanDigits = phone.replace(/\D/g, "");
  const canonicalPhone = `+${cleanDigits}`;
  const profile = await withAuthNetworkRetry(async () => {
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("phone_e164", canonicalPhone)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, "lookup-profile");

  if (profile?.id) {
    const user = await withAuthNetworkRetry(async () => {
      const { data, error } = await admin.auth.admin.getUserById(profile.id);
      if (error) throw error;
      return data.user;
    }, "lookup-user");
    if (user) return user;
  }

  for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
    const data = await withAuthNetworkRetry(async () => {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
      if (error) throw error;
      return data;
    }, "lookup-legacy-user");
    const user = data.users.find((candidate) => {
      const metaPhone = candidate.user_metadata?.phone?.replace(/\D/g, "");
      const rawPhone = candidate.phone?.replace(/\D/g, "");
      return (metaPhone && metaPhone.endsWith(cleanDigits)) || (rawPhone && rawPhone.endsWith(cleanDigits));
    });
    if (user) return user;
    if (data.users.length < USERS_PER_PAGE) return null;
  }

  throw new Error("The account lookup reached its safety limit. Please try again.");
}
