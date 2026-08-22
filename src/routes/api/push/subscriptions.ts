import { createFileRoute } from "@tanstack/react-router";
import { createPushSubscriptionHandler } from "@/features/notifications/push-subscriptions.server";

const handle = createPushSubscriptionHandler();

export const Route = createFileRoute("/api/push/subscriptions")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      DELETE: async ({ request }) => handle(request),
    },
  },
});
