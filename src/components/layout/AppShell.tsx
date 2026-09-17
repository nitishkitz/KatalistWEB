import type { ReactNode } from "react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import { PageHeader } from "./PageHeader";
import { useSession } from "@/hooks/useSession";
import katalistMark from "@/assets/katalist-mark.png.asset.json";
import { GhostCard } from "@/features/doorman/GhostCard";
import { useRealtimeInvalidation } from "@/features/realtime/use-realtime";
import { usePresence } from "@/features/people/presence";

interface AppShellProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  noPadding?: boolean;
  /** Hide the global top navigation bar (e.g. focused full-screen workspaces). */
  hideTopNav?: boolean;
}

export function AppShell({ title, subtitle, actions, children, noPadding, hideTopNav }: AppShellProps) {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  useRealtimeInvalidation();
  // Track this client as online app-wide so the Team screen's presence is real.
  usePresence();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, session, navigate]);

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
      <AppSidebar />{/* mobile bottom tab bar only */}
      <main className="flex-1 min-w-0 pb-16 md:pb-0">
        {noPadding ? children : (
          <div className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-4 pb-10 pt-4 md:px-8 md:pt-6">
            {title && <PageHeader title={title} subtitle={subtitle} actions={actions} />}
            {children}
          </div>
        )}
      </main>
      <GhostCard />
    </div>
  );
}
