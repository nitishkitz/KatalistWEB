import { useEffect, useState, type CSSProperties, type ReactNode, type Ref } from "react";

import { cn } from "@/lib/utils";
import { DEMO_PERSONAS, type DemoPersona } from "@/hooks/useSession";
import { useAvatarUrl } from "@/features/people/directory";
import { formatPhoneInput, type OtpSignIn } from "../use-otp-sign-in";

const COUNTRY_CODES = [
  { code: "+91", label: "India" },
  { code: "+1", label: "United States" },
  { code: "+44", label: "United Kingdom" },
  { code: "+971", label: "United Arab Emirates" },
  { code: "+65", label: "Singapore" },
  { code: "+61", label: "Australia" },
];

/** Staggers a step's children into place. */
const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is a nicety; unsupported or blocked is fine.
  }
};

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function GatePath({ labels, index }: { labels: [string, string, string]; index: number }) {
  return (
    <ol className="kg-path" aria-label="Sign-in progress">
      {labels.map((label, i) => (
        <li
          key={label}
          className={cn(i < index && "is-done", i === index && "is-now")}
          aria-current={i === index ? "step" : undefined}
        >
          <span className="kg-dot" />
          {label}
        </li>
      ))}
    </ol>
  );
}

export function GateButton({
  busy,
  disabled,
  label,
  type = "submit",
  onClick,
  ref,
}: {
  busy?: boolean;
  disabled?: boolean;
  label: string;
  type?: "submit" | "button";
  onClick?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      className={cn("kg-cta", busy && "is-busy")}
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      aria-disabled={busy || disabled ? "true" : "false"}
      aria-busy={busy || undefined}
    >
      <span>{label}</span>
      <svg className="kg-ball" viewBox="0 0 20 20" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="#D8F23B"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength="60"
          strokeDasharray="6 4"
        />
      </svg>
    </button>
  );
}

function Note({ id, auth }: { id: string; auth: OtpSignIn }) {
  return (
    <p className={cn("kg-note", auth.note?.error && "is-error")} id={id} aria-live="polite">
      {auth.note?.text ?? ""}
    </p>
  );
}

/* ---------- Number / email ---------- */

export function ContactStep({
  auth,
  sending,
  inputRef,
  onSubmit,
  onShowDemo,
}: {
  auth: OtpSignIn;
  sending: boolean;
  inputRef: Ref<HTMLInputElement>;
  onSubmit: () => void;
  onShowDemo?: () => void;
}) {
  const isPhone = auth.channel === "phone";
  const invalid = Boolean(auth.note?.error);
  const clearError = () => {
    if (auth.note?.error) auth.setNote(null);
  };

  return (
    <section className="kg-step" aria-labelledby="kg-h-contact">
      <h1 id="kg-h-contact" className="kg-title" tabIndex={-1} style={stagger(0)}>
        Unlock your space.
      </h1>
      <p className="kg-lede" style={stagger(1)}>
        {isPhone ? (
          <>
            Sign in with your phone. We will text you a <span style={{ whiteSpace: "nowrap" }}>6-digit</span> code.
          </>
        ) : (
          <>
            Sign in with your email. We will send you a <span style={{ whiteSpace: "nowrap" }}>6-digit</span> code.
          </>
        )}
      </p>
      <form
        noValidate
        style={stagger(2)}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {isPhone ? (
          <>
            <label className="kg-label" htmlFor="kg-tel">
              Phone number
            </label>
            <div className="kg-well" data-invalid={invalid}>
              <select
                id="kg-cc"
                name="country-code"
                autoComplete="tel-country-code"
                aria-label="Country code"
                value={auth.dialCode}
                onChange={(event) => {
                  auth.setDialCode(event.target.value);
                  auth.setPhone(formatPhoneInput(event.target.value, auth.phone));
                }}
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code} title={c.label}>
                    {c.code}
                  </option>
                ))}
              </select>
              <input
                ref={inputRef}
                id="kg-tel"
                name="tel"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                enterKeyHint="send"
                aria-describedby="kg-contact-note"
                aria-invalid={invalid}
                value={auth.phone}
                onChange={(event) => {
                  auth.setPhone(formatPhoneInput(auth.dialCode, event.target.value));
                  clearError();
                }}
              />
            </div>
          </>
        ) : (
          <>
            <label className="kg-label" htmlFor="kg-email">
              Email address
            </label>
            <div className="kg-well" data-invalid={invalid}>
              <input
                ref={inputRef}
                id="kg-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                enterKeyHint="send"
                aria-describedby="kg-contact-note"
                aria-invalid={invalid}
                value={auth.email}
                onChange={(event) => {
                  auth.setEmail(event.target.value);
                  clearError();
                }}
              />
            </div>
          </>
        )}
        <Note id="kg-contact-note" auth={auth} />
        <GateButton busy={sending} label={sending ? "Sending code" : "Send code"} />
      </form>
      {auth.phoneAvailable || onShowDemo ? (
        <div className="kg-row" style={stagger(3)}>
          {auth.phoneAvailable ? (
            <button
              className="kg-link"
              type="button"
              onClick={() => auth.chooseChannel(isPhone ? "email" : "phone")}
            >
              {isPhone ? "Use email instead" : "Use phone instead"}
            </button>
          ) : null}
          {onShowDemo ? (
            <button className="kg-link" type="button" onClick={onShowDemo}>
              Demo accounts
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Code ---------- */

export function CodeStep({
  auth,
  verifying,
  verificationPending,
  recovering,
  rejected,
  inputRef,
  ctaRef,
  onCodeChange,
  onSubmit,
  onResend,
  onChangeContact,
}: {
  auth: OtpSignIn;
  verifying: boolean;
  verificationPending: boolean;
  recovering: boolean;
  rejected: boolean;
  inputRef: Ref<HTMLInputElement>;
  ctaRef: Ref<HTMLButtonElement>;
  onCodeChange: (code: string) => void;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onChangeContact: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [longWait, setLongWait] = useState(false);
  useEffect(() => {
    setLongWait(false);
    if (!verificationPending) return;
    const timer = setTimeout(() => setLongWait(true), 5000);
    return () => clearTimeout(timer);
  }, [verificationPending]);
  const { otp, otpExpired: expired } = auth;
  const sentTo = auth.channel === "phone" ? `${auth.dialCode} ${auth.phone.trim()}` : auth.email.trim();
  const ctaLabel = verifying
    ? "Verifying"
    : expired
    ? auth.busy
      ? "Sending code"
      : "Send a new code"
    : "Verify code";

  return (
    <section className="kg-step" aria-labelledby="kg-h-code">
      <h1 id="kg-h-code" className="kg-title" tabIndex={-1} style={stagger(0)}>
        Enter the code.
      </h1>
      <p className="kg-lede" style={stagger(1)}>
        Sent to <b>{sentTo}</b>. Coey is holding the gate.
      </p>
      <form
        noValidate
        style={stagger(2)}
        onSubmit={(event) => {
          event.preventDefault();
          if (expired) onResend();
          else onSubmit(otp);
        }}
      >
        <label htmlFor="kg-otp" className="kg-sr-only">
          6-digit code
        </label>
        <div className={cn("kg-cells", focused && "is-focus", rejected && "is-error", expired && "is-off")}>
          <input
            ref={inputRef}
            id="kg-otp"
            name="one-time-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            enterKeyHint="done"
            aria-describedby="kg-code-note"
            aria-invalid={rejected}
            readOnly={verifying || recovering || expired}
            value={otp}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, 6);
              if (next.length > otp.length) buzz(6);
              onCodeChange(next);
              if (next.length === 6) onSubmit(next);
            }}
          />
          {Array.from({ length: 6 }, (_, i) => {
            const ch = otp[i] ?? "";
            return (
              <span
                // Re-keying on the digit replays the fill pop.
                key={`${i}-${ch}`}
                className={cn(
                  "kg-cell",
                  ch && "is-filled",
                  otp.length < 6 && i === Math.min(otp.length, 5) && "is-current",
                )}
              >
                {ch}
              </span>
            );
          })}
        </div>
        <Note id="kg-code-note" auth={auth} />
        <GateButton ref={ctaRef} busy={verifying || (expired && auth.busy)} disabled={recovering} label={ctaLabel} />
        <p className="kg-verification-status" role="status">
          {verificationPending && longWait ? "Still verifying…" : ""}
        </p>
      </form>
      <div className="kg-row" style={stagger(3)}>
        <button className="kg-link" type="button" onClick={onChangeContact} disabled={verifying || recovering}>
          {auth.channel === "phone" ? "Change number" : "Change email"}
        </button>
        <button
          className="kg-link"
          type="button"
          disabled={auth.busy || verifying || recovering || auth.secondsUntilResend > 0}
          onClick={onResend}
        >
          {auth.secondsUntilResend > 0 ? `Resend code in ${auth.secondsUntilResend}s` : "Resend code"}
        </button>
      </div>
      <p className="kg-expiry" style={stagger(4)}>
        {expired ? "Code expired" : `Code expires in ${formatCountdown(auth.otpRemainingMs)}`}
      </p>
    </section>
  );
}

/* ---------- Profile (first sign-in, or an incomplete profile) ---------- */

function ProfileField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="kg-field">
      <label className="kg-label" htmlFor={id}>
        {label}
      </label>
      <div className="kg-well kg-well--compact" data-invalid={Boolean(error)}>
        {children}
      </div>
      {error || hint ? (
        <p id={`${id}-hint`} className={cn("kg-field-hint", error && "is-error")}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export function ProfileStep({
  auth,
  saving,
  onSubmit,
}: {
  auth: OtpSignIn;
  saving: boolean;
  onSubmit: () => void;
}) {
  const { profileErrors: errors, setProfileErrors } = auth;
  const clear = (field: keyof typeof errors) =>
    setProfileErrors((current) => ({ ...current, [field]: undefined }));

  return (
    <section className="kg-step" aria-labelledby="kg-h-profile">
      <h1 id="kg-h-profile" className="kg-title" tabIndex={-1} style={stagger(0)}>
        One last thing.
      </h1>
      <p className="kg-lede" style={stagger(1)}>
        Add your name and contact details to finish setting up your space.
      </p>
      <form
        noValidate
        style={stagger(2)}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <ProfileField id="kg-profile-name" label="Full name" error={errors.fullName}>
          <input
            id="kg-profile-name"
            autoComplete="name"
            aria-invalid={Boolean(errors.fullName)}
            aria-describedby={errors.fullName ? "kg-profile-name-hint" : undefined}
            value={auth.fullName}
            onChange={(event) => {
              auth.setFullName(event.target.value);
              clear("fullName");
            }}
          />
        </ProfileField>
        <ProfileField
          id="kg-profile-phone"
          label="Mobile number"
          error={errors.phone}
          hint="Include your country code, for example +91."
        >
          <input
            id="kg-profile-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby="kg-profile-phone-hint"
            value={auth.profilePhone}
            onChange={(event) => {
              auth.setProfilePhone(event.target.value);
              clear("phone");
            }}
          />
        </ProfileField>
        <ProfileField
          id="kg-profile-email"
          label="Email address"
          error={errors.email}
          hint="Your contact email. Sign-in still uses a one-time code."
        >
          <input
            id="kg-profile-email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby="kg-profile-email-hint"
            value={auth.profileEmail}
            onChange={(event) => {
              auth.setProfileEmail(event.target.value);
              clear("email");
            }}
          />
        </ProfileField>
        <Note id="kg-profile-note" auth={auth} />
        <GateButton busy={saving} label={saving ? "Saving profile" : "Continue"} />
      </form>
    </section>
  );
}

/* ---------- Demo accounts (demo deployments only) ---------- */

function PersonaButton({ persona, onEnter }: { persona: DemoPersona; onEnter: () => void }) {
  const src = useAvatarUrl(persona.name, persona.email);
  return (
    <button type="button" className="kg-persona" onClick={onEnter}>
      {src ? (
        <img src={src} alt="" className="kg-persona-avatar" />
      ) : (
        <span className="kg-persona-avatar" aria-hidden="true">
          {persona.initials}
        </span>
      )}
      <span>
        <span className="kg-persona-name">{persona.name}</span>
        <span className="kg-persona-role">{persona.role}</span>
      </span>
      <span className="kg-persona-go" aria-hidden="true">
        Enter
      </span>
    </button>
  );
}

export function DemoStep({ auth, onUseOtp }: { auth: OtpSignIn; onUseOtp: () => void }) {
  return (
    <section className="kg-step" aria-labelledby="kg-h-demo">
      <h1 id="kg-h-demo" className="kg-title" tabIndex={-1} style={stagger(0)}>
        Pick a seat.
      </h1>
      <p className="kg-lede" style={stagger(1)}>
        Demo accounts. One tap, using the sample Court, Lists and Nudges data.
      </p>
      <div className="kg-personas" style={stagger(2)}>
        {DEMO_PERSONAS.map((persona) => (
          <PersonaButton key={persona.key} persona={persona} onEnter={() => auth.enterAsDemo(persona)} />
        ))}
      </div>
      <div className="kg-row" style={stagger(3)}>
        <button className="kg-link" type="button" onClick={onUseOtp}>
          Use phone or email
        </button>
      </div>
    </section>
  );
}
