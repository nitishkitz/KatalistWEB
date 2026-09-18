import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquare, Users } from "lucide-react";
import { useHub } from "@/features/hub/hub-context";

export const Route = createFileRoute("/team/")({
  component: TeamHome,
});

function TeamHome() {
  const { openContacts } = useHub();
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f0e9fb]">
        <MessagesSquare className="h-8 w-8 text-[#6638ec]" />
      </div>
      <h1 className="mt-4 text-[20px] font-semibold text-[#000533]">Your conversations</h1>
      <p className="mt-1 max-w-sm text-[13px] text-[#6a769c]">
        Pick a conversation or a list on the left, search for anyone to message, or open Contacts to connect and invite people.
      </p>
      <button
        type="button"
        onClick={openContacts}
        className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#975ee2] px-5 text-[13px] font-semibold text-white transition hover:brightness-95"
      >
        <Users className="h-4 w-4" />
        Open Contacts
      </button>
    </div>
  );
}
