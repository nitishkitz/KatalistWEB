import { createFileRoute } from "@tanstack/react-router";
import { createUatVerifyHandler } from "@/lib/auth/uat-auth.server";

const handleVerify = createUatVerifyHandler();

export const Route = createFileRoute("/api/uat-auth/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => handleVerify(request),
    },
  },
});
