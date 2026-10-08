import { createFileRoute } from "@tanstack/react-router";

// Registers the commit or pull request a Thing is about to be created from, after reading it from GitHub for this List.
export const Route = createFileRoute("/api/code-activity/workspace-source")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const workspace = await import("@/features/code-activity/server/workspace.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const b = await http.readJson(request);
        return http.toResponse(await workspace.registerSource(await http.buildDeps(), { user: authed.user, listId: typeof b.listId === "string" ? b.listId : "", kind: b.kind, key: b.key }));
      },
    },
  },
});
