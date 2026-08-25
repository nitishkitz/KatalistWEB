import type { ContextKind, Importance, Person } from "@/domain/thing";
import type { ListTokenBinding } from "./list-token";

export type MagicBoxFieldSource = "default" | "parser" | "mention" | "manual" | "ai-suggestion";

export type DueResolution =
  | { status: "none" }
  | {
      status: "resolved";
      dueAt: string;
      dueHasTime: boolean;
      label: string;
      source: MagicBoxFieldSource;
    }
  | { status: "ambiguous"; raw: string; label: "Check date" };

export type PersonResolution =
  | { status: "self" }
  | { status: "resolved"; person: Person; source: "mention" | "manual" }
  | { status: "unresolved"; rawMention: string };

export type DraftAttachmentStatus = "uploading" | "ready" | "finalizing" | "recovery-failed" | "failed";

export type DraftAttachment = {
  clientId: string;
  file: File;
  status: DraftAttachmentStatus;
  stagingKey?: string;
  attachmentId?: string;
  createdThingId?: string;
  error?: string;
};

export type ResolvedMention = {
  actorId: string;
  displayName: string;
  start: number;
  end: number;
};

export type MentionQuery = {
  start: number;
  end: number;
  query: string;
};

export type RankedPerson = Person & {
  score: number;
  rank: number;
  reasons: string[];
};

export type MagicBoxDraft = {
  rawText: string;
  derivedTitle: string;
  assignee: PersonResolution;
  ownerImportance: Importance;
  importanceSource: MagicBoxFieldSource;
  due: DueResolution;
  listId?: string;
  listName?: string;
  listResolution: "none" | "resolved" | "unresolved";
  rawListToken?: string;
  context: ContextKind;
  attachments: DraftAttachment[];
  aiCorrection?: { requestId: string; text: string } | null;
};

export type ParsedMagicBoxText = {
  derivedTitle: string;
  ownerImportance: Importance;
  importanceSource: MagicBoxFieldSource;
  due: DueResolution;
  mentionTokens: MentionQuery[];
};

export type FinalCreateThingInput = {
  title: string;
  context: "work" | "home";
  ownerImportance: "now" | "next" | "later";
  listId?: string;
  assigneeActorId?: string;
  dueAt?: string;
  dueHasTime?: boolean;
};

export type MagicBoxAction =
  | { type: "TEXT_CHANGED"; text: string; caret: number }
  | { type: "ASSIGNEE_SELECTED"; person: Person; source: "mention" | "manual"; binding?: ResolvedMention; text?: string; caret?: number }
  | { type: "ASSIGNEE_CLEARED" }
  | { type: "LIST_SELECTED"; listId: string; listName: string; binding: ListTokenBinding; text: string; caret: number }
  | { type: "DUE_SET"; dueAt: string; dueHasTime: boolean; label: string }
  | { type: "DUE_CLEARED" }
  | { type: "IMPORTANCE_SET"; importance: Importance }
  | { type: "IMPORTANCE_CLEARED" }
  | { type: "ATTACHMENT_ADDED"; attachment: DraftAttachment }
  | { type: "ATTACHMENT_UPDATED"; clientId: string; patch: Partial<DraftAttachment> }
  | { type: "ATTACHMENT_REMOVED"; clientId: string }
  | { type: "AI_CORRECTION_RECEIVED"; text: string; requestId: string }
  | { type: "AI_CORRECTION_ACCEPTED" }
  | { type: "AI_CORRECTION_DISMISSED" }
  | { type: "RESET_AFTER_SUCCESS" };

export type AssigneeOverride =
  | { kind: "mention"; person: Person }
  | { kind: "manual"; person: Person }
  | { kind: "manual-self" }
  | null;

export type DueOverride =
  | { kind: "manual"; dueAt: string; dueHasTime: boolean; label: string }
  | { kind: "cleared" }
  | null;

export type MagicBoxInternalState = {
  rawText: string;
  caret: number;
  mentionBinding: ResolvedMention | null;
  listBinding: ListTokenBinding | null;
  assigneeOverride: AssigneeOverride;
  dueOverride: DueOverride;
  importanceOverride: Importance | null;
  attachments: DraftAttachment[];
  aiCorrection: { requestId: string; text: string } | null;
};

export type MagicBoxReduceContext = {
  now: Date;
  timeZone: string;
  people: Person[];
  lists?: Array<{ id: string; name: string }>;
  listId?: string;
  listName?: string;
  context: ContextKind;
};

export const MAGIC_BOX_ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxBytes: 20 * 1024 * 1024,
} as const;

export const MAGIC_BOX_VOICE_MAX_MS = 30_000;
