export type ParsedDevice = { label: string; kind: "phone" | "computer" };

export function parseUserAgent(userAgent: string | null): ParsedDevice {
  if (!userAgent) return { label: "Unknown browser", kind: "computer" };

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /CriOS\//.test(userAgent)
          ? "Chrome"
          : /Chrome\//.test(userAgent)
            ? "Chrome"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : "Browser";
  const platform = /iPhone|iPad|iPod/.test(userAgent)
    ? "iPhone/iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "device";
  const kind = /Mobile|iPhone|iPad|iPod|Android/.test(userAgent) ? "phone" : "computer";

  return { label: `${browser} on ${platform}`, kind };
}

export function formatLastUsed(value: string | null): string {
  if (!value) return "Usage time unavailable";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Usage time unavailable";

  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
