import { classifyAssistantIntent, type AssistantConversationTurn, type AssistantIntent } from "./assistant";

export type CoeyRoute = {
  kind: "greeting" | "fast" | "model" | "clarify";
  intent: AssistantIntent;
  /** Set for the "what's up today" family: answer with an overview of today. */
  today?: boolean;
};

const MISSPELLINGS: Array<[RegExp, string]> = [
  [/\b(atention|attension|attnetion|atteintion|attenton)\b/g, "attention"],
  [/\b(overdu|overdew|over due|overdoo)\b/g, "overdue"],
  [/\b(todya|todat|2day|tday)\b/g, "today"],
  [/\b(wats|whts|wat s|whatz)\b/g, "whats"],
  [/\b(waht|wht)\b/g, "what"],
  [/\b(chnaged|chagned)\b/g, "changed"],
  [/\b(nugde|nudg)\b/g, "nudge"],
  [/\b(hii+|heyy+|helo|hllo)\b/g, "hi"],
];

/** Lowercase, drop apostrophes and punctuation, fix common typos. "What's up?" and "whats up" match. */
export function normalizeQuestion(question: string): string {
  let q = question
    .toLowerCase()
    .replace(/[‘’ʼ'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, replacement] of MISSPELLINGS) q = q.replace(pattern, replacement);
  return q;
}

const GREETING =
  /^(hi|hello|hey|heya|hiya|yo|howdy|sup|namaste|good (morning|afternoon|evening)|how are you|hows it going|thanks|thank you|thx)( (coey|there|team|again))?$/;

const TODAY =
  /^(whats up|what is up|whats going on|whats happening|what is happening|what is going on|whats new|how is my day|hows my day|how does my day look|whats on|whats on my plate|what do i have|what have i got|anything for me|anything today|what is on my plate)( (today|now|right now|this morning|this afternoon))?$|^(whats|what is) (on )?(my )?(today|plate|agenda)$/;

const OUT_OF_SCOPE =
  /\b(weather|temperature|forecast|stock price|stocks|news|joke|poem|song|recipe|capital of|president|prime minister|translate|write (me )?(a )?(code|essay|poem|story)|football|cricket score|movie|lyrics|horoscope|bitcoin|who won)\b/;

const KATALIST_WORDS =
  /\b(thing|things|task|tasks|list|lists|bucket|buckets|court|due|deadline|team|assign|assigned|assignee|nudge|status|catch|sorted|progress|work|home|overdue|waiting|stuck|blocked|risk|risky|priority|priorities|workload|busy|behind|late|ghost|snooze)\b/;

const SUMMARY_WORDS =
  /\b(summari[sz]e|summary|overview|status|how many|count|how is it going|hows it going|how are we doing|how are things|progress)\b/;

/**
 * One source of truth for which path answers a question.
 *  greeting: conversational reply, no facts needed.
 *  fast: deterministic answer built from authenticated facts.
 *  model: open-ended synthesis or follow-up over the same facts.
 *  clarify: nothing usable to answer (empty, gibberish, or clearly outside Katalist).
 */
export function routeCoeyQuestion(
  question: string,
  history: AssistantConversationTurn[] = [],
): CoeyRoute {
  const q = normalizeQuestion(question);
  if (q.length < 2 || !/\p{L}/u.test(q)) return { kind: "clarify", intent: "clarification" };
  if (GREETING.test(q)) return { kind: "greeting", intent: "clarification" };
  if (TODAY.test(q)) return { kind: "fast", intent: "attention_items", today: true };
  if (OUT_OF_SCOPE.test(q) && !KATALIST_WORDS.test(q))
    return { kind: "clarify", intent: "unsupported" };
  const intent = classifyAssistantIntent(q);
  if (intent === "stale_items" || intent === "person_items") return { kind: "fast", intent };
  // Follow-ups lean on earlier turns, which only the model can resolve.
  const followUp = history.length > 0 && /\b(it|that|those|them|this|these|why|more|else|and)\b/.test(q);
  if (followUp && intent !== "nudge_recommendation") return { kind: "model", intent };
  if (intent === "nudge_recommendation" || intent === "overdue_items" || intent === "attention_items")
    return q.split(" ").length <= 9 ? { kind: "fast", intent } : { kind: "model", intent };
  if (intent === "recent_activity") return { kind: "fast", intent };
  if (intent === "scope_summary")
    return SUMMARY_WORDS.test(q) && q.split(" ").length <= 9
      ? { kind: "fast", intent }
      : { kind: "model", intent };
  // Unclassified wording is open-ended: the model gets it, and the fallback is a data summary.
  return { kind: "model", intent: "scope_summary" };
}
