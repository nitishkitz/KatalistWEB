import { defineEventHandler, readBody, createError } from "h3";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { serverFixedOtp } from "../../lib/fixed-otp";

const USERS_PER_PAGE = 1_000;

async function findUserByPhone(phone: string) {
  const admin = getSupabaseAdmin();
  const cleanDigits = phone.replace(/\D/g, "");

  // Supabase returns only 50 users by default. A returning account that falls
  // outside that first page used to look new and then failed during creation.
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw error;
    const user = data.users.find((candidate) => {
      const metaPhone = candidate.user_metadata?.phone?.replace(/\D/g, "");
      const rawPhone = candidate.phone?.replace(/\D/g, "");
      return (
        (metaPhone && metaPhone.endsWith(cleanDigits)) ||
        (rawPhone && rawPhone.endsWith(cleanDigits))
      );
    });
    if (user) return user;
    if (data.users.length < USERS_PER_PAGE) return null;
  }

  return null;
}

export default defineEventHandler(async (event) => {
  const fixedOtp = serverFixedOtp();
  if (!fixedOtp) {
    throw createError({
      statusCode: 404,
      message: "Phone sign-in is not available in this deployment. Use email instead.",
    });
  }

  const body = (await readBody(event)) as { phone?: string; otp?: string } | null;
  const phone = body?.phone;
  const otp = body?.otp;

  if (!phone || otp !== fixedOtp) {
    throw createError({ statusCode: 400, message: "Invalid or expired code." });
  }

  const cleanDigits = phone.replace(/\D/g, "");
  const admin = getSupabaseAdmin();
  let user = await findUserByPhone(phone);

  if (!user) {
    const email = `user-${cleanDigits}@users.katalist.invalid`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        phone,
        display_name: "Katalist User",
        full_name: "Katalist User",
      },
    });
    if (createErr) {
      // Two devices can submit the same number at almost the same moment.
      // The second create races the first; load the account that just won.
      user = await findUserByPhone(phone);
      if (!user) throw createErr;
    } else {
      user = created.user;
    }
  }

  const userEmail = user.email || `user-${cleanDigits}@users.katalist.invalid`;
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userEmail,
  });
  if (linkErr) throw linkErr;

  return {
    token_hash: linkData.properties.hashed_token,
    email: userEmail,
  };
});
