import { createFileRoute } from "@tanstack/react-router";

import { AuthGate } from "@/features/auth/gate/AuthGate";
import { sanitizeRedirectTarget } from "@/lib/validate-redirect";

type AuthSearch = { redirect?: string };

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Katalist" },
      {
        name: "description",
        content:
          "Sign in to Katalist with a one-time code and pick up exactly where you left off.",
      },
      { name: "theme-color", content: "#E9D8C8" },
      { property: "og:title", content: "Sign in to Katalist" },
      {
        property: "og:description",
        content: "Sign in to Katalist with a one-time code.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // G01/G02: an unauthenticated direct link into a gated destination (e.g.
  // onboarding's "Find people" step, or a future deep link) is sent here
  // with its intended destination, so a successful sign-in returns the user
  // there instead of always landing on Court. `redirect` is re-validated on
  // read (sanitizeRedirectTarget), never trusted as-is.
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const { redirect } = Route.useSearch();
  return <AuthGate returnTo={sanitizeRedirectTarget(redirect, "/")} />;
}
