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
