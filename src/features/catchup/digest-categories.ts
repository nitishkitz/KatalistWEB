import type { CatchUpMoment } from "./use-catchup";

/** Summary tiles in the Morning Digest hero. A moment can count in more than one. */
export type DigestCategory = "catch" | "stale" | "due";

export function momentInCategory(moment: CatchUpMoment, category: DigestCategory): boolean {
  switch (category) {
    case "catch":
      return moment.thing.acknowledgement === "waiting_for_catch";
    case "stale":
      return moment.reason === "stale" || moment.reason === "quiet" || moment.reason === "repeated_handoff";
    case "due":
      return moment.reason === "due_soon";
  }
}

export function digestCounts(moments: CatchUpMoment[]): Record<DigestCategory, number> {
  const count = (category: DigestCategory) => moments.filter((m) => momentInCategory(m, category)).length;
  return { catch: count("catch"), stale: count("stale"), due: count("due") };
}

export type QueueBadge = { label: string; bg: string; text: string };

/** Right-hand pill on a queue row. */
export function queueBadgeFor(moment: CatchUpMoment): QueueBadge {
  if (moment.reason === "stale" || moment.reason === "quiet" || moment.reason === "repeated_handoff") {
    return { label: "Stale", bg: "#fbdce6", text: "#e83d59" };
  }
  if (moment.reason === "due_soon") return { label: "Due soon", bg: "#e2edff", text: "#2a60c6" };
  if (moment.reason === "waiting_for_catch") return { label: "Waiting", bg: "#eaecf1", text: "#465685" };
  if (moment.kind === "snooze_ended") return { label: "Snooze ended", bg: "#e2edff", text: "#2a60c6" };
  return { label: "Needs you", bg: "#eaecf1", text: "#465685" };
}
