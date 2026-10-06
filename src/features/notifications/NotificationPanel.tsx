import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowRight, AtSign, Bell, Check, CheckCheck, Clock, Loader2, MessageCircle, Sparkles, Sunrise, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { domainErrorMessage } from "@/lib/domain-error";
import { useSession } from "@/hooks/useSession";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { useThing } from "@/features/things/use-thing";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { rpcCatchAndStart, rpcReassignThing } from "@/features/things/rpc";
import { withOptimisticPatch } from "@/features/things/query-updates";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useNotifications } from "./use-notifications";
import { useNotificationTargets } from "./use-notification-targets";
import { groupNotifications, notificationActions, type NotificationGroup } from "./notification-model";
import { requestCatchupOpen } from "@/features/catchup/catchup-entry";

const actionClass = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[#ded8f1] px-3 text-[12px] font-medium text-[#6541ad] transition-colors hover:bg-[#eee8fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function relativeTime(at: string) {
  return at && Number.isFinite(Date.parse(at)) ? formatDistanceToNowStrict(new Date(at), { addSuffix: true }) : "";
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"all" | "attention">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { user } = useSession();
  const inbox = useNotifications();
  const targets = useNotificationTargets(inbox.items, open || expanded, inbox.preview);
  const people = useAssignablePeople();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const selected = useThing(selectedId);

  useEffect(() => { setOpen(false); setExpanded(false); setSelectedId(null); setTab("all"); }, [user?.id]);

  const markRead = (item: NotificationGroup) => {
    const ids = item.ids.filter((id) => inbox.items.some((n) => n.id === id && !n.read));
    if (ids.length) inbox.markOne.mutate(ids, { onError: () => toast.error("Couldn't mark this notification read. Try again.") });
  };
  const openThing = (item: NotificationGroup) => {
    if (!item.thingId) return;
    markRead(item);
    setOpen(false); setExpanded(false); setSelectedId(item.thingId);
  };
  const goToList = async (item: NotificationGroup) => {
    const list = targets.lists.find((l) => l.id === item.listId);
    if (!list) { toast.error("This conversation is no longer available."); return; }
    await navigate(list.kind === "dm" || list.kind === "group"
      ? { to: "/team/$conversationId", params: { conversationId: list.id }, search: { tab: "chat" } }
      : { to: "/lists/$listId", params: { listId: list.id } });
    markRead(item); setOpen(false); setExpanded(false);
  };
  const reviewCourt = async (item: NotificationGroup) => {
    setOpen(false);
    setExpanded(false);
    requestCatchupOpen();
    await navigate({ to: "/" });
    markRead(item);
  };
  const mutation = useMutation({
    mutationFn: async ({ item, assigneeId }: { item: NotificationGroup; assigneeId?: string }) => {
      if (!item.thingId) throw new Error("This Thing is no longer available.");
      const epoch = getIdentityEpoch(qc).epoch;
      const person = people.find((p) => p.id === assigneeId);
      await withOptimisticPatch(qc, item.thingId, assigneeId
        ? { ...(person ? { assignee: person } : {}), acknowledgement: "waiting_for_catch", personalPace: null, caughtAt: null }
        : { acknowledgement: "caught", workStatus: "under_progress", personalPace: "next" }, async () => {
        if (assigneeId) await rpcReassignThing(item.thingId!, assigneeId);
        else await rpcCatchAndStart(item.thingId!, "next");
      });
      return { item, epoch, reassigned: Boolean(assigneeId) };
    },
    onSuccess: ({ item, epoch, reassigned }) => {
      if (!isEpochCurrent(qc, epoch)) return;
      markRead(item);
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(reassigned ? "Reassigned. Waiting for Catch." : "Caught. Your Thing is under progress.");
    },
    onError: (error) => toast.error(domainErrorMessage(error)),
  });

  const grouped = groupNotifications(inbox.items);
  const attention: NotificationGroup[] = [];
  const updates: NotificationGroup[] = [];
  for (const item of grouped) {
    const thing = targets.things.find((t) => t.id === item.thingId);
    (notificationActions(item, thing, targets.ready ? targets.actorId : null).needsAttention ? attention : updates).push(item);
  }

  const renderRow = (item: NotificationGroup) => {
    const thing = targets.things.find((t) => t.id === item.thingId);
    const actions = notificationActions(item, thing, targets.ready ? targets.actorId : null);
    const person = people.find((p) => p.id === item.actorId);
    const assignee = people.find((p) => p.id === thing?.current_assignee_actor_id);
    const chat = item.kind === "list_message";
    const brief = item.kind === "morning_brief";
    const sorted = item.kind === "thing_sorted";
    const attentionRow = actions.needsAttention;
    const mention = item.kind === "mention";
    const Icon = brief ? Sunrise : mention ? AtSign : chat ? MessageCircle : sorted ? Check : attentionRow ? Clock : Sparkles;
    const title = chat && item.count > 1 ? item.title.replace(/^New message in /, `${item.count} new messages in `)
      : sorted && person ? `${person.name} sorted your Thing`
      : item.kind === "thing_caught" && person ? `${person.name} caught your Thing`
      : item.kind === "thing_reassigned" && person ? `${person.name} reassigned your Thing`
      : item.kind === "nudged" && person ? `${person.name} nudged you`
      : brief ? "Your morning brief" : item.title;
    return (
      <li key={item.id} className={cn("rounded-xl px-3 py-3.5", !item.read ? "bg-[#f7f4fd]" : "bg-white")}>
        <div className="flex items-start gap-3">
          <div className="relative mt-0.5 shrink-0">
            {person && !brief && !chat ? <PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={38} /> : (
              <span className={cn("flex h-[38px] w-[38px] items-center justify-center rounded-xl", brief || attentionRow ? "bg-[#fff0df] text-[#bf6815]" : sorted ? "bg-emerald-50 text-emerald-600" : "bg-[#eee7fc] text-[#8054c5]")}><Icon className="h-[19px] w-[19px]" /></span>
            )}
            {sorted && person ? <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white bg-emerald-500 p-0.5 text-white"><Check className="h-2.5 w-2.5" /></span> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-[13px] font-semibold leading-5 text-[#20243a]">{title}</p>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                <time dateTime={item.createdAt || undefined} className="text-[10px] text-[#6a769c]">{relativeTime(item.createdAt)}</time>
                {!item.read ? <span aria-label="Unread" className="h-1.5 w-1.5 rounded-full bg-[#975ee2]" /> : null}
              </div>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[#6a769c]">{item.body}</p>
            {attentionRow && thing ? <p className="mt-0.5 text-[11px] text-[#6a769c]">{thing.acknowledgement === "caught" ? "Caught" : "Waiting for catch"}{assignee ? ` · ${assignee.name}` : ""}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {item.thingId ? <button type="button" className={cn(actionClass, attentionRow && "border-transparent bg-[#e9defb]")} onClick={() => openThing(item)}>{attentionRow ? "Open Thing" : "View Thing"}<ArrowRight className="h-3 w-3" /></button> : null}
              {actions.canCatch ? <button type="button" className={actionClass} disabled={mutation.isPending} onClick={() => mutation.mutate({ item })}>Catch</button> : null}
              {actions.canReassign && attentionRow ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" className={actionClass} disabled={mutation.isPending}><UserPlus className="h-3 w-3" />Reassign</button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                    {people.filter((p) => p.id !== thing?.current_assignee_actor_id).map((p) => <DropdownMenuItem key={p.id} onSelect={() => mutation.mutate({ item, assigneeId: p.id })}>{p.name}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {!item.thingId && item.listId ? <button type="button" className={actionClass} disabled={!targets.ready} onClick={() => void goToList(item)}>{chat ? "Reply" : "Open"}<ArrowRight className="h-3 w-3" /></button> : null}
              {brief || item.kind === "spring_clean" ? <button type="button" className={actionClass} onClick={() => void reviewCourt(item)}>Review<ArrowRight className="h-3 w-3" /></button> : null}
              {!item.read ? <button type="button" className="ml-auto rounded px-1 py-1 text-[10px] text-[#6a769c] hover:text-[#6541ad] focus-visible:ring-2 focus-visible:ring-ring" disabled={inbox.markOne.isPending} onClick={() => markRead(item)}>Mark read</button> : null}
            </div>
          </div>
        </div>
      </li>
    );
  };

  const panel = (full: boolean) => (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
        <div className="flex items-center gap-2"><h2 className="text-[17px] font-semibold tracking-tight text-[#20243a]">Notifications</h2>{inbox.unreadCount ? <span className="rounded-full bg-[#eee7fc] px-2 py-1 text-[11px] font-medium text-[#6541ad]">{inbox.unreadCount} new</span> : null}</div>
        <button type="button" className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-[#6541ad] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40" disabled={!inbox.unread || inbox.markAll.isPending} onClick={() => inbox.markAll.mutate(undefined, { onError: () => toast.error("Couldn't mark notifications read. Try again.") })}><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>
      </div>
      <div role="tablist" aria-label="Notification filter" className="mx-5 flex gap-5 border-b border-[#e9eaf2]">
        {(["all", "attention"] as const).map((value) => <button key={value} type="button" role="tab" id={`notification-${full ? "full" : "popover"}-tab-${value}`} tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "all" : event.key === "End" ? "attention" : value === "all" ? "attention" : "all";
          setTab(next);
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[id$="tab-${next}"]`)?.focus();
        }} aria-controls={`notification-${full ? "full" : "popover"}-items`} className={cn("border-b-2 px-1 pb-3 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === value ? "border-[#975ee2] text-[#6541ad]" : "border-transparent text-[#6a769c]")} onClick={() => setTab(value)}>{value === "all" ? "All" : "Needs attention"}</button>)}
      </div>
      <div id={`notification-${full ? "full" : "popover"}-items`} role="tabpanel" aria-labelledby={`notification-${full ? "full" : "popover"}-tab-${tab}`} className={cn("overflow-y-auto overscroll-contain px-2 py-3", full ? "max-h-[65dvh]" : "max-h-[min(560px,65dvh)]")}>
        {targets.error ? <div role="status" className="mx-3 mb-3 rounded-lg bg-[#f7f4fd] p-3 text-[12px] text-[#6a769c]">Couldn't check current Thing actions. <button type="button" className="font-medium text-[#6541ad] underline" onClick={() => void targets.retry()}>Retry</button></div> : null}
        {inbox.isLoading ? <div role="status" className="flex items-center justify-center gap-2 py-12 text-[12px] text-[#6a769c]"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Loading notifications…</div> : inbox.error && !grouped.length ? <div role="alert" className="p-5 text-center text-[12px] text-[#6a769c]">Couldn't load notifications.<button type="button" className={cn(actionClass, "mt-3")} onClick={() => void inbox.retry()}>Try again</button></div> : (
          <>
            {attention.length ? <><h3 className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6a769c]">Needs attention</h3><ul className="space-y-2">{attention.map(renderRow)}</ul></> : null}
            {tab === "all" && updates.length ? <><h3 className={cn("px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6a769c]", attention.length && "mt-4 border-t border-[#e9eaf2] pt-4")}>Updates</h3><ul className="space-y-1">{updates.map(renderRow)}</ul></> : null}
            {!(tab === "all" ? grouped.length : attention.length) ? <div className="flex flex-col items-center gap-2 py-10 text-center"><span className="rounded-full bg-[#f1ecfc] p-3 text-[#975ee2]"><CheckCheck className="h-6 w-6" /></span><p className="text-[13px] font-medium text-[#20243a]">{targets.ready || tab === "all" ? "You're caught up" : "Checking current Things…"}</p><p className="text-[12px] text-[#6a769c]">{tab === "attention" ? "Only current Things needing action appear here." : "New updates will appear here."}</p></div> : null}
            {full && inbox.hasMore ? <button type="button" className={cn(actionClass, "mt-4 w-full")} disabled={inbox.loadingMore} onClick={() => void inbox.loadMore()}>{inbox.loadingMore ? "Loading…" : "Load older notifications"}</button> : null}
          </>
        )}
      </div>
      {!full ? <button type="button" className="flex min-h-12 items-center justify-center gap-2 border-t border-[#e9eaf2] text-[12px] font-medium text-[#6541ad] hover:bg-[#f7f4fd] focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setOpen(false); setExpanded(true); }}>View all notifications<ArrowRight className="h-3.5 w-3.5" /></button> : null}
    </div>
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><button type="button" className={cn("relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,box-shadow] duration-[520ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", open && "scale-110 bg-[#f5f0ff] text-[#6941c6] shadow-[0_7px_18px_rgba(105,65,166,0.2)]")} aria-label={inbox.unreadCount ? `Notifications, ${inbox.unreadCount} unread` : "Notifications"}><Bell className={cn("h-[18px] w-[18px] transition-transform duration-[520ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none", open && "scale-110 rotate-[-8deg]")} />{inbox.unread ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#975ee2]" /> : null}</button></PopoverTrigger>
        <PopoverContent align="end" sideOffset={12} collisionPadding={12} className="w-[440px] max-w-[calc(100vw-24px)] origin-top-right overflow-hidden rounded-2xl border-[#e9eaf2] bg-white p-0 text-[#20243a] shadow-[0_22px_54px_rgba(28,25,56,0.2)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.92] data-[state=open]:slide-in-from-top-2 data-[state=open]:duration-[520ms] data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.96] data-[state=closed]:slide-out-to-top-2 data-[state=closed]:duration-[340ms] data-[state=closed]:ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:animate-none">{panel(false)}</PopoverContent>
      </Popover>
      <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="max-w-xl gap-0 overflow-hidden rounded-2xl p-0"><DialogTitle className="sr-only">All notifications</DialogTitle><DialogDescription className="sr-only">Your updates and Things needing attention.</DialogDescription><div className="pt-5">{panel(true)}</div></DialogContent></Dialog>
      <Dialog open={Boolean(selectedId)} onOpenChange={(next) => { if (!next) setSelectedId(null); }}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto rounded-2xl p-5 sm:p-7">
          <DialogTitle className="sr-only">Thing details</DialogTitle><DialogDescription className="sr-only">Review and manage the Thing from your notification.</DialogDescription>
          {selected.isLoading ? <p role="status" className="py-10 text-center text-[13px] text-muted-foreground">Loading Thing…</p> : selected.thing ? <ThingDetailContent key={selected.thing.id} initialThing={selected.thing} variant="court" /> : <div className="py-8 text-center"><p>This Thing is no longer available or couldn't be loaded.</p><button type="button" className={cn(actionClass, "mt-3")} onClick={() => void selected.refetch()}>Try again</button></div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
