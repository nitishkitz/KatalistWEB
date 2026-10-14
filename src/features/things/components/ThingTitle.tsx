import type { Thing } from '@/domain/thing';

import {thingReference} from '../thing-reference';

/** Inline flow lets subsequent title lines use the card's full width. */
export function ThingTitle({thing}: {thing: Pick<Thing,'title'|'referenceNumber'>}) {
  const reference=thingReference(thing);
  return <span className="break-words">
    {reference ? <><span className="whitespace-nowrap font-mono text-[11px] font-normal tracking-normal text-slate-500">{reference}</span>{"\u00a0\u00a0"}</> : null}
    {thing.title}
  </span>;
}
