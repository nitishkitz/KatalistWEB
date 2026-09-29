import bgWave from "@/assets/auth/bg-wave.png";
import katalistMark from "@/assets/auth/katalist-mark.svg";
import { cn } from "@/lib/utils";

/**
 * Shared dark hero panel for the pre-auth flow (splash, onboarding carousel,
 * phone login, OTP verification) -- matches the Figma "KATALIST / Life,
 * Sorted." brand frame used across all of those screens.
 */
export function AuthHeroPanel({
  className,
  variant = "split",
}: {
  className?: string;
  /** "split": half-width, hidden below lg (paired with a right-hand panel).
   *  "fullscreen": always visible, fills its container (e.g. the splash). */
  variant?: "split" | "fullscreen";
}) {
  return (
    <div
      className={cn(
        "relative flex-col items-center justify-center overflow-hidden bg-[#140b2e]",
        variant === "split" ? "hidden lg:flex" : "flex",
        className,
      )}
      style={{
        backgroundImage: `url(${bgWave})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="relative z-10 flex flex-col items-center px-12 text-center">
        <div className="flex flex-col items-center">
          <div
            className="flex h-28 w-28 items-center justify-center rounded-3xl"
            style={{
              background:
                "linear-gradient(141.9deg, #975ee2 9.2%, #60399e 44.8%, #1c153f 91.1%)",
            }}
          >
            <img
              src={katalistMark}
              alt=""
              aria-hidden="true"
              className="h-[72px] w-auto object-contain"
            />
          </div>
          <span className="-mt-2.5 text-[9px] font-medium uppercase tracking-[0.14em] text-white">
            Life, Sorted
          </span>
        </div>
        <h1 className="mt-6 font-logo text-[56px] font-bold uppercase leading-none tracking-tight text-white">
          Katalist
        </h1>
        <p className="mt-4 max-w-[280px] text-sm text-white/70">
          Bring clarity to what matters today.
        </p>
      </div>
    </div>
  );
}
