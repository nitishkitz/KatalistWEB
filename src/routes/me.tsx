import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bell,
  Briefcase,
  ChevronRight,
  Home,
  LogOut,
  Palette,
  Shield,
  Sparkles,
  Flame,
  Crown,
  BarChart3,
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
  Plug,
  Laptop,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { MeSkeleton } from "@/components/katalist/ScreenSkeletons";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useSession } from "@/hooks/useSession";
import { useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/features/context/use-app-context";
import { useProfile, useUploadAvatar, useUpdateProfile } from "@/features/me/use-profile";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTrophy } from "@/features/me/use-trophy";
import { useAvatarUrl } from "@/features/people/directory";
import { isDoormanEnabled } from "@/features/doorman/use-doorman";
import { cn } from "@/lib/utils";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useStoredMotionPreference } from "@/hooks/use-motion-preference";
import { getPushPermissionState, registerPushForUser, type PushPermissionState } from "@/features/push/push-registration";
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

const CARD_SHADOW = "0 3px 9.4px 0 rgba(0,0,0,0.05)";

/** Selectable profile cover wallpapers (gradient presets). "photo" keeps the
 *  illustrated Katalist banner; the rest are the existing gradient options. */
const COVER_THEMES: { key: string; label: string; className: string }[] = [
  { key: "violet", label: "Violet", className: "bg-gradient-to-r from-[#7c4ddb] via-[#8b5cf0] to-[#5b8def]" },
  { key: "sunset", label: "Sunset", className: "bg-gradient-to-r from-[#ff7e5f] to-[#feb47b]" },
  { key: "ocean", label: "Ocean", className: "bg-gradient-to-r from-[#2193b0] to-[#6dd5ed]" },
  { key: "forest", label: "Forest", className: "bg-gradient-to-r from-[#11998e] to-[#38ef7d]" },
  { key: "berry", label: "Berry", className: "bg-gradient-to-r from-[#c31432] to-[#240b36]" },
  { key: "peach", label: "Peach", className: "bg-gradient-to-r from-[#f6d365] to-[#fda085]" },
  { key: "slate", label: "Slate", className: "bg-gradient-to-r from-[#334155] to-[#64748b]" },
  { key: "aurora", label: "Aurora", className: "bg-gradient-to-r from-[#a18cd1] to-[#fbc2eb]" },
];

const settingsRows = [
  { id: "preferences", title: "Work / Home Context", body: "Set your default workspace and context", icon: Home, tint: "bg-[#f3ebfe] text-[#975ee2]" },
  { id: "notifications", title: "Notifications", body: "Manage push delivery on this device", icon: Bell, tint: "bg-[#fef4ec] text-[#fd983f]" },
  { id: "appearance", title: "Appearance", body: "Theme, reduced motion, and display preferences", icon: Palette, tint: "bg-[#e4fcee] text-[#12a15f]" },
  { id: "privacy", title: "Privacy", body: "Manage what others can see", icon: Shield, tint: "bg-[#f3ebfe] text-[#975ee2]" },
  { id: "integrations", title: "Integrations", body: "Connect your favourite tools", icon: Plug, tint: "bg-[#e9f4ff] text-[#2874f4]" },
  { id: "devices", title: "Logged-in devices", body: "See and sign out of devices using your account", icon: Laptop, tint: "bg-[#f3ebfe] text-[#975ee2]" },
];

function MePage() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const uploadAvatar = useUploadAvatar();
  const updateProfile = useUpdateProfile();
  const { stats, restore, readState: trophyReadState, retry: retryTrophy } = useTrophy();
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
  const [avatarAttempt, setAvatarAttempt] = useState<{ file: File; status: "uploading" | "failed" } | null>(null);
  const { reduceMotion: reduced, setReduceMotion: setReduced } = useStoredMotionPreference();
  // G06: real push permission state, shown honestly in the notifications
  // panel below instead of the previous static "in-app notifications
  // only, for now" copy (which was simply false -- real browser push
  // already existed via PushRegistrar, it just had no user-facing
  // control and auto-prompted for permission on every sign-in instead).
  const [pushPermission, setPushPermission] = useState<PushPermissionState>(() => getPushPermissionState());
  const [pushEnabling, setPushEnabling] = useState(false);
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
    name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();
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
  const isSyntheticAuthEmail = rawEmail.endsWith("@katalist.local") || rawEmail.endsWith(".invalid");
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
    ...(profile?.occupation ? [{ icon: Briefcase, label: "Occupation", value: profile.occupation }] : []),
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
        toast.error("Notifications were blocked. You can allow them again in your browser's site settings.");
      } else if (result.reason === "unsupported") {
        toast.error("This browser doesn't support push notifications.");
      } else {
        toast.error("Couldn't enable notifications right now.");
      }
    } finally {
      setPushEnabling(false);
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
          if (isEpochCurrent(qc, epoch)) toast.error(err instanceof Error ? err.message : "Couldn’t save cover.");
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
          if (isEpochCurrent(qc, epoch)) toast.error(err instanceof Error ? err.message : "Couldn’t save.");
        },
      },
    );
  };

  const statCards = [
    {
      icon: Crown,
      tint: "bg-[#f0ebfd] text-[#975ee2]",
      value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : String(stats.sorted),
      label: "Things sorted",
      hint: "Every sort counts, even on the same Thing twice",
    },
    {
      icon: BarChart3,
      tint: "bg-[#e6fcf0] text-[#12a15f]",
      value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : String(stats.caught),
      label: "Things caught",
      hint: "Every catch counts, even on the same Thing twice",
    },
    {
      icon: Flame,
      tint: "bg-[#fef0e4] text-[#fd983f]",
      value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : stats.streak,
      label: "Day streak",
      hint: "Consecutive days with at least one Thing sorted",
    },
    {
      icon: Calendar,
      tint: "bg-[#eef1ff] text-[#2874f4]",
      value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : String(stats.weekly),
      label: "Last 7 days",
      hint: "Rolling 7-day window, not a calendar week",
    },
  ] as const;

  const avatarNode = <PersonAvatar name={name} initials={initials} src={avatarUrl} size={92} />;

  return (
    <AppShell noPadding>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-3 md:px-8 lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden">
        <div className="flex h-full flex-col gap-3">
          {/* Cover banner: illustrated Katalist cover + overlaid identity */}
          <div
            className="relative shrink-0 overflow-hidden rounded-2xl"
            style={{ height: "clamp(138px, 18vh, 184px)", boxShadow: CARD_SHADOW }}
          >
            {coverIsPhoto ? (
              <img src={coverImage} alt="" className="absolute inset-0 h-full w-full object-cover object-right" />
            ) : (
              <div className={cn("absolute inset-0", coverClass)} />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-white/85 via-white/45 to-transparent" />

            {!demoSession ? (
              <Popover open={coverOpen} onOpenChange={setCoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-[#975ee2] px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#8a4fdc]"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    Change cover
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 rounded-2xl border border-border/80 bg-white p-3">
                  <p className="mb-2 text-[12px] font-semibold text-[#000533]">Choose a wallpaper</p>
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
                      <img src={coverImage} alt="" className="h-full w-full object-cover object-right" />
                      {coverIsPhoto ? <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" /> : null}
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
                          {active ? <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}

            {/* Identity block, overlaid bottom-left */}
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-5">
              {demoSession ? (
                <span className="inline-block rounded-full ring-4 ring-white">{avatarNode}</span>
              ) : (
                <div className="relative inline-block rounded-full ring-4 ring-white">
                  <label className="group/av relative inline-block cursor-pointer rounded-full" title="Change photo">
                    {avatarNode}
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-white opacity-0 transition-opacity group-hover/av:bg-black/35 group-hover/av:opacity-100">
                      <Camera className="h-5 w-5" />
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => onAvatarFile(e.target.files?.[0])}
                    />
                  </label>
                  {avatarAttempt?.status === "uploading" ? (
                    <span
                      role="status"
                      aria-label="Uploading photo"
                      className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white"
                    >
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </span>
                  ) : avatarAttempt?.status === "failed" ? (
                    <button
                      type="button"
                      onClick={retryAvatarUpload}
                      title="Upload failed — click to retry"
                      className="absolute -bottom-1 -right-1 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span className="sr-only">Upload failed — retry</span>
                    </button>
                  ) : null}
                </div>
              )}

              <div className="min-w-0 pb-1">
                <h1 className="truncate text-[clamp(20px,2.4vw,30px)] font-semibold leading-tight text-black">{name}</h1>
                <p className="mt-0.5 truncate text-[15px] font-medium text-[#4a5578]">{role}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium text-[#4a5578]">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ede9ff]/90 px-2.5 py-1 capitalize text-[#7a45cf]">
                    {context === "home" ? <Home className="h-3.5 w-3.5" /> : <Briefcase className="h-3.5 w-3.5" />}
                    {context} Mode
                  </span>
                  {timezone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {timezone}
                    </span>
                  ) : null}
                  {memberSince ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      Since {memberSince}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Trophy stats */}
          {trophyReadState === "error" || trophyReadState === "stale" ? (
            <div role="alert" className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-950">
              <span>{trophyReadState === "stale" ? "Trophy stats may be out of date." : "Trophy stats are unavailable. Your activity has not been erased."}</span>
              <button type="button" onClick={retryTrophy} className="shrink-0 font-semibold underline">Retry</button>
            </div>
          ) : null}
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
            {statCards.map((s) => (
              <div key={s.label} className="flex items-center gap-3 rounded-[14px] bg-white p-3.5" style={{ boxShadow: CARD_SHADOW }}>
                <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", s.tint)}>
                  <s.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-[22px] font-semibold leading-none text-black">{s.value}</div>
                  <div className="mt-1 text-[12px] font-medium text-[#1b2955]">{s.label}</div>
                  <div className="mt-0.5 hidden text-[10px] leading-tight text-[#9aa3bd] xl:block">{s.hint}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Two columns fill remaining height */}
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.32fr_1fr]">
            {/* Left: About with tabs */}
            <section className="flex min-h-0 flex-col rounded-[14px] bg-white" style={{ boxShadow: CARD_SHADOW }}>
              <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-[#eef0f6] px-5 pt-3">
                  <TabsList className="h-auto gap-1 bg-transparent p-0">
                    {[
                      { v: "overview", label: "Overview" },
                      { v: "goals", label: "Goals" },
                      { v: "activity", label: "Activity" },
                    ].map((t) => (
                      <TabsTrigger
                        key={t.v}
                        value={t.v}
                        className="rounded-none border-b-2 border-transparent bg-transparent px-3 pb-2.5 text-[13px] font-medium text-[#565f8c] shadow-none data-[state=active]:border-[#5a19ed] data-[state=active]:bg-transparent data-[state=active]:text-[#5a19ed] data-[state=active]:shadow-none"
                      >
                        {t.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                <TabsContent value="overview" className="mt-0 flex min-h-0 flex-1 flex-col px-5 pb-4 pt-3">
                  <div className="flex shrink-0 items-center justify-between">
                    <h2 className="text-[17px] font-semibold text-[#000110]">About</h2>
                    {!demoSession ? (
                      <button
                        type="button"
                        onClick={openEdit}
                        className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#f4eefd] px-3 py-2 text-[12px] font-medium text-[#5e07f4] hover:bg-[#ecdffb]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit Profile
                      </button>
                    ) : null}
                  </div>
                  {aboutRows.length === 0 ? (
                    <p className="py-4 text-[13px] text-[#6a769c]">No contact details on your profile yet.</p>
                  ) : (
                    <div className="mt-1 min-h-0 flex-1 divide-y divide-[#eef0f6] overflow-y-auto">
                      {aboutRows.map((r) => (
                        <div key={r.label} className="flex items-center gap-3 py-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                            <r.icon className="h-4 w-4" />
                          </span>
                          <span className="w-28 shrink-0 text-[13px] text-[#565f8c]">{r.label}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#2d355b]">{r.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="goals" className="mt-0 flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-6 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f0ebfd] text-[#975ee2]">
                    <Target className="h-6 w-6" />
                  </span>
                  <p className="mt-3 text-[14px] font-medium text-[#2d355b]">No goals yet</p>
                  <p className="mt-1 max-w-xs text-[12px] text-[#6a769c]">
                    Set weekly targets for sorting and catching Things to keep momentum. Goals are coming soon.
                  </p>
                </TabsContent>

                <TabsContent value="activity" className="mt-0 flex min-h-0 flex-1 flex-col px-5 pb-4 pt-3">
                  {stats.achievement ? (
                    <div className="flex items-center gap-2 rounded-[12px] bg-[#f7f4ff] px-4 py-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0ebfd] text-[#975ee2]">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <span className="text-[12px] text-[#6a769c]">Recent achievement</span>
                      <span className="text-[13px] font-semibold text-black">{stats.achievement}</span>
                    </div>
                  ) : null}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {statCards.map((s) => (
                      <div key={s.label} className="rounded-[12px] border border-[#eef0f6] px-4 py-3">
                        <div className="text-[18px] font-semibold leading-none text-black">{s.value}</div>
                        <div className="mt-1 text-[12px] text-[#6a769c]">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {!stats.achievement ? (
                    <p className="mt-3 text-[12px] text-[#6a769c]">Keep sorting and catching Things to unlock achievements.</p>
                  ) : null}
                </TabsContent>
              </Tabs>
            </section>

            {/* Right: Settings & Preferences */}
            <section className="flex min-h-0 flex-col rounded-[14px] bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
              <h2 className="shrink-0 text-[17px] font-semibold text-[#000110]">Settings &amp; Preferences</h2>
              <div className="mt-2 min-h-0 flex-1 divide-y divide-[#eef0f6] overflow-y-auto">
                {settingsRows.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPanel(s.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]", s.tint)}>
                      <s.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-[#1b2955]">{s.title}</span>
                      <span className="block text-[12px] text-[#5f689e]">{s.body}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-[#9aa3bd]" />
                  </button>
                ))}
              </div>
              <div className="mt-3 flex shrink-0 flex-wrap gap-2 border-t border-[#eef0f6] pt-3">
                <button
                  type="button"
                  onClick={() => setPanel("shredded")}
                  className="rounded-lg border border-[#e4e6ef] bg-[#f7f7fa] px-3 py-2 text-[12px] text-[#1d1d1d] hover:bg-muted"
                >
                  Recently Shredded{trophyReadState === "ready" || trophyReadState === "stale" ? stats.shredded.length ? ` (${stats.shredded.length})` : "" : ""}
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#fccad5] bg-[#fef9fa] px-3 py-2 text-[12px] text-[#ff1c3f] hover:bg-[#fdeef1]"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </section>
          </div>
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
            <label className="group/av relative inline-block cursor-pointer rounded-full" title="Change photo">
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
            <span className="text-[12px] text-muted-foreground">Tap the photo to upload a new one.</span>
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
                editNameError ? "border-destructive focus:border-destructive" : "border-border focus:border-primary",
              )}
            />
            {editNameError ? <p className="mt-1 text-[12px] font-normal text-destructive">{editNameError}</p> : null}
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
        <DialogContent className={cn("rounded-2xl bg-white p-5", panel === "devices" ? "sm:max-w-lg" : "sm:max-w-md")}>
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
                  <p className="mt-4 text-[13px] text-muted-foreground">{trophyReadState === "loading" ? "Loading Shred history…" : "Shred history unavailable. Retry from the Trophy section."}</p>
                ) : stats.shredded.length === 0 ? (
                  <p className="mt-4 text-[13px] text-muted-foreground">Nothing shredded yet.</p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {stats.shredded.map((s) => (
                      <li key={`${s.kind}:${s.id}`} className="flex items-center justify-between text-[12px]">
                        <span>{s.title}</span>
                        <button
                          type="button"
                          className="text-primary"
                          onClick={() =>
                            void Promise.resolve(restore(s.id, s.kind)).catch((err) =>
                              toast.error(err instanceof Error ? err.message : "Couldn’t restore that."),
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
                {panel === "devices" ? (
                  <LoggedInDevices />
                ) : panel === "appearance" ? (
                  <label className="mt-4 flex items-center justify-between text-[13px]">
                    Reduced motion
                    <input
                      type="checkbox"
                      checked={reduced}
                      onChange={(e) => setReduced(e.target.checked)}
                    />
                  </label>
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
                        localStorage.setItem("katalist.doorman_enabled", e.target.checked ? "1" : "0");
                        void qc.invalidateQueries({ queryKey: ["doorman"] });
                      }}
                    />
                  </label>
                ) : panel === "notifications" ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-[13px] text-muted-foreground">
                      You're notified in-app when a Thing is assigned to you, caught, reassigned, nudged, commented
                      on, sorted, or cancelled.
                    </p>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3">
                      <div>
                        <p className="text-[13px] font-medium text-foreground">Push notifications</p>
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
                      ) : null}
                    </div>
                  </div>
                ) : panel === "integrations" ? (
                  <p className="mt-4 text-[13px] text-muted-foreground">
                    No integrations are available yet. Connections to your favourite tools will appear here as they
                    become available.
                  </p>
                ) : (
                  <p className="mt-4 text-[13px] text-muted-foreground">
                    Your name, email, and avatar are visible to other Katalist accounts. Your phone number is never
                    shown to anyone else. Private Buckets are visible only to you.
                  </p>
                )}
              </>
            )}
            <button type="button" className="mt-5 text-[13px] text-primary" onClick={() => setPanel(null)}>
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
