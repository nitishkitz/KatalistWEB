import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type React from "react";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  Layers,
  Mic,
  Sparkles,
  Star,
  Trophy,
  Users,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { Logo } from "@/components/katalist/Logo";
import katalistMark from "@/assets/katalist-mark.png.asset.json";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to Katalist — Life, Sorted." },
      {
        name: "description",
        content:
          "Capture anything, organize everything, and move forward together. Take the Katalist tour and get started in seconds.",
      },
      { property: "og:title", content: "Welcome to Katalist — Life, Sorted." },
      {
        property: "og:description",
        content:
          "Capture anything, organize everything, and move forward together with Katalist.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WelcomePage,
});

type Step = {
  title: string;
  accent: string;
  body: string;
  bullets: { icon: typeof Sparkles; label: string }[];
  visual: () => React.ReactElement;
};

function MagicBoxVisual() {
  return (
    <div className="w-full rounded-2xl border border-border bg-card p-4 katalist-shadow">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" /> Magic Box
      </div>
      <div className="rounded-xl border border-border bg-background p-3">
        <p className="text-sm text-muted-foreground">Toss a thought...</p>
        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-2 text-xs text-muted-foreground">
            {["#", "@", "!!", "☰"].map((s) => (
              <span
                key={s}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card"
              >
                {s}
              </span>
            ))}
          </div>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
      <p className="mt-4 mb-2 text-xs font-semibold text-foreground">Suggestions</p>
      <div className="space-y-2">
        {[
          ["# Product", "Roadmap for Q3"],
          ["@ Rahul", "Review landing page copy"],
          ["# Marketing", "Create campaign brief"],
        ].map(([tag, text]) => (
          <div
            key={text}
            className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-xs"
          >
            <span className="text-muted-foreground">{tag}</span>
            <span className="text-foreground">{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrganizeVisual() {
  const buckets = [
    ["Product", "12 things"],
    ["Design", "8 things"],
    ["Marketing", "15 things"],
    ["Personal", "6 things"],
  ];
  const court = [
    ["NOW", "5", "text-status-now"],
    ["NEXT", "8", "text-status-next"],
    ["LATER", "12", "text-status-later"],
  ];
  return (
    <div className="w-full rounded-2xl border border-border bg-card p-4 katalist-shadow">
      <p className="mb-2 text-xs font-semibold text-foreground">Buckets</p>
      <div className="space-y-1.5">
        {buckets.map(([name, count]) => (
          <div
            key={name}
            className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-xs"
          >
            <span className="font-medium text-foreground"># {name}</span>
            <span className="text-muted-foreground">{count}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 mb-2 text-xs font-semibold text-foreground">Court</p>
      <div className="space-y-1.5">
        {court.map(([label, count, color]) => (
          <div
            key={label}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"
          >
            <span className={cn("font-semibold", color)}>{label}</span>
            <span className="text-muted-foreground">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NudgeVisual() {
  const rows = [
    ["Overdue things", "3", "text-status-now"],
    ["Due today", "5", "text-status-caught"],
    ["Waiting for others", "4", "text-status-waiting"],
    ["Low activity", "2", "text-status-later"],
  ];
  return (
    <div className="w-full rounded-2xl border border-border bg-card p-4 katalist-shadow">
      <p className="mb-3 text-xs font-semibold text-foreground">Nudges</p>
      <div className="space-y-1.5">
        {rows.map(([label, count, color]) => (
          <div
            key={label}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-xs"
          >
            <span className="flex items-center gap-2 text-foreground">
              <Clock className={cn("h-3.5 w-3.5", color)} />
              {label}
            </span>
            <span className="text-muted-foreground">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CollaborateVisual() {
  return (
    <div className="w-full rounded-2xl border border-border bg-card p-4 katalist-shadow">
      <p className="text-xs text-muted-foreground"># Product</p>
      <p className="mt-1 text-sm font-semibold text-foreground">Finalize landing page</p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Assignee</p>
          <p className="mt-1 font-medium text-foreground">Rahul</p>
        </div>
        <div>
          <p className="text-muted-foreground">Due date</p>
          <p className="mt-1 font-medium text-foreground">May 24</p>
        </div>
      </div>
      <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
        {[
          ["Rahul", "Looks good!"],
          ["Sai", "Can we update the hero image?"],
          ["Arjun", "Updated the copy."],
        ].map(([who = "", msg]) => (
          <div key={msg} className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">
              {who.charAt(0)}
            </span>
            <span className="font-medium text-foreground">{who}</span>
            <span className="text-muted-foreground">{msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CelebrateVisual() {
  return (
    <div className="w-full rounded-2xl border border-border bg-card p-4 katalist-shadow">
      <p className="mb-3 text-xs font-semibold text-foreground">Trophy Room</p>
      <div className="flex items-center justify-between rounded-xl bg-primary p-4 text-primary-foreground">
        <div>
          <p className="text-sm font-semibold">On a roll!</p>
          <p className="text-xs opacity-80">7 day streak</p>
        </div>
        <Trophy className="h-8 w-8" />
      </div>
      <p className="mt-4 mb-2 text-xs font-semibold text-foreground">Recent unlocks</p>
      <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
        {["Early Bird", "Planner", "Team Player"].map((t) => (
          <div key={t} className="rounded-lg border border-border px-2 py-3">
            <Star className="mx-auto mb-1 h-4 w-4 text-primary" />
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function WelcomeVisual() {
  return (
    <div className="flex w-full items-center justify-center">
      <img src={katalistMark.url} alt="Katalist" className="h-40 w-40 opacity-90" />
    </div>
  );
}

const STEPS: Step[] = [
  {
    title: "Welcome to",
    accent: "Katalist",
    body: "Your home for things, ideas, and teamwork. Capture anything, organize everything, and move forward together.",
    bullets: [],
    visual: WelcomeVisual,
  },
  {
    title: "Capture",
    accent: "anything",
    body: "Use the Magic Box to turn thoughts, notes, links, and messages into actionable things in seconds.",
    bullets: [
      { icon: Mic, label: "Type, speak, or paste" },
      { icon: Wand2, label: "Auto-parse with smart suggestions" },
      { icon: CheckCircle2, label: "Instantly into the right place" },
    ],
    visual: MagicBoxVisual,
  },
  {
    title: "Organize",
    accent: "what matters",
    body: "Everything has a place. Buckets, Lists, and Court help you stay focused and in control.",
    bullets: [
      { icon: Layers, label: "Buckets to group by topic" },
      { icon: Layers, label: "Lists to break it down" },
      { icon: Sparkles, label: "Court to focus on what's next" },
    ],
    visual: OrganizeVisual,
  },
  {
    title: "Nudge",
    accent: "smarter",
    body: "Auto-Nudge brings what needs your attention to the top — so nothing important slips through.",
    bullets: [
      { icon: Sparkles, label: "Smart prioritization" },
      { icon: Bell, label: "Timely reminders" },
      { icon: CheckCircle2, label: "Stay on track, effortlessly" },
    ],
    visual: NudgeVisual,
  },
  {
    title: "Collaborate",
    accent: "together",
    body: "Assign, share, comment, and move things forward as a team.",
    bullets: [
      { icon: Users, label: "Assign to teammates" },
      { icon: Sparkles, label: "Real-time updates" },
      { icon: CheckCircle2, label: "Everything in one place" },
    ],
    visual: CollaborateVisual,
  },
  {
    title: "Celebrate",
    accent: "progress",
    body: "Track wins, earn trophies, and celebrate every step forward. Big or small.",
    bullets: [
      { icon: Trophy, label: "Trophy room" },
      { icon: Layers, label: "Personal & team progress" },
      { icon: Star, label: "Built-in motivation" },
    ],
    visual: CelebrateVisual,
  },
];

function WelcomePage() {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/", replace: true });
    }
  }, [loading, session, navigate]);

  const step = STEPS[index]!;
  const Visual = step.visual;
  const isLast = index === STEPS.length - 1;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <div className="flex items-center justify-between">
          <Logo />
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            {index + 1} / {STEPS.length}
          </span>
        </div>

        <div className="grid flex-1 items-center gap-12 py-12 md:grid-cols-2">
          <div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
              {step.title}
              <br />
              <span className="text-primary">{step.accent}</span>
            </h1>
            {index === 0 && (
              <p className="mt-3 text-base font-medium text-primary">Life, Sorted.</p>
            )}
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </p>

            {step.bullets.length > 0 && (
              <ul className="mt-6 space-y-3">
                {step.bullets.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-3 text-sm text-foreground">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
                      <Icon className="h-4 w-4 text-primary" />
                    </span>
                    {label}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-8 flex items-center gap-3">
              <Button
                size="lg"
                onClick={() => (isLast ? navigate({ to: "/auth" }) : setIndex(index + 1))}
              >
                {index === 0 ? "Get Started" : isLast ? "Create your account" : "Next"}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              {!isLast && (
                <Button variant="ghost" size="lg" onClick={() => navigate({ to: "/auth" })}>
                  Skip
                </Button>
              )}
            </div>

            <p className="mt-6 text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/auth" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>

          <div className="flex justify-center">
            <div className="w-full max-w-sm">
              <Visual />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 pb-4">
          {STEPS.map((s, i) => (
            <button
              key={s.accent}
              aria-label={`Go to step ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-6 bg-primary" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
