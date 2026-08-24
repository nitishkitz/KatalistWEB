import type { Person } from "@/domain/thing";
import type { RankedPerson } from "./types";

const SCORE_EXACT = 1000;
const SCORE_PREFIX = 800;
const SCORE_WORD = 600;
const SCORE_INCLUDES = 400;
const BOOST_LIST = 80;
const BOOST_RECENCY_MAX = 40;
const BOOST_FREQUENCY_MAX = 30;
const BOOST_CONTEXT = 15;

export type RankAssignableInput = {
  query: string;
  people: Person[];
  currentListMemberIds?: Set<string>;
  recentActorIds?: string[];
  frequencyByActorId?: Record<string, number>;
  sameContextActorIds?: Set<string>;
};

function textScore(name: string, query: string): { score: number; reason: string } | null {
  if (!query) return { score: 0, reason: "all" };
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return { score: SCORE_EXACT, reason: "exact" };
  if (n.startsWith(q)) return { score: SCORE_PREFIX, reason: "prefix" };
  const words = n.split(/\s+/);
  if (words.some((w) => w.startsWith(q))) return { score: SCORE_WORD, reason: "word" };
  if (n.includes(q)) return { score: SCORE_INCLUDES, reason: "includes" };
  return null;
}

export function rankAssignablePeople(input: RankAssignableInput): RankedPerson[] {
  const query = input.query.trim();
  const recencyIndex = new Map<string, number>();
  (input.recentActorIds ?? []).forEach((id, i) => {
    if (!recencyIndex.has(id)) recencyIndex.set(id, i);
  });
  const recencyCount = Math.max(1, recencyIndex.size);

  const ranked: RankedPerson[] = [];
  for (const person of input.people) {
    const match = textScore(person.name, query);
    if (!match) continue;
    const reasons = [match.reason];
    let score = match.score;
    if (input.currentListMemberIds?.has(person.id)) {
      score += BOOST_LIST;
      reasons.push("list");
    }
    const recencyPos = recencyIndex.get(person.id);
    if (recencyPos != null) {
      const boost = Math.round(BOOST_RECENCY_MAX * (1 - recencyPos / recencyCount));
      score += Math.max(0, boost);
      reasons.push("recency");
    }
    const freq = input.frequencyByActorId?.[person.id] ?? 0;
    if (freq > 0) {
      score += Math.min(BOOST_FREQUENCY_MAX, freq * 5);
      reasons.push("frequency");
    }
    if (input.sameContextActorIds?.has(person.id)) {
      score += BOOST_CONTEXT;
      reasons.push("context");
    }
    ranked.push({ ...person, score, rank: 0, reasons });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.id.localeCompare(b.id);
  });
  return ranked.map((p, i) => ({ ...p, rank: i }));
}
