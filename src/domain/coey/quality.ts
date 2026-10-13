/**
 * Message quality gates Q1–Q8 (spec §12.5) and banned words (§12.6). Run on
 * every Coey message before it is shown or sent; a failure means regenerate
 * once, then fall back to a safe template (§11.3, §16.7).
 */
export type GateId = "Q1" | "Q2" | "Q3" | "Q4" | "Q5" | "Q6" | "Q7" | "Q8";
export type GateFailure = { gate: GateId; reason: string };

export type CoeyMessage = {
  text: string;
  /** Buttons offered with the message; asks need at least one exit (Q2). */
  actions?: Array<{ label: string; exit?: boolean }>;
  /** The Thing this message is about (Q7). */
  thingTitle?: string;
  audience: "holder" | "sender" | "upward";
  /** People who may be named in this context; used to detect blame and comparisons. */
  names?: string[];
  /** For upward messages: the requester, who must never be named (Q8). */
  requester?: string;
  variantId?: string;
  recentVariantIds?: string[];
  /** S1 overload whisper to the sender is the one allowed reference to another person's load (Q4). */
  allowOverloadWhisper?: boolean;
};

const BANNED: Array<[RegExp, string]> = [
  [/\boverdue\b/i, "overdue"],
  [/\blate\b/i, "late"],
  [/\bassigned to you\b/i, "assigned to you"],
  [/\byou haven'?t\b|\byou have not\b/i, "you haven't"],
  [/\bfinally\b/i, "finally"],
  [/\breminder\b/i, "reminder"],
  [/\basap\b|\bas soon as possible\b/i, "ASAP"],
  [/\bjust checking in\b/i, "just checking in"],
  [/\byou (?:should|need to|must)\b/i, "you should"],
  [/\bis waiting (?:for|on) you\b/i, "is waiting for you"],
  [/\b(?:ignored|unresponsive|inactive)\b/i, "ignored/unresponsive/inactive"],
  [/\bdon'?t lose your streak\b/i, "don't lose your streak"],
];

const FAILURE_VERBS = "(?:haven'?t|hasn'?t|didn'?t|did not|has not|have not|never|forgot|missed|failed|ignored|dropped)";
const SURVEILLANCE = /\b(?:opened|seen it|read receipt|response time|replied (?:in|after)|last active|was online|has been online|activity score|workload|capacity of)\b/i;
const COMPARISON = /\b(?:faster|slower|better|worse|quicker|more reliable) than\b|\bcompared (?:to|with)\b|\branks?\b|\branked\b|\btop performer\b|\bleaderboard\b/i;
const URGENCY = /\b(?:urgent|urgently|immediately|right away|right now|asap|today itself|abhi|jaldi|turant)\b/i;
const IMPERATIVE_START = /^\s*(?:please\s+)?(?:approve|send|do|finish|complete|review|check|call|reply|respond|confirm|sign|share|update)\b/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function checkMessage(m: CoeyMessage): GateFailure[] {
  const failures: GateFailure[] = [];
  const text = m.text.trim();
  const names = (m.names ?? []).filter((n) => n.trim().length >= 2);
  const firstNames = names.map((n) => n.split(/\s+/)[0]!);

  // Q1 Blame: no sentence makes a person the subject of a failure.
  const subjects = ["you", "they", "he", "she", ...names, ...firstNames].map(escape).join("|");
  if (new RegExp(`\\b(?:${subjects})\\s+(?:still\\s+)?${FAILURE_VERBS}\\b`, "i").test(text)
    || new RegExp(`\\b(?:${[...names, ...firstNames, "you"].map(escape).join("|") || "you"})\\s+(?:is|are|was|were)\\s+(?:late|behind|slow|lazy|unresponsive)\\b`, "i").test(text)) {
    failures.push({ gate: "Q1", reason: "a person is the subject of a failure" });
  }
  // Q2 Exit: every ask offers a way out.
  const asks = /\?/.test(text) || (m.actions?.length ?? 0) > 0;
  if (asks && m.actions && !m.actions.some((a) => a.exit)) failures.push({ gate: "Q2", reason: "an ask without an exit" });
  // Q3 Banned words.
  for (const [pattern, word] of BANNED) if (pattern.test(text)) failures.push({ gate: "Q3", reason: `banned: ${word}` });
  // Q4 Surveillance.
  if (SURVEILLANCE.test(text)) failures.push({ gate: "Q4", reason: "reveals someone's behaviour" });
  if (!m.allowOverloadWhisper && names.some((n) => new RegExp(`\\b${escape(n.split(/\s+/)[0]!)}\\s+has\\s+\\d+\\b`, "i").test(text))) {
    failures.push({ gate: "Q4", reason: "reveals another person's counts" });
  }
  // Q5 Comparison.
  if (COMPARISON.test(text)) failures.push({ gate: "Q5", reason: "compares people" });
  // Q6 Repetition.
  if (m.variantId && m.recentVariantIds?.includes(m.variantId)) failures.push({ gate: "Q6", reason: "variant shown in the last 30 days" });
  // Q7 Clarity.
  if (m.thingTitle && !text.toLowerCase().includes(m.thingTitle.toLowerCase().slice(0, 40))) failures.push({ gate: "Q7", reason: "Thing name missing" });
  if (text.length > 220) failures.push({ gate: "Q7", reason: "too long" });
  if ((text.match(/\?/g) ?? []).length > 1) failures.push({ gate: "Q7", reason: "more than one ask" });
  // Q8 Hierarchy: upward messages are soft.
  if (m.audience === "upward") {
    if (IMPERATIVE_START.test(text)) failures.push({ gate: "Q8", reason: "imperative to a senior" });
    if (URGENCY.test(text)) failures.push({ gate: "Q8", reason: "urgency words upward" });
    if (m.requester && new RegExp(`\\b${escape(m.requester.split(/\s+/)[0]!)}\\b`, "i").test(text)) failures.push({ gate: "Q8", reason: "requester named" });
  }
  return failures;
}

/** §16.7: try the composed message, one regeneration, then the safe template. */
export function chooseMessage(candidates: CoeyMessage[], safeTemplate: CoeyMessage): { message: CoeyMessage; usedFallback: boolean; attempts: number } {
  for (let i = 0; i < Math.min(2, candidates.length); i++) {
    if (checkMessage(candidates[i]!).length === 0) return { message: candidates[i]!, usedFallback: false, attempts: i + 1 };
  }
  return { message: safeTemplate, usedFallback: true, attempts: Math.min(2, candidates.length) };
}
