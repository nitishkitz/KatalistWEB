import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { ThingDetailSheet } from "@/features/things/ThingDetailSheet";
import { useListThings } from "@/features/lists/use-list-things";
import { useList } from "@/features/lists/use-lists";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useListMessages } from "@/features/lists/use-list-messages";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { deriveListView, type ListStatusFilter } from "@/features/lists/list-board-model";
import { ListThingsToolbar, type ListView } from "@/features/lists/ListThingsToolbar";
import { ListThingsBoard } from "@/features/lists/ListThingsBoard";
import { ListThingsTable } from "@/features/lists/ListThingsTable";
import { ListChatPanel } from "@/features/lists/ListChatPanel";
import { ListPeoplePanel } from "@/features/lists/ListPeoplePanel";

export const Route = createFileRoute("/lists/$listId")({
  component: ListDetailPage,
});

function ListDetailPage() {
  const { listId } = Route.useParams();
  useLocalVersion();
  const { list, isLoading, error } = useList(listId);
  const chat = useListMessages(listId);
  const { things: listThings, myActorId } = useListThings(listId);
  const [view, setView] = useState<ListView>("table");
  const [status, setStatus] = useState<ListStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"things" | "chat" | "members">("things");
  const [msg, setMsg] = useState("");
  const viewOnly = list?.role === "view_only";
  const selected = listThings.find((t) => t.id === selectedId) ?? null;

  const board = deriveListView({
    things: listThings,
    status,
    assigneeId,
    query,
    now: new Date(),
  });

  if (isLoading) {
    return (
      <AppShell title="List" subtitle="Loading">
        <p className="text-sm text-muted-foreground">Opening this List…</p>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell title="List" subtitle="Couldn’t load">
        <p className="text-sm text-muted-foreground">{domainErrorMessage(error)}</p>
      </AppShell>
    );
  }

  if (!list) {
    return (
      <AppShell title="List" subtitle="Not found">
        <Link to="/lists" className="text-sm text-primary">
          Back to Lists
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell title={list.name} subtitle={`${list.context} · ${list.ownerLine}`} magicBoxContext={{ listId: list.id, listName: list.name, editable: !viewOnly }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-0.5">
          {(["things", "chat", "members"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12.5px] font-medium capitalize",
                tab === id ? "bg-muted" : "text-muted-foreground",
              )}
            >
              {id === "members" ? "Members & permissions" : id}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">
          Role: {list.role.replace("_", " ")} · Thing comments stay on the Thing.
        </p>
      </div>

      {tab === "things" ? (
        <>
          <ListThingsToolbar view={view} onView={setView} status={status} onStatus={setStatus} query={query} onQuery={setQuery} assignees={board.assignees} assigneeId={assigneeId} onAssignee={setAssigneeId} />
          {view === "board" ? (
            <ListThingsBoard things={board.flat} myActorId={myActorId} onSelect={(thing) => setSelectedId(thing.id)} />
          ) : (
            <ListThingsTable things={board.flat} onSelect={(thing) => setSelectedId(thing.id)} />
          )}
        </>
      ) : null}

      {tab === "chat" ? (
        <ListChatPanel chat={chat} message={msg} onMessage={setMsg} />
      ) : null}

      {tab === "members" ? (
        <ListPeoplePanel listId={list.id} members={list.members} isOwner={list.role === "owner"} />
      ) : null}

      <ThingDetailSheet
        thing={selected}
        open={Boolean(selected)}
        onOpenChange={(v) => !v && setSelectedId(null)}
      />
    </AppShell>
  );
}
