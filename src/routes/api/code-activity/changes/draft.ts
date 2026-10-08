import { createFileRoute } from "@tanstack/react-router";

// E11. Explicit user trigger only. The database checks role, flag, List consent and rate limit as the caller.
export const Route = createFileRoute("/api/code-activity/changes/draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const ai = await import("@/features/code-activity/server/ai.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const b = await http.readJson(request);
        return http.toResponse(
          await ai.generateDraft(await http.buildAiDeps(), { user: authed.user, listId: String(b.listId ?? ""), changeId: String(b.changeId ?? ""), note: typeof b.note === "string" ? b.note : "" }),
        );
      },
    },
  },
});
