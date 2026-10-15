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
  Shield,
  CheckCircle2,
  Copy,
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
import { Switch } from "@/components/ui/switch";
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

/** Curated, atmospheric mesh gradient presets for the profile cover banner. */
const COVER_THEMES = [
  {
    key: "iris",
    label: "Midnight Iris",
    className: "cover-mesh-iris",
  },
  {
    key: "dusk",
    label: "Cosmic Dusk",
    className: "cover-mesh-dusk",
  },
  {
    key: "cobalt",
    label: "Hyper Cobalt",
    className: "cover-mesh-cobalt",
  },
  {
    key: "emerald",
    label: "Emerald Horizon",
    className: "cover-mesh-emerald",
  },
  {
    key: "amber",
    label: "Warm Amber",
    className: "cover-mesh-amber",
  },
  {
    key: "aurora",
    label: "Nordic Aurora",
    className: "cover-mesh-aurora",
  },
  {
    key: "slate",
    label: "Monochrome Slate",
    className: "cover-mesh-slate",
  },
  {
    key: "berry",
    label: "Berry Velvet",
    className: "cover-mesh-berry",
  },
] as const;

type SettingsTabId =
  | "profile"
  | "preferences"
  | "working-time"
  | "coey"
  | "notifications"
  | "appearance"
  | "privacy"
  | "integrations"
  | "devices";

const settingsRows = [
  {
    id: "preferences" as const,
    title: "Work / Home Context",
    body: "Set your default workspace and context",
    icon: Home,
  },
  {
    id: "working-time" as const,
    title: "Working time",
    body: "Days, hours, holidays and leave Coey respects",
    icon: Clock,
  },
  {
    id: "coey" as const,
    title: "Coey",
    body: "Full, Light or Quiet",
    icon: Sparkles,
  },
  {
    id: "notifications" as const,
    title: "Notifications",
    body: "Manage push delivery on this device",
    icon: Bell,
  },
  {
    id: "appearance" as const,
    title: "Appearance",
    body: "Theme, reduced motion, and display preferences",
    icon: Palette,
  },
  {
    id: "privacy" as const,
    title: "Privacy",
    body: "Manage what others can see",
    icon: LockKeyhole,
  },
  {
    id: "integrations" as const,
    title: "Integrations",
    body: "Connect your favourite tools",
    icon: Link,
  },
  {
    id: "devices" as const,
    title: "Logged-in devices",
    body: "See and sign out of devices using your account",
    icon: Monitor,
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
  const { context, setContext } = useAppContext();

  const [activeTab, setActiveTab] = useState<SettingsTabId>("profile");
  const [shreddedOpen, setShreddedOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editOccupation, setEditOccupation] = useState("");
  const [editNameError, setEditNameError] = useState<string | null>(null);
  const [avatarAttempt, setAvatarAttempt] = useState<{
    file: File;
    status: "uploading" | "failed";
  } | null>(null);
  const { reduceMotion: reduced, setReduceMotion: setReduced } = useStoredMotionPreference();
  const selectedFont = useStoredFontPreference();
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
  const rawEmail = profile?.email || user?.email || "";
  const isSyntheticAuthEmail =
    rawEmail.endsWith("@katalist.local") || rawEmail.endsWith(".invalid");
  const email = isSyntheticAuthEmail ? "" : rawEmail;
  const phone = profile?.phone_e164 || user?.phone || "";
  const timezone = profile?.timezone || "Asia/Kolkata";
  const createdAt = profile?.created_at || user?.created_at || "";
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "";
  const demoSession = user?.app_metadata?.provider === "demo";

  async function handleSignOut() {
    await signOut();
    qc.clear();
    toast.success("Signed out");
    await navigate({ to: "/auth", replace: true });
  }

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
      <AppShell homeSurface="me">
        <MeSkeleton />
      </AppShell>
    );
  }

  // Gracefully map legacy preset keys to the new atmospheric mesh gradients
  const rawCoverTheme = profile?.cover_theme ?? "iris";
  const themeMap: Record<string, string> = {
    photo: "iris",
    violet: "iris",
    ocean: "cobalt",
    forest: "emerald",
    sunset: "dusk",
    peach: "amber",
    slate: "slate",
    aurora: "aurora",
    berry: "berry",
  };
  const activeCoverKey =
    themeMap[rawCoverTheme] ||
    (COVER_THEMES.some((t) => t.key === rawCoverTheme) ? rawCoverTheme : "iris");
  const activeCoverClass =
    COVER_THEMES.find((c) => c.key === activeCoverKey)?.className ?? "cover-mesh-iris";

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
        onSuccess: () => {
          if (isEpochCurrent(qc, epoch)) toast.success("Cover theme updated.");
        },
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
          if (isEpochCurrent(qc, epoch))
            toast.error(err instanceof Error ? err.message : "Couldn’t save.");
        },
      },
    );
  };

  const copyValue = (value: string, label: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied to clipboard`);
  };

  const avatarNode = <PersonAvatar name={name} initials={initials} src={avatarUrl} size={84} />;
  const currentSettingMeta = settingsRows.find((s) => s.id === activeTab);

  return (
    <AppShell noPadding homeSurface="me">
      <div className="profile-page">
        {/* Left Rail Navigation */}
        <aside className="profile-rail" aria-label="Profile and settings">
          <button
            type="button"
            className={cn(
              "profile-rail-row",
              activeTab === "profile" && "profile-rail-current",
            )}
            onClick={() => setActiveTab("profile")}
          >
            <UserRound aria-hidden="true" />
            <span>Profile</span>
          </button>

          {[
            { title: "Workspace", rows: settingsRows.slice(0, 3) },
            { title: "Preferences", rows: settingsRows.slice(3) },
          ].map((group) => (
            <section className="profile-rail-group" key={group.title}>
              <h2>{group.title}</h2>
              {group.rows.map((setting) => {
                const isCurrent = activeTab === setting.id;
                return (
                  <button
                    key={setting.id}
                    type="button"
                    onClick={() => setActiveTab(setting.id as SettingsTabId)}
                    className={cn(
                      "profile-rail-row",
                      isCurrent && "profile-rail-current",
                    )}
                  >
                    <setting.icon aria-hidden="true" />
                    <span>{setting.title}</span>
                  </button>
                );
              })}
            </section>
          ))}

          <div className="profile-rail-utilities">
            <button
              type="button"
              className="profile-rail-row"
              onClick={() => setShreddedOpen(true)}
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

        {/* Content View */}
        <div className="profile-content" id="profile-details">
          <header className="home-page-heading hidden">
            <p>YOUR PROFILE</p>
            <h2>A little space that feels like you.</h2>
          </header>
          {activeTab === "profile" ? (
            <div className="space-y-6">
              {/* Atmospheric Gradient Cover Banner */}
              <div
                className={cn(
                  "profile-cover-banner transition-all duration-300",
                  activeCoverClass,
                )}
              />

              {/* Identity Row */}
              <section className="profile-identity" aria-labelledby="profile-name">
                <div className="flex items-end gap-4 min-w-0">
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

                  <div className="profile-identity-copy min-w-0">
                    <div className="profile-identity-name-row">
                      <h1 id="profile-name">{name}</h1>
                      <span className="profile-badge-role">{role}</span>
                      <span className="profile-badge-context">
                        {context === "home" ? (
                          <Home aria-hidden="true" />
                        ) : (
                          <Briefcase aria-hidden="true" />
                        )}
                        {context === "home" ? "Home" : "Work"} Mode
                      </span>
                    </div>
                    <div className="profile-metadata-sub">
                      {email ? (
                        <span>
                          <Mail aria-hidden="true" />
                          {email}
                        </span>
                      ) : null}
                      {phone ? (
                        <span>
                          <Phone aria-hidden="true" />
                          {phone}
                        </span>
                      ) : null}
                      {timezone ? (
                        <span>
                          <MapPin aria-hidden="true" />
                          {timezone}
                        </span>
                      ) : null}
                      {memberSince ? (
                        <span>
                          <Calendar aria-hidden="true" />
                          Joined {memberSince}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {!demoSession ? (
                  <div className="profile-identity-actions">
                    <Popover open={coverOpen} onOpenChange={setCoverOpen}>
                      <PopoverTrigger asChild>
                        <button type="button" className="profile-btn-action">
                          <Palette aria-hidden="true" />
                          <span>Change cover</span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-80 rounded-2xl border border-border/80 bg-white p-4 shadow-xl"
                      >
                        <div className="mb-3">
                          <p className="text-[13px] font-semibold text-foreground">Ambient Cover Themes</p>
                          <p className="text-[11.5px] text-muted-foreground mt-0.5">
                            Curated radial mesh atmospheric backgrounds
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {COVER_THEMES.map((c) => {
                            const active = activeCoverKey === c.key;
                            return (
                              <button
                                key={c.key}
                                type="button"
                                onClick={() => saveCover(c.key)}
                                className={cn(
                                  "group relative flex items-center gap-2 p-1.5 rounded-xl border transition-all text-left",
                                  active
                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                    : "border-border/60 hover:border-border hover:bg-muted/50",
                                )}
                              >
                                <div
                                  className={cn(
                                    "h-7 w-7 rounded-lg shadow-inner flex items-center justify-center shrink-0 border border-white/10",
                                    c.className,
                                  )}
                                >
                                  {active && (
                                    <Check className="h-3.5 w-3.5 text-white drop-shadow stroke-[2.5]" />
                                  )}
                                </div>
                                <span className="text-[11.5px] font-medium text-foreground truncate">
                                  {c.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>

                    <button type="button" className="profile-btn-action" onClick={openEdit}>
                      <Pencil aria-hidden="true" />
                      <span>Edit profile</span>
                    </button>
                  </div>
                ) : null}
              </section>

              {/* Personal Details / Credentials Card */}
              <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{context === "home" ? "Personal details" : "Account Credentials"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {context === "home" ? "Your details, in one place." : "Personal identity and verified contact endpoints"}
                    </p>
                  </div>
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Verified
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 pt-1">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-lg bg-background border border-border/60 flex items-center justify-center text-foreground/70 shrink-0">
                        <Mail className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Email Address</p>
                        <p className="text-xs font-semibold text-foreground truncate mt-0.5">
                          {email || "No email linked"}
                        </p>
                      </div>
                    </div>
                    {email ? (
                      <button
                        type="button"
                        onClick={() => copyValue(email, "Email")}
                        className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-background/80 transition-colors shrink-0"
                        title="Copy email"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-lg bg-background border border-border/60 flex items-center justify-center text-foreground/70 shrink-0">
                        <Phone className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Mobile Number</p>
                        <p className="text-xs font-semibold text-foreground truncate mt-0.5">
                          {phone || "No phone linked"}
                        </p>
                      </div>
                    </div>
                    {phone ? (
                      <button
                        type="button"
                        onClick={() => copyValue(phone, "Phone")}
                        className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-background/80 transition-colors shrink-0"
                        title="Copy phone"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="h-9 w-9 rounded-lg bg-background border border-border/60 flex items-center justify-center text-foreground/70 shrink-0">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Time Zone</p>
                      <p className="text-xs font-semibold text-foreground truncate mt-0.5">
                        {timezone || "Asia/Kolkata"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="h-9 w-9 rounded-lg bg-background border border-border/60 flex items-center justify-center text-foreground/70 shrink-0">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Workspace Role</p>
                      <p className="text-xs font-semibold text-foreground truncate mt-0.5">{role}</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Workspace Velocity / Activity Card */}
              <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{context === "home" ? "Your activity" : "Workspace Velocity"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {context === "home" ? "A look at your recent activity." : "Live movement and touchpoints across your Things"}
                    </p>
                  </div>
                  <button
                    type="button"
                    ref={sortedCardRef}
                    onClick={() => setSolvedOpen(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>Solved history</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>

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

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                  <div className="p-4 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between text-muted-foreground mb-2">
                      <span className="text-[11.5px] font-medium">Things Sorted</span>
                      <SortedActivityIcon className="h-4 w-4 text-primary" />
                    </div>
                    <p className="text-3xl font-bold tracking-tight text-foreground font-mono">
                      {sortedCount === null ? "—" : String(sortedCount)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">Currently assigned & resolved</p>
                  </div>

                  <div className="p-4 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between text-muted-foreground mb-2">
                      <span className="text-[11.5px] font-medium">Things Caught</span>
                      <CaughtActivityIcon className="h-4 w-4 text-[#008493]" />
                    </div>
                    <p className="text-3xl font-bold tracking-tight text-foreground font-mono">
                      {trophyReadState === "error" || trophyReadState === "loading"
                        ? "—"
                        : String(stats.caught)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">Total catches on the board</p>
                  </div>

                  <div className="p-4 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between text-muted-foreground mb-2">
                      <span className="text-[11.5px] font-medium">Active Streak</span>
                      <Flame className="h-4 w-4 text-[#bd6a08]" />
                    </div>
                    <p className="text-3xl font-bold tracking-tight text-foreground font-mono">
                      {trophyReadState === "error" || trophyReadState === "loading"
                        ? "—"
                        : stats.streak === "1d"
                          ? "1 day"
                          : stats.streak || "0"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">Consecutive sorted days</p>
                  </div>

                  <div className="p-4 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between text-muted-foreground mb-2">
                      <span className="text-[11.5px] font-medium">7-Day Touchpoints</span>
                      <Calendar className="h-4 w-4 text-[#494ee4]" />
                    </div>
                    <p className="text-3xl font-bold tracking-tight text-foreground font-mono">
                      {trophyReadState === "error" || trophyReadState === "loading"
                        ? "—"
                        : String(stats.weekly)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">Rolling 7-day velocity</p>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            /* In-page Settings Content */
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-border/70">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab("profile")}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                    >
                      <span>Profile</span>
                      <span>/</span>
                    </button>
                    <span className="text-xs font-semibold text-primary">
                      {currentSettingMeta?.title}
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    {currentSettingMeta?.title}
                  </h1>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {currentSettingMeta?.body}
                  </p>
                </div>
              </div>

              {activeTab === "preferences" && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">Active Context</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Switch your current headspace. Things, buckets, and nudges filter automatically based on this.
                      </p>
                    </div>
                    <div className="inline-flex rounded-xl bg-muted/60 p-1 border border-border/50">
                      <button
                        type="button"
                        onClick={() => setContext("work")}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all",
                          context === "work"
                            ? "bg-white text-foreground shadow-sm font-semibold"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Briefcase className="h-4 w-4 text-[#2874f4]" />
                        Work Context
                      </button>
                      <button
                        type="button"
                        onClick={() => setContext("home")}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all",
                          context === "home"
                            ? "bg-white text-foreground shadow-sm font-semibold"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Home className="h-4 w-4 text-[#975ee2]" />
                        Home Context
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-primary" />
                          <h2 className="text-sm font-semibold text-foreground">Doorman Breakthroughs</h2>
                        </div>
                        <p className="text-xs text-muted-foreground max-w-lg leading-relaxed">
                          Let genuinely urgent Things from your other context surface as a Ghost Card without breaking your focus or pulling you out of your current zone.
                        </p>
                      </div>
                      <Switch
                        checked={doorman}
                        onCheckedChange={(checked) => {
                          setDoorman(checked);
                          localStorage.setItem("katalist.doorman_enabled", checked ? "1" : "0");
                          void qc.invalidateQueries({ queryKey: ["doorman"] });
                          toast.success(
                            checked ? "Doorman breakthroughs enabled" : "Doorman breakthroughs disabled",
                          );
                        }}
                      />
                    </div>
                    <div className="rounded-xl border border-border/40 bg-muted/30 p-3.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <Sparkles className="h-4 w-4 text-primary shrink-0" />
                      <span>
                        When enabled, high-priority notifications from your inactive mode appear gracefully as Ghost Cards at the edge of your screen.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "working-time" && (
                <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
                  <WorkingTimeSettings />
                </div>
              )}

              {activeTab === "coey" && (
                <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
                  <CoeyPresenceSettings />
                </div>
              )}

              {activeTab === "notifications" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Bell className="h-4 w-4 text-[#fd983f]" />
                          <h2 className="text-sm font-semibold text-foreground">Browser Push Delivery</h2>
                        </div>
                        <p className="text-xs text-muted-foreground max-w-lg leading-relaxed">
                          Receive real-time updates for assignments, urgent nudges, and team catches even when Katalist is in the background.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                            pushPermission === "granted"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : pushPermission === "denied"
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-muted text-muted-foreground border border-border/50",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              pushPermission === "granted"
                                ? "bg-emerald-500"
                                : pushPermission === "denied"
                                  ? "bg-rose-500"
                                  : "bg-muted-foreground",
                            )}
                          />
                          {pushPermission === "granted"
                            ? "Enabled"
                            : pushPermission === "denied"
                              ? "Blocked"
                              : pushPermission === "unsupported"
                                ? "Unsupported"
                                : "Not enabled"}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center gap-3">
                      {pushPermission === "default" && (
                        <button
                          type="button"
                          onClick={() => void handleEnablePush()}
                          disabled={pushEnabling}
                          className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-primary text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60 transition-all"
                        >
                          {pushEnabling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {pushEnabling ? "Enabling…" : "Enable Push Notifications"}
                        </button>
                      )}
                      {pushPermission === "granted" && (
                        <button
                          type="button"
                          onClick={() => void handleTestPush()}
                          disabled={pushTesting}
                          className="inline-flex items-center gap-2 h-9 px-4 rounded-xl border border-border bg-background text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 transition-all"
                        >
                          {pushTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {pushTesting ? "Sending…" : "Send Test Push"}
                        </button>
                      )}
                      {pushPermission === "denied" && (
                        <p className="text-xs text-rose-600">
                          Push notifications are blocked in your browser settings. You can allow them again via the lock icon in your URL bar.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-3">
                    <h2 className="text-sm font-semibold text-foreground">In-App Notification Triggers</h2>
                    <p className="text-xs text-muted-foreground">
                      Katalist alerts you inside the app for the following essential events:
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 pt-1">
                      {[
                        { title: "Things Assigned", desc: "When someone assigns or delegates a task to you" },
                        { title: "Things Caught", desc: "When a colleague picks up a task you created" },
                        { title: "Nudges & Reminders", desc: "Gentle reminders when things need your attention" },
                        { title: "Court Movement", desc: "When items are sorted, resolved, or cancelled" },
                      ].map((item) => (
                        <div key={item.title} className="p-3 rounded-xl border border-border/50 bg-muted/20">
                          <p className="text-xs font-medium text-foreground">{item.title}</p>
                          <p className="text-[11.5px] text-muted-foreground mt-0.5">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "appearance" && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">App Font Typography</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Select a typeface that suits your reading style across the application.
                      </p>
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {FONT_OPTIONS.map((option) => (
                        <label
                          key={option.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all focus-within:ring-2 focus-within:ring-primary",
                            selectedFont === option.id
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "border-border/60 hover:bg-muted/40",
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
                          <div className="min-w-0">
                            <span
                              className="block text-[15px] font-semibold leading-tight text-foreground"
                              style={{ fontFamily: option.stack }}
                            >
                              {option.label}
                            </span>
                            <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">
                              {option.detail}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <h2 className="text-sm font-semibold text-foreground">Reduced Motion</h2>
                        <p className="text-xs text-muted-foreground">
                          Minimize sliding transitions, fly animations, and decorative movement across the workspace.
                        </p>
                      </div>
                      <Switch
                        checked={reduced}
                        onCheckedChange={(checked) => setReduced(checked)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "privacy" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                    <div className="flex items-center gap-2">
                      <LockKeyhole className="h-4 w-4 text-[#975ee2]" />
                      <h2 className="text-sm font-semibold text-foreground">Privacy & Data Governance</h2>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Katalist is built with privacy-first boundaries. Your private workspaces and contact information are protected by strict row-level security.
                    </p>

                    <div className="grid gap-3 pt-1">
                      <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 space-y-1">
                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          Private Buckets
                        </p>
                        <p className="text-[12px] text-muted-foreground leading-relaxed">
                          Buckets marked as private are visible only to you. No team members, workspace admins, or automated summaries can view private Things.
                        </p>
                      </div>
                      <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 space-y-1">
                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          Public Profile Fields
                        </p>
                        <p className="text-[12px] text-muted-foreground leading-relaxed">
                          Your display name, avatar, occupation, and timezone are visible to team members to facilitate collaboration and working hours awareness.
                        </p>
                      </div>
                      <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 space-y-1">
                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          Phone & Contact Confidentiality
                        </p>
                        <p className="text-[12px] text-muted-foreground leading-relaxed">
                          Your phone number and authentication tokens are strictly confidential and never displayed in directory or team lists.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "integrations" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                    <div className="flex items-center gap-2">
                      <Link className="h-4 w-4 text-[#2874f4]" />
                      <h2 className="text-sm font-semibold text-foreground">Connected Integrations</h2>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Connect your existing productivity stack to link code commits, calendar blocks, and team chats.
                    </p>

                    <div className="grid gap-3 pt-1 sm:grid-cols-2">
                      <div className="p-4 rounded-xl border border-border/60 bg-muted/10 flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-foreground">GitHub</p>
                          <p className="text-[11.5px] text-muted-foreground">Link commits and pull requests to Things</p>
                        </div>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Available
                        </span>
                      </div>
                      <div className="p-4 rounded-xl border border-border/60 bg-muted/10 flex items-start justify-between gap-3 opacity-75">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-foreground">Google Calendar</p>
                          <p className="text-[11.5px] text-muted-foreground">Sync working hours and time blocks</p>
                        </div>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
                          Coming Soon
                        </span>
                      </div>
                      <div className="p-4 rounded-xl border border-border/60 bg-muted/10 flex items-start justify-between gap-3 opacity-75">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-foreground">Slack</p>
                          <p className="text-[11.5px] text-muted-foreground">Send nudges and receive daily briefings</p>
                        </div>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
                          Coming Soon
                        </span>
                      </div>
                      <div className="p-4 rounded-xl border border-border/60 bg-muted/10 flex items-start justify-between gap-3 opacity-75">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-foreground">Linear</p>
                          <p className="text-[11.5px] text-muted-foreground">Bi-directional issue sync with Katalist</p>
                        </div>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
                          Coming Soon
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "devices" && (
                <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
                  <LoggedInDevices />
                </div>
              )}
            </div>
          )}
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

      {/* Recently Shredded dialog */}
      <Dialog open={shreddedOpen} onOpenChange={setShreddedOpen}>
        <DialogContent className="rounded-2xl bg-white p-5 sm:max-w-md">
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
                    className="text-primary font-medium hover:underline"
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
