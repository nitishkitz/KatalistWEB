import { createFileRoute } from "@tanstack/react-router";

// The person's own reviewed words become a Thing, linked to a registered source. Every check runs in one database function.
export const Route = createFileRoute("/api/code-activity/workspace-confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const thing = await import("@/features/code-activity/server/thing.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const b = await http.readJson(request);
        return http.toResponse(
          await thing.confirmWorkspaceThing({
            user: authed.user,
            listId: b.listId,
            sourceId: b.sourceId,
            key: b.key,
            title: b.title,
            notes: b.notes,
            assigneeActorId: b.assigneeActorId,
            dueAt: b.dueAt,
            importance: b.importance,
            reviewedSha: b.reviewedSha,
            acknowledgeSourceChange: b.acknowledgeSourceChange,
          }),
        );
      },
    },
  },
});
