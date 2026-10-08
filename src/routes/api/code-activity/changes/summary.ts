import { createFileRoute } from "@tanstack/react-router";

// E10. Explicit user trigger only; same gates as drafting.
export const Route = createFileRoute("/api/code-activity/changes/summary")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const ai = await import("@/features/code-activity/server/ai.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const b = await http.readJson(request);
        return http.toResponse(await ai.summarize(await http.buildAiDeps(), { user: authed.user, listId: String(b.listId ?? ""), changeId: String(b.changeId ?? "") }));
      },
    },
  },
});
