export type CoeyEvent =
  | "THING_TOSSED_SELF"
  | "THING_TOSSED_OTHER"
  | "PERSON_AMBIGUOUS"
  | "DATE_AMBIGUOUS"
  | "VOICE_CAPTURED"
  | "VOICE_FAILED"
  | "ATTACHMENT_FAILED"
  | "TOSS_FAILED";

const FALLBACK: Record<CoeyEvent, string> = {
  THING_TOSSED_SELF: "Caught by you. It’s on your court.",
  THING_TOSSED_OTHER: "Tossed to {name}. Your court’s lighter.",
  PERSON_AMBIGUOUS: "Pick a person — I won’t guess.",
  DATE_AMBIGUOUS: "Date looks fuzzy. Check it, or leave it open.",
  VOICE_CAPTURED: "Got it. Give that a quick look.",
  VOICE_FAILED: "I missed that one. Try the mic again.",
  ATTACHMENT_FAILED: "That file slipped. Retry or remove it.",
  TOSS_FAILED: "I fumbled that. Your draft is still here.",
};

const FORBIDDEN =
  /\b(shame|ashamed|lazy|stupid|dumb|incompetent|useless|worst|guilt|guilty|scold|pathetic|failure)\b|stack trace|internal error|sql|postgres|supabase/i;

export function coeyFallback(event: CoeyEvent, personName?: string): string {
  const text = FALLBACK[event];
  return personName ? text.replace("{name}", personName) : text.replace("{name}", "them");
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function sanitizeCoeyCopy(text: unknown, event: CoeyEvent, personName?: string): string {
  const fallback = coeyFallback(event, personName);
  if (typeof text !== "string") return fallback;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  if (wordCount(trimmed) > 18) return fallback;
  if (FORBIDDEN.test(trimmed)) return fallback;
  if (trimmed.includes("{") || trimmed.includes("}")) return fallback;
  return trimmed;
}
