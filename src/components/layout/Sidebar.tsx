import { useState } from "react";
import {
  Briefcase,
  Home,
  LayoutDashboard,
  ListChecks,
  Mailbox,
  PersonStanding,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { Logo } from "@/components/katalist/Logo";

const navItems = [
  { title: "Court", to: "/", icon: LayoutDashboard },
  { title: "Lists", to: "/lists", icon: ListChecks },
  { title: "Buckets", to: "/buckets", icon: Mailbox },
  { title: "Nudges", to: "/nudges", icon: Users },
  { title: "Me", to: "/me", icon: PersonStanding },
] as const;

type ContextMode = "work" | "home";

export function AppSidebar() {
  const currentPath = useRouterState({
    select: (router) => router.location.pathname,
  });

  const [context, setContext] = useState<ContextMode>("work");

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Logo />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = currentPath === item.to;
          return (
            <Link
              key={item.title}
              to={item.to}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground relative"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
              )}
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>

      {/* Work / Home switcher */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
          <button
            type="button"
            onClick={() => setContext("work")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              context === "work"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Briefcase className="h-4 w-4" />
            Work
          </button>
          <button
            type="button"
            onClick={() => setContext("home")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              context === "home"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Home className="h-4 w-4" />
            Home
          </button>
        </div>
      </div>
    </aside>
  );
}
