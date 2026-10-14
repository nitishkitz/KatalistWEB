import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { WorkingTimeSettings } from "@/features/me/WorkingTimeSettings";
import { CoeyPresenceSettings } from "@/features/me/CoeyPresenceSettings";
import { useRef, useState } from "react";
import {
  Bell,
  Briefcase,
  Home,
  LogOut,
  Palette,
  Sparkles,
  Flame,
  Mail,
  Phone,
  Calendar,
  Clock,
  Pencil,
  ImagePlus,
  Check,
  Camera,
  Loader2,
  RotateCcw,
  UserRound,
  MapPin,
  Link,
  LockKeyhole,
  Monitor,
  Trash2,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { MeSkeleton } from "@/components/katalist/ScreenSkeletons";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useSession } from "@/hooks/useSession";
import { useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/features/context/use-app-context";
import { useProfile, useUploadAvatar, useUpdateProfile } from "@/features/me/use-profile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SortedActivityIcon, CaughtActivityIcon } from "@/features/me/ProfileActivityIcons";
import "@/features/me/profile-page.css";
import { useTrophy } from "@/features/me/use-trophy";
import { SolvedThingsDialog } from "@/features/me/SolvedThingsDialog";
import { useAvatarUrl } from "@/features/people/directory";
import { isDoormanEnabled } from "@/features/doorman/use-doorman";
import { cn } from "@/lib/utils";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useStoredMotionPreference } from "@/hooks/use-motion-preference";
import {
  FONT_OPTIONS,
  setFontPreference,
  useStoredFontPreference,
} from "@/hooks/use-font-preference";
import {
  getPushPermissionState,
  registerPushForUser,
  sendTestPush,
  type PushPermissionState,
} from "@/features/push/push-registration";
import coverImage from "@/assets/profile/cover.png";
import { LoggedInDevices } from "@/features/me/devices/LoggedInDevices";

export const Route = createFileRoute("/me")({
  head: () => ({
    meta: [
      { title: "Me — Katalist" },
      { name: "description", content: "Profile, trophy, preferences and settings." },
    ],
  }),
  component: MePage,
});

/** Selectable profile cover wallpapers (gradient presets). "photo" keeps the
 *  illustrated Katalist banner; the rest are the existing gradient options. */
const COVER_THEMES: { key: string; label: string; className: string }[] = [
  {
    key: "violet",
    label: "Violet",
    className: "bg-gradient-to-r from-[#7c4ddb] via-[#8b5cf0] to-[#5b8def]",
  },
  { key: "sunset", label: "Sunset", className: "bg-gradient-to-r from-[#ff7e5f] to-[#feb47b]" },
  { key: "ocean", label: "Ocean", className: "bg-gradient-to-r from-[#2193b0] to-[#6dd5ed]" },
  { key: "forest", label: "Forest", className: "bg-gradient-to-r from-[#11998e] to-[#38ef7d]" },
  { key: "berry", label: "Berry", className: "bg-gradient-to-r from-[#c31432] to-[#240b36]" },
  { key: "peach", label: "Peach", className: "bg-gradient-to-r from-[#f6d365] to-[#fda085]" },
  { key: "slate", label: "Slate", className: "bg-gradient-to-r from-[#334155] to-[#64748b]" },
  { key: "aurora", label: "Aurora", className: "bg-gradient-to-r from-[#a18cd1] to-[#fbc2eb]" },
];

const settingsRows = [
  {
    id: "preferences",
    title: "Work / Home Context",
    body: "Set your default workspace and context",
    icon: Home,
    tint: "bg-[#f3ebfe] text-[#975ee2]",
  },
  {
    id: "working-time",
    title: "Working time",
    body: "Days, hours, holidays and leave Coey respects",
    icon: Clock,
    tint: "bg-[#e9f4ff] text-[#2874f4]",
  },
  {
    id: "coey",
    title: "Coey",
    body: "Full, Light or Quiet",
    icon: Sparkles,
    tint: "bg-[#f3ebfe] text-[#975ee2]",
  },
  {
    id: "notifications",
    title: "Notifications",
    body: "Manage push delivery on this device",
    icon: Bell,
    tint: "bg-[#fef4ec] text-[#fd983f]",
  },
  {
    id: "appearance",
    title: "Appearance",
    body: "Theme, reduced motion, and display preferences",
    icon: Palette,
    tint: "bg-[#e4fcee] text-[#12a15f]",
  },
  {
    id: "privacy",
    title: "Privacy",
    body: "Manage what others can see",
    icon: LockKeyhole,
    tint: "bg-[#f3ebfe] text-[#975ee2]",
  },
  {
    id: "integrations",
    title: "Integrations",
    body: "Connect your favourite tools",
    icon: Link,
    tint: "bg-[#e9f4ff] text-[#2874f4]",
  },
  {
    id: "devices",
    title: "Logged-in devices",
    body: "See and sign out of devices using your account",
    icon: Monitor,
    tint: "bg-[#f3ebfe] text-[#975ee2]",
  },
];

function MePage() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const uploadAvatar = useUploadAvatar();
  const updateProfile = useUpdateProfile();
  const {
    stats,
    restore,
    readState: trophyReadState,
    retry: retryTrophy,
    sortedCount,
  } = useTrophy();
  const [solvedOpen, setSolvedOpen] = useState(false);
  const sortedCardRef = useRef<HTMLButtonElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const { context } = useAppContext();

  const [panel, setPanel] = useState<string | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editOccupation, setEditOccupation] = useState("");
  const [editNameError, setEditNameError] = useState<string | null>(null);
  // G13: per-file avatar-upload state -- keeps the actual File so Retry
  // never has to ask the user to re-pick it, and distinguishes an in-flight
  // upload from a failed one instead of leaving no visible state at all.
  const [avatarAttempt, setAvatarAttempt] = useState<{
    file: File;
    status: "uploading" | "failed";
  } | null>(null);
  const { reduceMotion: reduced, setReduceMotion: setReduced } = useStoredMotionPreference();
  const selectedFont = useStoredFontPreference();
  // G06: real push permission state, shown honestly in the notifications
  // panel below instead of the previous static "in-app notifications
  // only, for now" copy (which was simply false -- real browser push
  // already existed via PushRegistrar, it just had no user-facing
  // control and auto-prompted for permission on every sign-in instead).
  const [pushPermission, setPushPermission] = useState<PushPermissionState>(() =>
    getPushPermissionState(),
  );
  const [pushEnabling, setPushEnabling] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);
  const [doorman, setDoorman] = useState(() => isDoormanEnabled());

  const name =
    profile?.display_name ||
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "You";
  const role = profile?.occupation || user?.user_metadata?.role_label || "Member";
  const initials =
    user?.user_metadata?.initials ||
    name
      .split(" ")
      .map((n: string) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  const avatarUrl = useAvatarUrl(name, user?.email, profile?.avatar_url);
  // G06: phone-based sign-in synthesizes a fake "local-<digits>@katalist.local"
  // address (see src/lib/auth/local-user.ts) so Supabase's email-shaped auth
  // internals still work -- it was never a real contact address, so it must
  // never be shown as one.
  const rawEmail = profile?.email || user?.email || "";
  // Phone sign-in mints placeholder addresses so Supabase's email-shaped auth
  // internals work: "@katalist.local" (local-user.ts) and "@users.katalist.invalid"
  // (phone-login middleware). `.invalid` is an RFC 2606 reserved TLD and is never
  // a real address, so neither should ever be shown as a contact email.
  const isSyntheticAuthEmail =
    rawEmail.endsWith("@katalist.local") || rawEmail.endsWith(".invalid");
  const email = isSyntheticAuthEmail ? "" : rawEmail;
  const phone = profile?.phone_e164 || user?.phone || "";
  const timezone = profile?.timezone || "";
  const createdAt = profile?.created_at || user?.created_at || "";
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "";
  const demoSession = user?.app_metadata?.provider === "demo";

  const aboutRows: { icon: typeof Mail; label: string; value: string }[] = [
    ...(email ? [{ icon: Mail, label: "Email", value: email }] : []),
    ...(phone ? [{ icon: Phone, label: "Phone", value: phone }] : []),
    ...(memberSince ? [{ icon: Calendar, label: "Member since", value: memberSince }] : []),
    ...(timezone ? [{ icon: Clock, label: "Time zone", value: timezone }] : []),
    ...(profile?.occupation
      ? [{ icon: Briefcase, label: "Occupation", value: profile.occupation }]
      : []),
  ];

  async function handleSignOut() {
    await signOut();
    qc.clear();
    toast.success("Signed out");
    await navigate({ to: "/auth", replace: true });
  }

  // G06: the ONLY place in the app that ever calls the permission-requesting
  // flow -- an explicit click here, never an automatic effect on sign-in.
  async function handleEnablePush() {
    if (!user?.id || pushEnabling) return;
    setPushEnabling(true);
    try {
      const result = await registerPushForUser(user.id, (opts) => void navigate(opts as never));
      setPushPermission(getPushPermissionState());
      if (result.ok) {
        toast.success("Notifications enabled.");
      } else if (result.reason === "denied") {
        toast.error(
          "Notifications were blocked. You can allow them again in your browser's site settings.",
        );
      } else if (result.reason === "unsupported") {
        toast.error("This browser doesn't support push notifications.");
      } else {
        toast.error("Couldn't enable notifications right now.");
      }
    } finally {
      setPushEnabling(false);
    }
  }

  async function handleTestPush() {
    if (pushTesting) return;
    setPushTesting(true);
    try {
      const result = await sendTestPush();
      if (result.ok) toast.success("Test sent. Chrome should show it now.");
      else toast.error(result.message);
    } finally {
      setPushTesting(false);
    }
  }

  if (profileLoading) {
    return (
      <AppShell>
        <MeSkeleton />
      </AppShell>
    );
  }

  const coverTheme = profile?.cover_theme ?? "photo";
  const coverIsPhoto = coverTheme === "photo" || coverTheme === "violet";
  const coverClass = COVER_THEMES.find((c) => c.key === coverTheme)?.className;

  const submitAvatarFile = (file: File) => {
    setAvatarAttempt({ file, status: "uploading" });
    const epoch = getIdentityEpoch(qc).epoch;
    uploadAvatar.mutate(file, {
      onSuccess: () => {
        if (!isEpochCurrent(qc, epoch)) return;
        toast.success("Photo updated.");
        setAvatarAttempt(null);
      },
      onError: (err) => {
        if (!isEpochCurrent(qc, epoch)) return;
        toast.error(err instanceof Error ? err.message : "Couldn’t save photo.");
        // Keep the same File so Retry can resubmit it without asking the
        // user to re-select anything.
        setAvatarAttempt({ file, status: "failed" });
      },
    });
  };
  const onAvatarFile = (file?: File | null) => {
    if (!file) return;
    submitAvatarFile(file);
  };
  const retryAvatarUpload = () => {
    if (!avatarAttempt) return;
    submitAvatarFile(avatarAttempt.file);
  };
  const saveCover = (key: string) => {
    setCoverOpen(false);
    const epoch = getIdentityEpoch(qc).epoch;
    updateProfile.mutate(
      { cover_theme: key },
      {
        onError: (err) => {
          if (isEpochCurrent(qc, epoch))
            toast.error(err instanceof Error ? err.message : "Couldn’t save cover.");
        },
      },
    );
  };
  const openEdit = () => {
    setEditName(name);
    setEditOccupation(profile?.occupation ?? "");
    setEditNameError(null);
    setEditOpen(true);
  };
  const saveEdit = () => {
    const dn = editName.trim();
    if (!dn) {
      // G13: inline, field-level message (not just a toast) so the user
      // sees exactly which field needs fixing, matching the pattern this
      // dialog otherwise entirely lacked. Edits are already retained -- the
      // dialog stays open either way -- this only makes the reason visible
      // at the field itself.
      setEditNameError("Name can’t be empty.");
      return;
    }
    setEditNameError(null);
    const epoch = getIdentityEpoch(qc).epoch;
    updateProfile.mutate(
      { display_name: dn, occupation: editOccupation.trim() || null },
      {
        onSuccess: () => {
          if (!isEpochCurrent(qc, epoch)) return;
          toast.success("Profile updated.");
          setEditOpen(false);
        },
        onError: (err) => {
          // A genuine server/network rejection stays a toast -- unlike the
          // empty-name case above, this isn't a locally-knowable failure
          // mode, so there's no specific field to point at.
          if (isEpochCurrent(qc, epoch))
            toast.error(err instanceof Error ? err.message : "Couldn’t save.");
        },
      },
    );
  };

  const statCards = [
    {
      icon: SortedActivityIcon,
      tone: "sorted",
      value: sortedCount === null ? "—" : String(sortedCount),
      label: "Things sorted",
      hint: "Currently sorted Things assigned to you",
      action: "solved" as const,
    },
    {
      icon: CaughtActivityIcon,
      tone: "caught",
      value:
        trophyReadState === "error" || trophyReadState === "loading" ? "—" : String(stats.caught),
      label: "Things caught",
      hint: "Every catch counts, even on the same Thing twice",
    },
    {
      icon: Flame,
      tone: "streak",
      value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : stats.streak,
      label: "Day streak",
      hint: "Consecutive days with at least one Thing sorted",
    },
    {
      icon: Calendar,
      tone: "weekly",
      value:
        trophyReadState === "error" || trophyReadState === "loading" ? "—" : String(stats.weekly),
      label: "Last 7 days",
      hint: "Rolling 7-day window, not a calendar week",
    },
  ] as const;

  const avatarNode = <PersonAvatar name={name} initials={initials} src={avatarUrl} size={112} />;

  return (
    <AppShell noPadding>
      <div className="profile-page">
        <aside className="profile-rail" aria-label="Profile and settings">
          <a className="profile-rail-current" href="#profile-details" aria-current="page">
            <UserRound aria-hidden="true" />
            Profile
          </a>
          {[
            { title: "Workspace", rows: settingsRows.slice(0, 3) },
            { title: "Preferences", rows: settingsRows.slice(3) },
          ].map((group) => (
            <section className="profile-rail-group" key={group.title}>
              <h2>{group.title}</h2>
              {group.rows.map((setting) => (
                <button
                  key={setting.id}
                  type="button"
                  onClick={() => setPanel(setting.id)}
                  aria-haspopup="dialog"
                  className="profile-rail-row"
                >
                  <setting.icon aria-hidden="true" />
                  <span>{setting.title}</span>
                </button>
              ))}
            </section>
          ))}
          <div className="profile-rail-utilities">
            <button
              type="button"
              className="profile-rail-row"
              onClick={() => setPanel("shredded")}
              aria-haspopup="dialog"
            >
              <Trash2 aria-hidden="true" />
              <span>
                Recently Shredded
                {(trophyReadState === "ready" || trophyReadState === "stale") &&
                stats.shredded.length
                  ? ` (${stats.shredded.length})`
                  : ""}
              </span>
            </button>
            <button
              type="button"
              className="profile-rail-row profile-sign-out"
              onClick={handleSignOut}
            >
              <LogOut aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        <div className="profile-content" id="profile-details">
          <header className="profile-intro">
            <p>Your profile</p>
            <span>Manage your details and make Katalist yours.</span>
          </header>
          <section className="profile-identity" aria-labelledby="profile-name">
            <div className="profile-avatar">
              {avatarNode}
              {!demoSession ? (
                <>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="Choose profile photo"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                      onAvatarFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="profile-photo-button"
                    aria-label="Change profile photo"
                    disabled={avatarAttempt?.status === "uploading"}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    <Camera aria-hidden="true" />
                  </button>
                </>
              ) : null}
              {avatarAttempt?.status === "uploading" ? (
                <span role="status" aria-label="Uploading photo" className="profile-photo-status">
                  <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                </span>
              ) : null}
              {avatarAttempt?.status === "failed" ? (
                <button
                  type="button"
                  className="profile-photo-button profile-photo-retry"
                  onClick={retryAvatarUpload}
                  aria-label="Upload failed — retry"
                >
                  <RotateCcw aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="profile-identity-copy">
              <h1 id="profile-name">{name}</h1>
              <p className="profile-role">{role}</p>
              <div className="profile-metadata">
                <span className="profile-context">
                  {context === "home" ? (
                    <Home aria-hidden="true" />
                  ) : (
                    <Briefcase aria-hidden="true" />
                  )}
                  {context} Mode
                </span>
                {timezone ? (
                  <span>
                    <MapPin aria-hidden="true" />
                    {timezone}
                  </span>
                ) : null}
                {memberSince ? (
                  <span>
                    <Calendar aria-hidden="true" />
                    Since {memberSince}
                  </span>
                ) : null}
              </div>
            </div>
            {!demoSession ? (
              <div className="profile-identity-actions">
                <button type="button" className="profile-edit-button" onClick={openEdit}>
                  <Pencil aria-hidden="true" />
                  Edit profile
                </button>
                <Popover open={coverOpen} onOpenChange={setCoverOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" className="profile-cover-button">
                      <ImagePlus className="h-3.5 w-3.5" />
                      Change cover
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-64 rounded-2xl border border-border/80 bg-white p-3"
                  >
                    <div
                      className={cn(
                        "mb-3 h-16 overflow-hidden rounded-lg",
                        !coverIsPhoto && coverClass,
                      )}
                    >
                      {coverIsPhoto ? (
                        <img
                          src={coverImage}
                          alt="Selected cover preview"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <p className="mb-2 text-[12px] font-semibold text-[#000533]">
                      Choose a wallpaper
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      <button
                        type="button"
                        title="Katalist"
                        onClick={() => saveCover("photo")}
                        className={cn(
                          "relative h-10 w-full overflow-hidden rounded-lg ring-2 transition-transform hover:scale-105",
                          coverIsPhoto ? "ring-[#975ee2]" : "ring-transparent",
                        )}
                      >
                        <img
                          src={coverImage}
                          alt=""
                          className="h-full w-full object-cover object-right"
                        />
                        {coverIsPhoto ? (
                          <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                        ) : null}
                      </button>
                      {COVER_THEMES.filter((c) => c.key !== "violet").map((c) => {
                        const active = coverTheme === c.key;
                        return (
                          <button
                            key={c.key}
                            type="button"
                            title={c.label}
                            onClick={() => saveCover(c.key)}
                            className={cn(
                              "relative h-10 w-full rounded-lg ring-2 transition-transform hover:scale-105",
                              c.className,
                              active ? "ring-[#975ee2]" : "ring-transparent",
                            )}
                          >
                            {active ? (
                              <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ) : null}
          </section>

          <section className="profile-personal" aria-labelledby="profile-personal-heading">
            <h2 id="profile-personal-heading">Personal details</h2>
            {aboutRows.length ? (
              <dl className="profile-details-list">
                {aboutRows.map((row) => (
                  <div key={row.label} className="profile-detail-row">
                    <dt>
                      <row.icon aria-hidden="true" />
                      <span>{row.label}</span>
                    </dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="profile-empty">No contact details on your profile yet.</p>
            )}
          </section>

          <section className="profile-activity" aria-labelledby="profile-activity-heading">
            <h2 id="profile-activity-heading">Your activity</h2>
            <p className="profile-activity-caption">Personal movement only.</p>
            {trophyReadState === "error" || trophyReadState === "stale" ? (
              <div role="alert" className="profile-activity-alert">
                <span>
                  {trophyReadState === "stale"
                    ? "Trophy stats may be out of date."
                    : "Trophy stats are unavailable. Your activity has not been erased."}
                </span>
                <button type="button" onClick={retryTrophy}>
                  Retry
                </button>
              </div>
            ) : null}
            <div className="profile-activity-grid">
              {statCards.map((stat) => {
                const body = (
                  <>
                    <stat.icon className="profile-activity-icon" aria-hidden="true" />
                    <div className="profile-activity-copy">
                      <h3>{stat.label}</h3>
                      <p className="profile-activity-value">
                        {stat.tone === "streak" && stat.value === "1d" ? "1 day" : stat.value}
                      </p>
                      <p className="profile-activity-hint">{stat.hint}</p>
                    </div>
                    {"action" in stat ? (
                      <span className="profile-activity-link">
                        View Things <ArrowRight aria-hidden="true" />
                      </span>
                    ) : null}
                  </>
                );
                return "action" in stat ? (
                  <button
                    key={stat.label}
                    type="button"
                    ref={sortedCardRef}
                    aria-label="View sorted Things"
                    aria-haspopup="dialog"
                    onClick={() => setSolvedOpen(true)}
                    className={`profile-activity-tile profile-activity-${stat.tone}`}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    key={stat.label}
                    className={`profile-activity-tile profile-activity-${stat.tone}`}
                  >
                    {body}
                  </div>
                );
              })}
            </div>
            {stats.achievement &&
            stats.achievement !== "—" &&
            trophyReadState !== "error" &&
            trophyReadState !== "loading" ? (
              <p className="profile-achievement">
                <Sparkles aria-hidden="true" />
                <span>
                  Recent achievement: <strong>{stats.achievement}</strong>
                </span>
              </p>
            ) : null}
          </section>
        </div>
      </div>

      {/* Edit profile dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="rounded-2xl bg-white p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold">Edit profile</DialogTitle>
            <DialogDescription className="text-[12.5px]">
              Update your photo, name, and role.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 flex items-center gap-4">
            <label
              className="group/av relative inline-block cursor-pointer rounded-full"
              title="Change photo"
            >
              <PersonAvatar name={name} initials={initials} src={avatarUrl} size={64} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-white opacity-0 transition-opacity group-hover/av:bg-black/35 group-hover/av:opacity-100">
                <Camera className="h-4 w-4" />
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => onAvatarFile(e.target.files?.[0])}
              />
            </label>
            <span className="text-[12px] text-muted-foreground">
              Tap the photo to upload a new one.
            </span>
          </div>
          <label className="mt-4 block text-[12px] font-medium text-[#3d3f74]">
            Name
            <input
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
                setEditNameError(null);
              }}
              aria-invalid={Boolean(editNameError)}
              className={cn(
                "mt-1 h-10 w-full rounded-xl border px-3 text-[13px] font-normal outline-none focus:ring-2 focus:ring-ring",
                editNameError
                  ? "border-destructive focus:border-destructive"
                  : "border-border focus:border-primary",
              )}
            />
            {editNameError ? (
              <p className="mt-1 text-[12px] font-normal text-destructive">{editNameError}</p>
            ) : null}
          </label>
          <label className="mt-3 block text-[12px] font-medium text-[#3d3f74]">
            Role / occupation
            <input
              value={editOccupation}
              onChange={(e) => setEditOccupation(e.target.value)}
              placeholder="e.g. Mobile Application Developer"
              className="mt-1 h-10 w-full rounded-xl border border-border px-3 text-[13px] font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring"
            />
          </label>
          <DialogFooter className="mt-4 gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEdit}
              className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* G13: these settings panels plus "Recently Shredded" were a
          hand-rolled `fixed inset-0` backdrop + plain <div> -- no
          role="dialog", no focus trap, no aria-labelledby, no Escape
          handling beyond whatever the browser gave it for free. Moved to
          the same accessible Dialog primitive "Edit profile" above already
          uses; content/controls are unchanged, this is only the wrapper. */}
      <Dialog open={panel !== null} onOpenChange={(open) => setPanel(open ? panel : null)}>
        <DialogContent
          className={cn(
            "rounded-2xl bg-white p-5",
            panel === "devices" ? "sm:max-w-lg" : "sm:max-w-md",
          )}
        >
          <div>
            {panel === "shredded" ? (
              <>
                <DialogHeader>
                  <DialogTitle className="text-[15px] font-semibold">Recently Shredded</DialogTitle>
                  <DialogDescription className="text-[12px]">
                    Restore something you shredded from your surfaces.
                  </DialogDescription>
                </DialogHeader>
                {trophyReadState === "error" || trophyReadState === "loading" ? (
                  <p className="mt-4 text-[13px] text-muted-foreground">
                    {trophyReadState === "loading"
                      ? "Loading Shred history…"
                      : "Shred history unavailable. Retry from the Trophy section."}
                  </p>
                ) : stats.shredded.length === 0 ? (
                  <p className="mt-4 text-[13px] text-muted-foreground">Nothing shredded yet.</p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {stats.shredded.map((s) => (
                      <li
                        key={`${s.kind}:${s.id}`}
                        className="flex items-center justify-between text-[12px]"
                      >
                        <span>{s.title}</span>
                        <button
                          type="button"
                          className="text-primary"
                          onClick={() =>
                            void Promise.resolve(restore(s.id, s.kind)).catch((err) =>
                              toast.error(
                                err instanceof Error ? err.message : "Couldn’t restore that.",
                              ),
                            )
                          }
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="text-[15px] font-semibold">
                    {settingsRows.find((s) => s.id === panel)?.title}
                  </DialogTitle>
                  <DialogDescription className="text-[12px]">
                    {settingsRows.find((s) => s.id === panel)?.body}
                  </DialogDescription>
                </DialogHeader>
                {panel === "working-time" ? (
                  <WorkingTimeSettings />
                ) : panel === "coey" ? (
                  <CoeyPresenceSettings />
                ) : panel === "devices" ? (
                  <LoggedInDevices />
                ) : panel === "appearance" ? (
                  <div className="mt-4 space-y-5">
                    <fieldset>
                      <legend className="text-[13px] font-semibold text-foreground">
                        App font
                      </legend>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        Choose the text style for this device.
                      </p>
                      <div className="mt-3 grid max-h-[min(50vh,420px)] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                        {FONT_OPTIONS.map((option) => (
                          <label
                            key={option.id}
                            className={cn(
                              "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring",
                              selectedFont === option.id
                                ? "border-primary bg-primary/5"
                                : "border-border hover:bg-muted/50",
                            )}
                          >
                            <input
                              type="radio"
                              name="app-font"
                              value={option.id}
                              checked={selectedFont === option.id}
                              onChange={() => setFontPreference(option.id)}
                              className="mt-1 accent-primary"
                            />
                            <span className="min-w-0">
                              <span
                                className="block text-[16px] font-semibold leading-tight"
                                style={{ fontFamily: option.stack }}
                              >
                                {option.label}
                              </span>
                              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                                {option.detail}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <label className="flex items-center justify-between text-[13px]">
                      Reduced motion
                      <input
                        type="checkbox"
                        checked={reduced}
                        onChange={(e) => setReduced(e.target.checked)}
                      />
                    </label>
                  </div>
                ) : panel === "preferences" ? (
                  <label className="mt-4 flex items-center justify-between gap-3 text-[13px]">
                    <span>
                      Doorman breakthroughs
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        Let genuinely urgent Things from your other context surface as a Ghost Card.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={doorman}
                      onChange={(e) => {
                        setDoorman(e.target.checked);
                        localStorage.setItem(
                          "katalist.doorman_enabled",
                          e.target.checked ? "1" : "0",
                        );
                        void qc.invalidateQueries({ queryKey: ["doorman"] });
                      }}
                    />
                  </label>
                ) : panel === "notifications" ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-[13px] text-muted-foreground">
                      You're notified in-app when a Thing is assigned to you, caught, reassigned,
                      nudged, commented on, sorted, or cancelled.
                    </p>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3">
                      <div>
                        <p className="text-[13px] font-medium text-foreground">
                          Push notifications
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {pushPermission === "granted"
                            ? "Enabled on this device."
                            : pushPermission === "denied"
                              ? "Blocked — allow them again in your browser's site settings to re-enable."
                              : pushPermission === "unsupported"
                                ? "Not supported in this browser."
                                : "Off. Enable to get notified even when Katalist isn't open."}
                        </p>
                      </div>
                      {pushPermission === "default" ? (
                        <button
                          type="button"
                          onClick={() => void handleEnablePush()}
                          disabled={pushEnabling}
                          className="h-8 shrink-0 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-60"
                        >
                          {pushEnabling ? "Enabling…" : "Enable"}
                        </button>
                      ) : pushPermission === "granted" ? (
                        <button
                          type="button"
                          onClick={() => void handleTestPush()}
                          disabled={pushTesting}
                          className="h-8 shrink-0 rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-foreground disabled:opacity-60"
                        >
                          {pushTesting ? "Sending…" : "Send test"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : panel === "integrations" ? (
                  <p className="mt-4 text-[13px] text-muted-foreground">
                    No integrations are available yet. Connections to your favourite tools will
                    appear here as they become available.
                  </p>
                ) : (
                  <p className="mt-4 text-[13px] text-muted-foreground">
                    Your name, email, and avatar are visible to other Katalist accounts. Your phone
                    number is never shown to anyone else. Private Buckets are visible only to you.
                  </p>
                )}
              </>
            )}
            <button
              type="button"
              className="mt-5 text-[13px] text-primary"
              onClick={() => setPanel(null)}
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <SolvedThingsDialog
        open={solvedOpen}
        onOpenChange={setSolvedOpen}
        returnFocusRef={sortedCardRef}
      />
    </AppShell>
  );
}
