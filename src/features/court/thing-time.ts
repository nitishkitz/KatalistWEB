function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatThingCreatedAt(
  value: string | null | undefined,
  now = new Date(),
): string | null {
  const createdAt = validDate(value);
  if (!createdAt) return null;

  const elapsed = Math.max(0, now.getTime() - createdAt.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export function formatThingCreatedAtExact(value: string | null | undefined): string | null {
  const createdAt = validDate(value);
  if (!createdAt) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(createdAt);
}
