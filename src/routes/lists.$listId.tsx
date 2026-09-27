import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Users,
  Calendar,
  Phone,
  PhoneOff,
  Video,
  MoreVertical,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useListCall } from "@/features/calls/use-list-call";
import { ListCallPanel } from "@/features/calls/ListCallPanel";
import { announceCall, getDeviceId } from "@/features/calls/call-lobby";
import { useListMeetings } from "@/features/lists/use-list-meetings";
import { ScheduleMeetingDialog } from "@/features/lists/ScheduleMeetingDialog";
import { StartCallDialog, type CallPerson } from "@/features/calls/StartCallDialog";
import { consumeAutojoin, onAutojoin } from "@/features/calls/autojoin-signal";
import { ListDetailSkeleton } from "@/components/katalist/ScreenSkeletons";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { supabase } from "@/integrations/supabase/client";
import { type ThingFile } from "@/features/things/PDFViewer";
import { formatCourtDue } from "@/features/court/court-view-model";
import { laneOf, type Person } from "@/domain/thing";
import { format, isToday, isTomorrow } from "date-fns";
import { useListThings } from "@/features/lists/use-list-things";
import { useListThingsFilter } from "@/features/lists/use-list-things-filter";
import { useList } from "@/features/lists/use-lists";
import { currentDemoActorId } from "@/features/demo/identities";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useListMessages } from "@/features/lists/use-list-messages";
import { ListChatPanel } from "@/features/lists/ListChatPanel";
import { ListInviteDialog, type ListInviteRole } from "@/features/lists/components/ListInviteDialog";
import { ListMembersSection, type MemberRoleFilter } from "@/features/lists/components/ListMembersSection";
import { ListThingsSection, type ListLaneId } from "@/features/lists/components/ListThingsSection";
import type { ListMember } from "@/features/lists/fixtures";
import { domainErrorMessage, extractErrorMessage } from "@/lib/domain-error";
import { classifyAsyncError } from "@/lib/query-policy";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { matchAvatarByName } from "@/features/people/directory";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { rpcAddListMember, rpcChangeListRole, rpcRemoveListMember } from "@/features/things/rpc";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/lists/$listId")({
  component: ListDetailPage,
});

type TabType = "things" | "chat" | "members";
type DueFilterType = "all" | "today" | "overdue" | "no_due";

function ListDetailPage() {
  const { listId } = Route.useParams();
  const listIdRef = useRef(listId);
  listIdRef.current = listId;
  const qc = useQueryClient();
  useLocalVersion();
  const { list, isLoading, error, refetch: refetchList } = useList(listId);
  const chat = useListMessages(listId);
  const { things: listThings, myActorId } = useListThings(listId);
  const { user, session } = useSession();
  const preview = isPreviewSession(session);
  // Unique per-device call identity. Using only user.id collides when the same
  // account is open on two devices, so each side would filter the other out as
  // "self" and never connect. A per-session suffix keeps every device distinct.
  const sessionSuffix = useMemo(
    () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)),
    [],
  );
  const selfId = `${user?.id || myActorId || "anon"}:${sessionSuffix}`;
  const selfName =
    list?.members?.find((m) => m.actorId === myActorId)?.name ||
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split("@")[0] ||
    "You";
  const call = useListCall(listId, selfId, selfName);
  const meetingsHook = useListMeetings(listId);
  const [scheduleMeetingOpen, setScheduleMeetingOpen] = useState(false);
  const [showAllMeetings, setShowAllMeetings] = useState(false);
  const [startCallOpen, setStartCallOpen] = useState(false);
  const [startCallDefaultVideo, setStartCallDefaultVideo] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Other list members, for the "Start a call" / "Invite" picker.
  const callPeople: CallPerson[] = useMemo(
    () =>
      (list?.members ?? [])
        .filter((m) => (m.profileId ?? m.actorId) !== (user?.id ?? myActorId))
        .map((m) => ({
          id: m.profileId ?? m.actorId ?? m.name,
          name: m.name,
          initials: m.initials,
          avatarUrl: m.avatarUrl,
        })),
    [list?.members, user?.id, myActorId],
  );

  // Ring + push a chosen set of people (client picker's selection, or "everyone"
  // as a default) without touching the caller's own join state.
  const ringAndAnnounce = (selectedProfileIds: string[], meetingTitle?: string) => {
    void announceCall({
      listId,
      listName: list?.name ?? "a list",
      fromDeviceId: getDeviceId(),
      fromName: selfName,
      memberIds: selectedProfileIds,
    });
    // Record a call-history entry that renders inline in the chat timeline.
    chat.sendSystem.mutate(meetingTitle ? `started the meeting "${meetingTitle}"` : "started a call");
    // Also push to members who don't have the app open (best-effort).
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const at = sess.session?.access_token;
        if (at) {
          void fetch("/api/calls/ring", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${at}` },
            body: JSON.stringify({ listId, memberIds: selectedProfileIds }),
          });
        }
      } catch {
        // push is best-effort
      }
    })();
  };

  // Start (or leave) a call. Starting also rings the given (or every) list
  // member. withVideo=false drops the camera right after joining (audio-only),
  // and an optional meetingTitle personalizes the chat-history entry (e.g.
  // "started the meeting Design Review" for a scheduled meeting's "Join now").
  const startOrJoinCall = async (withVideo = true, meetingTitle?: string, selectedProfileIds?: string[]) => {
    if (call.joined) {
      call.leave();
      return;
    }
    const ok = await call.join();
    if (!ok) return;
    if (!withVideo) call.toggleCamera();
    const allMemberIds = (list?.members ?? [])
      .map((m) => m.profileId)
      .filter((x): x is string => Boolean(x));
    ringAndAnnounce(selectedProfileIds ?? allMemberIds, meetingTitle);
  };

  const openStartCall = (defaultVideo: boolean) => {
    setStartCallDefaultVideo(defaultVideo);
    setStartCallOpen(true);
  };

  // Auto-join when arriving from an incoming-call ring: either the in-app ring
  // (sessionStorage handoff) or a push-notification click (?call=1 in the URL).
  useEffect(() => {
    // Wait until the session identity is ready so the call joins with a real
    // selfId (not "anon"); this effect retries when user?.id arrives.
    const ready = Boolean(user?.id || myActorId);
    if (!ready || call.joined || call.connecting) return;

    let wanted = consumeAutojoin(listId);
    try {
      if (sessionStorage.getItem(`katalist.autojoin.${listId}`)) {
        sessionStorage.removeItem(`katalist.autojoin.${listId}`);
        wanted = true;
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("call") === "1") {
      wanted = true;
    }
    if (wanted) void call.join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, user?.id, myActorId, call.joined, call.connecting]);

  // Live delivery: when the ring banner's "Join" is tapped while this list is
  // already open, join immediately (navigating to the same route would not
  // remount the page, so we cannot rely on the effect above).
  useEffect(() => {
    const off = onAutojoin((id) => {
      if (id !== listId) return;
      consumeAutojoin(listId);
      if (!call.joined && !call.connecting) void call.join();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, call.joined, call.connecting]);
  const assignablePeople = useAssignablePeople();

  const [tab, setTab] = useState<TabType>("things");
  const [selectedState, setSelectedState] = useState<{ listId: string; thingId: string | null }>(() => ({
    listId,
    thingId: null,
  }));
  if (selectedState.listId !== listId) {
    setSelectedState({ listId, thingId: null });
  }
  const selectedId = selectedState.listId === listId ? selectedState.thingId : null;
  const setSelectedId = (thingId: string | null) => setSelectedState({ listId, thingId });
  const [navLane, setNavLane] = useState<ListLaneId>("now");
  const [navSearch, setNavSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<ThingFile | null>(null);

  // Things tab filters & search. G02: persisted per profile+List so it
  // survives navigating away and back -- "all" (every Thing, including
  // sorted/cancelled) is the compatibility default when nothing has been
  // saved yet, matching the pre-existing behavior before this filter had a
  // UI control at all.
  const filterIdentityId = preview ? currentDemoActorId() : user?.id ?? null;
  const { value: thingsFilter, setValue: setThingsFilter } = useListThingsFilter(filterIdentityId, listId);
  const [dueFilter, setDueFilter] = useState<DueFilterType>("all");
  const [personFilter, setPersonFilter] = useState<string | null>(null);

  // Members tab state
  const [memberRoleFilter, setMemberRoleFilter] = useState<MemberRoleFilter>("all");
  const [memberSearch, setMemberSearch] = useState("");
  const [inviting, setInviting] = useState(false);
  const [addingPersonId, setAddingPersonId] = useState<string | null>(null);
  const memberOperationKeysRef = useRef(new Set<string>());

  const viewOnly = list?.role === "view_only";
  const selected = listThings.find((t) => t.id === selectedId) ?? null;

  // Unique collaborators in this list (deduped by normalized name)
  const listCollaborators = useMemo(() => {
    const map = new Map<string, { id: string; name: string; initials: string; avatarUrl?: string | null; ids: Set<string> }>();

    const recordPerson = (p?: { id?: string; name?: string; initials?: string; avatarUrl?: string | null }) => {
      if (!p || !p.name || p.name === "Someone" || p.name.trim() === "") return;
      const normName = p.name.trim().toLowerCase();
      const existing = map.get(normName);
      if (existing) {
        if (p.id) existing.ids.add(p.id);
        if (!existing.avatarUrl && p.avatarUrl) existing.avatarUrl = p.avatarUrl;
      } else {
        map.set(normName, {
          id: p.id || normName,
          name: p.name.trim(),
          initials: p.initials || p.name.trim().slice(0, 2).toUpperCase(),
          avatarUrl: p.avatarUrl || matchAvatarByName(p.name.trim()),
          ids: new Set(p.id ? [p.id] : []),
        });
      }
    };

    if (list?.members) {
      for (const m of list.members) {
        recordPerson({
          id: m.actorId || m.profileId,
          name: m.name,
          initials: m.initials,
          avatarUrl: m.avatarUrl,
        });
      }
    }
    for (const t of listThings) {
      recordPerson(t.assignee);
      recordPerson(t.owner);
    }
    return Array.from(map.values());
  }, [listThings, list]);

  // Filtered & Sorted Things
  const filteredThings = useMemo(() => {
    const list_ = listThings.filter((t) => {
      // Quick filter. "active" = nonterminal (neither sorted nor
      // cancelled) -- G02's own default view; "all" (the pre-existing
      // default, kept for compatibility) includes terminal Things too.
      if (thingsFilter === "active" && (t.workStatus === "sorted" || t.workStatus === "cancelled")) return false;
      if (thingsFilter === "mine" && t.assignee.id !== myActorId) return false;
      if (thingsFilter === "theirs" && t.assignee.id === myActorId) return false;
      if (thingsFilter === "waiting" && t.acknowledgement !== "waiting_for_catch") return false;
      if (thingsFilter === "progress" && t.workStatus !== "under_progress") return false;
      if (thingsFilter === "completed" && t.workStatus !== "sorted") return false;
      if (thingsFilter === "cancelled" && t.workStatus !== "cancelled") return false;
      if (thingsFilter === "sorted" && t.workStatus !== "sorted") return false;

      // Person filter
      if (personFilter) {
        const collab = listCollaborators.find(
          (c) => c.name.toLowerCase() === personFilter.toLowerCase() || c.ids.has(personFilter),
        );
        const matchesAssignee =
          t.assignee &&
          (t.assignee.name.toLowerCase() === personFilter.toLowerCase() ||
            (collab?.ids && collab.ids.has(t.assignee.id)));
        const matchesOwner =
          t.owner &&
          (t.owner.name.toLowerCase() === personFilter.toLowerCase() ||
            (collab?.ids && collab.ids.has(t.owner.id)));
        if (!matchesAssignee && !matchesOwner) return false;
      }

      // Due filter
      if (dueFilter === "no_due" && t.dueAt != null) return false;
      if (dueFilter === "today") {
        if (!t.dueAt) return false;
        const d = new Date(t.dueAt);
        const now = new Date();
        const sameDay =
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate();
        if (!sameDay) return false;
      }
      if (dueFilter === "overdue") {
        if (!t.dueAt) return false;
        if (new Date(t.dueAt).getTime() >= Date.now()) return false;
      }

      return true;
    });

    // The route exposes no sort control: due-soon is the documented fixed
    // order, so keep it derived instead of retaining inert option state.
    return [...list_].sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  }, [listThings, thingsFilter, dueFilter, personFilter, myActorId, listCollaborators]);

  // Members search & filter
  const filteredMembers = useMemo(() => {
    const rawMembers = list?.members ?? [];
    const seen = new Set<string>();
    const deduped: typeof rawMembers = [];

    for (const m of rawMembers) {
      const key = (m.name || "").toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (m.profileId) seen.add(m.profileId);
      deduped.push(m);
    }

    return deduped.filter((m) => {
      if (memberRoleFilter !== "all" && m.role !== memberRoleFilter) return false;
      if (memberSearch.trim()) {
        const query = memberSearch.toLowerCase();
        return m.name.toLowerCase().includes(query);
      }
      return true;
    });
  }, [list?.members, memberRoleFilter, memberSearch]);

  // ── Things three-pane derived state ──────────────────────────────────────
  const grouped = useMemo(() => {
    const g: Record<"now" | "next" | "later", typeof filteredThings> = { now: [], next: [], later: [] };
    for (const t of filteredThings) g[laneOf(t)].push(t);
    return g;
  }, [filteredThings]);
  const laneTabs = [
    { id: "now" as const, label: "Now", color: "#fe1016" },
    { id: "next" as const, label: "NEXT", color: "#022dfb" },
    { id: "later" as const, label: "LATER", color: "#5c0bed" },
  ];
  const laneThings = useMemo(
    () => grouped[navLane].filter((t) => t.title.toLowerCase().includes(navSearch.trim().toLowerCase())),
    [grouped, navLane, navSearch],
  );
  const laneCounts: Record<ListLaneId, number> = {
    now: grouped.now.length,
    next: grouped.next.length,
    later: grouped.later.length,
  };
  const selectLane = (lane: ListLaneId) => {
    setNavLane(lane);
    setSelectedId(null);
  };
  const closeSelectedThing = () => setSelectedId(null);
  const clearThingFilters = () => {
    setThingsFilter("all");
    setDueFilter("all");
    setPersonFilter(null);
  };
  const selectedIsVisible = Boolean(selected && filteredThings.some((thing) => thing.id === selected.id));
  const activeThing = selectedId
    ? selectedIsVisible ? selected : null
    : laneThings[0] ?? filteredThings[0] ?? null;
  const selTint =
    navLane === "next"
      ? { bg: "#eef4ff", border: "#0b62f8" }
      : navLane === "later"
        ? { bg: "#f4f0ff", border: "#641dfb" }
        : { bg: "#fef0f4", border: "#fe0734" };
  // Reset/auto-select the file preview whenever the active Thing changes so a
  // previous Thing's image never stays on screen; a Thing with files shows its
  // first file, a Thing without files shows no preview.
  const activeThingId = activeThing?.id ?? null;
  useEffect(() => {
    setSelectedFile(activeThing?.files?.[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThingId]);

  // call.join() can already be in flight here — the autojoin listener and
  // the call's own hooks are created above, unconditionally, regardless of
  // which branch below ends up rendering. Without <ListCallPanel> in every
  // one of these early returns, a "Join" click that lands while the list is
  // still loading would successfully publish media (visible to everyone
  // else on the call) while this tab shows no call window at all, until the
  // list finishes loading and the component reaches the main return below.
  if (isLoading) {
    return (
      <AppShell noPadding hideTopNav>
        <ListDetailSkeleton />
        <ListCallPanel call={call} selfName={selfName} listId={listId} onInvite={() => setInviteOpen(true)} />
      </AppShell>
    );
  }

  if (error) {
    // B-03/C-06: a confirmed access-loss kind (revoked membership, deleted
    // List) is never worth a Retry -- the read didn't fail transiently, it
    // correctly reflects that this identity can no longer see this List.
    // Offering Retry there implies trying again might work, which it won't.
    const kind = classifyAsyncError(error);
    const accessLost = kind === "forbidden" || kind === "unauthenticated" || kind === "not-found";
    return (
      <AppShell title="List" subtitle={accessLost ? "No longer available" : "Couldn’t load"}>
        <p className="text-sm text-muted-foreground">
          {accessLost
            ? "You no longer have access to this List, or it no longer exists."
            : domainErrorMessage(error)}
        </p>
        {!accessLost && (
          <button
            type="button"
            onClick={() => void refetchList()}
            className="mt-3 inline-flex h-8 items-center rounded-md border border-border px-3 text-[12.5px] font-medium hover:bg-muted"
          >
            Retry
          </button>
        )}
        {accessLost ? (
          <Link to="/lists" className="mt-3 inline-block text-sm text-primary">
            Back to Lists
          </Link>
        ) : null}
        <ListCallPanel call={call} selfName={selfName} listId={listId} onInvite={() => setInviteOpen(true)} />
      </AppShell>
    );
  }

  if (!list) {
    return (
      <AppShell title="List" subtitle="Not found">
        <Link to="/lists" className="text-sm text-primary">
          Back to Lists
        </Link>
        <ListCallPanel call={call} selfName={selfName} listId={listId} onInvite={() => setInviteOpen(true)} />
      </AppShell>
    );
  }

  const ownerMembers = filteredMembers.filter((m) => m.role === "owner");
  const collaboratorMembers = filteredMembers.filter((m) => m.role === "collaborator" || (!m.role && m.role !== "owner" && m.role !== "view_only"));
  const viewOnlyMembers = filteredMembers.filter((m) => m.role === "view_only");

  const addMember = async (person: Person, requestedRole: ListInviteRole) => {
    const operationListId = list.id;
    const operationKey = `add:${operationListId}:${person.id}`;
    if (memberOperationKeysRef.current.has(operationKey)) return;
    memberOperationKeysRef.current.add(operationKey);
    setAddingPersonId(person.id);
    const addEpoch = getIdentityEpoch(qc).epoch;
    try {
      await rpcAddListMember(operationListId, person.profileId || person.id, requestedRole);
      if (!isEpochCurrent(qc, addEpoch) || listIdRef.current !== operationListId) return;
      toast.success(`Added ${person.name} as ${requestedRole === "collaborator" ? "Collaborator" : "View only"}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["list", operationListId] }),
        qc.invalidateQueries({ queryKey: ["lists"] }),
        qc.invalidateQueries({ queryKey: ["assignable-people"] }),
      ]);
    } catch (err: unknown) {
      if (isEpochCurrent(qc, addEpoch) && listIdRef.current === operationListId) {
        toast.error(extractErrorMessage(err) ?? "Couldn't add team member. Please try again.");
      }
    } finally {
      memberOperationKeysRef.current.delete(operationKey);
      if (isEpochCurrent(qc, addEpoch) && listIdRef.current === operationListId) {
        setAddingPersonId((current) => (current === person.id ? null : current));
      }
    }
  };

  const changeMemberRole = async (member: ListMember, currentRole: "collaborator" | "view_only") => {
    const operationListId = list.id;
    const memberId = member.profileId || member.actorId || member.name;
    const operationKey = `role:${operationListId}:${memberId}`;
    if (memberOperationKeysRef.current.has(operationKey)) return;
    memberOperationKeysRef.current.add(operationKey);
    const roleEpoch = getIdentityEpoch(qc).epoch;
    try {
      await rpcChangeListRole(
        operationListId,
        memberId,
        currentRole === "collaborator" ? "view_only" : "collaborator",
      );
      if (!isEpochCurrent(qc, roleEpoch) || listIdRef.current !== operationListId) return;
      toast.success(`Updated ${member.name}'s role`);
      await qc.invalidateQueries({ queryKey: ["list", operationListId] });
      await qc.invalidateQueries({ queryKey: ["lists"] });
    } catch (err: unknown) {
      if (isEpochCurrent(qc, roleEpoch) && listIdRef.current === operationListId) {
        toast.error(extractErrorMessage(err) ?? "Failed to update role");
      }
    } finally {
      memberOperationKeysRef.current.delete(operationKey);
    }
  };

  const removeMember = async (member: ListMember) => {
    const operationListId = list.id;
    const memberId = member.profileId || member.actorId || member.name;
    const operationKey = `remove:${operationListId}:${memberId}`;
    if (memberOperationKeysRef.current.has(operationKey)) return;
    memberOperationKeysRef.current.add(operationKey);
    const removeEpoch = getIdentityEpoch(qc).epoch;
    try {
      await rpcRemoveListMember(operationListId, memberId);
      if (!isEpochCurrent(qc, removeEpoch) || listIdRef.current !== operationListId) return;
      toast.success(`Removed ${member.name} from list`);
      await qc.invalidateQueries({ queryKey: ["list", operationListId] });
      await qc.invalidateQueries({ queryKey: ["lists"] });
      await qc.invalidateQueries({ queryKey: ["assignable-people"] });
    } catch (err: unknown) {
      if (isEpochCurrent(qc, removeEpoch) && listIdRef.current === operationListId) {
        toast.error(extractErrorMessage(err) ?? "Failed to remove member");
      }
    } finally {
      memberOperationKeysRef.current.delete(operationKey);
    }
  };

  const copyInviteLink = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard access is unavailable");
      }
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy the invite link. Copy it from the address bar instead.");
    }
  };

  const listInitials =
    list.name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "L";

  return (
    <AppShell noPadding hideTopNav>
      <div className="min-h-screen bg-[#edf2fe] px-4 py-3 space-y-3 pb-20">
        {/* List sub-header + tabs card */}
        <div className="rounded-[10px] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 pt-4 pb-3">
            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/lists"
                className="inline-flex items-center gap-2 rounded-full text-[12.5px] font-medium text-[#6a769c] hover:text-[#000533] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to List</span>
              </Link>
              <div className="h-8 w-px bg-[#eef0f6]" />
              <div className="flex items-center gap-2.5">
                {list.coverUrl ? (
                  <img
                    src={list.coverUrl}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-[6px] object-cover"
                    style={{ viewTransitionName: `list-cover-${list.id}` }}
                  />
                ) : (
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-[6px] bg-[#fee19c] text-[12px] font-medium text-black"
                    style={{ viewTransitionName: `list-cover-${list.id}` }}
                  >
                    {listInitials}
                  </span>
                )}
                <div className="min-w-0">
                  <div
                    className="text-[15px] font-medium text-black leading-tight truncate max-w-[220px]"
                    style={{ viewTransitionName: `list-title-${list.id}` }}
                  >
                    {list.name}
                  </div>
                  <div className="text-[12px] text-[#6a769c]">{list.ownerLine}</div>
                </div>
              </div>
              {listCollaborators.length > 0 && (
                <div className="flex items-center gap-3 pl-1">
                  <button
                    type="button"
                    onClick={() => setPersonFilter(null)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                      personFilter === null
                        ? "border-[#c9c4fc] bg-[#f5f4fe] text-black"
                        : "border-transparent text-[#6a769c] hover:text-black",
                    )}
                  >
                    <Users className="h-3.5 w-3.5 text-[#503188]" />
                    All People
                  </button>
                  {listCollaborators.slice(0, 3).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() =>
                        setPersonFilter((cur) => (cur === person.id ? null : person.id))
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[12px] font-medium transition-opacity cursor-pointer",
                        personFilter && personFilter !== person.id ? "opacity-50 hover:opacity-100" : "text-black",
                      )}
                      title={`Filter by ${person.name}`}
                    >
                      <PersonAvatar
                        name={person.name}
                        initials={person.initials}
                        src={person.avatarUrl}
                        size={24}
                      />
                      <span>{person.name.split(" ")[0]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => (call.joined ? void startOrJoinCall() : openStartCall(true))}
              disabled={call.connecting}
              className={cn(
                "inline-flex h-[42px] items-center gap-2 rounded-[9px] px-4 text-[14px] font-medium transition cursor-pointer disabled:opacity-60",
                call.joined
                  ? "bg-[#fc404d] text-white hover:brightness-95"
                  : "border border-[#eaeffa] bg-white text-[#1d1d1d] hover:bg-muted/40",
              )}
              title={call.joined ? "Leave call" : "Start or join a call with this list"}
            >
              {call.joined ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
              <span>{call.connecting ? "Connecting…" : call.joined ? "Leave call" : "Call"}</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-8 border-t border-[#eef0f6] px-5">
            {(
              [
                ["things", "Things"],
                ["chat", "Chat"],
                ["members", "Members & Permissions"],
              ] as const
            ).map(([id, label]) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative py-3 text-[13.5px] transition-colors outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
                    active ? "text-[#000533] font-medium" : "text-[#6a769c] hover:text-[#000533] font-normal",
                  )}
                >
                  {label}
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#975ee2]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: THINGS */}
        {/* ========================================================================= */}
        {tab === "things" && (
          <ListThingsSection
            list={list}
            viewOnly={viewOnly}
            laneTabs={laneTabs}
            navLane={navLane}
            onSelectLane={selectLane}
            laneCounts={laneCounts}
            navSearch={navSearch}
            onNavSearchChange={setNavSearch}
            thingsFilter={thingsFilter}
            onThingsFilterChange={setThingsFilter}
            laneThings={laneThings}
            selectedId={selectedId}
            selected={selected}
            selectedIsVisible={selectedIsVisible}
            activeThing={activeThing}
            selTint={selTint}
            onSelectThing={setSelectedId}
            onCloseSelected={closeSelectedThing}
            onClearFilters={clearThingFilters}
            selectedFile={selectedFile}
            onFileSelect={setSelectedFile}
          />
        )}

        {/* ========================================================================= */}
        {/* TAB 2: CHAT */}
        {/* ========================================================================= */}
        {tab === "chat" && (
          <div className="flex min-h-0 flex-col gap-3 h-[calc(100vh-9.5rem)] lg:flex-row">
            <ListChatPanel
              listId={listId}
              placeholderName={list.name}
              viewOnly={viewOnly}
              className="min-h-0 flex-1 rounded-[10px] bg-white"
            />
            {/* Right: List info sidebar */}
            <div className="w-full shrink-0 min-h-0 overflow-y-auto rounded-[10px] bg-white p-5 lg:w-[440px]">
              <h2 className="text-[22px] font-medium text-[#000533]">{list.name}</h2>

              <div className="mt-4 flex items-stretch">
                <div className="flex-1 pr-4">
                  <div className="text-[22px] font-medium text-[#000533]">{list.members.length}</div>
                  <div className="text-[12px] text-[#6a769c]">members</div>
                </div>
                <div className="flex-1 border-l border-[#eef0f6] pl-4">
                  <div className="text-[22px] font-medium text-[#000533]">{listThings.length}</div>
                  <div className="text-[12px] text-[#6a769c]">Things</div>
                </div>
              </div>

              <div className="mt-4 flex items-center -space-x-2">
                {list.members.slice(0, 4).map((m) => (
                  <PersonAvatar
                    key={m.profileId || m.actorId || m.name}
                    name={m.name}
                    initials={m.initials}
                    src={m.avatarUrl}
                    size={40}
                    className="ring-2 ring-white"
                  />
                ))}
                {list.members.length > 4 && (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0effe] text-[13px] font-medium text-[#975ee2] ring-2 ring-white">
                    +{list.members.length - 4}
                  </span>
                )}
              </div>

              {/* Members */}
              <div className="mt-6 flex items-center justify-between border-t border-[#eef0f6] pt-4">
                <span className="text-[14.5px] font-medium text-[#000128]">Members</span>
                <button
                  type="button"
                  onClick={() => setTab("members")}
                  className="text-[12.5px] font-medium text-[#975ee2] hover:opacity-80 cursor-pointer"
                >
                  See all {list.members.length}
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {list.members.slice(0, 3).map((m) => (
                  <div
                    key={m.profileId || m.actorId || m.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={32} />
                      <span className="text-[14px] font-medium text-[#000128]">{m.name}</span>
                    </div>
                    <span
                      className={cn(
                        "text-[12.5px]",
                        m.role === "owner" ? "font-medium text-[#975ee2]" : "text-[#717793]",
                      )}
                    >
                      {m.role === "owner" ? "Owner" : m.role === "view_only" ? "View only" : "Collaborator"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Quick Actions */}
              <div className="mt-6 border-t border-[#eef0f6] pt-4">
                <span className="text-[14.5px] font-medium text-[#000128]">Quick Actions</span>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => (call.joined ? void startOrJoinCall() : openStartCall(false))}
                    disabled={call.connecting}
                    className="flex flex-col items-center gap-1.5 rounded-[8px] border border-[#ebecf7] bg-[#f9f9fe] py-3 text-center hover:border-[#975ee2]/40 hover:bg-white transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#f0effe] text-[#975ee2]">
                      <Phone className="h-4 w-4" />
                    </span>
                    <span className="text-[12px] font-medium text-[#000533]">Start Audio Call</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => (call.joined ? void startOrJoinCall() : openStartCall(true))}
                    disabled={call.connecting}
                    className="flex flex-col items-center gap-1.5 rounded-[8px] border border-[#ebecf7] bg-[#f9f9fe] py-3 text-center hover:border-[#975ee2]/40 hover:bg-white transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#f0effe] text-[#975ee2]">
                      <Video className="h-4 w-4" />
                    </span>
                    <span className="text-[12px] font-medium text-[#000533]">Start Video Call</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMeetingOpen(true)}
                    className="flex flex-col items-center gap-1.5 rounded-[8px] border border-[#ebecf7] bg-[#f9f9fe] py-3 text-center hover:border-[#975ee2]/40 hover:bg-white transition-colors cursor-pointer"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#f0effe] text-[#975ee2]">
                      <Calendar className="h-4 w-4" />
                    </span>
                    <span className="text-[12px] font-medium text-[#000533]">Schedule Meeting</span>
                  </button>
                </div>
              </div>

              {/* Upcoming Meetings */}
              <div className="mt-6 border-t border-[#eef0f6] pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[14.5px] font-medium text-[#000128]">Upcoming Meetings</span>
                  {meetingsHook.meetings.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setShowAllMeetings((s) => !s)}
                      className="text-[12.5px] font-medium text-[#975ee2] hover:opacity-80 cursor-pointer"
                    >
                      {showAllMeetings ? "Show less" : "See All"}
                    </button>
                  )}
                </div>
                {meetingsHook.error && meetingsHook.meetings.length === 0 ? (
                  <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-amber-900">
                    <span>Couldn't load meetings.</span>
                    <button type="button" onClick={() => void meetingsHook.refetch()} className="font-semibold underline">
                      Retry
                    </button>
                  </div>
                ) : meetingsHook.meetings.length === 0 ? (
                  <p className="mt-3 text-[12px] text-[#8487a7]">No meetings scheduled yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {(showAllMeetings ? meetingsHook.meetings : meetingsHook.meetings.slice(0, 3)).map((meeting) => {
                      const starts = new Date(meeting.startsAt);
                      const ends = new Date(meeting.endsAt);
                      const now = Date.now();
                      const isLive = now >= starts.getTime() && now <= ends.getTime();
                      const dayLabel = isToday(starts) ? "Today" : isTomorrow(starts) ? "Tomorrow" : format(starts, "MMM d");
                      // list_meetings.created_by is a profile id live (auth.uid())
                      // but an actor-shaped demo id in preview — compare against
                      // whichever identity matches the mode.
                      const canManage = preview
                        ? meeting.createdBy === myActorId
                        : meeting.createdBy === user?.id;
                      return (
                        <div
                          key={meeting.id}
                          className="flex items-center gap-3 rounded-[8px] border border-[#ebecf7] bg-[#f9f9fe]/40 p-2.5"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[#f0effe] text-[#975ee2]">
                            <Calendar className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-[#00011b]">{meeting.title}</p>
                            <p className="text-[12px] text-black/60">
                              {dayLabel}, {format(starts, "h:mm a")} - {format(ends, "h:mm a")}
                            </p>
                          </div>
                          {isLive ? (
                            <button
                              type="button"
                              onClick={() => void startOrJoinCall(true, meeting.title)}
                              className="inline-flex h-7 shrink-0 items-center rounded-[8px] bg-[#975ee2] px-3 text-[12px] font-medium text-white hover:brightness-95 cursor-pointer"
                            >
                              Join now
                            </button>
                          ) : null}
                          {canManage ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[#8487a7] hover:bg-muted"
                                  aria-label="Meeting actions"
                                >
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40 bg-white">
                                <DropdownMenuItem
                                  onClick={() => {
                                    meetingsHook.cancel.mutate(meeting.id, {
                                      onSuccess: () => toast.success("Meeting cancelled."),
                                      onError: (err) => toast.error(domainErrorMessage(err)),
                                    });
                                  }}
                                  className="text-[12.5px] text-[#fc404d] cursor-pointer"
                                >
                                  Cancel meeting
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Things */}
              <div className="mt-6 flex items-center justify-between border-t border-[#eef0f6] pt-4">
                <span className="text-[14.5px] font-medium text-[#000128]">Recent Things</span>
                <button
                  type="button"
                  onClick={() => setTab("things")}
                  className="text-[12.5px] font-medium text-[#975ee2] hover:opacity-80 cursor-pointer"
                >
                  See all
                </button>
              </div>
              <div className="mt-3 space-y-2.5">
                {listThings.slice(0, 2).map((thing) => {
                  const due = formatCourtDue(thing);
                  return (
                    <button
                      key={thing.id}
                      type="button"
                      onClick={() => {
                        setTab("things");
                        setSelectedId(thing.id);
                      }}
                      className="flex w-full items-center gap-3 rounded-[11px] border border-[#f3f6fb] bg-white p-3 text-left hover:bg-[#f9f9fe] transition-colors cursor-pointer"
                    >
                      <span className="h-5 w-5 shrink-0 rounded-full border-2 border-[#cfd6e6]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium text-[#000128]">
                          {thing.title}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[12px]">
                          <span className="rounded-full bg-[#e6ecfd] px-2 py-0.5 text-[#975ee2]">
                            {thing.workStatus === "sorted"
                              ? "Sorted"
                              : thing.acknowledgement === "caught" || thing.workStatus === "under_progress"
                                ? "Under Progress"
                                : "Not Started"}
                          </span>
                          {thing.dueAt && (
                            <span className="inline-flex items-center gap-1 text-[#666e94]">
                              <Calendar className="h-3 w-3" />
                              Due {due.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {listThings.length === 0 && (
                  <p className="text-[12px] text-[#6a769c]">No Things yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: MEMBERS & PERMISSIONS */}
        {/* ========================================================================= */}
        {tab === "members" && (
          <ListMembersSection
            list={list}
            memberSearch={memberSearch}
            onMemberSearchChange={setMemberSearch}
            memberRoleFilter={memberRoleFilter}
            onMemberRoleFilterChange={setMemberRoleFilter}
            ownerMembers={ownerMembers}
            collaboratorMembers={collaboratorMembers}
            viewOnlyMembers={viewOnlyMembers}
            filteredMembersEmpty={filteredMembers.length === 0}
            onCopyInviteLink={() => void copyInviteLink()}
            onOpenInvite={() => setInviting(true)}
            onChangeRole={(member, currentRole) => void changeMemberRole(member, currentRole)}
            onRemoveMember={(member) => void removeMember(member)}
          />
        )}
        {tab === "members" && (
          <ListInviteDialog
            open={inviting}
            onOpenChange={setInviting}
            list={list}
            people={assignablePeople}
            addingPersonId={addingPersonId}
            onAdd={addMember}
          />
        )}
      </div>
      <ListCallPanel
        call={call}
        selfName={selfName}
        listId={listId}
        title={list?.name}
        onInvite={() => setInviteOpen(true)}
      />
      <ScheduleMeetingDialog
        listId={listId}
        open={scheduleMeetingOpen}
        onOpenChange={setScheduleMeetingOpen}
      />
      <StartCallDialog
        open={startCallOpen}
        onOpenChange={setStartCallOpen}
        people={callPeople}
        defaultVideo={startCallDefaultVideo}
        onStart={({ withVideo, selectedIds }) => void startOrJoinCall(withVideo, undefined, selectedIds)}
      />
      <StartCallDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        people={callPeople}
        variant="invite"
        onInvite={(selectedIds) => ringAndAnnounce(selectedIds)}
      />
    </AppShell>
  );
}
