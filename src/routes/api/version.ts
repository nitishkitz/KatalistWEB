import { createFileRoute } from "@tanstack/react-router";

// Which commit this deployment was built from. No secrets, never cached.
export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async () =>
        new Response(
          JSON.stringify({
            commit: process.env.KATALIST_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
            deployment: process.env.VERCEL_DEPLOYMENT_ID || null,
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
        ),
    },
  },
});
