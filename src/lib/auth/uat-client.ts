import { validateRequiredProfile, type ProfileFieldErrors } from "@/lib/auth/profile-validation";
import type { UatVerifyRequest, UatVerifyResponse } from "@/lib/auth/uat-contract";

const JSON_HEADERS = { "content-type": "application/json" };

export const UAT_AUTH_REQUEST_PATH = "/api/uat-auth/request";
export const UAT_AUTH_VERIFY_PATH = "/api/uat-auth/verify";

export type UatClientError = Error & {
  status: number;
  code?: string;
};

async function readError(response: Response): Promise<UatClientError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  const error = new Error(body.message ?? "Sign-in is temporarily unavailable.") as UatClientError;
  error.status = response.status;
  error.code = body.error;
  return error;
}

export async function postUatRequest(
  phone: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true }> {
  const response = await fetchImpl(UAT_AUTH_REQUEST_PATH, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone }),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as { ok: true };
}

export async function postUatVerify(
  input: UatVerifyRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<UatVerifyResponse> {
  const response = await fetchImpl(UAT_AUTH_VERIFY_PATH, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as UatVerifyResponse;
}

export type UatProfileDraft = { fullName: string; age: string; occupation: string };

export type UatSubmitProfileResult =
  | UatVerifyResponse
  | { status: "invalid_profile"; errors: ProfileFieldErrors };

export function createUatAuthController(fetchImpl: typeof fetch = fetch) {
  let verifyCount = 0;
  return {
    get verifyCount() {
      return verifyCount;
    },
    request(phone: string) {
      return postUatRequest(phone, fetchImpl);
    },
    async verifyOtp(phone: string, otp: string) {
      verifyCount += 1;
      return postUatVerify({ phone, otp }, fetchImpl);
    },
    async submitProfile(phone: string, otp: string, profile: UatProfileDraft): Promise<UatSubmitProfileResult> {
      const result = validateRequiredProfile(profile);
      if (!result.ok) return { status: "invalid_profile", errors: result.errors };
      verifyCount += 1;
      return postUatVerify({ phone, otp, profile }, fetchImpl);
    },
  };
}
