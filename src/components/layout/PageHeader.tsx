import { Bell, ChevronDown, LogOut, Sparkles, User, Users } from "lucide-react";
import { useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession, DEMO_PERSONAS, signInAsDemo } from "@/hooks/useSession";

interface PageHeaderProps {
  title: string;
  subtitle?: string | undefined;
  className?: string | undefined;
}

export function PageHeader({ title, subtitle, className }: PageHeaderProps) {
  const { user, signOut, isDemo } = useSession();
  const navigate = useNavigate();

  const name =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "User";

  const role = user?.user_metadata?.role_label || "Member";
  const initials =
    user?.user_metadata?.initials ||
    name
      .split(" ")
      .map((n: string) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ||
    "U";

  async function handleSignOut() {
    await signOut();
    toast.success("Signed out successfully");
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header
      className={cn(
        "flex h-16 items-center justify-between border-b border-border bg-background px-6",
        className,
      )}
    >
      <div className="flex flex-col justify-center">
        <h1 className="katalist-page-title">{title}</h1>
        {subtitle && <p className="katalist-page-subtitle">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
          <span className="sr-only">Notifications</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex h-10 items-center gap-2.5 rounded-full px-2.5 hover:bg-accent border border-border/40"
            >
              <span className="relative">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.user_metadata?.avatar_url || ""} alt={name} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
              </span>
              <div className="hidden text-left md:block">
                <p className="text-xs font-medium leading-none text-foreground">{name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{role}</p>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-semibold leading-none">{name}</p>
                <p className="text-xs text-muted-foreground leading-none">
                  {user?.phone || user?.email}
                </p>
                {isDemo && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-primary font-medium mt-1">
                    <Sparkles className="h-3 w-3" /> Demo Persona
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link to="/me" className="flex items-center gap-2 cursor-pointer">
                <User className="h-4 w-4" />
                <span>Profile & Settings</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
              Switch Demo Persona
            </DropdownMenuLabel>

            {DEMO_PERSONAS.map((p) => (
              <DropdownMenuItem
                key={p.key}
                onClick={() => {
                  signInAsDemo(p);
                  toast.success(`Switched to ${p.name}`);
                }}
                className="flex items-center justify-between text-xs cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">
                    {p.initials}
                  </span>
                  <span>{p.name}</span>
                </span>
                <span className="text-[10px] text-muted-foreground">{p.role.split(" ")[0]}</span>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-destructive focus:text-destructive flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
