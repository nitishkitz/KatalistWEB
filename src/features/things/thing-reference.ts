import type { Thing } from '@/domain/thing';

export function thingReference(thing: Pick<Thing,'referenceNumber'>): string {
  return thing.referenceNumber ? `KT-${thing.referenceNumber}` : '';
}
