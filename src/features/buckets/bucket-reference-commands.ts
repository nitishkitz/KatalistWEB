import type { QueryClient } from "@tanstack/react-query";
import { rpcAddToBucket, rpcRemoveFromBucket } from "@/features/things/rpc";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

export type BucketReferenceTarget =
  | { thingId: string; listId?: never }
  | { listId: string; thingId?: never };

type Operation = "add" | "remove";
const pendingByClient = new WeakMap<QueryClient, Set<string>>();

function sourceKey(target: BucketReferenceTarget): string {
  return "thingId" in target ? `thing:${target.thingId}` : `list:${target.listId}`;
}

function pendingFor(qc: QueryClient) {
  let pending = pendingByClient.get(qc);
  if (!pending) {
    pending = new Set();
    pendingByClient.set(qc, pending);
  }
  return pending;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

export function parseThingDropPayload(raw: string): { thingId: string; title?: string } | null {
  try {
    const parsed = JSON.parse(raw) as { thingId?: unknown; title?: unknown };
    if (!validId(parsed.thingId)) return null;
    return {
      thingId: parsed.thingId,
      title: typeof parsed.title === "string" ? parsed.title.slice(0, 240) : undefined,
    };
  } catch {
    return null;
  }
}

export async function runBucketReferenceCommand(
  qc: QueryClient,
  operation: Operation,
  bucketId: string,
  target: BucketReferenceTarget,
): Promise<"performed" | "already-in-flight" | "retired"> {
  if (!validId(bucketId)) throw new Error("A valid Bucket is required.");
  const targetIsValid =
    ("thingId" in target && validId(target.thingId) && target.listId === undefined) ||
    ("listId" in target && validId(target.listId) && target.thingId === undefined);
  if (!targetIsValid) throw new Error("Choose exactly one valid Thing or List reference.");

  const key = `${operation}:${bucketId}:${sourceKey(target)}`;
  const pending = pendingFor(qc);
  if (pending.has(key)) return "already-in-flight";
  pending.add(key);
  const epoch = getIdentityEpoch(qc).epoch;
  try {
    if (operation === "add") {
      await rpcAddToBucket(bucketId, target.thingId, target.listId);
    } else {
      await rpcRemoveFromBucket(bucketId, target.thingId, target.listId);
    }
    if (!isEpochCurrent(qc, epoch)) return "retired";
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["bucket-items", bucketId] }),
      qc.invalidateQueries({ queryKey: ["bucket", bucketId] }),
      qc.invalidateQueries({ queryKey: ["buckets"] }),
    ]);
    return "performed";
  } catch (error) {
    // A request retired by an identity switch must be inert for the new
    // account: no stale toast and no cache work in the caller.
    if (!isEpochCurrent(qc, epoch)) return "retired";
    throw error;
  } finally {
    pending.delete(key);
  }
}
