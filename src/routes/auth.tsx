import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Cloud,
  Layers,
  Lock,
  Mail,
  QrCode,
  Shield,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
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
import { demoEnabled } from "@/lib/session-mode";
import { localFixedOtp } from "@/lib/fixed-otp";
import {
  createLocalUser,
  resolveFixedOtpOutcome,
  type LocalProfileErrors,
} from "@/lib/auth/local-user";
import { useAvatarUrl } from "@/features/people/directory";

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
          <img src={src} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-border/50" />
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
          <p className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">{persona.name}</p>
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
  const { session, loading } = useSession();

  const [tab, setTab] = useState<"otp" | "qr" | "preview">(demoEnabled() ? "preview" : "otp");
  const [channel, setChannel] = useState<Channel>("phone");
  const [dialCode, setDialCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profilePhone, setProfilePhone] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [occupation, setOccupation] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileErrors, setProfileErrors] = useState<LocalProfileErrors>({});

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/", replace: true });
    }
  }, [loading, session, navigate]);

  const destination =
    channel === "phone" ? `${dialCode}${phone.replace(/\D/g, "")}` : email.trim();

  function handleDemoLogin(persona: DemoPersona) {
    if (!demoEnabled()) return;
    signInAsDemo(persona);
    toast.success(`Welcome, ${persona.name}!`);
    navigate({ to: "/", replace: true });
  }

  async function sendOtp() {
    if (channel === "phone" && phone.replace(/\D/g, "").length < 6) {
      toast.error("Enter a valid phone number");
      return;
    }
    if (channel === "email" && !email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }

    setBusy(true);
    const fixedOtp = localFixedOtp();
    if (fixedOtp && channel === "phone") {
      setBusy(false);
      setSent(true);
      setOtp("");
      toast.success(`Use the local test code ${fixedOtp}`);
      return;
    }

    const { error } =
      channel === "phone"
        ? await supabase.auth.signInWithOtp({ phone: destination })
        : await supabase.auth.signInWithOtp({
            email: destination,
            options: { shouldCreateUser: true },
          });
    setBusy(false);

    if (error) {
      if (error.message.toLowerCase().includes("unsupported phone provider")) {
        toast.error(
          "Phone provider is not configured. Try the 'Demo (1-Click)' tab above or email login below!",
          { duration: 6000 }
        );
      } else {
        toast.error(error.message);
      }
      return;
    }
    setSent(true);
    setOtp("");
    toast.success(`We sent a one-time password to ${destination}`);
  }

  async function verifyOtp(code: string) {
    setBusy(true);
    const fixedOtp = localFixedOtp();
    if (fixedOtp && channel === "phone") {
      if (code !== fixedOtp) {
        setBusy(false);
        toast.error("Enter the 6-digit local test code");
        setOtp("");
        return;
      }
      const outcome = resolveFixedOtpOutcome(window.localStorage, destination, DEMO_PERSONAS);
      if (outcome.kind === "profile-setup") {
        setProfilePhone(outcome.phone);
        setProfileErrors({});
        setBusy(false);
        return;
      }
      signInAsDemo(outcome.persona);
      setBusy(false);
      navigate({ to: "/", replace: true });
      return;
    }

    const { error } =
      channel === "phone"
        ? await supabase.auth.verifyOtp({ phone: destination, token: code, type: "sms" })
        : await supabase.auth.verifyOtp({ email: destination, token: code, type: "email" });
    setBusy(false);

    if (error) {
      toast.error(error.message);
      setOtp("");
      return;
    }
    navigate({ to: "/", replace: true });
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
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen max-w-6xl gap-12 px-6 py-8 lg:grid-cols-2">
        {/* Brand panel */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <Logo />
            <p className="text-sm text-muted-foreground lg:hidden">
              Life, <span className="font-semibold text-primary">Sorted.</span>
            </p>
          </div>

          <div className="mt-16 max-w-md">
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
              Welcome back
              <br />
              to <span className="text-primary">Katalist</span>
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              The smart way to capture, organize and get things done — together.
            </p>

            <ul className="mt-8 space-y-5">
              {[
                {
                  icon: CheckCircle2,
                  title: "Capture anything instantly",
                  body: "Things, notes, links and more.",
                },
                {
                  icon: Layers,
                  title: "Organize with clarity",
                  body: "Buckets, lists and court to stay focused.",
                },
                {
                  icon: Users,
                  title: "Collaborate effortlessly",
                  body: "Assign, share and move things forward.",
                },
              ].map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Icon className="h-4 w-4 text-primary" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{title}</span>
                    <span className="block text-sm text-muted-foreground">{body}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex justify-center lg:justify-start">
              <img
                src="/welcome-hero.png"
                alt="Katalist overview"
                className="w-full max-w-md rounded-2xl object-contain drop-shadow-sm transition-transform duration-300 hover:scale-[1.02]"
              />
            </div>
          </div>
        </div>

        {/* Auth card */}
        <div className="flex flex-col justify-center">
          <div className="rounded-2xl border border-border bg-card katalist-shadow">
            <div className="grid grid-cols-3 border-b border-border">
              {(
                (
                  demoEnabled()
                    ? ([["preview", "Demo", Sparkles], ["otp", "Phone / OTP", Smartphone], ["qr", "Scan QR", QrCode]] as const)
                    : ([["otp", "Phone / OTP", Smartphone], ["qr", "Scan QR", QrCode]] as const)
                )
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 border-b-2 px-2 py-3.5 text-xs sm:text-sm font-medium transition-colors",
                    tab === key
                      ? "border-primary text-primary font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="p-6">
              {profilePhone ? (
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Create your profile</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Tell us a little about you to finish setting up {profilePhone}.
                      </p>
                    </div>
                    <label className="group relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-muted text-muted-foreground hover:border-primary hover:text-primary">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="Profile preview" className="h-full w-full object-cover" />
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
                          reader.onload = () => setAvatarUrl(typeof reader.result === "string" ? reader.result : null);
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
                      <h2 className="text-base font-semibold text-foreground">
                        Demo accounts
                      </h2>
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
                      <DemoPersonaButton key={persona.key} persona={persona} onEnter={() => handleDemoLogin(persona)} />
                    ))}
                  </div>
                </div>
              ) : tab === "otp" ? (
                sent ? (
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      Enter your one-time password
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      We sent a 6-digit code to{" "}
                      <span className="font-medium text-foreground">{destination}</span>
                    </p>

                    <div className="mt-6 flex justify-center">
                      <InputOTP
                        maxLength={6}
                        value={otp}
                        onChange={(value) => {
                          setOtp(value);
                          if (value.length === 6) void verifyOtp(value);
                        }}
                      >
                        <InputOTPGroup>
                          {[0, 1, 2, 3, 4, 5].map((i) => (
                            <InputOTPSlot key={i} index={i} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>

                    <Button
                      className="mt-6 w-full"
                      size="lg"
                      disabled={busy || otp.length !== 6}
                      onClick={() => void verifyOtp(otp)}
                    >
                      Verify & continue
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>

                    <div className="mt-4 flex items-center justify-between text-sm">
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setSent(false);
                          setOtp("");
                        }}
                      >
                        Change {channel === "phone" ? "number" : "email"}
                      </button>
                      <button
                        className="font-medium text-primary hover:underline disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void sendOtp()}
                      >
                        Resend code
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      {channel === "phone"
                        ? "Login with your phone number"
                        : "Login with your email"}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      We'll send you a one-time password (OTP)
                    </p>

                    {channel === "phone" ? (
                      <div className="mt-5 flex gap-2">
                        <Select value={dialCode} onValueChange={setDialCode}>
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COUNTRY_CODES.map((c) => (
                              <SelectItem key={c.code} value={c.code}>
                                {c.code}
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
                          className="flex-1"
                          aria-label="Phone number"
                        />
                      </div>
                    ) : (
                      <div className="mt-5">
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
                      Send OTP
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>

                    <button
                      className="mt-3 flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
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
                      QR login uses a short-lived secure challenge with the Katalist mobile app. Integration boundary — use Phone / OTP when available.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border px-6 py-3 text-center text-xs text-muted-foreground">
              Demo is for testing. Phone / OTP and QR stay for live accounts.
            </div>

            <div className="border-t border-border px-6 py-4 text-center text-sm text-muted-foreground">
              New to Katalist?{" "}
              <Link to="/onboarding" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Secure connection
            </span>
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Your data is private
            </span>
            <span className="flex items-center gap-1.5">
              <Cloud className="h-3.5 w-3.5" /> Secure and reliable
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
