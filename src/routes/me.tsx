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
  Trophy,
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
import { PushNotificationControl } from "@/features/notifications/PushNotificationControl";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/me")({
  head: () => ({
    meta: [
      { title: "Me — Katalist" },
      { name: "description", content: "Profile, Trophy, preferences and settings." },
    ],
  }),
  component: MePage,
});

const settings = [
  {
    id: "preferences",
    title: "Preferences",
    body: "Doorman breakthrough, nudge style, default Catch action",
    icon: Sparkles,
  },
  {
    id: "notifications",
    title: "Notifications",
    body: "Nudge reminders, daily momentum, weekly recap",
    icon: Bell,
  },
  {
    id: "appearance",
    title: "Appearance",
    body: "Theme, reduced motion, language",
    icon: Palette,
  },
  {
    id: "privacy",
    title: "Privacy",
    body: "Share activity, data export, connected accounts",
    icon: Shield,
  },
  {
    id: "subscription",
    title: "Subscription",
    body: "Plan, renewal, entitlements",
    icon: Trophy,
  },
];

function MePage() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const uploadAvatar = useUploadAvatar();
  const { stats, restore } = useTrophy();
  const { context, setContext } = useAppContext();
  const [panel, setPanel] = useState<string | null>(null);
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined" ? false : localStorage.getItem("katalist.reduced_motion") === "1",
  );
  const sorted = stats.sorted;
  const caught = stats.caught;
  const waiting = stats.waiting;

  const name =
    profile?.display_name ||
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "You";

  const role = user?.user_metadata?.role_label || "Member";
  const initials =
    user?.user_metadata?.initials ||
    name
      .split(" ")
      .map((n: string) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

  const avatarUrl = useAvatarUrl(name, user?.email, profile?.avatar_url);
  const email = profile?.email || user?.email || "";
  const phone = profile?.phone_e164 || user?.phone || user?.user_metadata?.phone || "";
  const demoSession = user?.app_metadata?.provider === "demo";

  async function handleSignOut() {
    await signOut();
    qc.clear();
    toast.success("Signed out");
    await navigate({ to: "/auth", replace: true });
  }

  return (
    <AppShell title="Me" subtitle="Profile, Trophy, preferences and settings">
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          {/* Identity */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                {demoSession ? (
                  <PersonAvatar name={name} initials={initials} src={avatarUrl} size={64} />
                ) : (
                  <label className="cursor-pointer">
                    <PersonAvatar name={name} initials={initials} src={avatarUrl} size={64} />
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
                            toast.error(err instanceof Error ? err.message : "Couldn’t save photo to profile."),
                        });
                      }}
                    />
                  </label>
                )}
                <div>
                  <h2 className="text-xl font-bold text-foreground">{name}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">{role}</p>
                  <p className="mt-2 text-[13px] text-muted-foreground">{email}</p>
                  <p className="text-[13px] text-muted-foreground">{phone}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">Member since Aug 2026</p>
                </div>
              </div>

              <div className="rounded-xl border border-border p-1">
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => void setContext("work")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium",
                      context === "work" ? "bg-muted text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <Briefcase className="h-3.5 w-3.5" />
                    Work
                  </button>
                  <button
                    type="button"
                    onClick={() => void setContext("home")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium",
                      context === "home" ? "bg-muted text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <Home className="h-3.5 w-3.5" />
                    Home
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Trophy */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold text-foreground">Trophy</h3>
              <span className="text-[12px] text-muted-foreground">Personal movement only</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ["Things Sorted", String(sorted)],
                ["Things Caught", String(caught)],
                ["Catch Response Time", "—"],
                ["Current Streak", stats.streak],
                ["Weekly Movement", String(stats.weekly)],
                ["Recent Achievement", stats.achievement],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border/80 bg-background px-3 py-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Settings grid */}
          <section className="grid gap-3 sm:grid-cols-2">
            {settings.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setPanel(s.id)}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left hover:bg-muted/40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground">
                  <s.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{s.title}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">{s.body}</span>
                </span>
              </button>
            ))}
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground hover:bg-muted"
              onClick={() => setPanel("shredded")}
            >
              Recently Shredded{stats.shredded.length ? ` (${stats.shredded.length})` : ""}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>

        {/* Coey insight */}
        <aside className="h-fit rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <img src="/katalist-mark-app.png" alt="" className="h-5 w-5" />
            <h3 className="text-[13px] font-semibold text-foreground">Coey insight</h3>
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {waiting
              ? `${waiting} still waiting for Catch. A gentle nudge keeps it moving — no ranking, no guilt.`
              : caught
                ? "All clear on incoming work. Breathe easy."
                : "Toss something when you’re ready."}
          </p>
          {stats.shredded.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-border pt-3">
              {stats.shredded.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-[12px]">
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
          ) : null}
        </aside>
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
                <h2 className="text-[15px] font-semibold">{settings.find((s) => s.id === panel)?.title}</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">{settings.find((s) => s.id === panel)?.body}</p>
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
                ) : panel === "notifications" ? (
                  <PushNotificationControl />
                ) : (
                  <p className="mt-4 text-[13px] text-muted-foreground">
                    Stored on your profile when a live session is present. Demo uses this device only.
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
