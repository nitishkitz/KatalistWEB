import { createFileRoute } from "@tanstack/react-router";

// E8 and E9 combined: one change's description, files, patches and checks, read from GitHub after authorization.
export const Route = createFileRoute("/api/code-activity/changes/detail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const activity = await import("@/features/code-activity/server/activity.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const params = new URL(request.url).searchParams;
        return http.toResponse(
          await activity.changeDetail(await http.buildDeps(), {
            user: authed.user,
            listId: params.get("listId") ?? "",
            changeId: params.get("changeId") ?? "",
          }),
        );
      },
    },
  },
});
