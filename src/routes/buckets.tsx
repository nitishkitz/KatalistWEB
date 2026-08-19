import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/katalist/EmptyState";

export const Route = createFileRoute("/buckets")({
  head: () => ({
    meta: [
      { title: "Buckets — Katalist" },
      { name: "description", content: "Your private focus spaces." },
    ],
  }),
  component: BucketsPage,
});

function BucketsPage() {
  return (
    <AppShell
      title="Buckets"
      subtitle="Your private focus spaces"
    >
      <EmptyState
        title="No buckets yet"
        description="Create a bucket to privately organize your things."
      />
    </AppShell>
  );
}
