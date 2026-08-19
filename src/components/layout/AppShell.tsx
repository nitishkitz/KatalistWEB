import { ReactNode, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

import { AppSidebar } from "./Sidebar";
import { PageHeader } from "./PageHeader";
import { useSession } from "@/hooks/useSession";
import katalistMark from "@/assets/katalist-mark.png.asset.json";

interface AppShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AppShell({ title, subtitle, children }: AppShellProps) {
  const { session, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/welcome", replace: true });
    }
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <img
          src={katalistMark.url}
          alt=""
          className="h-16 w-16 animate-pulse opacity-60"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex flex-1 flex-col pl-64">
        <PageHeader title={title} subtitle={subtitle} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
