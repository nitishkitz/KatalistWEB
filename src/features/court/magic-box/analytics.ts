export type MagicBoxAnalyticsEvent =
  | { name: "magic_box_focused"; surface: string; context: string; list_id?: string }
  | { name: "magic_box_person_selected"; method: "tab" | "enter" | "click" | "chip"; rank: number }
  | { name: "magic_box_chip_changed"; kind: "assignee" | "due" | "importance"; source: string }
  | { name: "magic_box_date_ambiguous"; category: "numeric" | "weekday" | "other" }
  | { name: "magic_box_voice_result"; success: boolean; duration_bucket: string; language?: string }
  | { name: "magic_box_attachment_added"; mime_category: string; size_bucket: string }
  | {
      name: "magic_box_toss";
      assignment: "self" | "delegated";
      due: boolean;
      importance: string;
      attachments: boolean;
      surface: "list" | "global";
    }
  | { name: "magic_box_toss_failed"; category: string }
  | { name: "magic_box_ai_assist"; result: "offered" | "accepted" | "rejected" | "timeout" };

export type MagicBoxAnalyticsSink = (event: MagicBoxAnalyticsEvent) => void;

let sink: MagicBoxAnalyticsSink = () => {};

export function setMagicBoxAnalyticsSink(next: MagicBoxAnalyticsSink) {
  sink = next;
}

export function trackMagicBox(event: MagicBoxAnalyticsEvent) {
  try {
    sink(event);
  } catch {
    // Analytics must never affect Toss.
  }
}

export function mimeCategory(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

export function sizeBucket(bytes: number): string {
  if (bytes < 100_000) return "lt100kb";
  if (bytes < 1_000_000) return "lt1mb";
  if (bytes < 5_000_000) return "lt5mb";
  if (bytes < 20_000_000) return "lt20mb";
  return "gt20mb";
}

export function durationBucket(ms: number): string {
  if (ms < 5_000) return "lt5s";
  if (ms < 15_000) return "lt15s";
  if (ms < 30_000) return "lt30s";
  return "30s";
}
