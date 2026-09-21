import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Phone, Video, MessageSquare, Folder, PhoneCall } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useSession } from "@/hooks/useSession";
import { usePresence } from "@/features/people/presence";
import { supabase } from "@/integrations/supabase/client";
import { useListMessages } from "@/features/lists/use-list-messages";
import { ListChatPanel } from "@/features/lists/ListChatPanel";
import { useListCall } from "@/features/calls/use-list-call";
import { ListCallPanel } from "@/features/calls/ListCallPanel";
import { announceCall, getDeviceId } from "@/features/calls/call-lobby";
import { consumeAutojoin, onAutojoin } from "@/features/calls/autojoin-signal";
import { StartCallDialog, type CallPerson } from "@/features/calls/StartCallDialog";
import { useConversation } from "@/features/hub/use-conversations";
import { useLists } from "@/features/lists/use-lists";
import { HubFilesPanel } from "./HubFilesPanel";
import { cn } from "@/lib/utils";

export type HubTab = "chat" | "files" | "call";

export function ConversationWorkspace({
  listId,
  tab,
  onTabChange,
  startCall = false,
  autoJoin = false,
  onStartConsumed,
}: {
  listId: string;
  tab: HubTab;
  onTabChange: (t: HubTab) => void;
  startCall?: boolean;
  /** Join (not start) an in-progress call, e.g. arriving from an incoming ring. */
  autoJoin?: boolean;
  onStartConsumed?: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useSession();
  const online = usePresence();
  const { conversation } = useConversation(listId);
  const { lists } = useLists();
  const chat = useListMessages(listId);

  const sessionSuffix = useMemo(
    () =>
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10),
    [],
  );
  const selfId = `${user?.id || "anon"}:${sessionSuffix}`;
  const selfName =
    (user?.user_metadata?.display_name as string | undefined) || user?.email?.split("@")[0] || "You";
  const call = useListCall(listId, selfId, selfName);

  const title = conversation?.title ?? "Conversation";
  const isDm = conversation?.kind === "dm";
  const selectedList = useMemo(() => lists.find((list) => list.id === listId), [lists, listId]);
  const other = conversation?.others[0];
  const isOnline = isDm && other ? online.has(other.id) : false;
  const memberIds = useMemo(() => (conversation?.others ?? []).map((o) => o.id), [conversation]);
  const callPeople: CallPerson[] = useMemo(
    () =>
      (conversation?.others ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        avatarUrl: o.avatarUrl,
      })),
    [conversation],
  );

  const [startCallOpen, setStartCallOpen] = useState(false);
  const [startCallDefaultVideo, setStartCallDefaultVideo] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Ring + push a chosen set of people without touching the caller's own join
  // state (used both when starting a call and when inviting mid-call).
  const ringAndAnnounce = (selectedIds: string[]) => {
    void announceCall({
      listId,
      listName: title,
      fromDeviceId: getDeviceId(),
      fromName: selfName,
      memberIds: selectedIds,
      kind: conversation?.kind ?? "group",
    });
    chat.sendSystem.mutate("started a call");
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const at = sess.session?.access_token;
        if (at) {
          void fetch("/api/calls/ring", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${at}` },
            body: JSON.stringify({ listId, memberIds: selectedIds }),
          });
        }
      } catch {
        // push is best-effort
      }
    })();
  };

  const startOrJoinCall = async (withVideo: boolean, selectedIds?: string[]) => {
    if (call.joined) {
      call.leave();
      return;
    }
    const ok = await call.join();
    if (!ok) return;
    if (!withVideo) call.toggleCamera(); // audio-only: drop the camera immediately
    ringAndAnnounce(selectedIds ?? memberIds);
  };

  const openStartCall = (defaultVideo: boolean) => {
    setStartCallDefaultVideo(defaultVideo);
    setStartCallOpen(true);
  };

  // Auto-start a call when arriving from a contact's "Call" action. This is
  // already an explicit, single-target call — it rings everyone directly,
  // skipping the Start Call picker.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!startCall || startedRef.current) return;
    if (!(user?.id) || call.joined || call.connecting) return;
    startedRef.current = true;
    onTabChange("call");
    void startOrJoinCall(true);
    onStartConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCall, user?.id, call.joined, call.connecting]);

  // Join when an incoming ring's "Join" is tapped while this conversation is open.
  useEffect(() => {
    const off = onAutojoin((id) => {
      if (id !== listId) return;
      consumeAutojoin(listId);
      if (!call.joined && !call.connecting) void call.join();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, call.joined, call.connecting]);

  // Auto-join when arriving fresh from an incoming ring (banner/push "Join").
  // Covers navigation into the page: the in-memory signal, a sessionStorage
  // one-shot flag, and the ?call=1 search param, without re-announcing a call.
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    let shouldJoin = autoJoin || consumeAutojoin(listId);
    try {
      if (!shouldJoin && sessionStorage.getItem(`katalist.autojoin.${listId}`) === "1") {
        shouldJoin = true;
      }
      sessionStorage.removeItem(`katalist.autojoin.${listId}`);
    } catch {
      /* ignore */
    }
    if (!shouldJoin) return;
    if (!(user?.id) || call.joined || call.connecting) return;
    autoJoinedRef.current = true;
    onTabChange("call");
    void call.join();
    onStartConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, listId, user?.id, call.joined, call.connecting]);

  const tabs: { id: HubTab; label: string; Icon: typeof MessageSquare }[] = [
    { id: "chat", label: "Chat", Icon: MessageSquare },
    { id: "files", label: "Files", Icon: Folder },
    { id: "call", label: "Call", Icon: PhoneCall },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#fbfbfe]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[#eef0f6] bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/team" })}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8487a7] hover:bg-[#f4f5fb] md:hidden"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="relative shrink-0">
            {selectedList?.coverUrl ? (
              <img
                src={selectedList.coverUrl}
                alt={`${title} cover`}
                className="h-10 w-10 rounded-[10px] object-cover outline outline-1 outline-black/10"
              />
            ) : (
              <PersonAvatar name={title} src={conversation?.avatarUrl ?? null} size={40} />
            )}
            {isOnline ? (
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#12a15f]" />
            ) : null}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-[#000533]">{title}</p>
            <p className="truncate text-[12px] text-[#6a769c]">
              {isDm
                ? isOnline
                  ? "Online"
                  : "Offline"
                : `${conversation?.memberCount ?? 0} members`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => (call.joined ? void startOrJoinCall(false) : openStartCall(false))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#3d3f74] hover:bg-[#f4f5fb]"
            aria-label="Audio call"
            title="Audio call"
          >
            <Phone className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => (call.joined ? void startOrJoinCall(true) : openStartCall(true))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#3d3f74] hover:bg-[#f4f5fb]"
            aria-label="Video call"
            title="Video call"
          >
            <Video className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#eef0f6] bg-white px-5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
              tab === t.id ? "border-[#6638ec] text-[#6638ec]" : "border-transparent text-[#6a769c] hover:text-[#000533]",
            )}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "chat" ? (
          <ListChatPanel listId={listId} placeholderName={title} />
        ) : tab === "files" ? (
          <HubFilesPanel listId={listId} conversationTitle={title} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            {call.joined || call.connecting ? (
              <p className="text-[13px] text-[#6a769c]">You are in the call. Controls are at the bottom of the screen.</p>
            ) : (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f0e9fb]">
                  <PhoneCall className="h-7 w-7 text-[#6638ec]" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-[#000533]">Start a call with {title}</p>
                  <p className="mt-1 text-[12.5px] text-[#6a769c]">Everyone in this conversation will be notified.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openStartCall(false)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#ebecf7] px-4 text-[13px] font-semibold text-[#3d3f74] hover:border-[#975ee2]"
                  >
                    <Phone className="h-4 w-4" />
                    Audio
                  </button>
                  <button
                    type="button"
                    onClick={() => openStartCall(true)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#975ee2] px-4 text-[13px] font-semibold text-white hover:brightness-95"
                  >
                    <Video className="h-4 w-4" />
                    Video
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* The call surface (floating window) renders itself when joined/connecting. */}
      <ListCallPanel
        call={call}
        selfName={selfName}
        listId={listId}
        title={title}
        onInvite={() => setInviteOpen(true)}
      />
      <StartCallDialog
        open={startCallOpen}
        onOpenChange={setStartCallOpen}
        people={callPeople}
        defaultVideo={startCallDefaultVideo}
        onStart={({ withVideo, selectedIds }) => void startOrJoinCall(withVideo, selectedIds)}
      />
      <StartCallDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        people={callPeople}
        variant="invite"
        onInvite={(selectedIds) => ringAndAnnounce(selectedIds)}
      />
    </div>
  );
}
