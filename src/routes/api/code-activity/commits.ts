import { createFileRoute } from "@tanstack/react-router";

// Workspace read: commits. Authorized in the database first, then read from GitHub with a metered, narrowed token.
export const Route = createFileRoute("/api/code-activity/commits")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const workspace = await import("@/features/code-activity/server/workspace.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const params = new URL(request.url).searchParams;
        return http.toResponse(
          await workspace.commits(await http.buildDeps(), {
            user: authed.user,
            listId: params.get("listId") ?? "",
            branch: params.get("branch"),
            cursor: params.get("cursor"),
            author: params.get("author"),
            path: params.get("path"),
            since: params.get("since"),
            until: params.get("until"),
          }),
        );
      },
    },
  },
});
