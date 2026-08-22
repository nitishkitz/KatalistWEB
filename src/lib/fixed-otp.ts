/**
 * Local-only OTP convenience for development.
 *
 * This is intentionally gated by Vite's DEV flag so a fixed code can never
 * become a production authentication bypass. Hosted Supabase Auth continues
 * to require the OTP it issued.
 */
export function localFixedOtp(): string | null {
  if (!import.meta.env.DEV) return null;
  const configured = import.meta.env.VITE_KATALIST_FIXED_OTP?.trim();
  return configured && /^\d{6}$/.test(configured) ? configured : null;
}

export function localFixedOtpEnabled(): boolean {
  return localFixedOtp() !== null;
}
