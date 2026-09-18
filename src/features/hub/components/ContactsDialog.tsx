import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, MessageCircle, Phone, UserPlus, Check, X, Clock, Mail, Copy, Users } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  const [tab, setTab] = useState<Tab>("people");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");

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

  // When the query is an email that matches nobody on Katalist, offer to invite it.
  const trimmedQuery = query.trim();
  const isEmailQuery = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedQuery);
  const showInviteCta = isEmailQuery && people.length === 0;

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
    try {
      await rpcSendContactRequest(member.id);
      refreshContacts();
      toast.success(`Request sent to ${member.name.split(" ")[0]}`);
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const respond = async (requestId: string, accept: boolean) => {
    setBusyId(requestId);
    try {
      await rpcRespondContactRequest(requestId, accept);
      refreshContacts();
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const cancelReq = async (requestId: string) => {
    setBusyId(requestId);
    try {
      await rpcCancelContactRequest(requestId);
      refreshContacts();
    } catch (err) {
      toast.error(domainErrorMessage(err));
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
    try {
      const inv = await rpcCreateInvitation(email);
      refreshContacts();
      setInviteEmail("");
      if (emailArg) setQuery("");
      const link = `${window.location.origin}/auth?invite=${inv.token}`;
      await navigator.clipboard.writeText(link).catch(() => {});
      toast.success("Invite created — link copied to clipboard");
    } catch (err) {
      toast.error(domainErrorMessage(err));
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
    try {
      await rpcRevokeInvitation(id);
      refreshContacts();
    } catch (err) {
      toast.error(domainErrorMessage(err));
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[720px] max-w-3xl flex-col bg-white p-0">
        <DialogHeader className="border-b border-[#eef0f6] px-6 py-4">
          <DialogTitle className="text-[17px] text-[#000533]">People &amp; contacts</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[#eef0f6] px-4">
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
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#f0e9fb] px-1 text-[10.5px] font-semibold text-[#6638ec]">
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* ALL PEOPLE */}
          {tab === "people" && (
            <>
              <label className="mb-3 flex h-10 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 focus-within:border-[#975ee2]">
                <Search className="h-4 w-4 text-[#8487a7]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, or type an email to invite"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-[#000533] outline-none placeholder:text-[#8487a7]"
                />
              </label>

              {/* Not on Katalist → offer an email invite inline. */}
              {showInviteCta && (
                <div className="mb-2 flex items-center gap-3 rounded-[10px] border border-dashed border-[#d9c9f6] bg-[#faf7ff] px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0e9fb] text-[#6638ec]">
                    <Mail className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[#000533]">{trimmedQuery}</p>
                    <p className="text-[11.5px] text-[#6a769c]">Not on Katalist yet — invite by email</p>
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

              <div className="space-y-1">
                {people.length === 0 ? (
                  <p className="py-10 text-center text-[12.5px] text-[#6a769c]">
                    {isEmailQuery ? "No one on Katalist with that email — invite them above." : "No people found."}
                  </p>
                ) : (
                  people.map((m) => {
                    const isContact = contactIds.has(m.id);
                    const requested = outgoingIds.has(m.id);
                    return (
                      <Row
                        key={m.id}
                        member={m}
                        online={online.has(m.id)}
                        busy={busyId === m.id}
                        onMessage={() => void openDm(m, false)}
                        onCall={() => void openDm(m, true)}
                        trailing={
                          isContact ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#e4fcf0] px-2.5 py-1 text-[11.5px] font-medium text-[#12a15f]">
                              <Check className="h-3 w-3" /> Contact
                            </span>
                          ) : requested ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f2f7] px-2.5 py-1 text-[11.5px] font-medium text-[#8487a7]">
                              <Clock className="h-3 w-3" /> Requested
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={busyId === m.id}
                              onClick={() => void connect(m)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#ebecf7] px-2.5 text-[12px] font-medium text-[#3d3f74] hover:border-[#975ee2] disabled:opacity-50"
                            >
                              <UserPlus className="h-3.5 w-3.5" /> Connect
                            </button>
                          )
                        }
                      />
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* CONTACTS */}
          {tab === "contacts" && (
            <div className="space-y-1">
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
                <p className="mt-1.5 text-[11px] text-[#8487a7]">
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
      <p className="mt-1 text-[11.5px] text-[#6a769c]">{hint}</p>
    </div>
  );
}
