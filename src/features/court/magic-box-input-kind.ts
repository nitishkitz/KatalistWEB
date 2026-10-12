/** Clear conversational queries must never become Things just because Toss was selected. */
export function isAssistantQuestion(value: string): boolean {
  const text = value.trim().replace(/^["'“‘]+/, "").toLowerCase();
  // Match the beginning only: "Investigate why ..." and "Rahul, submit ..."
  // remain task captures. Explicit @recipient requests also remain tasks.
  return /^(who|what|whats|what's|what’s|which|where|when|why|how)\b/.test(text)
    || /^(?:can|could|would) you (?:show|tell|find|explain|summari[sz]e|check|list)\b/.test(text)
    || /^(?:show|tell) me\b/.test(text)
    || /^i (?:need|want) to (?:see|know)\b/.test(text)
    || /^(?:hi|hello|hey|good morning|good afternoon|good evening)(?: coey)?[!.?]*$/.test(text);
}
