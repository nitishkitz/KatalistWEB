/**
 * Temporary fixed OTP convenience for test deployments.
 *
 * The fixed code is active only when a deployment explicitly configures a
 * valid six-digit value. Deployments without the variable continue to use
 * hosted Supabase Auth and require the OTP it issued.
 */
export function localFixedOtp(): string | null {
  const configured = import.meta.env.VITE_KATALIST_FIXED_OTP?.trim();
  return configured && /^\d{6}$/.test(configured) ? configured : null;
}

export function localFixedOtpEnabled(): boolean {
  return localFixedOtp() !== null;
}
