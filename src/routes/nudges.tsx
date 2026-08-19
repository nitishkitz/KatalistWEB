import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/katalist/EmptyState";

export const Route = createFileRoute("/nudges")({
  head: () => ({
    meta: [
      { title: "Nudges — Katalist" },
      { name: "description", content: "Gentle follow-up, without the awkwardness." },
    ],
  }),
  component: NudgesPage,
});

function NudgesPage() {
  return (
    <AppShell
      title="Nudges"
      subtitle="Gentle follow-up"
    >
      <EmptyState
        title="No nudges yet"
        description="When something needs a nudge, it'll appear here."
      />
    </AppShell>
  );
}
