import { defineEventHandler, readBody, createError } from "h3";
import { createClient } from "@supabase/supabase-js";

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as { phone?: string; otp?: string } | null;
  const phone = body?.phone;
  const otp = body?.otp;

  if (!phone || otp !== "111111") {
    throw createError({ statusCode: 400, message: "Invalid phone number or OTP. Enter OTP: 111111." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dyxqlgnbwtbxxdfoiqva.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5eHFsZ25id3RieHhkZm9pcXZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA1Mjg3OCwiZXhwIjoyMTAyNjI4ODc4fQ.INa1hOmRJVNbj7TBGOqRpYEmT4oA9ij8MI_5M77vyG4";

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw createError({ statusCode: 500, message: "SUPABASE_SERVICE_ROLE_KEY is not configured." });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const cleanDigits = phone.replace(/\D/g, "");
  const { data: { users }, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) throw listErr;

  let user = users?.find((u) => {
    const metaPhone = u.user_metadata?.phone?.replace(/\D/g, "");
    const rawPhone = u.phone?.replace(/\D/g, "");
    return (
      (metaPhone && metaPhone.endsWith(cleanDigits)) ||
      (rawPhone && rawPhone.endsWith(cleanDigits))
    );
  });

  if (!user) {
    const email = `user-${cleanDigits}@users.katalist.invalid`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        phone,
        display_name: "Katalist User",
        full_name: "Katalist User",
        uat_profile_complete: true,
      },
    });
    if (createErr) throw createErr;
    user = created.user;
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
