import { defineEventHandler, readBody, createError } from "h3";
import { getSupabaseAdmin, isTransientAuthFailure, withAuthNetworkRetry } from "../../lib/supabase-admin";
import { serverFixedOtp } from "../../lib/fixed-otp";
import { findAuthUserByPhone } from "../../lib/find-phone-user";

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

  const startedAt = Date.now();
  let stage = "lookup-user";
  try {
    const cleanDigits = phone.replace(/\D/g, "");
    const admin = getSupabaseAdmin();
    let user = await findAuthUserByPhone(admin, phone);

    if (!user) {
      stage = "create-user";
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
        user = await findAuthUserByPhone(admin, phone);
        if (!user) throw createErr;
      } else {
        user = created.user;
      }
    }

    stage = "generate-link";
    const userEmail = user.email || `user-${cleanDigits}@users.katalist.invalid`;
    const linkData = await withAuthNetworkRetry(async () => {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: userEmail,
      });
      if (error) throw error;
      return data;
    }, stage);
    if (!linkData.properties?.hashed_token) {
      throw new Error("Supabase did not return a verification token.");
    }

    console.info("[phone-auth] ready", { durationMs: Date.now() - startedAt });
    return { token_hash: linkData.properties.hashed_token, email: userEmail };
  } catch (error) {
    console.error("[phone-auth] failed", {
      stage,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    if (isTransientAuthFailure(error)) {
      throw createError({ statusCode: 503, message: "Supabase sign-in is temporarily unreachable. Try again." });
    }
    throw error;
  }
});
