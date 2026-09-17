import { Link, useRouterState } from "@tanstack/react-router";
import { Logo } from "@/components/katalist/Logo";
import { KatalistIcon } from "@/features/court/KatalistIcon";
import { useAppContext } from "@/features/context/use-app-context";
import { useSession } from "@/hooks/useSession";
import { useProfile } from "@/features/me/use-profile";
import { useAvatarUrl } from "@/features/people/directory";
import { NotificationBell } from "@/features/notifications/NotificationPanel";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";

export function TopNav() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { context, setContext } = useAppContext();
  const { user } = useSession();
  const { data: profile } = useProfile();

  const name =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "You";

  const initials =
    user?.user_metadata?.initials ||
    name
      .split(" ")
      .map((n: string) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  const avatarUrl = useAvatarUrl(name, user?.email, profile?.avatar_url);

  const navItems = [
    { title: "Court", to: "/" },
    { title: "Lists", to: "/lists" },
    { title: "Buckets", to: "/buckets" },
    { title: "Team", to: "/team" },
    { title: "Nudges", to: "/nudges" },
    { title: "Me", to: "/me" },
  ];

  return (
    <nav className="sticky top-0 z-40 hidden md:flex h-14 w-full items-center justify-between border-b border-[#f0f3fb] bg-[#f5f8fe] px-5">
      {/* Left */}
      <div className="flex items-center gap-5">
        <Logo markClassName="h-7 w-7" withText={true} textClassName="text-[19px]" />
      </div>

      {/* Center: nav links (absolutely centered in the bar) */}
      <div className="absolute left-1/2 top-0 flex h-14 -translate-x-1/2 items-center gap-1">
        {navItems.map((item) => {
          const isActive =
            item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          return (
            <Link
              key={item.title}
              to={item.to}
              className={cn(
                "relative flex items-center px-3 h-14 text-[15px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isActive
                  ? "text-[#503188] font-medium"
                  : "text-[#1d1d1d] hover:text-[#503188]"
              )}
            >
              {item.title}
              {isActive && (
                <span
                  className="absolute bottom-0 left-3 right-3 h-[3px] rounded-full"
                  style={{
                    background: "linear-gradient(90deg, #975ee2 0%, #503188 100%)",
                    boxShadow: "0 0 8px 1px rgba(151,94,226,0.55)",
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void setContext(context === "work" ? "home" : "work")}
          className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[#eaeffa] bg-white px-2.5 text-[13px] font-normal text-[#1d1d1d] transition-colors hover:bg-[#f5f8fe] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <KatalistIcon name="apps-grid" className="h-3.5 w-3.5 text-[#503188]" />
          <span className="capitalize">{context === "work" ? "Work" : "Home"}</span>
          <KatalistIcon name="chevron-down" className="h-3 w-3 text-[#5d6786]" />
        </button>

        <NotificationBell />

        <Link
          to="/me"
          className="flex items-center gap-1 rounded-full pl-0.5 pr-1 py-0.5 hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PersonAvatar name={name} initials={initials} src={avatarUrl} size={28} />
          <KatalistIcon name="chevron-down" className="h-3.5 w-3.5 text-[#5d6786]" />
        </Link>
      </div>
    </nav>
  );
}
