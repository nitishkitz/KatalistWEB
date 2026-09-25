import { ChevronDown, Crown, Eye, Paperclip, Plus, Search, Users, X } from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ListMember, ListRole, ListRow } from "@/features/lists/fixtures";

export type MemberRoleFilter = "all" | ListRole;

interface ListMembersSectionProps {
  list: ListRow;
  memberSearch: string;
  onMemberSearchChange: (value: string) => void;
  memberRoleFilter: MemberRoleFilter;
  onMemberRoleFilterChange: (value: MemberRoleFilter) => void;
  ownerMembers: ListMember[];
  collaboratorMembers: ListMember[];
  viewOnlyMembers: ListMember[];
  filteredMembersEmpty: boolean;
  onCopyInviteLink: () => void;
  onOpenInvite: () => void;
  onChangeRole: (member: ListMember, currentRole: "collaborator" | "view_only") => void;
  onRemoveMember: (member: ListMember) => void;
}

/**
 * Presentational Members & Permissions surface for List detail (T11-03).
 * Ownership of member mutations (add/remove/role-change), their pending
 * dedupe keys and epoch guards stays in the route -- this component only
 * renders the current state and dispatches the route's callbacks.
 */
export function ListMembersSection({
  list,
  memberSearch,
  onMemberSearchChange,
  memberRoleFilter,
  onMemberRoleFilterChange,
  ownerMembers,
  collaboratorMembers,
  viewOnlyMembers,
  filteredMembersEmpty,
  onCopyInviteLink,
  onOpenInvite,
  onChangeRole,
  onRemoveMember,
}: ListMembersSectionProps) {
  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row">
        {/* Left: members management card */}
        <div className="flex-1 rounded-[10px] bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[19.75px] font-medium text-[#000533]">Members &amp; Permissions</h2>
              <p className="mt-1 text-[12px] font-medium text-[#6a769c]">
                Control who can see and move Things in {list.name}.
              </p>
            </div>
            {list.role === "owner" && (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onCopyInviteLink}
                  className="inline-flex h-[42px] items-center gap-2 rounded-[10px] border border-[#ebf1fd] bg-[#f6f8fd] px-3.5 text-[12px] font-medium text-[#1b2031] hover:brightness-95 transition cursor-pointer"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Copy invite link
                </button>
                <button
                  type="button"
                  onClick={onOpenInvite}
                  className="inline-flex h-[42px] items-center gap-2 rounded-[10px] bg-[#1d2335] px-3.5 text-[12px] font-medium text-white hover:brightness-110 transition cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Invite people
                </button>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <label className="flex h-[42px] min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3">
              <Search className="h-4 w-4 text-[#8487a7]" />
              <input
                value={memberSearch}
                onChange={(e) => onMemberSearchChange(e.target.value)}
                placeholder="Search members"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[#000533] outline-none placeholder:text-[#8487a7]"
              />
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-[42px] items-center gap-2 rounded-[10px] border border-[#ebf1fd] bg-[#f6f8fd] px-3.5 text-[12px] font-medium text-[#2548fb] cursor-pointer"
                >
                  {memberRoleFilter === "all"
                    ? "All Roles"
                    : memberRoleFilter === "view_only"
                      ? "View Only"
                      : memberRoleFilter === "owner"
                        ? "Owner"
                        : "Collaborator"}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 bg-white">
                <DropdownMenuRadioGroup
                  value={memberRoleFilter}
                  onValueChange={(v) => onMemberRoleFilterChange(v as MemberRoleFilter)}
                >
                  <DropdownMenuRadioItem value="all" className="text-[12px]">All Roles</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="owner" className="text-[12px]">Owner</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="collaborator" className="text-[12px]">Collaborator</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="view_only" className="text-[12px]">View Only</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Member groups */}
          <div className="mt-5 space-y-5">
            {(
              [
                { key: "owner", title: `Owner (${ownerMembers.length})`, members: ownerMembers },
                { key: "collaborator", title: `Collaborators (${collaboratorMembers.length})`, members: collaboratorMembers },
                { key: "view_only", title: `View Only (${viewOnlyMembers.length})`, members: viewOnlyMembers },
              ] as const
            ).map((group) =>
              group.members.length === 0 ? null : (
                <div key={group.key} className="space-y-2.5">
                  <h3 className="text-[15px] font-medium text-[#000533]">{group.title}</h3>
                  {group.members.map((m) => {
                    const memberId = m.profileId || m.actorId || m.name;
                    const role = group.key;
                    const badge =
                      role === "owner"
                        ? { bg: "#edeafe", text: "#2a14a8", label: "Owner" }
                        : role === "collaborator"
                          ? { bg: "#e9f0fd", text: "#975ee2", label: "Collaborator" }
                          : { bg: "#f2f2fb", text: "#484872", label: "View Only" };
                    const capability =
                      role === "owner"
                        ? "Can manage list and members"
                        : role === "collaborator"
                          ? "Can create, edit, catch, pace and reassign Things"
                          : "Can view list and Things";
                    const rowBg =
                      role === "owner" ? "bg-[#f9f9fe]" : role === "collaborator" ? "bg-[#fdfdfe]" : "bg-white";
                    const canManage = list.role === "owner" && role !== "owner";
                    return (
                      <div
                        key={memberId}
                        className={cn(
                          "grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-[11px] border border-[#f4f4fc] px-4 py-2.5 sm:flex",
                          rowBg,
                        )}
                      >
                        <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={40} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium text-[#000533]">{m.name}</div>
                          <div className="text-[12px] text-[#686c8d]">{capability}</div>
                        </div>
                        <span
                          className="hidden shrink-0 rounded-[9px] px-3 py-1.5 text-[12px] sm:inline-block"
                          style={{ backgroundColor: badge.bg, color: badge.text }}
                        >
                          {badge.label}
                        </span>
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="col-span-2 inline-flex h-[38px] w-full shrink-0 items-center justify-between rounded-[6px] border border-[#e8e9f7] bg-[#fdfdfe] px-3 text-[12px] text-[#686c8d] cursor-pointer sm:w-[124px]"
                              >
                                {role === "collaborator" ? "Collaborator" : "View only"}
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 bg-white">
                              <DropdownMenuItem
                                onClick={() => onChangeRole(m, role as "collaborator" | "view_only")}
                                className="text-[12px]"
                              >
                                {role === "collaborator" ? (
                                  <>
                                    <Eye className="mr-2 h-3.5 w-3.5 text-emerald-500" /> Make View only
                                  </>
                                ) : (
                                  <>
                                    <Users className="mr-2 h-3.5 w-3.5 text-blue-500" /> Make Collaborator
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-[12px] text-destructive focus:text-destructive"
                                onClick={() => onRemoveMember(m)}
                              >
                                <X className="mr-2 h-3.5 w-3.5 text-destructive" /> Remove from list
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="col-span-2 inline-flex h-[38px] w-full shrink-0 items-center gap-1.5 rounded-[6px] border border-[#eeeffb] bg-[#f6f6fd] px-3 text-[12px] text-[#686c8d] sm:w-[124px]">
                            <Crown className="h-3.5 w-3.5 text-[#d9a441]" />
                            {badge.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ),
            )}
            {filteredMembersEmpty && (
              <p className="py-8 text-center text-[12px] text-[#6a769c]">No members match this filter.</p>
            )}
          </div>
        </div>

        {/* Right: Permission Guide */}
        <div className="w-full shrink-0 space-y-3 lg:w-[360px]">
          <div className="rounded-[10px] bg-white p-5">
            <h3 className="text-[18px] font-medium text-[#000533]">Permission Guide</h3>
            <div className="mt-4 space-y-4">
              {[
                {
                  icon: <Users className="h-5 w-5" />,
                  circle: "bg-[#ede8fe] text-[#975ee2]",
                  label: "Collaborator",
                  desc: "Create, edit, catch pace and reassign Things",
                },
                {
                  icon: <Eye className="h-5 w-5" />,
                  circle: "bg-[#e6ecfd] text-[#3b6ff5]",
                  label: "View Only",
                  desc: "Read List and Things",
                },
                {
                  icon: <Crown className="h-5 w-5" />,
                  circle: "bg-[#fdeede] text-[#d9822b]",
                  label: "Owner",
                  desc: "Manage members, roles and list",
                },
              ].map((g) => (
                <div key={g.label} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                      g.circle,
                    )}
                  >
                    {g.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-[#000533]">{g.label}</div>
                    <div className="text-[12px] text-[#6a769c]">{g.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
