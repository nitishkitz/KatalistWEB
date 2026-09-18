import { useState } from "react";
import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { HubSidebar } from "@/features/hub/components/HubSidebar";
import { ContactsDialog } from "@/features/hub/components/ContactsDialog";
import { HubContext } from "@/features/hub/hub-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team — Katalist" },
      { name: "description", content: "Message, call, and share files with your team." },
    ],
  }),
  component: TeamHubLayout,
});

function TeamHubLayout() {
  const params = useParams({ strict: false }) as { conversationId?: string };
  const inConversation = Boolean(params.conversationId);
  const [contactsOpen, setContactsOpen] = useState(false);

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
