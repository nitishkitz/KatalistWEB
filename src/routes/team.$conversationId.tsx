import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAppContext } from "@/features/context/use-app-context";
import { useConversation } from "@/features/hub/use-conversations";
import { ConversationWorkspace, type HubTab } from "@/features/hub/components/ConversationWorkspace";

type TeamConversationSearch = {
  tab?: HubTab;
  start?: "call";
  /** "1" = join an in-progress call (from an incoming ring), vs start a new one. */
  call?: "1";
};

export const Route = createFileRoute("/team/$conversationId")({
  validateSearch: (search: Record<string, unknown>): TeamConversationSearch => {
    const tab =
      search.tab === "files" || search.tab === "call" || search.tab === "chat" ? (search.tab as HubTab) : undefined;
    const start = search.start === "call" ? "call" : undefined;
    const call = search.call === "1" || search.call === 1 ? "1" : undefined;
    return { tab, start, call };
  },
  component: ConversationRoute,
});

function ConversationRoute() {
  const { conversationId } = Route.useParams();
  const { tab, start, call } = Route.useSearch();
  const navigate = useNavigate();
  const { context, setContext } = useAppContext();
  const { conversation } = useConversation(conversationId);
  const conversationContext = conversation?.context;
  const alignedFor = useRef<string | null>(null);

  // Conversations belong to one Work/Home mode. Arriving at a chat from the
  // other mode (a notification, a link, a ring) switches mode once so the rail
  // matches; toggling mode afterwards leaves the chat for that mode's Team home.
  useEffect(() => {
    if (!conversationContext) return;
    if (alignedFor.current !== conversationId) {
      alignedFor.current = conversationId;
      if (conversationContext !== context) void setContext(conversationContext);
      return;
    }
    if (conversationContext !== context) void navigate({ to: "/team" });
  }, [conversationId, conversationContext, context, setContext, navigate]);

  const setTab = (next: HubTab) => {
    void navigate({
      to: "/team/$conversationId",
      params: { conversationId },
      search: (prev) => ({ ...prev, tab: next }),
    });
  };

  const clearStart = () => {
    void navigate({
      to: "/team/$conversationId",
      params: { conversationId },
      search: (prev) => ({ ...prev, start: undefined, call: undefined }),
      replace: true,
    });
  };

  return (
    <ConversationWorkspace
      key={conversationId}
      listId={conversationId}
      tab={tab ?? "chat"}
      onTabChange={setTab}
      startCall={start === "call"}
      autoJoin={call === "1"}
      onStartConsumed={clearStart}
    />
  );
}
