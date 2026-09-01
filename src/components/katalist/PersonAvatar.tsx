import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAvatarUrl, matchAvatarByName } from "@/features/people/directory";

const AVATAR_COLORS = [
  "bg-purple-600 text-white",
  "bg-blue-600 text-white",
  "bg-emerald-600 text-white",
  "bg-amber-600 text-white",
  "bg-rose-600 text-white",
  "bg-indigo-600 text-white",
  "bg-teal-600 text-white",
  "bg-violet-600 text-white",
  "bg-pink-600 text-white",
];

function getColorForName(name: string): string {
  const n = name && name.toLowerCase() !== "someone" ? name : "Priya";
  let hash = 0;
  for (let i = 0; i < n.length; i++) {
    hash = (hash << 5) - hash + n.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export function PersonAvatar({
  name,
  initials,
  src,
  size = 32,
  className,
}: {
  name: string;
  initials?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const safeName = name && name.trim() && name.toLowerCase() !== "someone" ? name.trim() : "Priya";
  const directoryAvatar = useAvatarUrl(safeName, null, src);
  const resolvedSrc = src || directoryAvatar || matchAvatarByName(safeName);
  const [failed, setFailed] = useState(false);
  const show = Boolean(resolvedSrc) && !failed;

  const displayInitials =
    initials && initials.toUpperCase() !== "S" && initials.toUpperCase() !== "SO"
      ? initials
      : safeName
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")
          .toUpperCase() || "PS";

  const bgColor = getColorForName(safeName);

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-full font-semibold items-center justify-center select-none shadow-2xs",
        bgColor,
        className,
      )}
      style={{ width: size, height: size }}
    >
      {show ? (
        <img
          src={resolvedSrc ?? undefined}
          alt={safeName}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-bold tracking-tight"
          style={{ fontSize: Math.max(10, Math.round(size * 0.36)) }}
        >
          {displayInitials}
        </span>
      )}
    </span>
  );
}