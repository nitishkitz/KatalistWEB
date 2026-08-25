import { useState } from "react";
import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { MagicBox } from "@/features/court/MagicBox";
import { ThingDetailSheet } from "@/features/things/ThingDetailSheet";
import { useListThings } from "@/features/lists/use-list-things";
import { useList } from "@/features/lists/use-lists";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useListMessages } from "@/features/lists/use-list-messages";
import { domainErrorMessage } from "@/lib/domain-error";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";
import { cn } from "@/lib/utils";
import { deriveListBoard, type ListScope, type ListStatusFilter } from "@/features/lists/list-board-model";
import { ListThingsToolbar, type ListView } from "@/features/lists/ListThingsToolbar";
import { ListThingsBoard } from "@/features/lists/ListThingsBoard";
import { ListThingsTable } from "@/features/lists/ListThingsTable";
import { ListChatPanel } from "@/features/lists/ListChatPanel";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/lists/$listId")({
  component: ListDetailPage,
});

function MemberRow({
  name,
  initials,
  avatarUrl,
  role,
  actions,
}: {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  role?: string;
  actions?: ReactNode;
}) {
  const src = useAvatarUrl(name, null, avatarUrl);
  const label = role === "owner" ? "Owner" : role === "view_only" ? "View Only" : "Collaborator";
  return (
    <li className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <span className="flex items-center gap-2 text-[13px]">
        <PersonAvatar name={name} initials={initials} src={src} size={28} />
        {name}
      </span>
      {actions ?? <span className="text-[12px] text-muted-foreground">{label}</span>}
    </li>
  );
}

function ListDetailPage() {
  const qc = useQueryClient();
  const { listId } = Route.useParams();
  useLocalVersion();
  const { list, isLoading, error } = useList(listId);
  const chat = useListMessages(listId);
  const { things: listThings, myActorId } = useListThings(listId);
  const [view, setView] = useState<ListView>("board");
  const [scope, setScope] = useState<ListScope>("mine");
  const [status, setStatus] = useState<ListStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"things" | "chat" | "members">("things");
  const [msg, setMsg] = useState("");
  const viewOnly = list?.role === "view_only";
  const selected = listThings.find((t) => t.id === selectedId) ?? null;
  const memberRun = useMutation({
    mutationFn: async (input: { action: "role" | "remove"; profileId: string; role?: "collaborator" | "view_only" }) => {
      const result = input.action === "remove"
        ? await supabase.rpc("remove_list_member", { p_list_id: listId, p_profile_id: input.profileId })
        : await supabase.rpc("change_list_role", { p_list_id: listId, p_profile_id: input.profileId, p_role: input.role! });
      if (result.error) throw result.error;
    },
    onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["list", listId] }), qc.invalidateQueries({ queryKey: ["lists"] })]); toast.success("List permissions updated."); },
    onError: (error) => toast.error(domainErrorMessage(error)),
  });

  const board = deriveListBoard({
    things: listThings,
    myActorId,
    scope,
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
    <AppShell title={list.name} subtitle={`${list.context} · ${list.ownerLine}`}>
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
          {viewOnly ? null : <MagicBox listId={list.id} listName={list.name} />}
          <ListThingsToolbar view={view} onView={setView} scope={scope} onScope={setScope} status={status} onStatus={setStatus} query={query} onQuery={setQuery} assignees={board.assignees} assigneeId={assigneeId} onAssignee={setAssigneeId} />
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
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-[12px] text-muted-foreground">
            Only the List Owner can add, remove, or change roles. Assigning a Thing to a non-member
            does not make them a List member.
          </p>
          <ul className="space-y-2">
            {list.members.map((m) => (
              <MemberRow
                key={m.profileId ?? m.name}
                name={m.name}
                initials={m.initials}
                avatarUrl={m.avatarUrl}
                role={m.role}
                actions={list.role === "owner" && m.role !== "owner" && m.profileId ? <span className="flex items-center gap-2"><select value={m.role} disabled={memberRun.isPending} onChange={(event) => memberRun.mutate({ action: "role", profileId: m.profileId!, role: event.target.value as "collaborator" | "view_only" })} className="h-7 rounded-md border border-border bg-card px-2 text-[11px]"><option value="collaborator">Collaborator</option><option value="view_only">View only</option></select><button type="button" disabled={memberRun.isPending} onClick={() => memberRun.mutate({ action: "remove", profileId: m.profileId! })} className="text-[11px] text-muted-foreground hover:text-destructive">Remove</button></span> : undefined}
              />
            ))}
          </ul>
          {list.role === "owner" ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Owner tools: add people, change roles, promote Thing-only people.
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Collaborators cannot promote Thing-only people into membership.
            </p>
          )}
        </section>
      ) : null}

      <ThingDetailSheet
        thing={selected}
        open={Boolean(selected)}
        onOpenChange={(v) => !v && setSelectedId(null)}
      />
    </AppShell>
  );
}
