import type { CourtLaneId } from "./court-view-model";
import type { KatalistIconName } from "./KatalistIcon";

/**
 * Extracted from CourtLaneStack.tsx so that file exports only the component
 * itself -- react-refresh/only-export-components otherwise warns when a
 * component file also exports a shared data constant (same reason
 * use-interaction-blocker.ts's hook was split out of its own provider).
 */
export const courtLaneContent: Record<
  CourtLaneId,
  {
    label: string;
    descriptor: string;
    icon: KatalistIconName;
    tone: string;
    headerTone: string;
    bgTone: string;
    borderTone: string;
    /** Exact Figma accent (headers, counts). */
    accent: string;
    /** Exact Figma colored icon-box background. */
    iconBoxBg: string;
    /** Exact Figma lane gradient background. */
    gradient: string;
  }
> = {
  now: {
    label: "NOW",
    descriptor: "Things to handle now",
    icon: "now-smash",
    tone: "text-status-now",
    headerTone: "bg-transparent",
    bgTone: "bg-[#fff8f7]",
    borderTone: "border-[#fdecec]",
    accent: "#fe1016",
    iconBoxBg: "#fd4946",
    gradient: "linear-gradient(180deg,#fef1f4 0%,#fffbfd 100%)",
  },
  next: {
    label: "NEXT",
    descriptor: "Up next on your plate",
    icon: "next-rally",
    tone: "text-status-next",
    headerTone: "bg-transparent",
    bgTone: "bg-[#f9fbff]",
    borderTone: "border-[#edf4fc]",
    accent: "#0b62f8",
    iconBoxBg: "#005dfe",
    gradient: "linear-gradient(180deg,#f1f7ff 0%,rgba(249,252,255,0.7) 100%)",
  },
  later: {
    label: "LATER",
    descriptor: "For later consideration",
    icon: "later-lob",
    tone: "text-status-later",
    headerTone: "bg-transparent",
    bgTone: "bg-[#f9f7ff]",
    borderTone: "border-[#efeafe]",
    accent: "#641dfb",
    iconBoxBg: "#7c33fd",
    gradient: "linear-gradient(180deg,#efebfe 0%,rgba(244,243,255,0.35) 100%)",
  },
};
