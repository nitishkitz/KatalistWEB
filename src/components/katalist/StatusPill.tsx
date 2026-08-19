import { cn } from "@/lib/utils";

export type StatusVariant =
  | "now"
  | "next"
  | "later"
  | "waiting"
  | "caught"
  | "neutral";

interface StatusPillProps {
  variant: StatusVariant;
  children: React.ReactNode;
  className?: string;
}

const variantMap: Record<StatusVariant, string> = {
  now: "bg-status-now-bg text-status-now border-status-now/10",
  next: "bg-status-next-bg text-status-next border-status-next/10",
  later: "bg-status-later-bg text-status-later border-status-later/10",
  waiting: "bg-status-waiting-bg text-status-waiting border-status-waiting/10",
  caught: "bg-status-caught-bg text-status-caught border-status-caught/10",
  neutral: "bg-status-neutral-bg text-status-neutral border-status-neutral/10",
};

export function StatusPill({ variant, children, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        variantMap[variant],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
