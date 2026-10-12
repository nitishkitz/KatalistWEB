import type { AssistantAnswer, AssistantFacts } from "./assistant";

const normalize = (value: string) => value.toLowerCase().replace(/['’]s\b/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const closed = new Set(["sorted", "completed", "cancelled"]);
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length];
}

/** Names come only from permission-scoped facts. Partial/fuzzy matches never select an actor. */
export function personThingAnswer(facts: AssistantFacts, question: string, confirmedActorId?: string): AssistantAnswer | null {
  if (!/\bstale\b|\b(show|list|find|see)\b.*\b(things|tasks)\b|\b(things|tasks) (assigned|belonging) to\b/i.test(question)) return null;
  const people = new Map(facts.people.map(p => [p.actor_id, p.display_name]));
  for (const t of facts.things) if (t.assignee_actor_id && t.assignee_name && !people.has(t.assignee_actor_id)) people.set(t.assignee_actor_id, t.assignee_name);
  const q = normalize(question);
  const requestedRaw = question.match(/(?:show|list|find|see)\s+(?:me\s+)?(.+?)\s+(?:(?:active|overdue)\s+)?(?:things|tasks|stale)\b/i)?.[1]
    || question.match(/(?:things|tasks)\s+(?:assigned|belonging)\s+to\s+(.+?)(?:\s+(?:and|show|that|which)\b|$)/i)?.[1];
  let requested = requestedRaw ? normalize(requestedRaw) : "";
  if (/^(?:my|the|all|those|their|active|overdue|stale)$/.test(requested)) requested = "";
  const base = { schema_version: "katalist.assistant.answer.v1" as const, confidence: "high" as const, actions: [], citations: [], freshness: facts.freshness };
  const missing = (text: string): AssistantAnswer => ({ ...base, intent: "person_not_found", answer_markdown: text, groups: [] });
  let actorId: string | undefined;
  if (confirmedActorId) {
    if (!people.has(confirmedActorId)) return missing("That person is no longer available. Check the name and try again.");
    actorId = confirmedActorId;
  } else {
    const exact = [...people].filter(([, name]) => ` ${q} `.includes(` ${normalize(name)} `));
    if (exact.length === 1) actorId = exact[0][0];
    else {
      const candidates = exact.length > 1 ? exact : [...people].filter(([, name]) => {
        const first = normalize(name).split(" ")[0];
        const alias = requested.replace(/s$/, "");
        return ` ${q} `.includes(` ${first} `) || ` ${q} `.includes(` ${first}s `)
          || (requested.length >= 4 && [normalize(name), first].some(n => distance(requested, n) <= 2 || distance(alias, n) <= 1));
      });
      if (candidates.length) return {
        ...base, intent: "person_selection_required", groups: [],
        answer_markdown: candidates.length === 1 ? `Do you mean **${candidates[0][1]}**?` : "Which person do you mean?",
        person_candidates: candidates.slice(0, 8).map(([actor_id, display_name]) => ({ actor_id, display_name })),
      };
      if (requested) return missing(`I couldn't find a person named “${requestedRaw}”. Check the name and try again.`);
      return null;
    }
  }
  const name = people.get(actorId)!;
  const stale = /\bstale\b/i.test(question);
  const allAssigned = /\ball assigned things\b/i.test(question);
  const overdue = /\boverdue\b/i.test(question);
  const cutoff = Date.parse(facts.generated_at) - 3 * 86400000;
  const things = facts.things.filter(t => t.assignee_actor_id === actorId && !closed.has(t.status)
    && (!stale || allAssigned || Date.parse(t.updated_at) < cutoff) && (!overdue || t.is_overdue));
  return {
    ...base, intent: "person_items",
    answer_markdown: `**${name}** has ${things.length} ${stale && !allAssigned ? "stale" : overdue ? "overdue" : "active"} ${things.length === 1 ? "Thing" : "Things"}.`,
    groups: things.length ? [{ key: `person:${actorId}`, title: name, thing_ids: things.map(t => t.id), total: things.length }] : [],
    citations: things.slice(0, 20).map(t => ({ type: "thing", id: t.id, label: t.citation_label })),
  };
}
