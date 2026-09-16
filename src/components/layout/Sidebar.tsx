import { useState, useRef, useCallback } from "react";
import {
  Bell,
  FolderPlus,
  LayoutGrid,
  List,
  UserRound,
  Users,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAppContext } from "@/features/context/use-app-context";
import { SpringLoadedBucketFlyout } from "@/features/buckets/SpringLoadedBucketFlyout";

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
      <SpringLoadedBucketFlyout
        isOpen={isBucketFlyoutOpen}
        onClose={() => setIsBucketFlyoutOpen(false)}
      />

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
