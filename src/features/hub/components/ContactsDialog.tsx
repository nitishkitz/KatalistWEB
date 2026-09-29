import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Search, MessageCircle, Phone, UserPlus, Check, X, Mail, Copy, Users } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useTeam, type TeamMember } from "@/features/people/use-team";
import { usePresence } from "@/features/people/presence";
import { isUuid } from "@/features/things/rpc";
import {
  rpcGetOrCreateDm,
  rpcSendContactRequest,
  rpcRespondContactRequest,
  rpcCancelContactRequest,
  rpcCreateInvitation,
  rpcRevokeInvitation,
} from "@/features/hub/rpc";
import { useConversations } from "@/features/hub/use-conversations";
import { useContacts, useContactRequests, useInvitations, useRefreshContacts } from "@/features/hub/use-contacts";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useMotionPreference } from "@/hooks/use-motion-preference";
import { ContactPhysicsPile } from "./ContactPhysicsPile";

type Tab = "people" | "contacts" | "requests" | "invites";

export function ContactsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const online = usePresence();
  const { members } = useTeam();
  const { refetch: refetchConversations } = useConversations();
  const { contacts } = useContacts();
  const { incoming, outgoing } = useContactRequests();
  const { invitations } = useInvitations();
  const refreshContacts = useRefreshContacts();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("people");
  const [query, setQuery] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [searchMatchIds, setSearchMatchIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const { reduceMotion } = useMotionPreference();

  // This drawer is a temporary workspace. Once it closes, discard its
  // navigation and search state so the next visit always starts predictably.
  useEffect(() => {
    if (open) return;
    setTab("people");
    setQuery("");
    setSelectedPersonId(null);
    setSearchMatchIds([]);
    setInviteEmail("");
  }, [open]);

  const contactIds = useMemo(() => new Set(contacts.map((c) => c.id)), [contacts]);
  const outgoingIds = useMemo(() => new Set(outgoing.map((r) => r.person.id)), [outgoing]);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = members.filter((m) => isUuid(m.id));
    if (!q) return base;
    return base.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.role ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q),
    );
  }, [members, query]);

  const realMembers = useMemo(() => members.filter((member) => isUuid(member.id)), [members]);

  // When the query is an email that matches nobody on Katalist, offer to invite it.
  const trimmedQuery = query.trim();
  const isEmailQuery = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedQuery);
  const showInviteCta = isEmailQuery && people.length === 0;
  const resultPersonIds = useMemo(() => (trimmedQuery ? searchMatchIds : selectedPersonId ? [selectedPersonId] : []), [searchMatchIds, selectedPersonId, trimmedQuery]);
  const activePersonId = trimmedQuery ? searchMatchIds[0] ?? null : selectedPersonId;
  const featuredPerson = realMembers.find((member) => member.id === activePersonId) ?? null;
  // Matter.js is ideal for the small, tactile pile. Once a query matches a
  // larger roster, use a regular scrollable list so every result stays
  // reachable without simulating dozens of moving bodies.
  const useScrollableResults = Boolean(trimmedQuery) && people.length > 12;
  const physicsMembers = useMemo(() => {
    const visibleIds = new Set([...realMembers.slice(0, 24).map((member) => member.id), ...people.map((member) => member.id)]);
    return realMembers.filter((member) => visibleIds.has(member.id));
  }, [people, realMembers]);

  useEffect(() => {
    if (!trimmedQuery) {
      setSearchMatchIds([]);
      return;
    }
    // Keep the current card in place while typing. Only commit a new match
    // after the debounce, rather than releasing and lifting it per keystroke.
    const timeout = window.setTimeout(() => setSearchMatchIds(people.map((person) => person.id)), reduceMotion ? 0 : 180);
    return () => window.clearTimeout(timeout);
  }, [people, reduceMotion, trimmedQuery]);

  const openDm = async (member: { id: string; name: string }, startCall: boolean) => {
    if (!isUuid(member.id)) {
      toast.error("This contact cannot be messaged yet.");
      return;
    }
    setBusyId(member.id);
    try {
      const dm = await rpcGetOrCreateDm(member.id);
      await refetchConversations();
      onOpenChange(false);
      navigate({ to: "/team/$conversationId", params: { conversationId: dm.id }, search: startCall ? { start: "call" } : {} });
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const connect = async (member: TeamMember) => {
    setBusyId(member.id);
    const epoch = getIdentityEpoch(qc).epoch;
    try {
      await rpcSendContactRequest(member.id);
      refreshContacts(epoch);
      if (isEpochCurrent(qc, epoch)) toast.success(`Request sent to ${member.name.split(" ")[0]}`);
    } catch (err) {
      if (isEpochCurrent(qc, epoch)) toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const respond = async (requestId: string, accept: boolean) => {
    setBusyId(requestId);
    const epoch = getIdentityEpoch(qc).epoch;
    try {
      await rpcRespondContactRequest(requestId, accept);
      refreshContacts(epoch);
    } catch (err) {
      if (isEpochCurrent(qc, epoch)) toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const cancelReq = async (requestId: string) => {
    setBusyId(requestId);
    const epoch = getIdentityEpoch(qc).epoch;
    try {
      await rpcCancelContactRequest(requestId);
      refreshContacts(epoch);
    } catch (err) {
      if (isEpochCurrent(qc, epoch)) toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const sendInvite = async (emailArg?: string) => {
    const email = (emailArg ?? inviteEmail).trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error("Enter a valid email.");
      return;
    }
    setBusyId("invite");
    const epoch = getIdentityEpoch(qc).epoch;
    try {
      const inv = await rpcCreateInvitation(email);
      refreshContacts(epoch);
      if (!isEpochCurrent(qc, epoch)) return;
      setInviteEmail("");
      if (emailArg) setQuery("");
      const link = `${window.location.origin}/auth?invite=${inv.token}`;
      await navigator.clipboard.writeText(link).catch(() => {});
      toast.success("Invite created — link copied to clipboard");
    } catch (err) {
      if (isEpochCurrent(qc, epoch)) toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const copyInvite = async (token: string) => {
    const link = `${window.location.origin}/auth?invite=${token}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    toast.success("Invite link copied");
  };

  const revokeInvite = async (id: string) => {
    setBusyId(id);
    const epoch = getIdentityEpoch(qc).epoch;
    try {
      await rpcRevokeInvitation(id);
      refreshContacts(epoch);
    } catch (err) {
      if (isEpochCurrent(qc, epoch)) toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "people", label: "All people" },
    { id: "contacts", label: "Contacts", count: contacts.length },
    { id: "requests", label: "Requests", count: incoming.length },
    { id: "invites", label: "Invites", count: invitations.filter((i) => i.status === "pending").length },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        // Contacts occupies the workspace; header and sidebar remain usable.
        // Radix nonmodal mode omits the backdrop and lets the outside click
        // dismiss this panel and activate the clicked navigation together.
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="fixed inset-y-0 left-0 right-0 top-14 flex h-[calc(100dvh-3.5rem)] max-h-[calc(100dvh-3.5rem)] w-full max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-y-0 border-r-0 bg-white p-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 md:left-[300px] md:w-[calc(100vw-300px)] sm:rounded-none"
      >
        <DialogTitle className="sr-only">People and contacts</DialogTitle>

        {/* Tabs */}
        <div className="flex shrink-0 items-center gap-1 border-b border-[#eef0f6] px-4 pr-14">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                tab === t.id ? "border-[#6638ec] text-[#6638ec]" : "border-transparent text-[#6a769c] hover:text-[#000533]",
              )}
            >
              {t.label}
              {t.count ? (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#f0e9fb] px-1 text-[12px] font-semibold text-[#6638ec]">
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div
          className={cn(
            "min-h-0 flex-1 px-5 md:px-10",
            tab === "people" && useScrollableResults ? "overflow-y-auto py-3 md:py-4" : tab === "people" || tab === "contacts" ? "overflow-hidden py-3 md:py-4" : "overflow-y-auto py-4 md:py-6",
          )}
        >
          {/* ALL PEOPLE */}
          {tab === "people" && (
            <div className={cn("relative flex min-h-0 flex-col", useScrollableResults ? "min-h-full" : "h-full")}>
              <label className="mx-auto mb-3 flex h-11 w-full max-w-[760px] shrink-0 items-center gap-3 rounded-[12px] border border-[#ebecf7] bg-[#fbfaff] px-4 shadow-[0_5px_16px_rgba(60,35,100,0.06)] transition-[border-color,box-shadow] duration-200 focus-within:border-[#b590ee] focus-within:shadow-[0_8px_24px_rgba(109,69,173,0.12)]">
                <Search className="h-4 w-4 text-[#8487a7]" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedPersonId(null);
                  }}
                  placeholder="Search by name, or type an email to invite"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-[#000533] outline-none placeholder:text-[#8487a7]"
                />
                {query ? <button type="button" onClick={() => { setQuery(""); setSelectedPersonId(null); }} aria-label="Clear search" className="rounded-full p-1 text-[#8487a7] hover:bg-[#f0e9fb] hover:text-[#6638ec]"><X className="h-4 w-4" /></button> : null}
              </label>

              {/* Not on Katalist → offer an email invite inline. */}
              {showInviteCta && (
                <div className="mb-2 flex items-center gap-3 rounded-[10px] border border-dashed border-[#d9c9f6] bg-[#faf7ff] px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0e9fb] text-[#6638ec]">
                    <Mail className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[#000533]">{trimmedQuery}</p>
                    <p className="text-[12px] text-[#6a769c]">Not on Katalist yet — invite by email</p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === "invite"}
                    onClick={() => void sendInvite(trimmedQuery)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#975ee2] px-3 text-[12px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Invite
                  </button>
                </div>
              )}

              {trimmedQuery && people.length === 0 && !showInviteCta ? (
                <p className="pointer-events-none absolute left-0 right-0 top-16 z-50 text-center text-[12.5px] text-[#6a769c]">No people found.</p>
              ) : null}

              {useScrollableResults ? (
                <div className="min-h-0 flex-1" aria-label={`${people.length} matching people`}>
                  <p className="mb-2 px-2 text-[12px] font-medium text-[#8487a7]" aria-live="polite">{people.length} people found</p>
                  <div className="grid grid-cols-1 gap-1 xl:grid-cols-2">
                    {people.map((person) => (
                      <Row
                        key={person.id}
                        member={person}
                        online={online.has(person.id)}
                        busy={busyId === person.id}
                        onMessage={() => void openDm(person, false)}
                        onCall={() => void openDm(person, true)}
                        trailing={contactIds.has(person.id) ? <span className="rounded-full bg-[#f2ecfa] px-2.5 py-1 text-[12px] font-medium text-[#7045a4]">Contact</span> : outgoingIds.has(person.id) ? <span className="rounded-full bg-[#f2ecfa] px-2.5 py-1 text-[12px] font-medium text-[#7045a4]">Requested</span> : (
                          <button type="button" disabled={busyId === person.id} onClick={() => void connect(person)} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#e7def3] bg-white px-3 text-[12px] font-medium text-[#563c7e] transition-colors hover:border-[#975ee2] disabled:opacity-50"><UserPlus className="h-3.5 w-3.5" /> Connect</button>
                        )}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <ContactPhysicsPile
                  members={physicsMembers}
                  activePersonId={activePersonId}
                  resultPersonIds={resultPersonIds}
                  onlineIds={online}
                  reduceMotion={reduceMotion}
                  onSelect={(personId) => {
                    setQuery("");
                    setSelectedPersonId(personId);
                  }}
                  activeControls={featuredPerson ? (
                    <>
                      {!contactIds.has(featuredPerson.id) && !outgoingIds.has(featuredPerson.id) ? (
                        <button type="button" disabled={busyId === featuredPerson.id} onClick={() => void connect(featuredPerson)} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#e7def3] bg-white px-3 text-[12px] font-medium text-[#563c7e] transition-colors hover:border-[#975ee2] disabled:opacity-50"><UserPlus className="h-3.5 w-3.5" /> Connect</button>
                      ) : <span className="rounded-full bg-[#f2ecfa] px-2.5 py-1 text-[12px] font-medium text-[#7045a4]">{contactIds.has(featuredPerson.id) ? "Contact" : "Requested"}</span>}
                      <button type="button" disabled={busyId === featuredPerson.id} onClick={() => void openDm(featuredPerson, false)} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#8454d8] px-3 text-[12px] font-semibold text-white transition-transform duration-150 hover:-translate-y-0.5 hover:bg-[#7444c7] disabled:opacity-50"><MessageCircle className="h-3.5 w-3.5" /> Message</button>
                      <button type="button" disabled={busyId === featuredPerson.id} onClick={() => void openDm(featuredPerson, true)} aria-label={`Call ${featuredPerson.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#e7def3] bg-white text-[#563c7e] transition-colors hover:border-[#975ee2] disabled:opacity-50"><Phone className="h-3.5 w-3.5" /></button>
                    </>
                  ) : null}
                />
              )}
            </div>
          )}

          {/* CONTACTS */}
          {tab === "contacts" && (
            <div className="grid h-full min-h-0 content-start grid-cols-1 gap-1 overflow-hidden xl:grid-cols-2 xl:gap-x-6">
              {contacts.length === 0 ? (
                <Empty icon={Users} title="No contacts yet" hint="Connect with people from the All people tab." />
              ) : (
                contacts.map((c) => (
                  <Row
                    key={c.id}
                    member={c}
                    online={online.has(c.id)}
                    busy={busyId === c.id}
                    onMessage={() => void openDm(c, false)}
                    onCall={() => void openDm(c, true)}
                  />
                ))
              )}
            </div>
          )}

          {/* REQUESTS */}
          {tab === "requests" && (
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">Awaiting your approval</p>
                {incoming.length === 0 ? (
                  <p className="text-[12.5px] text-[#6a769c]">No incoming requests.</p>
                ) : (
                  <div className="space-y-1">
                    {incoming.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-[#f6f7fc]">
                        <PersonAvatar name={r.person.name} initials={r.person.initials} src={r.person.avatarUrl} size={38} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-[#000533]">{r.person.name}</p>
                          <p className="truncate text-[12px] text-[#6a769c]">{r.person.role ?? "wants to connect"}</p>
                        </div>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void respond(r.id, true)}
                          className="inline-flex h-8 items-center gap-1 rounded-[9px] bg-[#975ee2] px-3 text-[12px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void respond(r.id, false)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#ebecf7] text-[#8487a7] hover:border-[#e5484d] hover:text-[#e5484d] disabled:opacity-50"
                          aria-label="Decline"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">Sent — pending</p>
                {outgoing.length === 0 ? (
                  <p className="text-[12.5px] text-[#6a769c]">No pending requests.</p>
                ) : (
                  <div className="space-y-1">
                    {outgoing.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-[#f6f7fc]">
                        <PersonAvatar name={r.person.name} initials={r.person.initials} src={r.person.avatarUrl} size={38} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-[#000533]">{r.person.name}</p>
                          <p className="truncate text-[12px] text-[#6a769c]">Awaiting approval</p>
                        </div>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void cancelReq(r.id)}
                          className="inline-flex h-8 items-center rounded-[9px] border border-[#ebecf7] px-3 text-[12px] font-medium text-[#8487a7] hover:border-[#e5484d] hover:text-[#e5484d] disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* INVITES */}
          {tab === "invites" && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">Invite by email</p>
                <div className="flex gap-2">
                  <label className="flex h-10 flex-1 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 focus-within:border-[#975ee2]">
                    <Mail className="h-4 w-4 text-[#8487a7]" />
                    <input
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void sendInvite()}
                      placeholder="name@company.com"
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-[#000533] outline-none placeholder:text-[#8487a7]"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busyId === "invite"}
                    onClick={() => void sendInvite()}
                    className="inline-flex h-10 items-center rounded-[10px] bg-[#975ee2] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
                  >
                    Create invite
                  </button>
                </div>
                <p className="mt-1.5 text-[12px] text-[#8487a7]">
                  Creates a shareable invite link (copied to your clipboard). Automatic email delivery is not enabled yet.
                </p>
              </div>

              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">Pending invitations</p>
                {invitations.filter((i) => i.status === "pending").length === 0 ? (
                  <p className="text-[12.5px] text-[#6a769c]">No pending invitations.</p>
                ) : (
                  <div className="space-y-1">
                    {invitations
                      .filter((i) => i.status === "pending")
                      .map((i) => (
                        <div key={i.id} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-[#f6f7fc]">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0e9fb] text-[#6638ec]">
                            <Mail className="h-4 w-4" />
                          </span>
                          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#000533]">{i.email}</p>
                          <button
                            type="button"
                            onClick={() => void copyInvite(i.token)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#ebecf7] px-2.5 text-[12px] font-medium text-[#3d3f74] hover:border-[#975ee2]"
                          >
                            <Copy className="h-3.5 w-3.5" /> Link
                          </button>
                          <button
                            type="button"
                            disabled={busyId === i.id}
                            onClick={() => void revokeInvite(i.id)}
                            className="inline-flex h-8 items-center rounded-[9px] border border-[#ebecf7] px-2.5 text-[12px] font-medium text-[#8487a7] hover:border-[#e5484d] hover:text-[#e5484d] disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  member,
  online,
  busy,
  onMessage,
  onCall,
  trailing,
}: {
  member: { id: string; name: string; initials: string; avatarUrl: string | null; role: string | null };
  online: boolean;
  busy: boolean;
  onMessage: () => void;
  onCall: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-[#f6f7fc]">
      <span className="relative shrink-0">
        <PersonAvatar name={member.name} initials={member.initials} src={member.avatarUrl} size={38} />
        {online ? <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#12a15f]" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-[#000533]">{member.name}</p>
        <p className="truncate text-[12px] text-[#6a769c]">
          {member.role ?? "Teammate"}
          {online ? " · Online" : ""}
        </p>
      </div>
      {trailing}
      <button
        type="button"
        disabled={busy}
        onClick={onMessage}
        className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#975ee2] px-3 text-[12px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
      >
        <MessageCircle className="h-3.5 w-3.5" /> Message
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onCall}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#ebecf7] text-[#3d3f74] hover:border-[#975ee2] disabled:opacity-50"
        aria-label={`Call ${member.name}`}
      >
        <Phone className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Empty({ icon: Icon, title, hint }: { icon: typeof Users; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <Icon className="h-8 w-8 text-[#c5cae0]" />
      <p className="mt-2 text-[13px] font-semibold text-[#000533]">{title}</p>
      <p className="mt-1 text-[12px] text-[#6a769c]">{hint}</p>
    </div>
  );
}
