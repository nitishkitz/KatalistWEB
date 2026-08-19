import { cn } from "@/lib/utils";

interface SectionCardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  action?: React.ReactNode;
}

export function SectionCard({
  title,
  children,
  className,
  contentClassName,
  action,
}: SectionCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card katalist-shadow-card",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </div>
  );
}
