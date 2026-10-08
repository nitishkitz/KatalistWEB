import { createFileRoute } from "@tanstack/react-router";

// E6. The owner turns private-content (AI) processing on or off for this List. Off by default; connecting never sets it.
export const Route = createFileRoute("/api/code-activity/consent")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const ai = await import("@/features/code-activity/server/ai.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const b = await http.readJson(request);
        return http.toResponse(await ai.setConsent({ user: authed.user, listId: String(b.listId ?? ""), enabled: b.enabled }));
      },
    },
  },
});
