import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { MagicBox } from "@/features/court/MagicBox";
import { ThingRow } from "@/components/katalist/ThingRow";
import { ThingDetailSheet } from "@/features/things/ThingDetailSheet";
import { useListThings } from "@/features/lists/use-list-things";
import { useList } from "@/features/lists/use-lists";
import { useLocalVersion } from "@/features/things/local-state";
import { useListMessages } from "@/features/lists/use-list-messages";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";
import type { Thing } from "@/domain/thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/lists/$listId")({
  component: ListDetailPage,
});

type FeedFilter = "all" | "mine" | "waiting" | "progress" | "completed" | "cancelled";

function MemberRow({
  name,
  initials,
  avatarUrl,
  isOwner,
  ownerView,
}: {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  isOwner: boolean;
  ownerView: boolean;
}) {
  const src = useAvatarUrl(name, null, avatarUrl);
  return (
    <li className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <span className="flex items-center gap-2 text-[13px]">
        <PersonAvatar name={name} initials={initials} src={src} size={28} />
        {name}
      </span>
      <span className="text-[12px] text-muted-foreground">{isOwner ? "Owner" : ownerView ? "Collaborator" : "Member"}</span>
    </li>
  );
}

function ListDetailPage() {
  const { listId } = Route.useParams();
  useLocalVersion();
  const { list } = useList(listId);
  const chat = useListMessages(listId);
  const { things: listThings, myActorId } = useListThings(listId);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"things" | "chat" | "members">("things");
  const [msg, setMsg] = useState("");
  const viewOnly = list?.role === "view_only";
  const selected = listThings.find((t) => t.id === selectedId) ?? null;

  const things = useMemo(() => {
    return listThings.filter((t) => t.listId === listId || t.listName === list?.name);
  }, [listThings, list, listId]);

  const visible = things.filter((t) => {
    if (filter === "mine") return t.assignee.id === myActorId;
    if (filter === "waiting") return t.acknowledgement === "waiting_for_catch";
    if (filter === "progress") return t.workStatus === "under_progress";
    if (filter === "completed") return t.workStatus === "sorted";
    if (filter === "cancelled") return t.workStatus === "cancelled";
    return true;
  });

  const messages = chat.messages;

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
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["mine", "Mine"],
                ["waiting", "Waiting"],
                ["progress", "In Progress"],
                ["completed", "Completed"],
                ["cancelled", "Cancelled"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px]",
                  filter === id ? "border-primary/30 bg-primary/10 text-primary" : "border-border",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="hidden w-full md:table">
              <tbody>
                {visible.map((t) => (
                  <ThingRow key={t.id} thing={t} onSelect={(thing) => setSelectedId(thing.id)} />
                ))}
              </tbody>
            </table>
            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">No things in this filter.</p>
            ) : null}
          </div>
        </>
      ) : null}

      {tab === "chat" ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-[12px] text-muted-foreground">
            List Chat is room conversation. It is not Thing comments.
          </p>
          <div className="mb-3 max-h-80 space-y-2 overflow-y-auto">
            {messages.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No messages yet.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                  <span className="font-medium">{m.author}: </span>
                  {m.body}
                </div>
              ))
            )}
          </div>
          {viewOnly ? (
            <p className="text-[12px] text-muted-foreground">View Only can observe and comment on Things, not administer.</p>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!msg.trim()) return;
                void chat.send.mutateAsync(msg.trim()).then(
                  () => setMsg(""),
                  (err) => toast.error(domainErrorMessage(err)),
                );
              }}
            >
              <input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="Message the room — or turn a line into a Thing from Magic Box"
                className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-[13px]"
              />
              <button type="submit" className="rounded-lg bg-primary px-3 text-[13px] text-primary-foreground">
                Send
              </button>
            </form>
          )}
        </section>
      ) : null}

      {tab === "members" ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-[12px] text-muted-foreground">
            Only the List Owner can add, remove, or change roles. Assigning a Thing to a non-member does not make them a List member.
          </p>
          <ul className="space-y-2">
            {list.members.map((m) => (
              <MemberRow key={m.name} name={m.name} initials={m.initials} avatarUrl={m.avatarUrl} isOwner={false} ownerView={list.role === "owner"} />
            ))}
          </ul>
          {list.role === "owner" ? (
            <p className="mt-3 text-[12px] text-muted-foreground">Owner tools: add people, change roles, promote Thing-only people.</p>
          ) : (
            <p className="mt-3 text-[12px] text-muted-foreground">Collaborators cannot promote Thing-only people into membership.</p>
          )}
        </section>
      ) : null}

      <ThingDetailSheet thing={selected} open={Boolean(selected)} onOpenChange={(v) => !v && setSelectedId(null)} />
    </AppShell>
  );
}
