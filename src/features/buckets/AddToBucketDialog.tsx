import { useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { laneOf } from "@/domain/thing";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { useAccessibleLists, useAccessibleThings } from "./use-bucket-items";

type Target = { thingId: string } | { listId: string };

/**
 * Pick Things and Lists to reference in a Bucket, right where the Bucket is
 * shown. Buckets only reference: nothing about the Thing or List changes.
 */
export function AddToBucketDialog({
  open,
  bucketName,
  referencedThingIds,
  referencedListIds,
  onClose,
  onAdd,
}: {
  open: boolean;
  bucketName: string;
  referencedThingIds: Set<string>;
  referencedListIds: Set<string>;
  onClose: () => void;
  onAdd: (target: Target) => Promise<unknown>;
}) {
  const things = useAccessibleThings();
  const lists = useAccessibleLists();
  const [tab, setTab] = useState<"things" | "lists">("things");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const query = q.trim().toLowerCase();
  const shownThings = useMemo(
    () => things.filter((t) => !referencedThingIds.has(t.id) && (!query || t.title.toLowerCase().includes(query) || t.assignee.name.toLowerCase().includes(query))).slice(0, 80),
    [things, referencedThingIds, query],
  );
  const shownLists = useMemo(
    () => lists.filter((l) => !referencedListIds.has(l.id) && (!query || l.name.toLowerCase().includes(query))),
    [lists, referencedListIds, query],
  );
  const toggle = (key: string) => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const close = () => { if (busy) return; setPicked(new Set()); setQ(""); onClose(); };

  const addPicked = async () => {
    setBusy(true);
    let added = 0;
    const failed: string[] = [];
    for (const key of picked) {
      const [kind, id] = key.split(":") as ["thing" | "list", string];
      try {
        await onAdd(kind === "thing" ? { thingId: id } : { listId: id });
        added++;
      } catch (err) {
        failed.push(domainErrorMessage(err));
      }
    }
    setBusy(false);
    if (added) toast.success(`Added ${added} to ${bucketName}.`);
    if (failed.length) toast.error(failed[0]!);
    setPicked(new Set());
    setQ("");
    if (!failed.length) onClose();
  };

  const rowClass = (on: boolean) => cn(
    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#975ee2]",
    on ? "bg-[#f3edff] ring-1 ring-[#d9c7ff]" : "hover:bg-[#f7f3ff]",
  );
  const box = (on: boolean) => (
    <span aria-hidden="true" className={cn("flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[5px] border", on ? "border-[#793aff] bg-[#793aff] text-white" : "border-[#c9cde0] bg-white")}>
      {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-w-lg gap-3 bg-white p-5">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Add to {bucketName}</DialogTitle>
          <DialogDescription className="text-[12.5px]">Pick Things and Lists. They stay where they are; the Bucket only keeps a reference.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-xl bg-muted p-1" role="tablist">
          {(["things", "lists"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn("flex-1 rounded-lg px-2.5 py-1 text-[12.5px] font-medium", tab === t ? "bg-white font-semibold text-foreground" : "text-muted-foreground")}>
              {t === "things" ? `Things · ${shownThings.length}` : `Lists · ${shownLists.length}`}
            </button>
          ))}
        </div>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-[#f8f9fd] px-2.5">
          <Search className="h-4 w-4 text-[#858bb2]" aria-hidden="true" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "things" ? "Search Things…" : "Search Lists…"} aria-label="Search" className="w-full bg-transparent text-[13px] outline-none" />
        </label>
        <ul className="max-h-[22rem] space-y-0.5 overflow-y-auto pr-0.5">
          {tab === "things"
            ? shownThings.map((t) => {
                const on = picked.has(`thing:${t.id}`);
                const lane = laneOf(t);
                return (
                  <li key={t.id}>
                    <button type="button" aria-pressed={on} onClick={() => toggle(`thing:${t.id}`)} className={rowClass(on)}>
                      {box(on)}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[#11163b]">{t.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#7883a5]">
                          <span className={cn("h-1.5 w-1.5 rounded-full", lane === "now" ? "bg-[#ff4747]" : lane === "next" ? "bg-[#0661f9]" : "bg-[#7c33fd]")} />
                          <span className="capitalize">{lane}</span><span aria-hidden="true">·</span>
                          <PersonAvatar name={t.assignee.name} src={t.assignee.avatarUrl} initials={t.assignee.initials} size={16} />
                          <span className="truncate">{t.assignee.name}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            : shownLists.map((l) => {
                const on = picked.has(`list:${l.id}`);
                return (
                  <li key={l.id}>
                    <button type="button" aria-pressed={on} onClick={() => toggle(`list:${l.id}`)} className={rowClass(on)}>
                      {box(on)}
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#efeafe] text-[13px] font-semibold text-[#6638ec]">
                        {l.coverUrl ? <img src={l.coverUrl} alt="" className="h-full w-full object-cover" /> : l.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[#11163b]">{l.name}</span>
                        <span className="block truncate text-[11px] text-[#7883a5]">{l.thingCount} {l.thingCount === 1 ? "Thing" : "Things"} · {l.ownerLine}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
          {(tab === "things" ? shownThings : shownLists).length === 0 ? (
            <li className="px-2 py-6 text-center text-[12.5px] text-muted-foreground">{query ? "No matches." : "Nothing else to add."}</li>
          ) : null}
        </ul>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-[12px] text-muted-foreground">{picked.size ? `${picked.size} selected` : "Nothing selected"}</span>
          <div className="flex gap-2">
            <button type="button" onClick={close} disabled={busy} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted">Cancel</button>
            <button type="button" onClick={() => void addPicked()} disabled={busy || picked.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#793aff] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#6a2ee8] disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {picked.size ? `Add ${picked.size}` : "Add"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
