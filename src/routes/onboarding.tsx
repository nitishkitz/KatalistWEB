import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/katalist/Logo";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { ImportanceBadge, PaceBadge } from "@/components/katalist/ImportanceBadge";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonCell } from "@/components/katalist/PersonCell";
import {
  loadOnboardingState,
  resolveOnboardingEntry,
  saveOnboardingState,
} from "@/features/onboarding/onboarding-state";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

// G01: three concrete steps -- capture, Court/Catch, optional discovery --
// replacing the prior six-step mandatory tour. The discovery step (index 2)
// is the only one that can be skipped without ending the whole flow early;
// steps 0-1 are the tour itself.
const STEPS = [
  {
    kicker: "1/3",
    title: "Capture anything",
    body: "Toss a thought into Magic Box. It becomes one Thing -- no forms, no setup.",
  },
  {
    kicker: "2/3",
    title: "Catch it in Court",
    body: "Court is where live work lives. Catch a Thing, set your pace, then mark it Sorted when it's handled.",
  },
] as const;

const DISCOVERY_KICKER = "3/3";

// G01: illustrative-only data for the preview panel below -- explicitly
// labeled as such (never presented as this person's real Things), built
// from the SAME badge/cell primitives Court itself uses (ImportanceBadge,
// PaceBadge, AcknowledgementBadge, WorkStatusBadge, PersonCell), not a new
// bespoke preview component.
const PREVIEW_PERSON = {
  id: "preview-person",
  name: "Priya Sharma",
  initials: "PS",
  avatarUrl: null,
};

function OnboardingPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const identityId = session?.user?.id ?? null;

  const [hydrated, setHydrated] = useState(false);
  const [i, setI] = useState(0);
  const [onDiscoveryStep, setOnDiscoveryStep] = useState(false);

  // G01: an unauthenticated direct/deep link into onboarding goes through
  // auth first and returns here -- never rendered unauthenticated (the
  // discovery step's "Find people" action has nowhere to send a request
  // from without a real identity).
  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ to: "/auth", search: { redirect: "/onboarding" }, replace: true });
      return;
    }
    if (!identityId || hydrated) return;
    const state = loadOnboardingState(window.localStorage, identityId);
    const entry = resolveOnboardingEntry(state, STEPS.length);
    if (entry.redirectHome) {
      // G01: a returning user who already finished onboarding never
      // replays it -- direct navigation here lands them back in Court.
      navigate({ to: "/", replace: true });
      return;
    }
    setI(entry.stepIndex);
    setOnDiscoveryStep(entry.onDiscoveryStep);
    setHydrated(true);
  }, [loading, session, identityId, hydrated, navigate]);

  if (loading || !session || !hydrated) {
    return (
      <div className="h-[100dvh] overflow-hidden bg-background px-6 py-6 sm:py-8">
        <Logo />
      </div>
    );
  }

  function persist(next: { step: number; completed: boolean; skipped: boolean }) {
    if (!identityId) return;
    saveOnboardingState(window.localStorage, identityId, next);
  }

  function finish() {
    persist({ step: STEPS.length, completed: true, skipped: false });
    navigate({ to: "/", replace: true });
  }

  function skip() {
    persist({ step: onDiscoveryStep ? STEPS.length : i, completed: false, skipped: true });
    navigate({ to: "/", replace: true });
  }

  if (onDiscoveryStep) {
    return (
      <div className="h-[100dvh] overflow-hidden bg-background px-6 py-6 sm:py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Logo />
          <span className="text-[13px] text-muted-foreground">{DISCOVERY_KICKER}</span>
        </div>
        <div className="mx-auto mt-[clamp(32px,10vh,64px)] max-w-md">
          <p className="text-[12px] text-muted-foreground">Coey</p>
          <h1 className="mt-2 text-2xl font-semibold">Find people you already work with</h1>
          <p className="mt-3 text-[14px] text-muted-foreground">
            Search your team and send contact requests inside Katalist. This does not read or import
            your phone or email address book.
          </p>
          <div className="mt-8 flex gap-2">
            <button
              type="button"
              className="h-10 rounded-lg bg-primary px-4 text-[13px] text-primary-foreground"
              onClick={() => {
                persist({ step: STEPS.length, completed: true, skipped: false });
                navigate({ to: "/team", search: { openContacts: true }, replace: true });
              }}
            >
              Find people
            </button>
            <button
              type="button"
              className="h-10 rounded-lg border border-border px-4 text-[13px]"
              onClick={finish}
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    );
  }

  const step = STEPS[i]!;
  const isLastTourStep = i === STEPS.length - 1;

  return (
    <div className="h-[100dvh] overflow-hidden bg-background px-6 py-6 sm:py-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Logo />
        <span className="text-[13px] text-muted-foreground">{step.kicker}</span>
      </div>
      <div className="mx-auto mt-[clamp(32px,10vh,64px)] grid max-w-5xl gap-6 lg:grid-cols-2 lg:gap-10">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{step.title}</h1>
          <p className="mt-3 max-w-sm text-[15px] text-muted-foreground">{step.body}</p>
          <div className="mt-6 flex items-center gap-3 sm:mt-8">
            <button
              type="button"
              className="h-10 rounded-lg bg-primary px-4 text-[13px] text-primary-foreground"
              onClick={() => {
                if (isLastTourStep) {
                  persist({ step: STEPS.length, completed: false, skipped: false });
                  setOnDiscoveryStep(true);
                } else {
                  const next = i + 1;
                  persist({ step: next, completed: false, skipped: false });
                  setI(next);
                }
              }}
            >
              Continue
            </button>
            {i > 0 ? (
              <button
                type="button"
                className="text-[13px] text-muted-foreground"
                onClick={() => {
                  const prev = i - 1;
                  persist({ step: prev, completed: false, skipped: false });
                  setI(prev);
                }}
              >
                Back
              </button>
            ) : null}
            <button type="button" className="text-[13px] text-muted-foreground" onClick={skip}>
              Skip
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[12px] font-medium text-muted-foreground">
            Product preview{" "}
            <span className="italic">(illustrative example, not your real data)</span>
          </p>
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
            <p className="text-[13px] font-medium text-foreground">Draft the Q3 proposal</p>
            <div className="flex flex-wrap gap-1.5">
              <ImportanceBadge value="now" />
              <PaceBadge value="next" />
              <AcknowledgementBadge value="waiting_for_catch" />
              <WorkStatusBadge value="under_progress" />
            </div>
            <div className="flex items-center justify-between">
              <PersonCell person={PREVIEW_PERSON} />
              <span className="text-[12px] text-muted-foreground">Q3 Planning</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-6 flex max-w-5xl justify-center gap-1.5 sm:mt-10">
        {[...STEPS, DISCOVERY_KICKER].map((_, idx) => (
          <span
            key={idx}
            className={cn("h-1.5 w-6 rounded-full", idx === i ? "bg-primary" : "bg-muted")}
          />
        ))}
      </div>
    </div>
  );
}
