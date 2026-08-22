import { createFileRoute } from "@tanstack/react-router";
import { createUatRequestHandler } from "@/lib/auth/uat-auth.server";

const handleRequest = createUatRequestHandler();

export const Route = createFileRoute("/api/uat-auth/request")({
  server: {
    handlers: {
      POST: async ({ request }) => handleRequest(request),
    },
  },
});
