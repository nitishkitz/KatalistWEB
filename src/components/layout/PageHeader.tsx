import { Bell, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  const { user } = useSession();

  const name =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "Rahul Mehta";

  const initials =
    user?.user_metadata?.initials ||
    name
      .split(" ")
      .map((n: string) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

  return (
    <header className={cn("flex items-start justify-between gap-4 pb-4", className)}>
      <div>
        <h1 className="katalist-page-title">{title}</h1>
        {subtitle ? <p className="mt-0.5 katalist-page-subtitle">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-2 pt-1">
        {actions}
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
        </button>
        <Link to="/me" className="flex items-center gap-1 rounded-full pl-0.5 pr-1 hover:bg-muted">
          <span className="relative">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-semibold text-white">
              {initials}
            </span>
            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="sr-only">{name}</span>
        </Link>
      </div>
    </header>
  );
}
