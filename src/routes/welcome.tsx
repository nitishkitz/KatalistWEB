import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { Logo } from "@/components/katalist/Logo";
import { AuthHeroPanel } from "@/components/katalist/AuthHeroPanel";
import { demoEnabled } from "@/lib/session-mode";

import catMovement from "@/assets/auth/cat-movement.png";
import catCollaborate from "@/assets/auth/cat-collaborate.png";
import catLists from "@/assets/auth/cat-lists.png";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to Katalist — Life, Sorted." },
      {
        name: "description",
        content:
          "Move things forward instead of letting them pile up. Take the Katalist tour and get started in seconds.",
      },
      { property: "og:title", content: "Welcome to Katalist — Life, Sorted." },
      {
        property: "og:description",
        content:
          "Organize what matters, keep momentum, and let gentle nudges bring the right things back at the right time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WelcomePage,
});

type Step = {
  title: string;
  body: string;
  image: string;
};

const STEPS: Step[] = [
  {
    title: "Movement, Not Storage",
    body: "Katalist helps you move things forward instead of letting them pile up.",
    image: catMovement,
  },
  {
    title: "Catch, toss, and collaborate.",
    body: "Work with your team through conversation, Calls, nudges, and shared ownership.",
    image: catCollaborate,
  },
  {
    title: "Lists, Buckets, and Nudges.",
    body: "Organize what matters, keep momentum, and let gentle nudges bring the right things back at the right time.",
    image: catLists,
  },
];

// The splash screen auto-advances into the carousel rather than living
// behind its own route -- it's a brand beat, not a distinct destination.
const SPLASH_DURATION_MS = 1400;

function SplashPanel({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <button
      type="button"
      onClick={onDone}
      aria-label="Continue to Katalist"
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center overflow-hidden border-0 bg-[#140b2e] p-0"
    >
      <AuthHeroPanel variant="fullscreen" className="h-full w-full" />
      <div className="absolute bottom-16 flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("h-1.5 w-1.5 rounded-full", i === 1 ? "bg-white" : "bg-white/30")}
          />
        ))}
      </div>
    </button>
  );
}

function WelcomePage() {
  const [phase, setPhase] = useState<"splash" | "carousel">("splash");
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/", replace: true });
    }
  }, [loading, session, navigate]);

  if (phase === "splash") {
    return <SplashPanel onDone={() => setPhase("carousel")} />;
  }

  const step = STEPS[index]!;
  const isLast = index === STEPS.length - 1;

  return (
    <div className="grid h-[100dvh] overflow-hidden lg:grid-cols-2">
      <AuthHeroPanel />

      <div className="flex min-h-0 flex-col overflow-hidden bg-[#fefefe] px-6 py-5 sm:px-12 sm:py-6">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="lg:hidden">
            <Logo />
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <img
            src={step.image}
            alt=""
            className="h-auto max-h-[min(42vh,360px)] w-full max-w-sm object-contain"
          />

          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-foreground sm:mt-6 sm:text-4xl">
            {step.title}
          </h1>
          <p className="mt-2 max-w-md text-base font-medium text-foreground/70 sm:mt-3">
            {step.body}
          </p>

          <div className="mt-4 flex items-center gap-2 sm:mt-6">
            {STEPS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  i <= index ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3 pb-1 sm:pb-3">
          <div className="flex w-full max-w-md items-center gap-3">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => (isLast ? setIndex(index - 1) : navigate({ to: "/auth" }))}
            >
              {isLast ? (
                <>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Back
                </>
              ) : (
                "Skip"
              )}
            </Button>
            <Button
              size="lg"
              className="flex-1"
              onClick={() => (isLast ? navigate({ to: "/auth" }) : setIndex(index + 1))}
            >
              {isLast ? "Enter Katalist" : "Next"}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>

          {demoEnabled() && (
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/auth" })}>
              Enter with a demo account
            </Button>
          )}

          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/auth" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
