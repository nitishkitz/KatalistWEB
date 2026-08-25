export type BucketItemsSurface = "loading" | "error" | "empty" | "data";

export function bucketItemsSurface(input: {
  itemsLoading: boolean;
  itemsError: unknown;
  itemCount: number;
}): BucketItemsSurface {
  if (input.itemsLoading) return "loading";
  if (input.itemsError) return "error";
  if (input.itemCount === 0) return "empty";
  return "data";
}

export function selectedBucketIds(
  buckets: ReadonlyArray<{ id: string; thingIds?: readonly string[] }>,
  thingId: string,
): Set<string> {
  return new Set(
    buckets.filter((bucket) => bucket.thingIds?.includes(thingId)).map((bucket) => bucket.id),
  );
}
