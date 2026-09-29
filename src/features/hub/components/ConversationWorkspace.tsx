import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Phone, Video, MessageSquare, Folder, PhoneCall, Search, FileText, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/hooks/useSession";
import { usePresence } from "@/features/people/presence";
import { supabase } from "@/integrations/supabase/client";
import { useListMessages, useListMessageSearch, useListSystemHistory, type ListChatMessage } from "@/features/lists/use-list-messages";
import { ListChatPanel, type ListChatPanelHandle } from "@/features/lists/ListChatPanel";
import { useListCall } from "@/features/calls/use-list-call";
import { ListCallPanel } from "@/features/calls/ListCallPanel";
import { announceCall, getDeviceId } from "@/features/calls/call-lobby";
import { consumeAutojoin, onAutojoin } from "@/features/calls/autojoin-signal";
import { StartCallDialog, type CallPerson } from "@/features/calls/StartCallDialog";
import { useConversation } from "@/features/hub/use-conversations";
import { useLists } from "@/features/lists/use-lists";
import { HubFilesPanel } from "./HubFilesPanel";
import { getHubFileUrl, searchHubFiles, type HubFile } from "@/features/hub/use-hub-files";
import { markConversationAsRead } from "@/features/hub/chat-read-state";
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
  const qc = useQueryClient();
  const { user } = useSession();
  const online = usePresence();
  const { conversation, isLoading: conversationLoading, error: conversationError, refetch: refetchConversation } = useConversation(listId);
  // B-03/C-06: a revoked membership resolves as a successful, empty RLS
  // read (no thrown error at all -- see use-conversations.ts's own
  // `.maybeSingle()` comment), identically to a genuinely deleted List --
  // `conversation` settles to null either way. A genuinely transient
  // fetch failure (network blip) is the one case still worth a real Retry
  // rather than the permanent "no longer available" message.
  const conversationGone = !conversationLoading && !conversation && !conversationError;
  const conversationLoadFailed = !conversationLoading && !conversation && Boolean(conversationError);
  const { lists } = useLists();
  const chat = useListMessages(listId);
  const systemHistory = useListSystemHistory(listId, tab === "call");

  // Opening a conversation here — via the sidebar, a direct link, or
  // anywhere else — should clear its unread state, same as opening it
  // through the chat-heads bubble/pop-out already does (both read from the
  // same device-local last-read mark). G04: only while the tab is actually
  // active -- marking read the instant a backgrounded/hidden tab happens
  // to hold this conversation would clear "unread" for content the user
  // never actually looked at. Re-checked on visibilitychange so returning
  // to an already-open conversation still marks it read.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const markIfVisible = () => {
      if (document.visibilityState !== "hidden") markConversationAsRead(listId, user?.id);
    };
    markIfVisible();
    document.addEventListener("visibilitychange", markIfVisible);
    return () => document.removeEventListener("visibilitychange", markIfVisible);
  }, [listId, user?.id]);

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

  const callHistory = systemHistory.messages;
  const chatAttachments = useMemo(
    () =>
      chat.messages
        .filter((m) => m.attachment)
        .map((m) => ({ id: m.id, attachment: m.attachment!, author: m.author, at: m.at })),
    [chat.messages],
  );

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

  // Combined Chat + Files search (distinct from ListChatPanel's own
  // chat-only search) — messages are already fetched here via `chat`, so
  // only file results need a live query; debounced to avoid a query per
  // keystroke.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [fileResults, setFileResults] = useState<HubFile[]>([]);
  const [filesSearching, setFilesSearching] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ name: string; url: string } | null>(null);
  const chatPanelRef = useRef<ListChatPanelHandle | null>(null);
  const [pendingSearchMessage, setPendingSearchMessage] = useState<ListChatMessage | null>(null);
  const messageSearch = useListMessageSearch(listId, debouncedQuery);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(id);
  }, [searchQuery]);

  useEffect(() => {
    if (chat.accessLost) {
      setFileResults([]);
      setPendingSearchMessage(null);
      return;
    }
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setFileResults([]);
      return;
    }
    let cancelled = false;
    setFilesSearching(true);
    void searchHubFiles(qc, listId, debouncedQuery)
      .then((files) => {
        if (!cancelled) setFileResults(files);
      })
      .finally(() => {
        if (!cancelled) setFilesSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listId, debouncedQuery, qc, chat.accessLost]);

  useEffect(() => {
    if (tab === "chat" && pendingSearchMessage) {
      chatPanelRef.current?.showMessageResult(pendingSearchMessage);
      setPendingSearchMessage(null);
    }
  }, [tab, pendingSearchMessage]);

  const messageResults = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q || q.length < 2 || chat.accessLost) return [];
    return (messageSearch.data ?? []).filter((m) => m.kind !== "system");
  }, [messageSearch.data, debouncedQuery, chat.accessLost]);
  const visibleFileResults = chat.accessLost ? [] : fileResults;

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  const openFileResult = async (f: HubFile) => {
    if (!f.storagePath) return;
    const url = await getHubFileUrl(f.storagePath);
    if (!url) return;
    if ((f.mime ?? "").startsWith("image/")) {
      setImagePreview({ name: f.name, url });
      return;
    }
    window.open(url, "_blank", "noopener");
  };

  // Ring + push a chosen set of people without touching the caller's own join
  // state (used both when starting a call and when inviting mid-call).
  const ringAndAnnounce = (selectedIds: string[], withVideo: boolean) => {
    void announceCall({
      listId,
      listName: title,
      fromDeviceId: getDeviceId(),
      fromName: selfName,
      fromAvatarUrl: (user?.user_metadata?.avatar_url as string | undefined) ?? null,
      memberIds: selectedIds,
      callType: withVideo ? "video" : "audio",
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
    ringAndAnnounce(selectedIds ?? memberIds, withVideo);
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8487a7] hover:bg-[#f4f5fb] md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            {conversationLoading ? (
              <>
                <span className="block h-4 w-32 animate-pulse rounded bg-[#eef0f6]" />
                <span className="mt-1 block h-3 w-20 animate-pulse rounded bg-[#eef0f6]" />
              </>
            ) : (
              <>
                <p className="truncate text-[15px] font-semibold text-[#000533]">{title}</p>
                <p className="truncate text-[12px] text-[#6a769c]">
                  {isDm
                    ? isOnline
                      ? "Online"
                      : "Offline"
                    : `${conversation?.memberCount ?? 0} members`}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen((o) => !o)}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              searchOpen ? "bg-[#f0e9fb] text-[#975ee2]" : "text-[#3d3f74] hover:bg-[#f4f5fb]",
            )}
            aria-label="Search this conversation"
            title="Search messages and files"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => (call.joined ? void startOrJoinCall(false) : openStartCall(false))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#3d3f74] hover:bg-[#f4f5fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Audio call"
            title="Audio call"
          >
            <Phone className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => (call.joined ? void startOrJoinCall(true) : openStartCall(true))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#3d3f74] hover:bg-[#f4f5fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      {/* Combined Chat + Files search — separate from ListChatPanel's own
          chat-only search box; this one spans both tabs at once. */}
      {searchOpen && (
        <div className="border-b border-[#eef0f6] bg-white px-5 py-3">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[#8487a7]" />
            <input
              autoFocus
              value={searchQuery}
              maxLength={80}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && closeSearch()}
              placeholder="Search messages and files in this conversation…"
              className="h-[38px] w-full rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] pl-9 pr-9 text-[12.5px] text-[#000533] outline-none transition-colors placeholder:text-[#8487a7] focus:border-[#975ee2]"
            />
            <button
              type="button"
              onClick={closeSearch}
              className="absolute right-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[#8487a7] hover:bg-[#f0e9fb] hover:text-[#975ee2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {debouncedQuery.length >= 2 ? (
            <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">
              <div>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">
                  Messages {messageResults.length > 0 ? `(${messageResults.length})` : ""}
                </p>
                {messageSearch.isFetching ? (
                  <p className="text-[12px] text-[#8487a7]">Searching all messages…</p>
                ) : messageSearch.error ? (
                  <p role="alert" className="text-[12px] text-red-600">Message search failed. Edit your search to retry.</p>
                ) : messageResults.length === 0 ? (
                  <p className="text-[12px] text-[#8487a7]">No matching messages.</p>
                ) : (
                  <div className="space-y-1">
                    {messageResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onTabChange("chat");
                          setPendingSearchMessage(m);
                          closeSearch();
                        }}
                        className="flex w-full items-start gap-2 rounded-[9px] px-2 py-1.5 text-left hover:bg-[#faf9fe]"
                      >
                        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#975ee2]" />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-[#3d3f74]">
                          <span className="font-medium text-[#000533]">{m.author}:</span> {m.body || "📎 attachment"}
                        </span>
                      </button>
                    ))}
                    {messageSearch.hasMore ? <button type="button" disabled={messageSearch.isLoadingMore} onClick={() => void messageSearch.loadMore()} className="w-full rounded-lg border border-[#ebecf7] px-3 py-1 text-xs text-[#6638ec] disabled:opacity-50">{messageSearch.isLoadingMore ? "Loading more…" : "Load more message results"}</button> : null}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">
                  Files {visibleFileResults.length > 0 ? `(${visibleFileResults.length})` : ""}
                </p>
                {filesSearching ? (
                  <p className="text-[12px] text-[#8487a7]">Searching…</p>
                ) : visibleFileResults.length === 0 ? (
                  <p className="text-[12px] text-[#8487a7]">No matching files.</p>
                ) : (
                  <div className="space-y-1">
                    {visibleFileResults.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => void openFileResult(f)}
                        className="flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left hover:bg-[#faf9fe]"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[#975ee2]" />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-[#3d3f74]">{f.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* B-03/C-06: the conversation-metadata header (title/member count
          above) falls back to generic placeholder text when `conversation`
          is null, which previously happened silently for a revoked
          membership or a genuinely deleted List -- the chat/files panels
          below already correctly self-detect and surface this via their
          own `accessLost`/`error` state (see ListChatPanel.tsx/
          HubFilesPanel.tsx), but the header itself gave no indication.
          This banner makes the header-level state truthful too, without
          touching the already-correct body panels. */}
      {conversationGone || conversationLoadFailed ? (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-[#eef0f6] bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900">
          <span>
            {conversationGone
              ? "This conversation is no longer available."
              : "Couldn't confirm this conversation is still available."}
          </span>
          {conversationLoadFailed ? (
            <button type="button" onClick={() => void refetchConversation()} className="shrink-0 font-semibold underline">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "chat" ? (
          <ListChatPanel ref={chatPanelRef} listId={listId} placeholderName={title} />
        ) : tab === "files" ? (
          <HubFilesPanel listId={listId} conversationTitle={title} chatAttachments={chatAttachments} chatAccessLost={chat.accessLost} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
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
            {callHistory.length > 0 && (
              <div className="border-t border-[#eef0f6] px-5 py-4">
                <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">Call history</p>
                <div className="space-y-2">
                  {callHistory
                    .map((m) => (
                      <div key={m.id} className="flex items-center gap-3 rounded-[10px] border border-[#eef0f6] px-3 py-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0e9fb] text-[#6638ec]">
                          <PhoneCall className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <p className="truncate text-[12.5px] text-[#000533]">
                            <span className="font-medium">{m.author}</span> {m.body}
                          </p>
                          <p className="text-[12px] text-[#8487a7]">
                            {new Date(m.at).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                  {systemHistory.hasMore ? <button type="button" disabled={systemHistory.isLoadingMore} onClick={() => void systemHistory.loadMore()} className="w-full rounded-lg border border-[#eef0f6] px-3 py-2 text-xs text-[#6638ec] disabled:opacity-50">{systemHistory.isLoadingMore ? "Loading older calls…" : "Load older call history"}</button> : null}
                </div>
              </div>
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
        onInvite={(selectedIds) => ringAndAnnounce(selectedIds, !call.cameraOff)}
      />

      {/* Giant in-app preview for image search results — same convention as
          the Files tab: never redirect to a new tab for an image. */}
      <Dialog open={Boolean(imagePreview)} onOpenChange={(open) => !open && setImagePreview(null)}>
        <DialogContent className="max-w-[92vw] w-fit gap-0 border-none bg-transparent p-0 shadow-none sm:rounded-none">
          {imagePreview ? (
            <div className="flex max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white katalist-elevation-dialog">
              <div className="flex items-center justify-between gap-3 border-b border-[#eef0f6] px-4 py-2.5">
                <DialogTitle className="min-w-0 truncate text-[13px] font-medium text-[#000533]">
                  {imagePreview.name}
                </DialogTitle>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-[#0b0c29] p-2">
                <img
                  src={imagePreview.url}
                  alt={imagePreview.name}
                  className="mx-auto max-h-[80vh] w-auto max-w-full object-contain"
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
