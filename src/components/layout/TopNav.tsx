import { Link, useRouterState } from "@tanstack/react-router";
import { BriefcaseBusiness, House } from "lucide-react";
import { Logo } from "@/components/katalist/Logo";
import { KatalistIcon } from "@/features/court/KatalistIcon";
import { useAppContext } from "@/features/context/use-app-context";
import { useSession } from "@/hooks/useSession";
import { useProfile } from "@/features/me/use-profile";
import { useAvatarUrl } from "@/features/people/directory";
import { NotificationBell } from "@/features/notifications/NotificationPanel";
import { CatchUpNavCapsule } from "@/features/catchup/CatchUpNavCapsule";
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
    <nav className="sticky top-0 z-40 hidden h-14 w-full items-center justify-between overflow-visible border-b border-[#f0f3fb] bg-[#f5f8fe] px-3 md:flex lg:px-5">
      {/* Brand and primary navigation */}
      <div className="flex min-w-0 shrink-0 items-center">
        <Logo markClassName="h-7 w-7" withText={true} textClassName="text-[19px]" />
        <span aria-hidden="true" className="mx-3 h-6 w-px bg-[#dfe4ef] lg:mx-4" />
        <div className="flex min-w-0 items-center gap-0">
          {navItems.map((item) => {
            const isActive = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.title}
                to={item.to}
                className={cn(
                  "relative flex h-14 shrink-0 items-center whitespace-nowrap px-1.5 text-[12px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-2 lg:px-2.5 lg:text-[14px]",
                  isActive ? "text-[#503188] font-medium" : "text-[#1d1d1d] hover:text-[#503188]",
                )}
              >
                {item.title}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-2.5 right-2.5 h-[3px] rounded-full"
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
      </div>

      {/* Right */}
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 lg:gap-2.5">
        <div className="hidden xl:block">
          <CatchUpNavCapsule />
        </div>
        <div
          role="group"
          aria-label="Work and Home context"
          className="relative inline-flex h-9 w-[146px] shrink-0 items-center overflow-hidden rounded-full border border-[#e5e8f2] bg-[#eef1f8] p-0.5 shadow-sm lg:w-[156px]"
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-0.5 left-0.5 z-0 w-[calc(50%-2px)] rounded-full bg-white shadow-[0_2px_8px_rgba(35,31,75,0.16)] transition-transform duration-500 ease-out motion-reduce:transition-none",
              context === "home" && "translate-x-full",
            )}
          />
          <button
            type="button"
            aria-pressed={context === "work"}
            onClick={() => void setContext("work")}
            className={cn(
              "relative z-10 inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-medium outline-none transition-[color,transform] duration-300 focus-visible:ring-2 focus-visible:ring-ring lg:gap-1.5 lg:px-2.5 lg:text-[12px]",
              context === "work" ? "text-[#503188]" : "text-[#667085] hover:text-[#3f276f]",
            )}
          >
            <BriefcaseBusiness
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-300 motion-reduce:transition-none",
                context === "work" ? "scale-110" : "scale-95",
              )}
              aria-hidden="true"
            />
            Work
          </button>
          <button
            type="button"
            aria-pressed={context === "home"}
            onClick={() => void setContext("home")}
            className={cn(
              "relative z-10 inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-medium outline-none transition-[color,transform] duration-300 focus-visible:ring-2 focus-visible:ring-ring lg:gap-1.5 lg:px-2.5 lg:text-[12px]",
              context === "home" ? "text-[#503188]" : "text-[#667085] hover:text-[#3f276f]",
            )}
          >
            <House
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-300 motion-reduce:transition-none",
                context === "home" ? "scale-110" : "scale-95",
              )}
              aria-hidden="true"
            />
            Home
          </button>
        </div>

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
