import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { toProxiedUrl } from "@/integrations/supabase/proxy";
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
  const rawSrc = src || directoryAvatar || matchAvatarByName(safeName);
  // Stored avatar URLs carry the Supabase host; route them through the same-origin proxy.
  const resolvedSrc = rawSrc ? toProxiedUrl(rawSrc, (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL ?? "") : rawSrc;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  useEffect(() => {
    setFailedSrc(null);
    setRetryCount(0);
  }, [resolvedSrc]);
  useEffect(() => {
    if (!failedSrc || failedSrc !== resolvedSrc || retryCount > 0) return;
    const timer = window.setTimeout(() => {
      setRetryCount(1);
      setFailedSrc(null);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [failedSrc, resolvedSrc, retryCount]);
  const show = Boolean(resolvedSrc) && failedSrc !== resolvedSrc;

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
        "relative inline-flex shrink-0 overflow-hidden rounded-full font-semibold items-center justify-center select-none ",
        bgColor,
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span
        className="flex h-full w-full items-center justify-center font-bold tracking-tight"
        style={{ fontSize: Math.max(12, Math.round(size * 0.36)) }}
      >
        {displayInitials}
      </span>
      {show ? (
        <img
          key={`${resolvedSrc}:${retryCount}`}
          src={resolvedSrc ?? undefined}
          alt={safeName}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedSrc(resolvedSrc ?? null)}
        />
      ) : null}
    </span>
  );
}
