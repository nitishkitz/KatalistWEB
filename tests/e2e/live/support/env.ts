/**
 * Runtime-only configuration for the two-account live harness (READY-01).
 *
 * Nothing here is read from files. Phone numbers and the test code come from
 * the operator's environment at run time and are never written to artifacts,
 * traces' storage state, or the fixture ledger. Account A is the operator's
 * account; Account B is CHRI's.
 */
export type LiveAccount = { alias: "A" | "B"; dialCode: string; phone: string };

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function liveConfigured(): boolean {
  return Boolean(
    process.env.KATALIST_LIVE_TARGET_APPROVED === "true" &&
      process.env.KATALIST_LIVE_BASE_URL &&
      process.env.KATALIST_A_PHONE &&
      process.env.KATALIST_B_PHONE &&
      process.env.KATALIST_LIVE_OTP &&
      // Identity is mandatory: writes never start without both expected names.
      process.env.KATALIST_A_NAME &&
      process.env.KATALIST_B_NAME,
  );
}

export function liveEnv() {
  return {
    baseURL: need("KATALIST_LIVE_BASE_URL").replace(/\/$/, ""),
    otp: need("KATALIST_LIVE_OTP"),
    build: process.env.KATALIST_LIVE_BUILD?.trim() || "unrecorded",
    timezone: process.env.KATALIST_LIVE_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone,
    runId: process.env.KATALIST_LIVE_RUN_ID?.trim() || "run01",
    accounts: {
      A: { alias: "A", dialCode: process.env.KATALIST_A_DIAL?.trim() || "+91", phone: need("KATALIST_A_PHONE") } as LiveAccount,
      B: { alias: "B", dialCode: process.env.KATALIST_B_DIAL?.trim() || "+91", phone: need("KATALIST_B_PHONE") } as LiveAccount,
    },
    // Display name expected on B's Me page, so a mislabelled account is caught
    // before any mutation. Required.
    expectedName: { A: need("KATALIST_A_NAME"), B: need("KATALIST_B_NAME") },
  };
}

/** `QA-YYYYMMDD-run01-` prefix required by the plan for every new record. */
export function qaPrefix(date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `QA-${ymd}-${liveEnv().runId}-`;
}

/** Strip anything resembling a phone number or the OTP from text bound for artifacts. */
export function redact(text: string): string {
  const { otp } = liveEnv();
  return text.split(otp).join("[otp]").replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]");
}
