import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/AppShell";
import { SectionCard } from "@/components/katalist/SectionCard";
import { EmptyState } from "@/components/katalist/EmptyState";
import { StatusPill } from "@/components/katalist/StatusPill";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Court — Katalist" },
      { name: "description", content: "What needs your attention today." },
    ],
  }),
  component: CourtPage,
});

function CourtPage() {
  return (
    <AppShell
      title="Court"
      subtitle="What needs your attention"
    >
      {/* Quick capture placeholder */}
      <SectionCard className="mb-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Sparkles className="h-5 w-5 text-primary" />
          <span className="text-sm">Toss a thought...</span>
        </div>
      </SectionCard>

      {/* Status tokens demo */}
      <div className="mb-6 flex flex-wrap gap-2">
        <StatusPill variant="now">NOW</StatusPill>
        <StatusPill variant="next">NEXT</StatusPill>
        <StatusPill variant="later">LATER</StatusPill>
        <StatusPill variant="waiting">WAITING</StatusPill>
        <StatusPill variant="caught">Caught</StatusPill>
        <StatusPill variant="neutral">Not Started</StatusPill>
      </div>

      <EmptyState
        title="Your Court is clear"
        description="Toss something when you're ready."
      />
    </AppShell>
  );
}
