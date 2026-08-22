import { createFileRoute } from "@tanstack/react-router";
import { createDrainHandler } from "@/features/notifications/push-worker.server";

const handle = createDrainHandler();

export const Route = createFileRoute("/api/internal/notifications/drain")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
