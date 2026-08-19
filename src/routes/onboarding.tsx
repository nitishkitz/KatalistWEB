import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/katalist/Logo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

const STEPS = [
  {
    kicker: "1/6",
    title: "Welcome to Katalist",
    body: "Life, Sorted. Movement, not storage.",
  },
  {
    kicker: "2/6",
    title: "Capture anything",
    body: "Toss a thought into Magic Box. It becomes one Thing.",
  },
  {
    kicker: "3/6",
    title: "Organize what matters",
    body: "Court is live work. Lists are rooms. Buckets are private lenses.",
  },
  {
    kicker: "4/6",
    title: "Nudge smarter",
    body: "Coey follows up without the awkward chase.",
  },
  {
    kicker: "5/6",
    title: "Collaborate together",
    body: "Creator, Owner, and Assignee stay distinct. Comments live on the Thing.",
  },
  {
    kicker: "6/6",
    title: "Celebrate progress",
    body: "Trophy is personal movement only. No leaderboards.",
  },
];

function OnboardingPage() {
  const [i, setI] = useState(0);
  const [contacts, setContacts] = useState(false);
  const navigate = useNavigate();
  const step = STEPS[i];

  if (contacts) {
    return (
      <div className="min-h-screen bg-background px-6 py-10">
        <Logo />
        <div className="mx-auto mt-16 max-w-md">
          <p className="text-[12px] text-muted-foreground">Coey</p>
          <h1 className="mt-2 text-2xl font-semibold">I need your contacts to find your team.</h1>
          <p className="mt-3 text-[14px] text-muted-foreground">
            Used only to match people you already work with. Not sold. Not scraped into a network graph.
          </p>
          <div className="mt-8 flex gap-2">
            <button
              type="button"
              className="h-10 rounded-lg bg-primary px-4 text-[13px] text-primary-foreground"
              onClick={() => navigate({ to: "/", replace: true })}
            >
              Connect
            </button>
            <button
              type="button"
              className="h-10 rounded-lg border border-border px-4 text-[13px]"
              onClick={() => navigate({ to: "/", replace: true })}
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Logo />
        <span className="text-[13px] text-muted-foreground">{step.kicker}</span>
      </div>
      <div className="mx-auto mt-16 grid max-w-5xl gap-10 lg:grid-cols-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{step.title}</h1>
          <p className="mt-3 max-w-sm text-[15px] text-muted-foreground">{step.body}</p>
          <div className="mt-10 flex items-center gap-3">
            <button
              type="button"
              className="h-10 rounded-lg bg-primary px-4 text-[13px] text-primary-foreground"
              onClick={() => {
                if (i === STEPS.length - 1) setContacts(true);
                else setI((n) => n + 1);
              }}
            >
              {i === STEPS.length - 1 ? "Get started" : "Continue"}
            </button>
            {i > 0 ? (
              <button type="button" className="text-[13px] text-muted-foreground" onClick={() => setI((n) => n - 1)}>
                Back
              </button>
            ) : null}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[12px] font-medium text-muted-foreground">Product preview</p>
          <div className="mt-4 h-56 rounded-xl border border-dashed border-border bg-background" />
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-5xl justify-center gap-1.5">
        {STEPS.map((_, idx) => (
          <span
            key={idx}
            className={cn("h-1.5 w-6 rounded-full", idx === i ? "bg-primary" : "bg-muted")}
          />
        ))}
      </div>
    </div>
  );
}
