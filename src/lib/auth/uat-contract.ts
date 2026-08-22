export type UatVerifyRequest = {
  phone: string;
  otp: string;
  profile?: { fullName: string; age: string; occupation: string };
};

export type UatSessionPayload = { access_token: string; refresh_token: string };

export type UatVerifyResponse =
  | { status: "needs_profile" }
  | { status: "authenticated"; session: UatSessionPayload };

export type UatRequestResponse = { ok: true };

export function isUatClient(env: { VITE_KATALIST_ENV?: string } | Record<string, unknown>): boolean {
  return (env as { VITE_KATALIST_ENV?: string }).VITE_KATALIST_ENV === "uat";
}
