import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Globe,
  LoaderCircle,
  Mail,
  QrCode,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useSession, DEMO_PERSONAS, signInAsDemo, DemoPersona } from "@/hooks/useSession";
import { Logo } from "@/components/katalist/Logo";
import { AuthHeroPanel } from "@/components/katalist/AuthHeroPanel";
import { demoEnabled } from "@/lib/session-mode";
import catLogin from "@/assets/auth/cat-login.png";
import flagIndia from "@/assets/auth/flag-india.png";
import katalistMark from "@/assets/auth/katalist-mark.svg";
import authCurve from "@/assets/auth/auth-curve.svg";
import privacyLock from "@/assets/auth/privacy-lock.svg";
import { localFixedOtp, localFixedOtpEnabled } from "@/lib/fixed-otp";
import { extractErrorMessage } from "@/lib/domain-error";
import { createLocalUser, type LocalProfileErrors } from "@/lib/auth/local-user";
import { useAvatarUrl } from "@/features/people/directory";
import { sanitizeRedirectTarget } from "@/lib/validate-redirect";

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

type AuthSearch = { redirect?: string };

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in to Katalist" },
      {
        name: "description",
        content:
          "Sign in to Katalist with a one-time password and pick up exactly where you left off.",
      },
      { property: "og:title", content: "Sign in to Katalist" },
      {
        property: "og:description",
        content: "Sign in to Katalist with a one-time password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // G01/G02: an unauthenticated direct link into a gated destination (e.g.
  // onboarding's "Find people" step, or a future deep link) is sent here
  // with its intended destination, so a successful sign-in returns the user
  // there instead of always landing on Court. `redirect` is re-validated on
  // read (sanitizeRedirectTarget), never trusted as-is.
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: AuthPage,
});

const COUNTRY_CODES = [
  { code: "+91", label: "India" },
  { code: "+1", label: "United States" },
  { code: "+44", label: "United Kingdom" },
  { code: "+61", label: "Australia" },
  { code: "+971", label: "United Arab Emirates" },
  { code: "+65", label: "Singapore" },
];

type Channel = "phone" | "email";
type AuthProgress = "idle" | "sending" | "code-sent" | "verifying" | "verified" | "error";

// G02: a resend must not be spammable, and a sent code must not remain
// verifiable forever -- both are part of "finish auth acceptance", not only
// the happy path.
const RESEND_COOLDOWN_MS = 30_000;
const OTP_TTL_MS = 5 * 60_000;

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type AuthRequestStage = "phone-login" | "set-session" | "verify-otp" | "send-email-code" | "verify-email-code";

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

function BrandDivider() {
  return (
    <div className="relative mt-10 border-t border-border">
      <div
        className="absolute left-1/2 top-0 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md"
        style={{
          background: "linear-gradient(141.9deg, #975ee2 9.2%, #60399e 44.8%, #1c153f 91.1%)",
        }}
      >
        <img src={katalistMark} alt="" aria-hidden="true" className="h-5 w-auto object-contain" />
      </div>
    </div>
  );
}

function DemoPersonaButton({ persona, onEnter }: { persona: DemoPersona; onEnter: () => void }) {
  const src = useAvatarUrl(persona.name, persona.email);
  return (
    <button
      type="button"
      onClick={onEnter}
      className="group flex w-full items-center justify-between rounded-xl border border-border bg-background p-3 text-left transition-all hover:border-primary hover:bg-accent/40"
    >
      <div className="flex items-center gap-3">
        {src ? (
          <img
            src={src}
            alt=""
            className="h-9 w-9 rounded-full object-cover ring-1 ring-border/50"
          />
        ) : (
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ring-1 ring-border/50",
              persona.color,
            )}
          >
            {persona.initials}
          </span>
        )}
        <div>
          <p className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
            {persona.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {persona.role} · <span className="font-mono">{persona.phone}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center text-xs font-medium text-primary">
        Enter <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </div>
    </button>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const returnTo = sanitizeRedirectTarget(redirect, "/");
  const { session, loading } = useSession();
  const phoneAvailable = localFixedOtpEnabled();

  const [tab, setTab] = useState<"otp" | "qr" | "preview">(demoEnabled() ? "preview" : "otp");
  const [channel, setChannel] = useState<Channel>(phoneAvailable ? "phone" : "email");
  const [dialCode, setDialCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authProgress, setAuthProgress] = useState<AuthProgress>("idle");
  const [authProgressMessage, setAuthProgressMessage] = useState("");
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [profilePhone, setProfilePhone] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [occupation, setOccupation] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileErrors, setProfileErrors] = useState<LocalProfileErrors>({});
  const verifyingOtpRef = useRef(false);
  const redirectedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && session && redirectedTokenRef.current !== session.access_token) {
      redirectedTokenRef.current = session.access_token;
      // Supabase can publish SIGNED_IN while the request that initiated OTP
      // verification is still settling (or has reported a transport failure).
      // A valid session is authoritative, so never leave a connection error on
      // screen once the user is actually authenticated.
      if (sent) {
        setBusy(false);
        setAuthProgress("verified");
        setAuthProgressMessage("Signed in. Opening Katalist…");
        verifyingOtpRef.current = false;
      }
      void navigate({ to: returnTo, replace: true });
    }
  }, [loading, session, sent, navigate, returnTo]);

  // Ticks once a code has been sent so the resend cooldown and expiry
  // countdowns are actually live, not just computed once at send time.
  useEffect(() => {
    if (!sent || otpSentAt == null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [sent, otpSentAt]);

  const secondsUntilResend =
    otpSentAt == null ? 0 : Math.max(0, Math.ceil((otpSentAt + RESEND_COOLDOWN_MS - now) / 1000));
  const otpExpired = otpSentAt != null && now - otpSentAt > OTP_TTL_MS;

  const destination = channel === "phone" ? `${dialCode}${phone.replace(/\D/g, "")}` : email.trim();

  function handleDemoLogin(persona: DemoPersona) {
    if (!demoEnabled()) return;
    signInAsDemo(persona);
    toast.success(`Welcome, ${persona.name}!`);
    navigate({ to: returnTo, replace: true });
  }

  async function sendOtp() {
    if (channel === "phone" && !phoneAvailable) {
      toast.error("Phone sign-in is not available in this deployment. Use email instead.");
      return;
    }
    if (channel === "phone" && phone.replace(/\D/g, "").length < 6) {
      toast.error("Enter a valid phone number");
      return;
    }
    if (channel === "email" && !email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }

    setBusy(true);
    setAuthProgress("sending");
    setAuthProgressMessage("Sending your code…");

    if (channel === "phone") {
      setBusy(false);
      setSent(true);
      setOtp("");
      setOtpSentAt(Date.now());
      setNow(Date.now());
      setAuthProgress("code-sent");
      setAuthProgressMessage("Code ready. Enter all 6 digits to continue.");
      toast.success(`Use verification code: ${localFixedOtp()}`);
      return;
    }

    let error: { message: string } | null = null;
    try {
      ({ error } = await supabase.auth.signInWithOtp({
        email: destination,
        options: { shouldCreateUser: true },
      }));
    } catch (err: unknown) {
      logAuthRequestFailure("send-email-code", err);
      const copy = authErrorCopy(err, "We couldn’t send a code. Try again.", "send-email-code");
      setBusy(false);
      setAuthProgress("error");
      setAuthProgressMessage(copy);
      toast.error(copy);
      return;
    }
    setBusy(false);

    if (error) {
      setAuthProgress("error");
      const copy = authErrorCopy(error, "We couldn’t send a code. Try again.", "send-email-code");
      setAuthProgressMessage(copy);
      toast.error(copy);
      return;
    }
    setSent(true);
    setOtp("");
    setOtpSentAt(Date.now());
    setNow(Date.now());
    setAuthProgress("code-sent");
    setAuthProgressMessage("Code sent. Enter all 6 digits to continue.");
    toast.success(`We sent a one-time password to ${destination}`);
  }

  async function verifyOtp(code: string) {
    if (verifyingOtpRef.current) return;
    verifyingOtpRef.current = true;
    if (otpSentAt != null && Date.now() - otpSentAt > OTP_TTL_MS) {
      setAuthProgress("error");
      setAuthProgressMessage("That code expired. Send a new code to continue.");
      toast.error("This code has expired. Send a new one.");
      setOtp("");
      verifyingOtpRef.current = false;
      return;
    }

    setBusy(true);
    setAuthProgress("verifying");
    setAuthProgressMessage("Checking your code…");

    if (channel === "phone") {
      const fixedCode = localFixedOtp();
      if (!fixedCode || code !== fixedCode) {
        setBusy(false);
        setAuthProgress("error");
        setAuthProgressMessage(
          fixedCode ? "That code doesn’t match. Try again." : "Phone sign-in is unavailable.",
        );
        toast.error(
          fixedCode
            ? `Please enter the 6-digit test code: ${fixedCode}`
            : "Phone sign-in is not available in this deployment.",
        );
        setOtp("");
        verifyingOtpRef.current = false;
        return;
      }

      let stage: AuthRequestStage = "phone-login";
      try {
        setAuthProgressMessage("Connecting to sign-in…");
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
          throw new Error(
            data.error || data.message || data.statusMessage || "Authentication failed",
          );
        }

        // Older local handlers return a ready session while production uses a
        // generated magic-link hash. Accept both server contracts so a device
        // can finish sign-in during a rolling deployment or local HMR update.
        const accessToken = typeof data.access_token === "string" ? data.access_token : null;
        const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : null;
        if (accessToken && refreshToken) {
          stage = "set-session";
          setAuthProgressMessage("Finishing secure sign-in…");
          const { data: sessionData, error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) throw setSessionError;

          await waitForSessionReady(sessionData.session?.access_token ?? accessToken);
          setBusy(false);
          setAuthProgress("verified");
          setAuthProgressMessage("Code verified. Signing you in…");
          verifyingOtpRef.current = false;
          toast.success("Welcome back!");
          navigate({ to: returnTo, replace: true });
          return;
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
          throw new Error(
            "We couldn’t prepare a verification session. Request a new code and try again.",
          );
        }

        stage = "verify-otp";
        setAuthProgressMessage("Finishing secure sign-in…");
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

        setBusy(false);
        setAuthProgress("verified");
        setAuthProgressMessage("Code verified. Signing you in…");
        verifyingOtpRef.current = false;
        toast.success(
          `Welcome back${authData.user?.user_metadata?.full_name ? `, ${authData.user.user_metadata.full_name}` : ""}!`,
        );
        navigate({ to: returnTo, replace: true });
        return;
      } catch (err: unknown) {
        logAuthRequestFailure(stage, err);
        const copy = authErrorCopy(err, "We couldn’t sign you in. Try again.", stage);
        setBusy(false);
        setAuthProgress("error");
        setAuthProgressMessage(copy);
        toast.error(copy);
        setOtp("");
        verifyingOtpRef.current = false;
        return;
      }
    }

    let authData: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>["data"];
    let error: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>["error"];
    try {
      ({ data: authData, error } = await supabase.auth.verifyOtp({
        email: destination,
        token: code,
        type: "email",
      }));
    } catch (err: unknown) {
      logAuthRequestFailure("verify-email-code", err);
      const copy = authErrorCopy(err, "We couldn’t verify that code. Try again.", "verify-email-code");
      setBusy(false);
      setAuthProgress("error");
      setAuthProgressMessage(copy);
      toast.error(copy);
      verifyingOtpRef.current = false;
      return;
    }

    if (error) {
      setBusy(false);
      setAuthProgress("error");
      const copy = authErrorCopy(error, "That code doesn’t match. Try again.", "verify-email-code");
      setAuthProgressMessage(copy);
      toast.error(copy);
      setOtp("");
      verifyingOtpRef.current = false;
      return;
    }

    await waitForSessionReady(authData.session?.access_token);
    setBusy(false);
    setAuthProgress("verified");
    setAuthProgressMessage("Code verified. Signing you in…");
    verifyingOtpRef.current = false;
    navigate({ to: returnTo, replace: true });
  }

  function completeLocalProfile() {
    if (!profilePhone) return;
    const result = createLocalUser(window.localStorage, profilePhone, {
      fullName,
      age,
      occupation,
      avatarUrl,
    });
    if (!result.ok) {
      setProfileErrors(result.errors);
      return;
    }
    signInAsDemo(result.persona);
    toast.success(`Welcome, ${result.persona.name}!`);
    navigate({ to: returnTo, replace: true });
  }

  const showAltMethodLink = !profilePhone;
  const showOtpHero = !profilePhone && tab === "otp";
  const otpRemainingMs = otpSentAt == null ? 0 : otpSentAt + OTP_TTL_MS - now;

  return (
    <div className="grid h-[100dvh] overflow-hidden lg:grid-cols-2">
      <AuthHeroPanel />

      <div className="relative flex min-h-0 flex-col overflow-hidden bg-[#fefefe] px-6 py-5 sm:px-12 sm:py-6 lg:px-16">
        <div
          className={cn(
            "z-10 flex items-center justify-between",
            showOtpHero
              ? "absolute inset-x-0 top-0 px-6 py-5 sm:px-12 sm:py-6 lg:px-16"
              : "relative",
          )}
        >
          <div className="lg:hidden">
            <Logo />
          </div>
          {showAltMethodLink ? (
            <div className="ml-auto flex items-center gap-4 text-xs font-medium">
              {demoEnabled() ? (
                <button
                  type="button"
                  onClick={() => setTab(tab === "preview" ? "otp" : "preview")}
                  className={cn(
                    "flex items-center gap-1.5",
                    tab === "preview"
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {tab === "preview" ? "Phone / OTP" : "Demo"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setTab(tab === "qr" ? "otp" : "qr")}
                className={cn(
                  "flex items-center gap-1.5",
                  tab === "qr" ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <QrCode className="h-3.5 w-3.5" />
                {tab === "qr" ? "Phone / OTP" : "Scan QR"}
              </button>
            </div>
          ) : null}
        </div>

        {showOtpHero ? <AuthOtpHero /> : null}
        <div
          className={cn(
            "relative z-10 mx-auto flex w-full flex-col",
            showOtpHero
              ? "max-w-[520px] shrink-0 pb-2 pt-2"
              : "min-h-0 max-w-md flex-1 justify-center py-3 sm:py-5",
          )}
        >
          {profilePhone ? (
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Create your profile</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tell us a little about you to finish setting up {profilePhone}.
                  </p>
                </div>
                <label className="group relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-muted text-muted-foreground hover:border-primary hover:text-primary">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Profile preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Camera className="h-5 w-5" />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label="Profile photo"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () =>
                        setAvatarUrl(typeof reader.result === "string" ? reader.result : null);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <Label htmlFor="profile-name">Full name</Label>
                  <Input
                    id="profile-name"
                    autoComplete="name"
                    className="mt-1.5"
                    value={fullName}
                    onChange={(event) => {
                      setFullName(event.target.value);
                      setProfileErrors((current) => ({ ...current, fullName: undefined }));
                    }}
                    aria-invalid={Boolean(profileErrors.fullName)}
                  />
                  {profileErrors.fullName ? (
                    <p className="mt-1 text-xs text-destructive">{profileErrors.fullName}</p>
                  ) : null}
                </div>

                <div>
                  <Label htmlFor="profile-age">Age</Label>
                  <Input
                    id="profile-age"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={120}
                    className="mt-1.5"
                    value={age}
                    onChange={(event) => {
                      setAge(event.target.value);
                      setProfileErrors((current) => ({ ...current, age: undefined }));
                    }}
                    aria-invalid={Boolean(profileErrors.age)}
                  />
                  {profileErrors.age ? (
                    <p className="mt-1 text-xs text-destructive">{profileErrors.age}</p>
                  ) : null}
                </div>

                <div>
                  <Label htmlFor="profile-occupation">Occupation</Label>
                  <Input
                    id="profile-occupation"
                    autoComplete="organization-title"
                    className="mt-1.5"
                    value={occupation}
                    onChange={(event) => {
                      setOccupation(event.target.value);
                      setProfileErrors((current) => ({ ...current, occupation: undefined }));
                    }}
                    onKeyDown={(event) => event.key === "Enter" && completeLocalProfile()}
                    aria-invalid={Boolean(profileErrors.occupation)}
                  />
                  {profileErrors.occupation ? (
                    <p className="mt-1 text-xs text-destructive">{profileErrors.occupation}</p>
                  ) : null}
                </div>
              </div>

              <Button className="mt-6 w-full" size="lg" onClick={completeLocalProfile}>
                Create profile
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              <button
                type="button"
                className="mt-3 w-full text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setProfilePhone(null);
                  setSent(false);
                  setOtp("");
                  setProfileErrors({});
                }}
              >
                Use another number
              </button>
            </div>
          ) : tab === "preview" ? (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Demo accounts</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    One tap. Uses the existing sample Court / Lists / Nudges data.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  <Sparkles className="h-3 w-3" /> Dev Ready
                </span>
              </div>

              <div className="mt-4 space-y-2.5">
                {DEMO_PERSONAS.map((persona) => (
                  <DemoPersonaButton
                    key={persona.key}
                    persona={persona}
                    onEnter={() => handleDemoLogin(persona)}
                  />
                ))}
              </div>
            </div>
          ) : tab === "otp" ? (
            sent ? (
              <div className="flex flex-col items-center text-center">
                <h1 className="text-3xl font-semibold leading-[1.269] text-black sm:text-[40.76px]">
                  Verify your number
                </h1>
                <p className="mt-4 text-[18.216px] leading-[1.269] text-black">
                  We sent a 6-digit code to{" "}
                  <span className="font-medium text-foreground">{destination}</span>
                </p>

                {otpExpired ? (
                  <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    This code has expired. Send a new one to continue.
                  </p>
                ) : null}

                <div className="mt-6 w-full">
                  <InputOTP
                    maxLength={6}
                    value={otp}
                    disabled={otpExpired || busy}
                    onChange={(value) => {
                      setOtp(value);
                      if (authProgress === "error") {
                        setAuthProgress("code-sent");
                        setAuthProgressMessage("Code ready. Enter all 6 digits to continue.");
                      }
                      if (value.length === 6) void verifyOtp(value);
                    }}
                  >
                    <InputOTPGroup className="w-full justify-between gap-2">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          className="h-14 w-12 rounded-[4px] border border-[#e4e4e4] bg-white text-lg font-semibold first:rounded-l-[4px] first:border-l last:rounded-r-[4px] sm:h-[67.6px] sm:w-[67.4px]"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                {!otpExpired ? (
                  <p className="mt-4 text-[18.216px] leading-[1.269] text-black">
                    Code expires in{" "}
                    <span className="font-semibold text-[#975ee2]">
                      {formatCountdown(otpRemainingMs)}
                    </span>
                  </p>
                ) : null}

                {authProgress !== "idle" ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className={cn(
                      "mt-2 flex items-center justify-center gap-2 text-sm font-medium",
                      authProgress === "error" ? "text-destructive" : "text-foreground/70",
                    )}
                  >
                    {authProgress === "sending" || authProgress === "verifying" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                    ) : null}
                    {authProgressMessage}
                  </p>
                ) : null}

                {channel === "phone" && phoneAvailable ? (
                  <p className="mt-2 rounded-md bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground">
                    Test mode — enter code{" "}
                    <span className="font-semibold text-primary">{localFixedOtp()}</span>
                  </p>
                ) : null}

                <Button
                  className="h-[45.6px] w-full rounded-[4px] bg-[#975ee2] text-[16.589px] font-medium hover:bg-[#975ee2]/90 mt-4"
                  disabled={busy || otp.length !== 6 || otpExpired}
                  onClick={() => void verifyOtp(otp)}
                >
                  {authProgress === "verifying" ? "Checking code…" : "Verify & Continue"}
                </Button>

                <div className="mt-3 flex w-full items-center justify-between text-sm">
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setSent(false);
                      setOtp("");
                      setOtpSentAt(null);
                    }}
                  >
                    Change {channel === "phone" ? "number" : "email"}
                  </button>
                  <button
                    className="font-medium text-primary hover:underline disabled:opacity-50"
                    disabled={busy || secondsUntilResend > 0}
                    onClick={() => void sendOtp()}
                  >
                    {secondsUntilResend > 0
                      ? `Resend code (${secondsUntilResend}s)`
                      : "Resend code"}
                  </button>
                </div>

                <div className="w-full">
                  <BrandDivider />
                  <div className="mt-4 flex items-center justify-center gap-4 sm:mt-6">
                    <img src={privacyLock} alt="" aria-hidden="true" className="h-[31px] w-[28px]" />
                    <p className="text-left text-[14.187px] leading-[1.269] text-black/70">
                      Your privacy and security are our priority.
                      <br />
                      We&apos;ll never share your details with anyone.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center">
                <h1 className="text-3xl font-semibold leading-[1.269] text-black sm:text-[40.76px]">
                  Welcome to Katalist
                </h1>
                <p className="mt-5 text-[18.216px] leading-[1.269] text-black">
                  {channel === "phone"
                    ? "Sign in with your phone number"
                    : "Sign in with your email"}
                </p>

                {channel === "phone" ? (
                  <div className="mt-8 flex h-[67.6px] w-full items-stretch overflow-hidden rounded-[4px] border border-[#e4e4e4] bg-white">
                    <Label htmlFor="dial-code" className="sr-only">
                      Country
                    </Label>
                    <Select value={dialCode} onValueChange={setDialCode}>
                      <SelectTrigger
                        id="dial-code"
                        aria-label="Country"
                        className="h-full w-[142px] shrink-0 justify-between gap-1.5 rounded-none border-0 border-r border-[#e4e4e4] px-5 text-[16.589px] text-black focus:ring-0"
                      >
                        <SelectValue>
                          <span className="flex items-center gap-4">
                            {dialCode === "+91" ? (
                              <img
                                src={flagIndia}
                                alt=""
                                className="h-[18.4px] w-[27.6px] object-cover"
                              />
                            ) : (
                              <Globe className="h-4 w-4 text-muted-foreground" />
                            )}
                            {dialCode}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRY_CODES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.label} ({c.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="tel"
                      inputMode="tel"
                      placeholder="Enter your phone number"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void sendOtp()}
                      className="h-full flex-1 rounded-none border-0 px-6 text-[16.589px] placeholder:text-black/50 focus-visible:ring-0"
                      aria-label="Phone number"
                    />
                  </div>
                ) : (
                  <div className="mt-8 w-full">
                    <Label htmlFor="email" className="sr-only">
                      Email address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      inputMode="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void sendOtp()}
                    />
                  </div>
                )}

                <Button
                  className="h-[45.6px] w-full rounded-[4px] bg-[#975ee2] text-[16.589px] font-medium hover:bg-[#975ee2]/90 mt-7"
                  disabled={busy}
                  onClick={() => void sendOtp()}
                >
                  Continue
                </Button>
                <p className="mt-5 text-[14.515px] leading-[1.269] text-black/70">
                  We&apos;ll send a one time code
                </p>

                {phoneAvailable ? (
                  <button
                    className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => setChannel(channel === "phone" ? "email" : "phone")}
                  >
                    {channel === "phone" ? (
                      <>
                        <Mail className="h-4 w-4" /> Use email instead
                      </>
                    ) : (
                      <>
                        <Smartphone className="h-4 w-4" /> Use phone instead
                      </>
                    )}
                  </button>
                ) : null}

                <div className="w-full">
                  <BrandDivider />
                </div>

                <p className="mt-4 text-[14.187px] leading-[1.269] text-black/70 sm:mt-6">
                  By continuing, you agree to our{" "}
                  <span className="font-semibold text-[#975ee2]">Terms of Service</span> and{" "}
                  <span className="font-semibold text-[#975ee2]">Privacy Policy.</span>
                </p>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-xl bg-secondary/60 p-6 text-center">
              <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-border bg-card">
                <QrCode className="h-20 w-20 text-foreground/80" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Scan QR to login</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open the Katalist mobile app and scan the QR code to login instantly.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  QR login uses a short-lived secure challenge with the Katalist mobile app.
                  Integration boundary — use Phone / OTP when available.
                </p>
              </div>
            </div>
          )}

          {!profilePhone && !(tab === "otp" && sent) ? (
            <p className="mt-4 text-center text-sm text-muted-foreground sm:mt-6">
              New to Katalist?{" "}
              <Link to="/welcome" className="font-medium text-primary hover:underline">
                Take the tour
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Figma login / verify hero: soft diagonal stripes, the zoomed Coey cat and
 * the white curved sheet the form sits on. It is an in-flow block that shrinks
 * with the viewport (max 370px, the Figma height above the heading), so the
 * cat can never overlap the form. Inner geometry scales with the block height.
 */
const AUTH_STRIPES = [
  { left: 546.7, top: -2.75, w: 210.949, h: 709.875, tone: 0.16 },
  { left: 389.2, top: -262, w: 208.099, h: 932.004, tone: 0.08 },
  { left: 173.9, top: -296.9, w: 209.093, h: 932.004, tone: 0.16 },
  { left: 73.4, top: -561.8, w: 210.949, h: 932.004, tone: 0.08 },
];

function AuthOtpHero() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative -mx-6 -mt-5 min-h-[120px] flex-[1_1_370px] overflow-hidden sm:-mx-12 sm:-mt-6 lg:-mx-16 max-h-[370px]"
    >
      {AUTH_STRIPES.map((stripe) => (
        <div
          key={stripe.left}
          className="absolute origin-center opacity-40"
          style={{
            left: `${(stripe.left / 720) * 100}%`,
            top: stripe.top,
            width: stripe.w,
            height: stripe.h,
            transform: "rotate(33.35deg) skewX(6.49deg) scaleY(0.99)",
            backgroundColor: `rgba(151, 94, 226, ${stripe.tone})`,
          }}
        />
      ))}
      {/* Cat image is 727px tall in the 370px Figma hero (196.4%). */}
      <img
        src={catLogin}
        alt=""
        className="absolute left-[calc(50%-9px)] top-0 h-[196.4%] w-auto max-w-none -translate-x-1/2"
      />
      {/* Curve sheet starts 274px down the 370px hero and is 686px tall. */}
      <div className="absolute inset-x-0 top-[74.05%] h-[185.5%]">
        <img src={authCurve} alt="" className="absolute inset-0 block size-full max-w-none" />
      </div>
    </div>
  );
}
