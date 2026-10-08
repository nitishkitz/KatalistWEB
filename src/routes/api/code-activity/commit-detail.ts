import { createFileRoute } from "@tanstack/react-router";

// Workspace read: commit-detail. Authorized in the database first, then read from GitHub with a metered, narrowed token.
export const Route = createFileRoute("/api/code-activity/commit-detail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const workspace = await import("@/features/code-activity/server/workspace.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const params = new URL(request.url).searchParams;
        return http.toResponse(
          await workspace.commitDetail(await http.buildDeps(), {
            user: authed.user,
            listId: params.get("listId") ?? "",
            sha: params.get("sha"),
          }),
        );
      },
    },
  },
});
