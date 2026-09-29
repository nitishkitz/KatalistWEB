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

function authErrorCopy(error: unknown, fallback: string) {
  const message = extractErrorMessage(error) ?? fallback;
  if (/fetch failed|network(?:\s+error)?|failed to fetch/i.test(message)) {
    return "We couldn’t reach sign-in. Check your connection and try again.";
  }
  return message;
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

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: returnTo, replace: true });
    }
  }, [loading, session, navigate, returnTo]);

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

    const { error } = await supabase.auth.signInWithOtp({
      email: destination,
      options: { shouldCreateUser: true },
    });
    setBusy(false);

    if (error) {
      setAuthProgress("error");
      setAuthProgressMessage(authErrorCopy(error, "We couldn’t send a code. Try again."));
      toast.error(error.message);
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

      try {
        const res = await fetch("/api/auth/phone-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: destination, otp: code }),
        });
        const data = (await res.json()) as {
          token_hash?: unknown;
          properties?: { hashed_token?: unknown };
          error?: string;
          message?: string;
          statusMessage?: string;
        };
        if (!res.ok) {
          throw new Error(
            data.error || data.message || data.statusMessage || "Authentication failed",
          );
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
        setBusy(false);
        setAuthProgress("error");
        setAuthProgressMessage(authErrorCopy(err, "We couldn’t sign you in. Try again."));
        toast.error(extractErrorMessage(err) ?? "Failed to authenticate");
        setOtp("");
        verifyingOtpRef.current = false;
        return;
      }
    }

    const { data: authData, error } = await supabase.auth.verifyOtp({
      email: destination,
      token: code,
      type: "email",
    });

    if (error) {
      setBusy(false);
      setAuthProgress("error");
      setAuthProgressMessage(authErrorCopy(error, "That code doesn’t match. Try again."));
      toast.error(error.message);
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
  const otpRemainingMs = otpSentAt == null ? 0 : otpSentAt + OTP_TTL_MS - now;

  return (
    <div className="grid h-[100dvh] overflow-hidden lg:grid-cols-2">
      <AuthHeroPanel />

      <div className="flex min-h-0 flex-col overflow-hidden bg-[#fefefe] px-6 py-5 sm:px-12 sm:py-6 lg:px-16">
        <div className="flex items-center justify-between">
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

        <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col justify-center py-3 sm:py-5">
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
                <img
                  src={catLogin}
                  alt=""
                  className="-mt-2 w-[clamp(112px,18vh,180px)] object-contain sm:w-[clamp(136px,20vh,210px)]"
                />
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-[32px]">
                  Verify your number
                </h1>
                <p className="mt-2 text-base text-foreground/70">
                  We sent a 6-digit code to{" "}
                  <span className="font-medium text-foreground">{destination}</span>
                </p>

                {otpExpired ? (
                  <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    This code has expired. Send a new one to continue.
                  </p>
                ) : null}

                <div className="mt-5 sm:mt-7">
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
                    <InputOTPGroup className="gap-2 sm:gap-3">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          className="h-14 w-12 text-lg font-semibold sm:h-16 sm:w-14"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                {!otpExpired ? (
                  <p className="mt-4 text-sm text-foreground/70">
                    Code expires in{" "}
                    <span className="font-semibold text-primary">
                      {formatCountdown(otpRemainingMs)}
                    </span>
                  </p>
                ) : null}

                {authProgress !== "idle" ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className={cn(
                      "mt-3 flex items-center justify-center gap-2 text-sm font-medium",
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
                  className="mt-4 w-full sm:mt-5"
                  size="lg"
                  disabled={busy || otp.length !== 6 || otpExpired}
                  onClick={() => void verifyOtp(otp)}
                >
                  {authProgress === "verifying" ? "Checking code…" : "Verify & Continue"}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>

                <div className="mt-4 flex w-full items-center justify-between text-sm">
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
                  <p className="mt-3 text-xs text-muted-foreground/80 sm:mt-5">
                    Your privacy and security are our priority. We&apos;ll never share your details
                    with anyone.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center">
                <img
                  src={catLogin}
                  alt=""
                  className="-mt-2 w-[clamp(112px,18vh,180px)] object-contain sm:w-[clamp(136px,20vh,210px)]"
                />
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-[32px]">
                  Welcome to Katalist
                </h1>
                <p className="mt-2 text-base text-foreground/70">
                  {channel === "phone"
                    ? "Sign in with your phone number"
                    : "Sign in with your email"}
                </p>

                {channel === "phone" ? (
                  <div className="mt-5 flex w-full items-stretch overflow-hidden rounded-md border border-input sm:mt-7">
                    <Label htmlFor="dial-code" className="sr-only">
                      Country
                    </Label>
                    <Select value={dialCode} onValueChange={setDialCode}>
                      <SelectTrigger
                        id="dial-code"
                        aria-label="Country"
                        className="w-auto shrink-0 gap-1.5 rounded-none border-0 border-r border-input px-3 focus:ring-0"
                      >
                        <SelectValue>
                          <span className="flex items-center gap-1.5">
                            {dialCode === "+91" ? (
                              <img
                                src={flagIndia}
                                alt=""
                                className="h-3.5 w-5 rounded-[2px] object-cover"
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
                      className="flex-1 rounded-none border-0 focus-visible:ring-0"
                      aria-label="Phone number"
                    />
                  </div>
                ) : (
                  <div className="mt-5 w-full sm:mt-7">
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
                  className="mt-4 w-full"
                  size="lg"
                  disabled={busy}
                  onClick={() => void sendOtp()}
                >
                  Continue
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
                <p className="mt-3 text-sm text-foreground/70">We&apos;ll send a one time code</p>

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

                <p className="mt-5 text-xs text-muted-foreground/80 sm:mt-7">
                  By continuing, you agree to our{" "}
                  <span className="font-semibold text-primary">Terms of Service</span> and{" "}
                  <span className="font-semibold text-primary">Privacy Policy.</span>
                </p>

                <div className="w-full">
                  <BrandDivider />
                </div>
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

          {!profilePhone ? (
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
