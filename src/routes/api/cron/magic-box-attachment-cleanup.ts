import { createFileRoute } from "@tanstack/react-router";
import { createAttachmentCleanupHandler, createLiveCleanupDeps } from "@/features/attachments/attachment-api.server";

export const Route = createFileRoute("/api/cron/magic-box-attachment-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        createAttachmentCleanupHandler({
          getDeps: createLiveCleanupDeps,
        })(request),
    },
  },
});
