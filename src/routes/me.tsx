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
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useSession } from "@/hooks/useSession";
import { useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/features/context/use-app-context";
import { useProfile, useUploadAvatar } from "@/features/me/use-profile";
import { useTrophy } from "@/features/me/use-trophy";
import { useAvatarUrl } from "@/features/people/directory";
import { isDoormanEnabled } from "@/features/doorman/use-doorman";
import { cn } from "@/lib/utils";

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
  const { data: profile } = useProfile();
  const uploadAvatar = useUploadAvatar();
  const { stats, restore } = useTrophy();
  const { context } = useAppContext();

  const [panel, setPanel] = useState<string | null>(null);
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined" ? false : localStorage.getItem("katalist.reduced_motion") === "1",
  );
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
  const email = profile?.email || user?.email || "";
  const phone = profile?.phone_e164 || user?.phone || "";
  const timezone = profile?.timezone || "";
  const createdAt = profile?.created_at || user?.created_at || "";
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "";
  const demoSession = user?.app_metadata?.provider === "demo";

  const headerStats: { icon: typeof Flame; tint: string; value: string; label: string }[] = [
    { icon: Flame, tint: "bg-[#fef0e4] text-[#fd983f]", value: stats.streak, label: "Day streak" },
    { icon: Crown, tint: "bg-[#f0ebfd] text-[#975ee2]", value: String(stats.sorted), label: "Things sorted" },
    { icon: BarChart3, tint: "bg-[#e6fcf0] text-[#12a15f]", value: String(stats.caught), label: "Caught" },
  ];

  const trophyTiles: { label: string; value: string }[] = [
    { label: "Things sorted", value: String(stats.sorted) },
    { label: "Things caught", value: String(stats.caught) },
    { label: "Current streak", value: stats.streak },
    { label: "This week", value: String(stats.weekly) },
    { label: "Recent achievement", value: stats.achievement },
  ];

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

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Header band: identity + trophy summary */}
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            {demoSession ? (
              <PersonAvatar name={name} initials={initials} src={avatarUrl} size={92} />
            ) : (
              <label className="cursor-pointer" title="Change photo">
                <PersonAvatar name={name} initials={initials} src={avatarUrl} size={92} />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    uploadAvatar.mutate(file, {
                      onSuccess: () => toast.success("Photo updated."),
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : "Couldn’t save photo."),
                    });
                  }}
                />
              </label>
            )}
            <div className="min-w-0">
              <h1 className="text-[26px] font-medium leading-tight text-black">{name}</h1>
              <p className="mt-0.5 text-[16px] text-[#6a769c]">{role}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-[#ede9ff] px-2.5 py-1 text-[11px] font-medium text-[#975ee2] capitalize">
                  {context === "home" ? <Home className="h-3.5 w-3.5" /> : <Briefcase className="h-3.5 w-3.5" />}
                  {context} mode
                </span>
                {email ? (
                  <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-[#f2f2fd] px-2.5 py-1 text-[11px] font-medium text-black/40">
                    <Mail className="h-3.5 w-3.5" />
                    {email}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* 3-stat trophy summary */}
          <div className="flex items-center gap-2 rounded-[10px] bg-white px-4 py-3" style={{ boxShadow: CARD_SHADOW }}>
            {headerStats.map((s, i) => (
              <div key={s.label} className="flex items-center gap-3">
                {i > 0 ? <span className="mx-1 h-10 w-px bg-[#eef0f6]" /> : null}
                <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", s.tint)}>
                  <s.icon className="h-5 w-5" />
                </span>
                <div className="pr-1">
                  <div className="text-[22px] font-semibold leading-none text-black">{s.value}</div>
                  <div className="mt-1 text-[13px] text-[#6a769c]">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Body: main + sidebar */}
        <div className="grid gap-5 lg:grid-cols-[1fr_372px]">
          <div className="space-y-5">
            {/* Trophy */}
            <section className="rounded-[6px] bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[16px] font-semibold text-black">Trophy</h2>
                <span className="text-[12px] text-[#6a769c]">Personal movement only</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {trophyTiles.map((t) => (
                  <div key={t.label} className="rounded-[8px] border border-[#eef0f6] bg-[#fbfbfe] px-3 py-3">
                    <p className="text-[11px] text-[#6a769c]">{t.label}</p>
                    <p className="mt-1 text-[18px] font-semibold text-black">{t.value}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* About / contact */}
            <section className="rounded-[6px] bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
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
          </div>

          {/* Right sidebar */}
          <div className="space-y-5">
            {/* Settings & Preferences */}
            <section className="rounded-[6px] bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
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
                      <span className="block text-[11px] text-[#6a769c]">{s.body}</span>
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
                  Recently Shredded{stats.shredded.length ? ` (${stats.shredded.length})` : ""}
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
      </div>

      {panel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => setPanel(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
            {panel === "shredded" ? (
              <>
                <h2 className="text-[15px] font-semibold">Recently Shredded</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">Restore something you shredded from your surfaces.</p>
                {stats.shredded.length === 0 ? (
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
                      onChange={(e) => {
                        setReduced(e.target.checked);
                        localStorage.setItem("katalist.reduced_motion", e.target.checked ? "1" : "0");
                        document.documentElement.classList.toggle("reduce-motion", e.target.checked);
                      }}
                    />
                  </label>
                ) : panel === "preferences" ? (
                  <label className="mt-4 flex items-center justify-between gap-3 text-[13px]">
                    <span>
                      Doorman breakthroughs
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
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
                  <p className="mt-4 text-[13px] text-muted-foreground">
                    In-app notifications only, for now — you're notified when a Thing is assigned to you, caught,
                    reassigned, nudged, commented on, sorted, or cancelled.
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
        </div>
      ) : null}
    </AppShell>
  );
}
