import { createFileRoute } from "@tanstack/react-router";

// E7. Saved activity for members of an enabled List. The database function applies the membership and flag checks.
export const Route = createFileRoute("/api/code-activity/feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const activity = await import("@/features/code-activity/server/activity.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const params = new URL(request.url).searchParams;
        return http.toResponse(await activity.feed({ user: authed.user, listId: params.get("listId") ?? "", cursor: params.get("cursor") }));
      },
    },
  },
});
