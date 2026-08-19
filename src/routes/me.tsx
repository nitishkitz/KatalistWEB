import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, Sparkles, User, Mail, Phone, Briefcase, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSession, DEMO_PERSONAS, signInAsDemo } from "@/hooks/useSession";
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

function MePage() {
  const { user, signOut, isDemo } = useSession();
  const navigate = useNavigate();

  const name =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "User";

  const role = user?.user_metadata?.role_label || "Member";
  const initials =
    user?.user_metadata?.initials ||
    name
      .split(" ")
      .map((n: string) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ||
    "U";

  async function handleSignOut() {
    await signOut();
    toast.success("Signed out successfully");
    navigate({ to: "/auth", replace: true });
  }

  return (
    <AppShell title="Me" subtitle="Profile and settings">
      <div className="space-y-6 max-w-2xl">
        {/* Profile Card */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 text-lg font-bold">
                <AvatarImage src={user?.user_metadata?.avatar_url || ""} />
                <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-foreground">{name}</h2>
                  {isDemo && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      <Sparkles className="h-3 w-3" /> Demo Persona
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <Briefcase className="h-3.5 w-3.5" />
                  {role}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 border-t border-border pt-4 text-sm">
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Phone className="h-4 w-4 text-primary" />
              <span>{user?.phone || user?.user_metadata?.phone || "No phone linked"}</span>
            </div>
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Mail className="h-4 w-4 text-primary" />
              <span>{user?.email || "No email linked"}</span>
            </div>
          </div>
        </div>

        {/* Persona Switcher Card */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Switch Demo Persona
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Switch between demo users instantly to test assignments and multi-user workflows.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DEMO_PERSONAS.map((p) => {
              const isCurrent = user?.email === p.email;
              return (
                <button
                  key={p.key}
                  onClick={() => {
                    signInAsDemo(p);
                    toast.success(`Switched to ${p.name}`);
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-xl border p-3 text-left transition-all",
                    isCurrent
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border bg-background hover:border-primary/40 hover:bg-accent/40",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                        p.color,
                      )}
                    >
                      {p.initials}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.role}</p>
                    </div>
                  </div>
                  {isCurrent && (
                    <span className="text-[11px] font-semibold text-primary">Active</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
