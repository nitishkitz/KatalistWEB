import { createFileRoute } from "@tanstack/react-router";

// E3. Browser navigation from GitHub: no Bearer header. Identity comes from the single-use state plus the
// HttpOnly nonce cookie. Redirects only to a fixed in-app path for the List bound in the state.
export const Route = createFileRoute("/api/code-activity/github/authorize/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const service = await import("@/features/code-activity/server/service.server");
        const params = new URL(request.url).searchParams;
        return http.toResponse(
          await service.handleCallback(await http.buildDeps(), {
            query: { code: params.get("code"), state: params.get("state"), error: params.get("error") },
            cookieHeader: request.headers.get("cookie"),
          }),
        );
      },
    },
  },
});
