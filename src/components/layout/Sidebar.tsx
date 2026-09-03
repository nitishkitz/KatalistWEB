import { useState, useRef, useCallback } from "react";
import {
  Bell,
  Briefcase,
  ChevronDown,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Users,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/katalist/Logo";
import { useAppContext } from "@/features/context/use-app-context";
import { SpringLoadedBucketFlyout } from "@/features/buckets/SpringLoadedBucketFlyout";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";

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
  const { isCollapsed, toggleCollapsed } = useSidebarCollapse();
  const [isBucketFlyoutOpen, setIsBucketFlyoutOpen] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBucketDragEnter = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/katalist-thing")) {
      e.preventDefault();
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = setTimeout(() => {
        setIsBucketFlyoutOpen(true);
      }, 150);
    }
  }, []);

  const handleBucketDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/katalist-thing")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleBucketDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    }
  }, []);

  return (
    <>
      {/* Desktop — collapsible sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar md:flex transition-[width] duration-200 ease-in-out",
          isCollapsed ? "w-[68px]" : "w-[220px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center",
            isCollapsed ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-1">
              <Logo withText={false} markClassName="h-7 w-7" />
              <button
                type="button"
                onClick={toggleCollapsed}
                className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <Logo />
              <button
                type="button"
                onClick={toggleCollapsed}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        <nav className={cn("mt-1 flex-1 space-y-1", isCollapsed ? "px-2" : "px-3")}>
          {navItems.map((item) => {
            const isActive =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const isBucketItem = item.to === "/buckets";
            return (
              <Link
                key={item.title}
                to={item.to}
                title={isCollapsed ? item.title : undefined}
                onDragEnter={isBucketItem ? handleBucketDragEnter : undefined}
                onDragOver={isBucketItem ? handleBucketDragOver : undefined}
                onDragLeave={isBucketItem ? handleBucketDragLeave : undefined}
                className={cn(
                  "relative flex items-center rounded-xl font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isCollapsed
                    ? "h-10 w-10 mx-auto justify-center"
                    : "gap-2.5 px-3 py-2 text-[13.5px]",
                  isActive
                    ? "bg-sidebar-accent text-foreground shadow-2xs"
                    : "text-sidebar-foreground/80 hover:bg-muted hover:text-foreground",
                  isBucketItem && isBucketFlyoutOpen && "ring-2 ring-primary/60 bg-primary/10 text-primary font-bold shadow-xs",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                )}
                <item.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
                {!isCollapsed && <span>{item.title}</span>}
                {"badge" in item && item.badge ? (
                  isCollapsed ? (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-purple-600 px-1 text-[9px] font-bold text-white shadow-xs">
                      {item.badge}
                    </span>
                  ) : (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-purple-100 px-1.5 text-[10.5px] font-bold text-purple-700">
                      {item.badge}
                    </span>
                  )
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className={cn("pb-4", isCollapsed ? "p-2" : "p-3")}>
          {isCollapsed ? (
            <button
              type="button"
              onClick={() => void setContext(context === "work" ? "home" : "work")}
              className="flex h-10 w-10 mx-auto items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted shadow-2xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={`Switch context (currently ${context === "work" ? "Work" : "Home"})`}
              aria-label="Switch Work or Home context"
            >
              {context === "work" ? (
                <Briefcase className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Home className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void setContext(context === "work" ? "home" : "work")}
              className="flex h-10 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          )}
        </div>

        <SpringLoadedBucketFlyout
          isOpen={isBucketFlyoutOpen}
          onClose={() => setIsBucketFlyoutOpen(false)}
        />
      </aside>

      {/* Mobile — bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-border bg-card px-1 md:hidden">
        {navItems.map((item) => {
          const isActive =
            item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          const isBucketItem = item.to === "/buckets";
          return (
            <Link
              key={item.title}
              to={item.to}
              onDragEnter={isBucketItem ? handleBucketDragEnter : undefined}
              onDragOver={isBucketItem ? handleBucketDragOver : undefined}
              onDragLeave={isBucketItem ? handleBucketDragLeave : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground",
                isBucketItem && isBucketFlyoutOpen && "text-primary font-bold animate-pulse",
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
