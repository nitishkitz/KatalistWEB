import { createFileRoute } from "@tanstack/react-router";

// E2. Owner starts GitHub authorization (or installation). Sets the browser-binding nonce cookie.
export const Route = createFileRoute("/api/code-activity/github/authorize/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const service = await import("@/features/code-activity/server/service.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const body = await http.readJson(request);
        return http.toResponse(
          await service.startAuthorization(await http.buildDeps(), {
            user: authed.user,
            listId: String(body.listId ?? ""),
            flow: String(body.flow ?? "oauth"),
          }),
        );
      },
    },
  },
});
