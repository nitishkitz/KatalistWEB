import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { useMotionPreference } from "@/hooks/use-motion-preference";
import { demoEnabled } from "@/lib/session-mode";
import { localFixedOtp } from "@/lib/fixed-otp";
import { holdIdentityTransition } from "@/features/realtime/identity-transition-hold";
import { contactProblem, OTP_TTL_MS, useOtpSignIn } from "../use-otp-sign-in";
import { clearGateHandoff, peekGateHandoff, setGateHandoff } from "./gate-handoff";
import { GateStage } from "./GateStage";
import { useGateScene } from "./use-gate-scene";
import { CodeStep, ContactStep, DemoStep, GateButton, ProfileStep } from "./GateSteps";
import "./auth-gate.css";

/**
 * /auth: Coey holds the gate while the visitor signs in on the wall beside
 * it. Sending a code walks Coey up to the dock, each digit lights a segment
 * of the ring, and a verified code opens the gate onto "You're in."
 *
 * useOtpSignIn owns sign-in; GateScene owns motion; this component sequences
 * the two so every network outcome has a matching scene beat.
 *
 * A verified code publishes the new session immediately, and
 * IdentityBoundary remounts the app on any identity change. So the gate
 * holds that swap from verify until "You're in." has played, then leaves a
 * handoff so a remount that still lands on /auth resumes on the final frame.
 */

type Step = "contact" | "code";
type Phase = "idle" | "sending" | "verifying" | "resending" | "returning" | "unlocking";
type FocusTarget = "contact" | "otp" | "cta" | "welcome";

const ENTER_DELAY_MS = 1600;

export function AuthGate({ returnTo }: { returnTo: string }) {
  const [handoff] = useState(peekGateHandoff);
  const auth = useOtpSignIn(returnTo, { resumeUnlocked: handoff != null });
  const { reduceMotion } = useMotionPreference();
  const { refs, sceneRef } = useGateScene(reduceMotion, { unlocked: handoff != null });

  const [step, setStep] = useState<Step>("contact");
  const [showDemo, setShowDemo] = useState(() => demoEnabled());
  const [phase, setPhaseState] = useState<Phase>(handoff ? "unlocking" : "idle");
  const phaseRef = useRef<Phase>(handoff ? "unlocking" : "idle");
  const [rejected, setRejected] = useState(false);
  const [welcome, setWelcome] = useState<"hidden" | "shown" | "settled">(handoff ? "settled" : "hidden");
  const [liveMessage, setLiveMessage] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; seq: number } | null>(null);

  const contactInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const codeCtaRef = useRef<HTMLButtonElement>(null);
  const welcomeHeadingRef = useRef<HTMLHeadingElement>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseHoldRef = useRef<(() => void) | null>(null);
  // finish() runs from a timer scheduled before verify's state landed.
  const welcomeNameRef = useRef(auth.welcomeName);
  welcomeNameRef.current = auth.welcomeName;
  const finishedRef = useRef(false);

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };
  const focusSoon = (target: FocusTarget) => setFocusRequest((r) => ({ target, seq: (r?.seq ?? 0) + 1 }));
  const announce = useCallback((message: string) => {
    setLiveMessage("");
    setTimeout(() => setLiveMessage(message), 30);
  }, []);

  const view = auth.profileRequired ? "profile" : showDemo ? "demo" : step;

  // Focus lands after the step it targets has rendered.
  useEffect(() => {
    if (!focusRequest) return;
    const el = {
      contact: contactInputRef.current,
      otp: otpInputRef.current,
      cta: codeCtaRef.current,
      welcome: welcomeHeadingRef.current,
    }[focusRequest.target];
    el?.focus({ preventScroll: true });
    if (focusRequest.target === "contact" && el instanceof HTMLInputElement) el.select();
  }, [focusRequest]);

  const holdIdentity = () => {
    releaseHoldRef.current ??= holdIdentityTransition();
  };
  const releaseIdentity = () => {
    releaseHoldRef.current?.();
    releaseHoldRef.current = null;
  };

  useEffect(
    () => () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      releaseHoldRef.current?.();
      releaseHoldRef.current = null;
    },
    [],
  );

  // Resumed after the sign-in remount: already unlocked, just continue on.
  const { enter } = auth;
  useEffect(() => {
    if (!handoff) return;
    clearGateHandoff();
    enter();
  }, [handoff, enter]);

  /* ---------- Ring mirrors the code step ---------- */

  const codeVisible = view === "code";
  const expired = codeVisible && auth.otpExpired;
  useEffect(() => {
    sceneRef.current?.setLit(codeVisible && !expired ? auth.otp.length : 0);
  }, [sceneRef, codeVisible, expired, auth.otp.length]);

  useEffect(() => {
    if (codeVisible) sceneRef.current?.setTimeLeft(auth.otpRemainingMs / OTP_TTL_MS);
  }, [sceneRef, codeVisible, auth.otpRemainingMs]);

  // On the details step each finished field lights a pair of dial segments.
  const profileProgress =
    view === "profile"
      ? (auth.fullName.trim().length >= 2 ? 2 : 0) +
        (auth.profilePhone.replace(/\D/g, "").length >= 8 ? 2 : 0) +
        (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(auth.profileEmail.trim()) ? 2 : 0)
      : 0;
  useEffect(() => {
    if (view === "profile") sceneRef.current?.setLit(profileProgress);
  }, [sceneRef, view, profileProgress]);

  const { setOtp, setNote } = auth;
  useEffect(() => {
    if (!codeVisible) return;
    sceneRef.current?.setExpired(expired);
    if (!expired || phaseRef.current !== "idle") return;
    setOtp("");
    setNote({ text: "This code has expired. Send a new code to continue.", error: true });
    announce("This code has expired.");
    focusSoon("cta");
  }, [sceneRef, codeVisible, expired, setOtp, setNote, announce]);

  /* ---------- Sequences ---------- */

  async function handleSend() {
    const scene = sceneRef.current;
    if (!scene || phaseRef.current !== "idle") return;
    const problem = contactProblem(auth.channel, auth.dialCode, auth.phone, auth.email);
    if (problem) {
      auth.setNote({ text: problem, error: true });
      focusSoon("contact");
      return;
    }

    setPhase("sending");
    scene.leaveColumn();
    const walk = scene.walkToCode(); // Coey walks up and docks the ball
    const sent = await auth.sendCode();
    if (!sent) {
      await scene.backToContact(900); // back to the same pose, error in place
      scene.returnColumn();
      setPhase("idle");
      focusSoon("contact");
      announce("We could not send the code.");
      return;
    }
    await walk;
    scene.returnColumn();
    setRejected(false);
    setStep("code");
    scene.showRing();
    setPhase("idle");
    focusSoon("otp");
    announce("Code sent. Enter the 6-digit code.");
  }

  function handleCodeChange(code: string) {
    auth.setOtp(code);
    if (rejected) {
      setRejected(false);
      sceneRef.current?.clearError();
      auth.setNote(null);
    }
  }

  async function handleVerify(code: string) {
    const scene = sceneRef.current;
    if (!scene || phaseRef.current !== "idle") return;
    if (code.length < 6) {
      auth.setNote({ text: "Enter all 6 digits.", error: true });
      focusSoon("otp");
      return;
    }

    setPhase("verifying");
    announce("Verifying your code.");
    holdIdentity(); // keep this gate mounted when the session lands
    scene.charge();
    const glow = scene.glow(); // the dock lights up
    const outcome = await auth.verifyCode(code);

    if (outcome === "ready") {
      await glow;
      await unlock();
      return;
    }
    if (outcome === "profile") {
      await glow;
      scene.holdForProfile();
      setPhase("idle");
      announce("Signed in. Add your details to finish.");
      return;
    }
    releaseIdentity();
    scene.reject();
    setRejected(true);
    setPhase("returning");
    try {
      navigator.vibrate?.([20, 40, 20]);
    } catch {
      // Vibration is optional.
    }
    await scene.backToCode(500); // back to the holding pose; the note explains why
    setPhase("idle");
    focusSoon("otp");
  }

  async function handleResend() {
    if (phaseRef.current !== "idle") return;
    setPhase("resending");
    const sent = await auth.sendCode({ resend: true });
    setPhase("idle");
    if (!sent) return;
    sceneRef.current?.setExpired(false);
    setRejected(false);
    focusSoon("otp");
    announce("We sent a new code.");
  }

  async function handleChangeContact() {
    const scene = sceneRef.current;
    if (!scene || phaseRef.current !== "idle") return;
    setPhase("returning");
    scene.hideRing();
    scene.leaveColumn();
    await scene.backToContact(900); // Coey steps back
    scene.returnColumn();
    auth.changeContact();
    setRejected(false);
    setStep("contact");
    setPhase("idle");
    focusSoon("contact");
  }

  async function handleSaveProfile() {
    if (phaseRef.current !== "idle") return;
    const saved = await auth.saveProfile();
    if (saved) await unlock();
  }

  /**
   * Leaves the gate: navigate, record the handoff, then let
   * IdentityBoundary run its deferred identity swap.
   */
  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    setGateHandoff({ frame: sceneRef.current?.captureFrame() ?? null, welcomeName: welcomeNameRef.current });
    auth.enter();
    releaseIdentity();
  }

  async function unlock() {
    const scene = sceneRef.current;
    if (!scene) {
      finish();
      return;
    }
    setPhase("unlocking");
    announce("Code accepted. Opening your space.");
    // Retrieve the ball, push, and glide the gate open.
    await scene.unlock(() => setWelcome("shown"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    setWelcome("settled");
    focusSoon("welcome");
    announce("You're in. Your space is unlocked.");
    enterTimerRef.current = setTimeout(finish, ENTER_DELAY_MS);
  }

  const fixedCode = auth.channel === "phone" && auth.phoneAvailable ? localFixedOtp() : null;
  const welcomeName = (handoff?.welcomeName ?? auth.welcomeName).split(" ")[0];

  return (
    <div ref={refs.root} className="kg" data-reduce-motion={reduceMotion ? "true" : "false"}>
      <GateStage refs={refs} poster={handoff?.frame} />

      <p className="kg-brand">KATALIST</p>

      <main
        ref={refs.column}
        className="kg-col"
        hidden={welcome !== "hidden"}
        data-tall={view === "profile" || view === "demo" ? "true" : "false"}
      >
        {view === "profile" ? (
          <ProfileStep auth={auth} saving={auth.profileSaving} onSubmit={() => void handleSaveProfile()} />
        ) : view === "demo" ? (
          <DemoStep auth={auth} onUseOtp={() => setShowDemo(false)} />
        ) : view === "code" ? (
          <CodeStep
            auth={auth}
            verifying={phase === "verifying" || phase === "unlocking"}
            verificationPending={phase === "verifying"}
            recovering={phase === "returning"}
            rejected={rejected}
            inputRef={otpInputRef}
            ctaRef={codeCtaRef}
            onCodeChange={handleCodeChange}
            onSubmit={(code) => void handleVerify(code)}
            onResend={() => void handleResend()}
            onChangeContact={() => void handleChangeContact()}
          />
        ) : (
          <ContactStep
            auth={auth}
            sending={phase === "sending"}
            inputRef={contactInputRef}
            onSubmit={() => void handleSend()}
            onShowDemo={demoEnabled() ? () => setShowDemo(true) : undefined}
          />
        )}

        {view === "contact" || view === "demo" ? (
          <div className="kg-foot">
            {fixedCode ? (
              <p>
                Test mode. Code <b>{fixedCode}</b> unlocks.
              </p>
            ) : null}
            <p>
              New to Katalist? <Link to="/welcome">Take the tour</Link>
            </p>
            <p>By continuing, you agree to our Terms of Service and Privacy Policy.</p>
          </div>
        ) : view === "code" && fixedCode ? (
          <div className="kg-foot">
            <p>
              Test mode. Code <b>{fixedCode}</b> unlocks.
            </p>
          </div>
        ) : null}
      </main>

      <section
        ref={refs.welcome}
        className={welcome === "settled" ? "kg-welcome is-settled" : "kg-welcome"}
        aria-labelledby="kg-h-done"
        hidden={welcome === "hidden"}
      >
        <h1 id="kg-h-done" ref={welcomeHeadingRef} className="kg-title" tabIndex={-1}>
          You&apos;re in.
        </h1>
        <div className="kg-after">
          <p>{welcomeName ? `Your space is unlocked. Welcome in, ${welcomeName}.` : "Your space is unlocked. Welcome in."}</p>
          <GateButton type="button" label="Open Katalist" onClick={finish} />
        </div>
      </section>

      <div className="kg-sr-only" aria-live="polite">
        {liveMessage}
      </div>
    </div>
  );
}
