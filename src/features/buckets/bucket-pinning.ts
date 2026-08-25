export function bucketPinned(row: { pinned_at: string | null }) {
  return Boolean(row.pinned_at);
}

export function orderBuckets<T extends { pinnedAt?: string | null; updatedAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt)) return a.pinnedAt ? -1 : 1;
    const pinned = new Date(b.pinnedAt ?? 0).getTime() - new Date(a.pinnedAt ?? 0).getTime();
    return pinned || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
