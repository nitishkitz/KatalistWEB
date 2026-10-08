import { createFileRoute } from "@tanstack/react-router";

// Workspace read: branches. Authorized in the database first, then read from GitHub with a metered, narrowed token.
export const Route = createFileRoute("/api/code-activity/branches")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const workspace = await import("@/features/code-activity/server/workspace.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const params = new URL(request.url).searchParams;
        return http.toResponse(
          await workspace.branches(await http.buildDeps(), {
            user: authed.user,
            listId: params.get("listId") ?? "",
            cursor: params.get("cursor"),
          }),
        );
      },
    },
  },
});
