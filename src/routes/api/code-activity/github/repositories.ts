import { createFileRoute } from "@tanstack/react-router";

// E16. Caller- and List-bound verified selections only; never global installations.
export const Route = createFileRoute("/api/code-activity/github/repositories")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const service = await import("@/features/code-activity/server/service.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const params = new URL(request.url).searchParams;
        return http.toResponse(
          await service.listRepositories({
            user: authed.user,
            listId: params.get("listId") ?? "",
            cookieHeader: request.headers.get("cookie"),
            after: params.get("cursor"),
            limit: Number(params.get("limit") ?? 50),
          }),
        );
      },
    },
  },
});
