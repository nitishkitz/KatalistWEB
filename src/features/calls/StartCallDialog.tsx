import { useEffect, useMemo, useState } from "react";
import { Phone, Video, Search, Check, Link2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";

export type CallPerson = {
  id: string;
  name: string;
  initials?: string;
  avatarUrl?: string | null;
};

/**
 * "Start a call" picker (Figma parity): choose Audio/Video, pick who to ring
 * from the conversation's people, copy an invite link, or start.
 *
 * Also reused as the in-call "Invite" picker (variant="invite") — same list
 * UI, but skips the Audio/Video choice and calls onInvite instead of onStart.
 */
export function StartCallDialog({
  open,
  onOpenChange,
  people,
  title = "Start a call",
  variant = "start",
  defaultVideo = true,
  onStart,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Candidates to ring — conversation/list members excluding yourself. */
  people: CallPerson[];
  title?: string;
  variant?: "start" | "invite";
  defaultVideo?: boolean;
  /** Called for variant="start": withVideo + the selected recipient ids. */
  onStart?: (opts: { withVideo: boolean; selectedIds: string[] }) => void;
  /** Called for variant="invite": the selected recipient ids. */
  onInvite?: (selectedIds: string[]) => void;
}) {
  const [withVideo, setWithVideo] = useState(defaultVideo);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // Default selection = everyone, reset whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setSelected(new Set(people.map((p) => p.id)));
      setQuery("");
      setWithVideo(defaultVideo);
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.name.toLowerCase().includes(q));
  }, [people, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable
    }
  };

  const submit = () => {
    const ids = [...selected];
    if (variant === "invite") onInvite?.(ids);
    else onStart?.({ withVideo, selectedIds: ids });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{variant === "invite" ? "Invite people" : title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {variant === "start" ? (
            <div className="flex rounded-[10px] bg-[#f1f2f7] p-1">
              <button
                type="button"
                onClick={() => setWithVideo(false)}
                className={cn(
                  "flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium transition-colors cursor-pointer",
                  !withVideo ? "bg-white text-[#000533] shadow-sm" : "text-[#6a769c]",
                )}
              >
                <Phone className="h-3.5 w-3.5" />
                Audio call
              </button>
              <button
                type="button"
                onClick={() => setWithVideo(true)}
                className={cn(
                  "flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium transition-colors cursor-pointer",
                  withVideo ? "bg-[#7b56fd] text-white shadow-sm" : "text-[#6a769c]",
                )}
              >
                <Video className="h-3.5 w-3.5" />
                Video Call
              </button>
            </div>
          ) : null}

          <label className="flex h-10 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3">
            <Search className="h-4 w-4 text-[#8487a7]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#000533] outline-none placeholder:text-[#8487a7]"
            />
          </label>

          <div>
            <p className="text-[12px] font-medium text-[#000533]">
              {variant === "invite" ? "People" : "Recent People"}
            </p>
            <div className="mt-2 max-h-[240px] space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-[#8487a7]">No one matches that search.</p>
              ) : (
                filtered.map((p) => {
                  const checked = selected.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
                      className="flex w-full items-center justify-between gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-muted/50 cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5">
                        <PersonAvatar name={p.name} initials={p.initials} src={p.avatarUrl} size={30} />
                        <span className="text-[13px] font-medium text-[#000128]">{p.name}</span>
                      </span>
                      <Checkbox checked={checked} onCheckedChange={() => toggle(p.id)} />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] font-medium text-foreground hover:bg-muted cursor-pointer"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[#12a15f]" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy Link"}
          </button>
          <button
            type="button"
            onClick={submit}
            className="inline-flex h-9 items-center rounded-lg bg-[#975ee2] px-4 text-[13px] font-semibold text-white hover:brightness-95 cursor-pointer"
          >
            {variant === "invite" ? "Send Invite" : "Start Call"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
