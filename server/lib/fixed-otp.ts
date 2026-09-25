/**
 * Server-side mirror of src/lib/fixed-otp.ts's contract: the fixed phone OTP
 * is active only when this deployment explicitly configures a valid
 * six-digit value. Read via `process.env` (not `import.meta.env`) because
 * this file runs in the Node/serverless request handler, not the Vite client
 * bundle -- Vite still makes `VITE_`-prefixed vars available on `process.env`
 * at runtime for server code that opts in, matching getSupabaseAdmin()'s own
 * `process.env.VITE_SUPABASE_URL` fallback pattern in this same directory.
 */
export function serverFixedOtp(): string | null {
  const configured = process.env.VITE_KATALIST_FIXED_OTP?.trim();
  return configured && /^\d{6}$/.test(configured) ? configured : null;
}
