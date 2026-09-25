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
import { useTrophy } from "@/features/me/use-trophy";
import { useAvatarUrl } from "@/features/people/directory";
import { isDoormanEnabled } from "@/features/doorman/use-doorman";
import { cn } from "@/lib/utils";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useStoredMotionPreference } from "@/hooks/use-motion-preference";
import { getPushPermissionState, registerPushForUser, type PushPermissionState } from "@/features/push/push-registration";

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

/** Selectable profile cover wallpapers (gradient presets). */
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
const DEFAULT_COVER = COVER_THEMES[0]!.className;

const settingsRows = [
  { id: "preferences", title: "Work / Home Context", body: "Doorman breakthroughs", icon: Sparkles },
  { id: "notifications", title: "Notifications", body: "What you're notified about", icon: Bell },
  { id: "appearance", title: "Appearance", body: "Theme, reduced motion", icon: Palette },
  { id: "privacy", title: "Privacy", body: "Who can see what", icon: Shield },
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
  const isSyntheticAuthEmail = rawEmail.endsWith("@katalist.local");
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

  const avatarNode = (
    <PersonAvatar name={name} initials={initials} src={avatarUrl} size={104} />
  );

  const coverClass = COVER_THEMES.find((c) => c.key === profile?.cover_theme)?.className ?? DEFAULT_COVER;

  const onAvatarFile = (file?: File | null) => {
    if (!file) return;
    const epoch = getIdentityEpoch(qc).epoch;
    uploadAvatar.mutate(file, {
      onSuccess: () => { if (isEpochCurrent(qc, epoch)) toast.success("Photo updated."); },
      onError: (err) => {
        if (isEpochCurrent(qc, epoch)) toast.error(err instanceof Error ? err.message : "Couldn’t save photo.");
      },
    });
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
    setEditOpen(true);
  };
  const saveEdit = () => {
    const dn = editName.trim();
    if (!dn) {
      toast.error("Name can’t be empty.");
      return;
    }
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
          if (isEpochCurrent(qc, epoch)) toast.error(err instanceof Error ? err.message : "Couldn’t save.");
        },
      },
    );
  };

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Hero: chosen wallpaper cover + overlapping avatar */}
        <div className="overflow-hidden rounded-[16px] bg-white" style={{ boxShadow: CARD_SHADOW }}>
          <div className={cn("relative h-32", coverClass)}>
            {!demoSession ? (
              <Popover open={coverOpen} onOpenChange={setCoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-[12px] font-medium text-white backdrop-blur-sm hover:bg-black/35"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    Change cover
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 rounded-2xl border border-border/80 bg-white p-3">
                  <p className="mb-2 text-[12px] font-semibold text-[#000533]">Choose a wallpaper</p>
                  <div className="grid grid-cols-4 gap-2">
                    {COVER_THEMES.map((c) => {
                      const active = (profile?.cover_theme ?? "violet") === c.key;
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
            ) : null}
          </div>
          <div className="px-6 pb-5">
            <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-end gap-4">
                {demoSession ? (
                  <span className="inline-block rounded-full ring-4 ring-white">{avatarNode}</span>
                ) : (
                  <label
                    className="group/av relative inline-block cursor-pointer rounded-full ring-4 ring-white"
                    title="Change photo"
                  >
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
                )}
                <div className="min-w-0 pb-1">
                  <h1 className="text-[26px] font-semibold leading-tight text-black">{name}</h1>
                  <p className="mt-0.5 text-[15px] text-[#6a769c]">{role}</p>
                </div>
              </div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ede9ff] px-3 py-1.5 text-[12px] font-medium capitalize text-[#975ee2]">
                  {context === "home" ? <Home className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
                  {context} Mode
                </span>
                {!demoSession ? (
                  <button
                    type="button"
                    onClick={openEdit}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#ebecf7] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3d3f74] hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit profile
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Trophy stat strip */}
        {trophyReadState === "error" || trophyReadState === "stale" ? (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-950">
            <span>{trophyReadState === "stale" ? "Trophy stats may be out of date." : "Trophy stats are unavailable. Your activity has not been erased."}</span>
            <button type="button" onClick={retryTrophy} className="shrink-0 font-semibold underline">Retry</button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { icon: Crown, tint: "bg-[#f0ebfd] text-[#975ee2]", value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : String(stats.sorted), label: "Things sorted" },
              { icon: BarChart3, tint: "bg-[#e6fcf0] text-[#12a15f]", value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : String(stats.caught), label: "Things caught" },
              { icon: Flame, tint: "bg-[#fef0e4] text-[#fd983f]", value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : stats.streak, label: "Current streak" },
              {
                // G06: stats.weekly is a rolling 7-day window (now - 7
                // days), not a calendar week -- "This week" implied a
                // reset every Sunday/Monday that never actually happens.
                icon: Calendar,
                tint: "bg-[#eef1ff] text-[#2874f4]",
                value: trophyReadState === "error" || trophyReadState === "loading" ? "—" : String(stats.weekly),
                label: "Last 7 days",
              },
            ] as const
          ).map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-3 rounded-[14px] bg-white p-4"
              style={{ boxShadow: CARD_SHADOW }}
            >
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", s.tint)}>
                <s.icon className="h-5 w-5" />
              </span>
              <div>
                <div className="text-[22px] font-semibold leading-none text-black">{s.value}</div>
                <div className="mt-1 text-[12px] text-[#6a769c]">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {stats.achievement ? (
          <div
            className="flex items-center gap-2 rounded-[12px] bg-white px-5 py-3"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0ebfd] text-[#975ee2]">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-[12px] text-[#6a769c]">Recent achievement</span>
            <span className="text-[13px] font-semibold text-black">{stats.achievement}</span>
          </div>
        ) : null}

        {/* Two columns: About + Settings */}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* About / contact */}
          <section className="rounded-[14px] bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
            <h2 className="mb-2 text-[16px] font-semibold text-black">About</h2>
            {aboutRows.length === 0 ? (
              <p className="py-4 text-[13px] text-[#6a769c]">No contact details on your profile yet.</p>
            ) : (
              <div className="divide-y divide-[#eef0f6]">
                {aboutRows.map((r) => (
                  <div key={r.label} className="flex items-center gap-3 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                      <r.icon className="h-4 w-4" />
                    </span>
                    <span className="w-28 shrink-0 text-[12px] text-[#6a769c]">{r.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-black">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Settings & Preferences */}
          <section className="rounded-[14px] bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
            <h2 className="mb-2 text-[16px] font-semibold text-black">Settings &amp; Preferences</h2>
            <div className="divide-y divide-[#eef0f6]">
              {settingsRows.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPanel(s.id)}
                  className="flex w-full items-center gap-3 py-3 text-left"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-black">{s.title}</span>
                    <span className="block text-[12px] text-[#6a769c]">{s.body}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#6a769c]" />
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-[#eef0f6] pt-3">
              <button
                type="button"
                onClick={() => setPanel("shredded")}
                className="rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:bg-muted"
              >
                Recently Shredded{trophyReadState === "ready" || trophyReadState === "stale" ? stats.shredded.length ? ` (${stats.shredded.length})` : "" : ""}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
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
              onChange={(e) => setEditName(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-border px-3 text-[13px] font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring"
            />
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

      {panel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => setPanel(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
            {panel === "shredded" ? (
              <>
                <h2 className="text-[15px] font-semibold">Recently Shredded</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">Restore something you shredded from your surfaces.</p>
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
                <h2 className="text-[15px] font-semibold">{settingsRows.find((s) => s.id === panel)?.title}</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">{settingsRows.find((s) => s.id === panel)?.body}</p>
                {panel === "appearance" ? (
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
        </div>
      ) : null}
    </AppShell>
  );
}
