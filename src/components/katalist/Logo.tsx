import { cn } from "@/lib/utils";

interface LogoProps {
  withText?: boolean;
  markClassName?: string;
  textClassName?: string;
  className?: string;
}

export function Logo({
  withText = true,
  markClassName = "h-7 w-7",
  textClassName = "text-[17px]",
  className,
}: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden={withText || undefined}
        className={cn(
          "inline-flex items-center justify-center rounded-[6px] p-1",
          markClassName,
        )}
        style={{
          background:
            "linear-gradient(141.9deg, #975ee2 9.2%, #60399e 44.8%, #1c153f 91.1%)",
        }}
      >
        <img
          src="/katalist-mark-app.png"
          alt={withText ? "" : "Katalist"}
          className="h-full w-full object-contain brightness-0 invert"
        />
      </span>
      {withText && (
        <span
          className={cn(
            "font-logo font-bold uppercase tracking-[0.01em] text-foreground",
            textClassName,
          )}
        >
          Katalist
        </span>
      )}
    </span>
  );
}
