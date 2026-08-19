import type { ReactNode } from "react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar } from "./Sidebar";
import { PageHeader } from "./PageHeader";
import { cn } from "@/lib/utils";
import { useAppContext } from "@/features/context/use-app-context";
import { useSession } from "@/hooks/useSession";
import katalistMark from "@/assets/katalist-mark.png.asset.json";
import { GhostCard } from "@/features/doorman/GhostCard";
import { useRealtimeInvalidation } from "@/features/realtime/use-realtime";

interface AppShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const { context } = useAppContext();
  const { session, loading } = useSession();
  const navigate = useNavigate();
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
    <div
      className={cn(
        "flex min-h-screen w-full transition-[background-color] duration-200",
        context === "home" ? "bg-[oklch(0.99_0.008_80)]" : "bg-background",
      )}
    >
      <AppSidebar />
      <div className="flex min-h-screen flex-1 flex-col pb-16 md:pb-0 md:pl-[220px]">
        <div className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-10 pt-4 md:px-8 md:pt-6">
          <PageHeader title={title} subtitle={subtitle} actions={actions} />
          {children}
        </div>
      </div>
      <GhostCard />
    </div>
  );
}
