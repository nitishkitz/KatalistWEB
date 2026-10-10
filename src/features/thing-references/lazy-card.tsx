import { Suspense, lazy, type ComponentProps } from "react";

// The card pulls in the Thing read path. Composers and chat panels only need it once a reference exists.
const Card = lazy(() => import("./CompactThingReferenceCard").then((m) => ({ default: m.CompactThingReferenceCard })));

export function LazyCompactThingReferenceCard(props: ComponentProps<typeof Card>) {
  return (
    <Suspense fallback={null}>
      <Card {...props} />
    </Suspense>
  );
}
