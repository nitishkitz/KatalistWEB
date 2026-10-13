import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { useSession, signInAsDemo, type DemoPersona } from "@/hooks/useSession";
import { demoEnabled } from "@/lib/session-mode";
type LoginConfig = { mode: "static" | "sms" | "off" | "unavailable"; staticCode: string | null; maintenance?: boolean };

/** The server decides the sign-in mode and, in temporary static mode, the code shown. Never cached. */
async function fetchLoginConfig(): Promise<LoginConfig> {
  try {
    const res = await fetch("/api/auth/login-config", { cache: "no-store" });
    if (!res.ok) return { mode: res.status === 503 ? "off" : "unavailable", staticCode: null, maintenance: res.status === 503 };
    const data = (await res.json()) as Partial<LoginConfig>;
    const mode = data.mode === "static" || data.mode === "sms" || data.mode === "off" ? data.mode : "unavailable";
    return { mode, staticCode: mode === "static" && typeof data.staticCode === "string" ? data.staticCode : null, maintenance: data.maintenance === true };
  } catch {
    return { mode: "unavailable", staticCode: null };
  }
}
import { extractErrorMessage } from "@/lib/domain-error";

/**
 * Sign-in state machine for /auth, independent of how the page looks.
 *
 * Actions resolve to outcomes instead of navigating, so the view can play
 * its own transition first and then call `enter()`. The one exception is a
 * visitor who arrives already signed in with a complete profile: they are
 * sent straight on, with no animation.
 */

export type Channel = "phone" | "email";
export type VerifyOutcome = "ready" | "profile" | "rejected";
export type SignInNote = { text: string; error: boolean } | null;
type ProfileField = "fullName" | "phone" | "email";
export type ProfileErrors = Partial<Record<ProfileField, string>>;

// G02: a resend must not be spammable, and a sent code must not remain
// verifiable forever -- both are part of "finish auth acceptance", not only
// the happy path.
export const RESEND_COOLDOWN_MS = 30_000;
export const OTP_TTL_MS = 5 * 60_000;

const PLACEHOLDER_EMAIL = /@(?:users\.katalist\.invalid|katalist\.local)$/i;

/**
 * verifyOtp() can resolve before the client's own getSession()/getUser()
 * reliably reflects the new session. Poll briefly for it to actually be
 * readable before navigating, so the next page's first queries don't fire
 * against a still-anonymous client.
 */
async function waitForSessionReady(expectedAccessToken: string | undefined, timeoutMs = 2000) {
  if (!expectedAccessToken) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token === expectedAccessToken) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

type AuthRequestStage = "phone-login" | "set-session" | "verify-otp" | "send-email-code" | "verify-email-code" | "send-phone-code" | "verify-phone-code";

function authErrorCopy(error: unknown, fallback: string, stage?: AuthRequestStage) {
  const message = extractErrorMessage(error) ?? fallback;
  if (/fetch failed|network(?:\s+error)?|failed to fetch/i.test(message)) {
    if (stage === "phone-login") {
      return "Katalist’s sign-in server could not be reached. Check that the app is online and try again.";
    }
    if (stage === "set-session" || stage === "verify-otp" || stage === "send-email-code" || stage === "verify-email-code") {
      return "Supabase sign-in could not be reached. Check your connection and try again.";
    }
    return "We couldn’t reach sign-in. Check your connection and try again.";
  }
  return message;
}

function logAuthRequestFailure(stage: AuthRequestStage, error: unknown) {
  // Do not log the OTP, phone number, token hash, or session tokens.
  const target = stage === "phone-login" ? "/api/auth/phone-login" : "Supabase Auth";
  console.error("[auth] request failed", {
    stage,
    target,
    error: extractErrorMessage(error) ?? "Unknown error",
  });
}

export function contactProblem(channel: Channel, dialCode: string, phone: string, email: string) {
  if (channel === "email") {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? "" : "Enter a valid email address.";
  }
  const n = phone.replace(/\D/g, "").length;
  if (dialCode === "+91" ? n === 10 : n >= 7 && n <= 15) return "";
  return dialCode === "+91" ? "Enter a 10-digit mobile number." : "Enter a phone number of 7 to 15 digits.";
}

/** Groups an Indian mobile number as "98765 43210"; other numbers stay as digits. */
export function formatPhoneInput(dialCode: string, value: string) {
  const d = value.replace(/\D/g, "").slice(0, 15);
  return dialCode === "+91" && d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5, 10)}` : d;
}

/**
 * `resumeUnlocked`: this mount is the gate resuming after IdentityBoundary's
 * sign-in remount (see gate-handoff.ts) -- sign-in already finished, so the
 * existing-session redirect must not re-run its profile check.
 */
export function useOtpSignIn(returnTo: string, { resumeUnlocked = false } = {}) {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [loginConfig, setLoginConfig] = useState<LoginConfig | null>(null);
  const loginConfigRef = useRef<LoginConfig | null>(null);
  useEffect(() => {
    let active = true;
    void fetchLoginConfig().then((config) => {
      if (!active) return;
      loginConfigRef.current = config;
      setLoginConfig(config);
    });
    return () => { active = false; };
  }, []);
  const ensureConfig = async () => {
    if (loginConfigRef.current && loginConfigRef.current.mode !== "unavailable") return loginConfigRef.current;
    const config = await fetchLoginConfig();
    loginConfigRef.current = config;
    setLoginConfig(config);
    return config;
  };
  // Temporary static mode shows a shared code; it does not prove the number belongs to the person.
  const fixedPhone = loginConfig?.mode === "static";
  const phoneAvailable = loginConfig === null || fixedPhone || loginConfig.mode === "sms";

  const channel = "phone" as const;
  const [dialCode, setDialCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const email = "";
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<SignInNote>(null);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [welcomeName, setWelcomeName] = useState("");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profilePhone, setProfilePhone] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});

  const verifyingOtpRef = useRef(false);
  const redirectedTokenRef = useRef<string | null>(null);
  const authCompletionPendingRef = useRef(false);
  const profileSetupRequestedRef = useRef(false);
  // Set once sign-in is complete and the view is playing its exit; stops a
  // late SIGNED_IN/TOKEN_REFRESHED from navigating mid-animation.
  const finishingRef = useRef(resumeUnlocked);

  const destination = channel === "phone" ? `${dialCode}${phone.replace(/\D/g, "")}` : email.trim();

  const enter = useCallback(() => {
    void navigate({ to: returnTo, replace: true });
  }, [navigate, returnTo]);

  const continueAfterAuth = useCallback(
    async (user: User | null): Promise<VerifyOutcome> => {
      if (!user || user.app_metadata?.provider === "demo") {
        authCompletionPendingRef.current = false;
        finishingRef.current = true;
        return "ready";
      }

      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("display_name, email, phone_e164")
          .eq("id", user.id)
          .maybeSingle();
        if (error) throw error;

        const savedName = profile?.display_name?.trim() ?? "";
        const savedEmail = profile?.email?.trim() ?? "";
        const hasRealEmail = Boolean(savedEmail && !PLACEHOLDER_EMAIL.test(savedEmail));
        const incomplete =
          !profile ||
          !savedName ||
          savedName.toLowerCase() === "katalist user" ||
          !profile.phone_e164;

        if (incomplete) {
          const metadataPhone = typeof user.user_metadata?.phone === "string" ? user.user_metadata.phone : "";
          const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
          const userEmail = user.email && !PLACEHOLDER_EMAIL.test(user.email) ? user.email : "";
          profileSetupRequestedRef.current = true;
          setProfileUserId(user.id);
          setProfilePhone(profile?.phone_e164 || user.phone || metadataPhone);
          setProfileEmail(hasRealEmail ? savedEmail : userEmail);
          setFullName(
            savedName && savedName.toLowerCase() !== "katalist user"
              ? savedName
              : metadataName === "Katalist User"
                ? ""
                : metadataName,
          );
          setOtp("");
          setNote(null);
          setBusy(false);
          verifyingOtpRef.current = false;
          authCompletionPendingRef.current = false;
          return "profile";
        }

        setWelcomeName(savedName);
      } catch (err) {
        setNote({
          text: authErrorCopy(err, "We signed you in, but couldn’t load your profile. Try again."),
          error: true,
        });
        setBusy(false);
        verifyingOtpRef.current = false;
        authCompletionPendingRef.current = false;
        return "rejected";
      }

      authCompletionPendingRef.current = false;
      profileSetupRequestedRef.current = false;
      finishingRef.current = true;
      setNote({ text: "Signed in. Opening Katalist…", error: false });
      verifyingOtpRef.current = false;
      return "ready";
    },
    [],
  );

  useEffect(() => {
    if (
      !loading &&
      session &&
      !authCompletionPendingRef.current &&
      !profileSetupRequestedRef.current &&
      !finishingRef.current &&
      redirectedTokenRef.current !== session.access_token
    ) {
      redirectedTokenRef.current = session.access_token;
      // Supabase can publish SIGNED_IN while the request that initiated OTP
      // verification is still settling (or has reported a transport failure).
      // A valid session is authoritative, so never leave a connection error on
      // screen once the user is actually authenticated.
      void continueAfterAuth(session.user).then((outcome) => {
        if (outcome === "ready") enter();
      });
    }
  }, [loading, session, continueAfterAuth, enter]);

  // Ticks once a code has been sent so the resend cooldown and expiry
  // countdowns are actually live, not just computed once at send time.
  useEffect(() => {
    if (otpSentAt == null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [otpSentAt]);

  const secondsUntilResend =
    otpSentAt == null ? 0 : Math.max(0, Math.ceil((otpSentAt + RESEND_COOLDOWN_MS - now) / 1000));
  const otpRemainingMs = otpSentAt == null ? 0 : Math.max(0, otpSentAt + OTP_TTL_MS - now);
  const otpExpired = otpSentAt != null && otpRemainingMs <= 0;

  function markSent(resend: boolean) {
    const at = Date.now();
    setOtp("");
    setOtpSentAt(at);
    setNow(at);
    setNote(resend ? { text: loginConfigRef.current?.mode === "static" ? "Your temporary code is shown below." : "We sent a new code.", error: false } : null);
  }

  /** Sends (or re-sends) a code. Validate with `contactProblem` first. */
  async function sendCode({ resend = false } = {}): Promise<boolean> {
    const config = await ensureConfig();
    if (config.maintenance) {
      setNote({ text: "Katalist is being updated. Please try again shortly.", error: true });
      return false;
    }
    if (config.mode === "unavailable") {
      setNote({ text: "We couldn’t reach Katalist. Check your connection, then try again.", error: true });
      return false;
    }
    if (config.mode === "off") {
      setNote({ text: "Phone sign-in is not configured yet. Please try again later.", error: true });
      return false;
    }
    setBusy(true);
    setNote(resend ? { text: "Sending a new code.", error: false } : null);

    if (config.mode === "static") {
      // No SMS is sent; the server checks the code when it is submitted.
      setBusy(false);
      markSent(resend);
      return true;
    }
    if (channel === "phone") {
      try {
        const { error } = await supabase.auth.signInWithOtp({ phone: destination, options: { shouldCreateUser: true } });
        if (error) throw error;
      } catch (err: unknown) {
        logAuthRequestFailure("send-phone-code", err);
        setBusy(false);
        setNote({ text: authErrorCopy(err, "We could not send the SMS code. Check the number, then try again.", "send-phone-code"), error: true });
        return false;
      }
      setBusy(false);
      markSent(resend);
      return true;
    }

    return false;
  }

  async function verifyPhone(code: string): Promise<VerifyOutcome> {
    if (loginConfigRef.current?.mode !== "static") {
      // Real verification: Supabase checks the code it sent to this number.
      try {
        authCompletionPendingRef.current = true;
        const { data: authData, error } = await supabase.auth.verifyOtp({ phone: destination, token: code, type: "sms" });
        if (error) throw error;
        await waitForSessionReady(authData.session?.access_token);
        return await continueAfterAuth(authData.user);
      } catch (err: unknown) {
        authCompletionPendingRef.current = false;
        logAuthRequestFailure("verify-phone-code", err);
        setNote({ text: authErrorCopy(err, "That code did not match or has expired. Check it or request a new one.", "verify-phone-code"), error: true });
        return "rejected";
      }
    }
    let stage: AuthRequestStage = "phone-login";
    try {
      const res = await fetch("/api/auth/phone-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: destination, otp: code }),
      });
      const data = (await res.json()) as {
        token_hash?: unknown;
        properties?: { hashed_token?: unknown };
        access_token?: unknown;
        refresh_token?: unknown;
        error?: string;
        message?: string;
        statusMessage?: string;
      };
      if (!res.ok) {
        // The server is the only judge of the code; show its specific reason.
        const reason = (data as { code?: string }).code;
        if (reason === "wrong_code" || reason === "invalid_phone" || reason === "rate_limited" || reason === "maintenance" || reason === "disabled") {
          setNote({ text: data.error || "We couldn’t sign you in. Try again.", error: true });
          return "rejected";
        }
        throw new Error(data.error || data.message || data.statusMessage || "Authentication failed");
      }

      // Older local handlers return a ready session while production uses a
      // generated magic-link hash. Accept both server contracts so a device
      // can finish sign-in during a rolling deployment or local HMR update.
      const accessToken = typeof data.access_token === "string" ? data.access_token : null;
      const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : null;
      if (accessToken && refreshToken) {
        stage = "set-session";
        authCompletionPendingRef.current = true;
        const { data: sessionData, error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setSessionError) throw setSessionError;

        await waitForSessionReady(sessionData.session?.access_token ?? accessToken);
        return await continueAfterAuth(sessionData.session?.user ?? null);
      }

      // The endpoint returns `token_hash`, while Supabase's generated-link
      // payload calls the same value `properties.hashed_token`. Supporting
      // both keeps the browser contract explicit across deployed versions.
      const tokenHash =
        typeof data.token_hash === "string"
          ? data.token_hash
          : typeof data.properties?.hashed_token === "string"
            ? data.properties.hashed_token
            : null;
      if (!tokenHash) {
        throw new Error("We couldn’t prepare a verification session. Request a new code and try again.");
      }

      stage = "verify-otp";
      authCompletionPendingRef.current = true;
      const { data: authData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });
      if (verifyError) throw verifyError;

      // verifyOtp's returned session isn't guaranteed to be readable by
      // the client's own getSession()/getUser() yet - navigating before
      // it settles races every query on the next page (Court, directory,
      // etc.) into firing with no session and permanently caching empty
      // results. Confirm it's actually readable first.
      await waitForSessionReady(authData.session?.access_token);
      return await continueAfterAuth(authData.user);
    } catch (err: unknown) {
      authCompletionPendingRef.current = false;
      logAuthRequestFailure(stage, err);
      setNote({ text: authErrorCopy(err, "We couldn’t sign you in. Try again.", stage), error: true });
      return "rejected";
    }
  }

  async function verifyCode(code: string): Promise<VerifyOutcome> {
    if (verifyingOtpRef.current) return "rejected";
    verifyingOtpRef.current = true;
    if (otpSentAt != null && Date.now() - otpSentAt > OTP_TTL_MS) {
      setNote({ text: "This code has expired. Send a new code to continue.", error: true });
      setOtp("");
      verifyingOtpRef.current = false;
      return "rejected";
    }

    setBusy(true);
    setNote(null);
    const outcome = await verifyPhone(code);
    if (outcome === "rejected") {
      setBusy(false);
      setOtp("");
      verifyingOtpRef.current = false;
    }
    return outcome;
  }

  /** Back to the contact step, discarding the sent code. */
  function changeContact() {
    setOtp("");
    setOtpSentAt(null);
    setNote(null);
  }

  async function saveProfile(): Promise<boolean> {
    const name = fullName.trim().replace(/\s+/g, " ");
    const emailAddress = profileEmail.trim().toLowerCase();
    const digits = profilePhone.replace(/\D/g, "");
    const normalizedPhone = profilePhone.trim().startsWith("+") ? `+${digits}` : `${dialCode}${digits}`;
    const errors: ProfileErrors = {};
    if (!name || name.length > 100) errors.fullName = "Enter your name (up to 100 characters).";
    if (digits.length < 8 || digits.length > 15) errors.phone = "Enter a valid mobile number.";
    if (emailAddress && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress)) errors.email = "Enter a valid email address.";
    if (Object.keys(errors).length) {
      setProfileErrors(errors);
      return false;
    }

    if (!profileUserId) {
      setNote({ text: "Your sign-in session expired. Please sign in again.", error: true });
      return false;
    }

    setProfileSaving(true);
    try {
      const { data: current } = await supabase.auth.getUser();
      if (current.user?.id !== profileUserId) {
        throw new Error("Your sign-in session changed. Please sign in again.");
      }
      const { error } = await supabase.from("profiles").upsert(
        {
          id: profileUserId,
          display_name: name,
          phone_e164: normalizedPhone,
          email: emailAddress || null,
        },
        { onConflict: "id" },
      );
      if (error) throw error;

      profileSetupRequestedRef.current = false;
      finishingRef.current = true;
      setWelcomeName(name);
      setNote(null);
      return true;
    } catch (err) {
      setNote({ text: authErrorCopy(err, "We couldn’t save your profile. Please try again."), error: true });
      return false;
    } finally {
      setProfileSaving(false);
    }
  }

  function enterAsDemo(persona: DemoPersona) {
    if (!demoEnabled()) return;
    finishingRef.current = true;
    signInAsDemo(persona);
    enter();
  }

  return {
    phoneAvailable,
    testOtp: fixedPhone ? loginConfig?.staticCode ?? null : null,
    channel,
    dialCode,
    setDialCode,
    phone,
    setPhone,
    email,
    destination,
    otp,
    setOtp,
    busy,
    note,
    setNote,
    secondsUntilResend,
    otpRemainingMs,
    otpExpired,
    welcomeName,
    profileRequired: profileUserId != null,
    fullName,
    setFullName,
    profilePhone,
    setProfilePhone,
    profileEmail,
    setProfileEmail,
    profileErrors,
    setProfileErrors,
    profileSaving,
    sendCode,
    verifyCode,
    changeContact,
    saveProfile,
    enterAsDemo,
    enter,
  };
}

export type OtpSignIn = ReturnType<typeof useOtpSignIn>;
