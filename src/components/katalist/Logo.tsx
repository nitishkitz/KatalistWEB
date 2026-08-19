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
      <img
        src="/katalist-mark-app.png"
        alt={withText ? "" : "Katalist"}
        aria-hidden={withText || undefined}
        className={cn("object-contain", markClassName)}
      />
      {withText && (
        <span className={cn("font-bold tracking-tight text-foreground", textClassName)}>
          Katalist
        </span>
      )}
    </span>
  );
}
