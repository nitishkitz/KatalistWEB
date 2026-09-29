import { useEffect, useRef, useState } from "react";
import { createFileRoute, Outlet, useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { HubSidebar } from "@/features/hub/components/HubSidebar";
import { ContactsDialog } from "@/features/hub/components/ContactsDialog";
import { HubContext } from "@/features/hub/hub-context";
import { cn } from "@/lib/utils";

type TeamSearch = {
  openContacts?: boolean;
};

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team — Katalist" },
      { name: "description", content: "Message, call, and share files with your team." },
    ],
  }),
  // G01: lets an external link (onboarding's "Find people" step) open the
  // real Contacts flow on arrival, instead of only being reachable once
  // already on this page. `openContacts` is read once on mount below, not
  // kept in sync with the URL afterward -- this is a one-shot "arrive with
  // it open" signal, not a persisted view-state param.
  validateSearch: (search: Record<string, unknown>): TeamSearch => {
    const openContacts =
      search.openContacts === true || search.openContacts === "true" ? true : undefined;
    return { openContacts };
  },
  component: TeamHubLayout,
});

function TeamHubLayout() {
  const params = useParams({ strict: false }) as { conversationId?: string };
  const inConversation = Boolean(params.conversationId);
  const { openContacts: openContactsOnArrival } = useSearch({ from: "/team" });
  const [contactsOpen, setContactsOpen] = useState(Boolean(openContactsOnArrival));
  const navigate = useNavigate({ from: "/team" });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const previousPathname = useRef(pathname);

  // Child-route navigation can also come from keyboard shortcuts or code.
  // Close the workspace panel whenever the selected conversation changes.
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    setContactsOpen(false);
  }, [pathname]);

  // `openContacts` is an arrival instruction, not persistent UI state.
  // Consume it immediately so closing the drawer stays closed after a reload
  // or after moving between Team child routes.
  useEffect(() => {
    if (!openContactsOnArrival) return;
    void navigate({ search: {}, replace: true });
  }, [navigate, openContactsOnArrival]);

  return (
    <HubContext.Provider value={{ openContacts: () => setContactsOpen(true) }}>
      <AppShell noPadding>
        <div className="flex h-[calc(100dvh-4rem)] w-full min-w-0 md:h-[calc(100dvh-3.5rem)]">
          {/* Left rail — hidden on mobile while a conversation is open (drawer behavior). */}
          <div className={cn("min-h-0 md:flex", inConversation ? "hidden" : "flex w-full md:w-auto")}>
            <HubSidebar />
          </div>
          {/* Main pane */}
          <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto md:flex md:flex-col", inConversation ? "flex flex-col" : "hidden md:flex")}>
            <Outlet />
          </div>
        </div>
      </AppShell>
      <ContactsDialog open={contactsOpen} onOpenChange={setContactsOpen} />
    </HubContext.Provider>
  );
}
