import { createFileRoute } from "@tanstack/react-router";
import { createRemoveAttachmentHandler, createSupabaseAttachmentDeps } from "@/features/attachments/attachment-api.server";

export const Route = createFileRoute("/api/magic-box/attachments/remove")({
  server: {
    handlers: {
      POST: async ({ request }) => createRemoveAttachmentHandler(createSupabaseAttachmentDeps(request))(request),
    },
  },
});
