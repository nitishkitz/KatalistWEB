import { createFileRoute } from "@tanstack/react-router";
import { createMagicBoxCorrectHandler } from "@/features/ai/magic-box-api.server";

const handle = createMagicBoxCorrectHandler();

export const Route = createFileRoute("/api/magic-box/correct")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
