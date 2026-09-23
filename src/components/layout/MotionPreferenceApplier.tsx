import { useEffect } from "react";
import { useMotionPreference } from "@/hooks/use-motion-preference";

/**
 * D02: applies the one unified motion preference (OS reduce OR the Me
 * toggle) as a single `reduce-motion` class on the document root, mounted
 * once at the app root (not per-AppShell-instance, so it doesn't
 * add/remove on every route navigation). CSS rules under `.reduce-motion`
 * in styles.css mirror the existing `@media (prefers-reduced-motion:
 * reduce)` rules, so anything that already respects the OS media query
 * (shimmer, view-transitions) now also respects the app-level override,
 * without every consumer needing its own check.
 */
export function MotionPreferenceApplier() {
  const { reduceMotion } = useMotionPreference();

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
  }, [reduceMotion]);

  return null;
}
