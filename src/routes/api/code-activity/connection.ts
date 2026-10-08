import { createFileRoute } from "@tanstack/react-router";

// E17 status, E4 connect a verified selection, E5 disconnect. Owner checks live in the database functions.
export const Route = createFileRoute("/api/code-activity/connection")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const service = await import("@/features/code-activity/server/service.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const listId = new URL(request.url).searchParams.get("listId") ?? "";
        return http.toResponse(await service.connectionStatus({ user: authed.user, listId }));
      },
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const service = await import("@/features/code-activity/server/service.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const body = await http.readJson(request);
        // The body never carries a nonce or hash: the service derives it from the HttpOnly cookie.
        return http.toResponse(
          await service.connect(await http.buildDeps(), {
            userId: authed.userId,
            user: authed.user,
            listId: String(body.listId ?? ""),
            proofId: String(body.proofId ?? ""),
            acknowledged: body.sharingAcknowledged,
            cookieHeader: request.headers.get("cookie"),
          }),
        );
      },
      DELETE: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const service = await import("@/features/code-activity/server/service.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const body = await http.readJson(request);
        return http.toResponse(await service.disconnect({ user: authed.user, listId: String(body.listId ?? ""), confirm: body.confirm }));
      },
    },
  },
});
