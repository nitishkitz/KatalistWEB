import type { ReactNode } from "react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import { PageHeader } from "./PageHeader";
import { useSession } from "@/hooks/useSession";
import katalistMark from "@/assets/katalist-mark.png.asset.json";
import { GhostCard } from "@/features/doorman/GhostCard";
import { MeetingReminderCard } from "@/features/lists/MeetingReminderCard";
import { ChatHeadsDock } from "@/features/hub/ChatHeadsDock";
import { usePresence } from "@/features/people/presence";
import { requestMagicBoxFocus, tryHandleMagicBoxCapture } from "@/features/court/magic-box-entry";

interface AppShellProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  noPadding?: boolean;
  /** Hide the global top navigation bar (e.g. focused full-screen workspaces). */
  hideTopNav?: boolean;
  /** Hide the mobile bottom navigation for focused detail screens. */
  hideBottomNav?: boolean;
}

export function AppShell({ title, subtitle, actions, children, noPadding, hideTopNav, hideBottomNav }: AppShellProps) {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  // Global database-change invalidation moved to RealtimeInvalidationProvider
  // (P7), mounted once at the root instead of once per AppShell instance --
  // route transitions (Court -> Lists -> Buckets -> Nudges, all AppShell-hosted)
  // no longer create/destroy a global owner on every navigation.
  // Track this client as online app-wide so the Team screen's presence is real.
  usePresence();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, session, navigate]);

  useEffect(() => {
    const focusMagicBox = async (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      // A screen with its own List-scoped composer (Code Activity) handles this in place; otherwise open Court.
      if (await tryHandleMagicBoxCapture()) return;
      await navigate({ to: "/" });
      requestMagicBoxFocus();
    };
    window.addEventListener("keydown", focusMagicBox);
    return () => window.removeEventListener("keydown", focusMagicBox);
  }, [navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <img src={katalistMark.url} alt="" className="h-14 w-14 animate-pulse opacity-60" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      {!hideTopNav && <TopNav />}
      <AppSidebar hideBottomNav={hideBottomNav} />{/* mobile bottom tab bar only */}
      <main className={`flex-1 min-w-0 ${hideBottomNav ? "" : "pb-16 md:pb-0"}`}>
        {noPadding ? children : (
          <div className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-4 pb-10 pt-4 md:px-8 md:pt-6">
            {title && <PageHeader title={title} subtitle={subtitle} actions={actions} />}
            {children}
          </div>
        )}
      </main>
      <GhostCard />
      <MeetingReminderCard />
      <ChatHeadsDock />
    </div>
  );
}
