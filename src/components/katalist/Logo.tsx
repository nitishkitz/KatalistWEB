import { cn } from "@/lib/utils";
import katalistMark from "@/assets/katalist-mark.png.asset.json";

interface LogoProps {
  /** Render the "Katalist" wordmark next to the mark. */
  withText?: boolean;
  /** Tailwind size classes for the mark itself. */
  markClassName?: string;
  textClassName?: string;
  className?: string;
}

export function Logo({
  withText = true,
  markClassName = "h-8 w-8",
  textClassName = "text-xl",
  className,
}: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <img
        src={katalistMark.url}
        alt={withText ? "" : "Katalist"}
        aria-hidden={withText || undefined}
        className={cn("object-contain", markClassName)}
      />
      {withText && (
        <span
          className={cn(
            "font-bold tracking-tight text-foreground",
            textClassName,
          )}
        >
          Katalist
        </span>
      )}
    </span>
  );
}
