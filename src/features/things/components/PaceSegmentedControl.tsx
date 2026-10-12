import type { Pace } from "@/domain/thing";
import { cn } from "@/lib/utils";

const PACES: Pace[] = ["now", "next", "later"];

/** Pill colour per pace (Figma 109:2 Now, 109:8 Next, 109:14 Later). */
const PACE_COLOR: Record<Pace, string> = {
  now: "#fd4946",
  next: "#1a73fe",
  later: "#975ee2",
};

type Props = {
  label: string;
  value: Pace | null;
  disabled?: boolean;
  onChange: (pace: Pace) => void;
};

/**
 * Segmented Now / Next / Later control. A single pill slides between the
 * options while its colour cross-fades to the selected pace's colour, and
 * the label colours ease with it. Reduced-motion users get an instant swap.
 */
export function PaceSegmentedControl({ label, value, disabled, onChange }: Props) {
  const index = value ? PACES.indexOf(value) : -1;
  return (
    <div
      role="group"
      aria-label={label}
      className="relative inline-grid grid-cols-3 rounded-[6px] bg-[#f0f1f9] p-0.5"
    >
      <span
        aria-hidden="true"
        data-testid="pace-pill"
        className="katalist-pace-pill pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 w-[calc((100%-4px)/3)] rounded-[5px]"
        style={{
          transform: `translateX(${Math.max(index, 0) * 100}%)`,
          backgroundColor: value ? PACE_COLOR[value] : "transparent",
          opacity: index < 0 ? 0 : 1,
        }}
      />
      {PACES.map((pace) => {
        const active = value === pace;
        return (
          <button
            key={pace}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(pace)}
            className={cn(
              "katalist-pace-label relative z-10 min-h-7 min-w-[48px] rounded-[5px] px-2.5 text-[12px] font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              active ? "text-white" : "text-[#3a4675]",
            )}
          >
            {pace}
          </button>
        );
      })}
    </div>
  );
}
