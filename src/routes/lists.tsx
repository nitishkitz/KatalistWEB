import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/katalist/EmptyState";

export const Route = createFileRoute("/lists")({
  head: () => ({
    meta: [
      { title: "Lists — Katalist" },
      { name: "description", content: "Shared collaboration rooms for your things." },
    ],
  }),
  component: ListsPage,
});

function ListsPage() {
  return (
    <AppShell
      title="Lists"
      subtitle="Shared collaboration rooms"
    >
      <EmptyState
        title="No lists yet"
        description="Create a list to share work with others."
      />
    </AppShell>
  );
}
