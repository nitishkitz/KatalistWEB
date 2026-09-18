import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, X, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useTeam } from "@/features/people/use-team";
import { isUuid } from "@/features/things/rpc";
import { rpcCreateGroup } from "@/features/hub/rpc";
import { useConversations } from "@/features/hub/use-conversations";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";

export function NewGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { members } = useTeam();
  const { refetch } = useConversations();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, { name: string; initials: string; avatarUrl: string | null }>>({});
  const [creating, setCreating] = useState(false);

  const selectedIds = Object.keys(selected);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Only real people (resolvable profile/actor id) can be added to a group.
    return members.filter((m) => isUuid(m.id) && (q ? m.name.toLowerCase().includes(q) : true));
  }, [members, query]);

  const toggle = (id: string, m: { name: string; initials: string; avatarUrl: string | null }) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = m;
      return next;
    });
  };

  const reset = () => {
    setName("");
    setQuery("");
    setSelected({});
  };

  const create = async () => {
    const clean = name.trim();
    if (!clean) {
      toast.error("Give the group a name.");
      return;
    }
    // create_group resolves actor→profile ids; only uuid ids are valid RPC args.
    const ids = selectedIds.filter((id) => isUuid(id));
    if (ids.length === 0) {
      toast.error("Add at least one member.");
      return;
    }
    setCreating(true);
    try {
      const group = await rpcCreateGroup(clean, ids);
      await refetch();
      onOpenChange(false);
      reset();
      navigate({ to: "/team/$conversationId", params: { conversationId: group.id } });
    } catch (err) {
      console.error("[hub] createGroup failed", err);
      toast.error(domainErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="text-[16px] text-[#000533]">New group</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            className="h-11 w-full rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 text-[13px] text-[#000533] outline-none focus:border-[#975ee2]"
          />

          {selectedIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedIds.map((id) => {
                const m = selected[id];
                return (
                  <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-[#f0e9fb] py-1 pl-1 pr-2 text-[12px] text-[#6638ec]">
                    <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={20} />
                    {m.name.split(" ")[0]}
                    <button type="button" onClick={() => toggle(id, m)} aria-label={`Remove ${m.name}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <label className="flex h-10 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 focus-within:border-[#975ee2]">
            <Search className="h-4 w-4 text-[#8487a7]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#000533] outline-none placeholder:text-[#8487a7]"
            />
          </label>

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-[#6a769c]">No people found.</p>
            ) : (
              filtered.map((m) => {
                const isSel = Boolean(selected[m.id]);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id, { name: m.name, initials: m.initials, avatarUrl: m.avatarUrl })}
                    className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-[#f6f7fc]"
                  >
                    <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[#000533]">{m.name}</span>
                      {m.role ? <span className="block truncate text-[11.5px] text-[#6a769c]">{m.role}</span> : null}
                    </span>
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                        isSel ? "border-[#975ee2] bg-[#975ee2] text-white" : "border-[#cfd3e6]",
                      )}
                    >
                      {isSel ? <Check className="h-3 w-3" /> : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={create}
            disabled={creating}
            className="inline-flex h-10 w-full items-center justify-center rounded-[10px] bg-[#975ee2] text-[13px] font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create group"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
