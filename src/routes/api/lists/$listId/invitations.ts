import { createFileRoute } from "@tanstack/react-router";
import { createListInvitation } from "@/features/lists/server/list-invitations";

export const Route = createFileRoute("/api/lists/$listId/invitations")({ server: { handlers: { POST: ({ request, params }) => createListInvitation(request, params.listId) } } });
