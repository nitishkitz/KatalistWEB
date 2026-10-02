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
      <div className="relative z-10 flex flex-col items-center px-8 text-center sm:px-12">
        {/* Figma app-icon tile (node 20:43): 128.6px gradient square, K mark
            85.2x87.8 inset 21.87px / 14.15px from the top-left. */}
        <div
          className="relative size-[128.606px] shrink-0 rounded-[12.861px]"
          style={{
            backgroundImage:
              "linear-gradient(141.91deg, rgb(151, 94, 226) 9.173%, rgb(96, 57, 158) 44.765%, rgb(28, 21, 63) 91.077%)",
          }}
        >
          <img
            src={katalistMark}
            alt=""
            aria-hidden="true"
            className="absolute left-[21.87px] top-[14.15px] block h-[87.767px] w-[85.201px] max-w-none"
          />
        </div>
        <h1 className="mt-[clamp(16px,3vh,24px)] font-logo text-[clamp(38px,4.5vw,56px)] font-bold uppercase leading-none tracking-tight text-white">
          Katalist
        </h1>
        <p className="mt-[clamp(10px,2vh,16px)] max-w-[280px] text-sm text-white/70">
          Bring clarity to what matters today.
        </p>
      </div>
    </div>
  );
}
