import { createFileRoute } from "@tanstack/react-router";
import { acceptListInvitation } from "@/features/lists/server/list-invitations";

export const Route = createFileRoute("/api/list-invitations/accept")({ server: { handlers: { POST: ({ request }) => acceptListInvitation(request) } } });
