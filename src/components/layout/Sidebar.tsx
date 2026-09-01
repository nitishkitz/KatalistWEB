import {
  Bell,
  Briefcase,
  ChevronDown,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
  UserRound,
  Users,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/katalist/Logo";
import { useAppContext } from "@/features/context/use-app-context";

const navItems = [
  { title: "Court", to: "/", icon: LayoutGrid },
  { title: "Lists", to: "/lists", icon: List },
  { title: "Buckets", to: "/buckets", icon: FolderPlus },
  { title: "Team", to: "/team", icon: Users },
  { title: "Nudges", to: "/nudges", icon: Bell, badge: 11 },
  { title: "Me", to: "/me", icon: UserRound },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { context, setContext } = useAppContext();

  return (
    <>
      {/* Desktop — locked 220px chrome */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center px-5">
          <Logo />
        </div>

        <nav className="mt-1 flex-1 space-y-0.5 px-3">
          {navItems.map((item) => {
            const isActive =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.title}
                to={item.to}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors duration-200",
                  isActive
                    ? "bg-sidebar-accent text-foreground"
                    : "text-sidebar-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                )}
                <item.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
                <span>{item.title}</span>
                {"badge" in item && item.badge ? (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-purple-100 px-1.5 text-[10.5px] font-bold text-purple-700">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 pb-4">
          <button
            type="button"
            onClick={() => void setContext(context === "work" ? "home" : "work")}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
            aria-label="Switch Work or Home context"
          >
            {context === "work" ? (
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Home className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="flex-1 text-left capitalize">
              {context === "work" ? "Work" : "Home"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </aside>

      {/* Mobile — bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-border bg-card px-1 md:hidden">
        {navItems.map((item) => {
          const isActive =
            item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          return (
            <Link
              key={item.title}
              to={item.to}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
