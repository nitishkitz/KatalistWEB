import { createFileRoute } from "@tanstack/react-router";
import { createMagicBoxCoeyHandler } from "@/features/ai/magic-box-api.server";

const handle = createMagicBoxCoeyHandler();

export const Route = createFileRoute("/api/magic-box/coey")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
