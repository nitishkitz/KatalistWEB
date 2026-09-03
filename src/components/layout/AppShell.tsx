import type { ReactNode } from "react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar } from "./Sidebar";
import { PageHeader } from "./PageHeader";
import { useSession } from "@/hooks/useSession";
import katalistMark from "@/assets/katalist-mark.png.asset.json";
import { GhostCard } from "@/features/doorman/GhostCard";
import { useRealtimeInvalidation } from "@/features/realtime/use-realtime";

import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";
import { cn } from "@/lib/utils";

interface AppShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const { isCollapsed } = useSidebarCollapse();
  useRealtimeInvalidation();

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
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div
        className={cn(
          "flex min-h-screen flex-1 flex-col pb-16 md:pb-0 transition-[padding-left] duration-200 ease-in-out",
          isCollapsed ? "md:pl-[68px]" : "md:pl-[220px]",
        )}
      >
        <div className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-10 pt-4 md:px-8 md:pt-6">
          <PageHeader title={title} subtitle={subtitle} actions={actions} />
          {children}
        </div>
      </div>
      <GhostCard />
    </div>
  );
}
