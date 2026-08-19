import { useState } from "react";
import { cn } from "@/lib/utils";

export function PersonAvatar({
  name,
  initials,
  src,
  size = 32,
  className,
}: {
  name: string;
  initials: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = Boolean(src) && !failed;

  return (
    <span
      className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full bg-zinc-800 text-white", className)}
      style={{ width: size, height: size }}
    >
      {show ? (
        <img
          src={src ?? undefined}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-semibold"
          style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}
        >
          {initials}
        </span>
      )}
    </span>
  );
}