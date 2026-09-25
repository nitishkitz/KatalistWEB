import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // D01/T08: track is a base control fill, border-led not shadowed --
      // legacy shadow-sm removed. Uses bg-border (still the light decorative
      // 0.88 value), not bg-input -- --input was darkened for the T08/D03
      // contrast fix (a boundary color now needs 3:1), which would make
      // this track's *fill* (not a border) unintentionally dark.
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-border",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        // The thumb is a small sliding element that needs a minimal depth
        // cue to read as "raised" above the track -- kept at the subtlest
        // elevation tier rather than removed outright like other base
        // controls' purely decorative shadows.
        "pointer-events-none block h-4 w-4 rounded-full bg-background katalist-elevation-card ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
