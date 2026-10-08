import { createFileRoute } from "@tanstack/react-router";

// E12. The owner and current collaborators of the List, for owners and collaborators only.
export const Route = createFileRoute("/api/code-activity/assignee-candidates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const thing = await import("@/features/code-activity/server/thing.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        return http.toResponse(await thing.assigneeCandidates({ user: authed.user, listId: new URL(request.url).searchParams.get("listId") ?? "" }));
      },
    },
  },
});
