import { createFileRoute } from "@tanstack/react-router";
import { createFinalizeAttachmentHandler, createSupabaseAttachmentDeps } from "@/features/attachments/attachment-api.server";

export const Route = createFileRoute("/api/magic-box/attachments/finalize")({
  server: {
    handlers: {
      POST: async ({ request }) => createFinalizeAttachmentHandler(createSupabaseAttachmentDeps(request))(request),
    },
  },
});
