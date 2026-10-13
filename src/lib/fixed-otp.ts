/**
 * Temporary fixed OTP convenience for test deployments.
 *
 * The fixed code is active only when a deployment explicitly configures a
 * valid six-digit value. Deployments without the variable continue to use
 * hosted Supabase Auth and require the OTP it issued.
 */
export function localFixedOtp(): string | null {
  const environment = import.meta.env.VITE_KATALIST_ENV;
  const testEnvironment = environment === "uat" || environment === "test" || environment === "development";
  if (environment === "production" || (import.meta.env.PROD && !testEnvironment)) return null;
  const configured = import.meta.env.VITE_KATALIST_FIXED_OTP?.trim();
  return configured && /^\d{6}$/.test(configured) ? configured : null;
}

export function localFixedOtpEnabled(): boolean {
  return localFixedOtp() !== null;
}

/**
 * Real phone verification through Supabase Auth's SMS provider. Requires an
 * SMS provider (e.g. Twilio) configured on the Supabase project; the browser
 * never sees or chooses the code.
 */
export function smsOtpEnabled(): boolean {
  return import.meta.env.VITE_KATALIST_PHONE_AUTH === "sms";
}
