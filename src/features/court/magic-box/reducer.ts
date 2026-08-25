import type { Person } from "@/domain/thing";
import { findMentionTokens, uniquePersonMatch, bindingStillValid } from "./mention";
import { parseMagicBoxText } from "./parser";
import { listBindingStillValid, resolveListToken } from "./list-token";
import type {
  DueResolution,
  MagicBoxAction,
  MagicBoxDraft,
  MagicBoxInternalState,
  MagicBoxReduceContext,
  PersonResolution,
} from "./types";

export function emptyMagicBoxState(): MagicBoxInternalState {
  return {
    rawText: "",
    caret: 0,
    mentionBinding: null,
    listBinding: null,
    assigneeOverride: null,
    dueOverride: null,
    importanceOverride: null,
    attachments: [],
    aiCorrection: null,
  };
}

function resolveAssignee(state: MagicBoxInternalState, people: Person[]): PersonResolution {
  if (state.assigneeOverride?.kind === "manual-self") return { status: "self" };
  if (state.assigneeOverride?.kind === "manual") {
    return { status: "resolved", person: state.assigneeOverride.person, source: "manual" };
  }
  if (state.assigneeOverride?.kind === "mention") {
    return { status: "resolved", person: state.assigneeOverride.person, source: "mention" };
  }
  if (state.mentionBinding) {
    const person = people.find((p) => p.id === state.mentionBinding!.actorId);
    if (person) return { status: "resolved", person, source: "mention" };
  }
  const first = findMentionTokens(state.rawText)[0];
  if (!first) return { status: "self" };
  const unique = uniquePersonMatch(first.query, people);
  if (unique) return { status: "resolved", person: unique, source: "mention" };
  return { status: "unresolved", rawMention: first.query };
}

function resolveDue(state: MagicBoxInternalState, parsedDue: DueResolution): DueResolution {
  if (state.dueOverride?.kind === "cleared") return { status: "none" };
  if (state.dueOverride?.kind === "manual") {
    return {
      status: "resolved",
      dueAt: state.dueOverride.dueAt,
      dueHasTime: state.dueOverride.dueHasTime,
      label: state.dueOverride.label,
      source: "manual",
    };
  }
  return parsedDue;
}

export function selectDraft(state: MagicBoxInternalState, ctx: MagicBoxReduceContext): MagicBoxDraft {
  const selectedList = ctx.listId
    ? { status: "resolved" as const, list: { id: ctx.listId, name: ctx.listName ?? "List" } }
    : state.listBinding && listBindingStillValid(state.rawText, state.listBinding)
      ? { status: "resolved" as const, list: { id: state.listBinding.listId, name: state.listBinding.listName } }
      : resolveListToken(state.rawText, ctx.lists ?? []);
  let parsingText = state.rawText;
  if (!ctx.listId && state.listBinding && listBindingStillValid(state.rawText, state.listBinding)) {
    parsingText = `${state.rawText.slice(0, state.listBinding.start)} ${state.rawText.slice(state.listBinding.end)}`;
  } else if (!ctx.listId && selectedList.status !== "none") {
    parsingText = state.rawText.replace(/(?:^|\s)#[^#\s]+/, " ");
  }
  const parsed = parseMagicBoxText(parsingText, {
    now: ctx.now,
    timeZone: ctx.timeZone,
    manualImportance: state.importanceOverride,
    manualDue:
      state.dueOverride?.kind === "manual"
        ? {
            dueAt: state.dueOverride.dueAt,
            dueHasTime: state.dueOverride.dueHasTime,
            label: state.dueOverride.label,
          }
        : null,
  });
  return {
    rawText: state.rawText,
    derivedTitle: parsed.derivedTitle,
    assignee: resolveAssignee(state, ctx.people),
    ownerImportance: parsed.ownerImportance,
    importanceSource: parsed.importanceSource,
    due: resolveDue(state, parsed.due),
    listId: selectedList.status === "resolved" ? selectedList.list.id : undefined,
    listName: selectedList.status === "resolved" ? selectedList.list.name : undefined,
    listResolution: selectedList.status,
    rawListToken: selectedList.status === "unresolved" ? selectedList.rawToken : undefined,
    context: ctx.context,
    attachments: state.attachments,
    aiCorrection: state.aiCorrection,
  };
}

export function reduceMagicBox(
  state: MagicBoxInternalState,
  action: MagicBoxAction,
  _ctx: MagicBoxReduceContext,
): MagicBoxInternalState {
  switch (action.type) {
    case "TEXT_CHANGED": {
      let mentionBinding = state.mentionBinding;
      let assigneeOverride = state.assigneeOverride;
      let listBinding = state.listBinding;
      if (!bindingStillValid(action.text, mentionBinding)) {
        mentionBinding = null;
        if (assigneeOverride?.kind === "mention") assigneeOverride = null;
      }
      if (!listBindingStillValid(action.text, listBinding)) listBinding = null;
      return {
        ...state,
        rawText: action.text,
        caret: action.caret,
        mentionBinding,
        listBinding,
        assigneeOverride,
      };
    }
    case "ASSIGNEE_SELECTED": {
      const nextText = action.text ?? state.rawText;
      return {
        ...state,
        rawText: nextText,
        caret: action.caret ?? action.binding?.end ?? state.caret,
        mentionBinding: action.binding ?? state.mentionBinding,
        assigneeOverride:
          action.source === "manual" ? { kind: "manual", person: action.person } : { kind: "mention", person: action.person },
      };
    }
    case "ASSIGNEE_CLEARED":
      return { ...state, assigneeOverride: { kind: "manual-self" }, mentionBinding: state.mentionBinding };
    case "LIST_SELECTED":
      return { ...state, rawText: action.text, caret: action.caret, listBinding: action.binding };
    case "DUE_SET":
      return {
        ...state,
        dueOverride: {
          kind: "manual",
          dueAt: action.dueAt,
          dueHasTime: action.dueHasTime,
          label: action.label,
        },
      };
    case "DUE_CLEARED":
      return { ...state, dueOverride: { kind: "cleared" } };
    case "IMPORTANCE_SET":
      return { ...state, importanceOverride: action.importance };
    case "IMPORTANCE_CLEARED":
      return { ...state, importanceOverride: "next" };
    case "ATTACHMENT_ADDED":
      return { ...state, attachments: [...state.attachments, action.attachment] };
    case "ATTACHMENT_UPDATED":
      return {
        ...state,
        attachments: state.attachments.map((item) =>
          item.clientId === action.clientId ? { ...item, ...action.patch } : item,
        ),
      };
    case "ATTACHMENT_REMOVED":
      return { ...state, attachments: state.attachments.filter((item) => item.clientId !== action.clientId) };
    case "AI_CORRECTION_RECEIVED":
      return { ...state, aiCorrection: { requestId: action.requestId, text: action.text } };
    case "AI_CORRECTION_ACCEPTED": {
      if (!state.aiCorrection) return state;
      return {
        ...state,
        rawText: state.aiCorrection.text,
        caret: state.aiCorrection.text.length,
        mentionBinding: bindingStillValid(state.aiCorrection.text, state.mentionBinding) ? state.mentionBinding : null,
        listBinding: listBindingStillValid(state.aiCorrection.text, state.listBinding) ? state.listBinding : null,
        assigneeOverride: state.assigneeOverride?.kind === "mention" ? null : state.assigneeOverride,
        aiCorrection: null,
      };
    }
    case "AI_CORRECTION_DISMISSED":
      return { ...state, aiCorrection: null };
    case "RESET_AFTER_SUCCESS":
      return emptyMagicBoxState();
    default:
      return state;
  }
}

export function canTossDraft(draft: MagicBoxDraft, pending: boolean): boolean {
  return (
    draft.derivedTitle.trim().length > 0 &&
    draft.assignee.status !== "unresolved" &&
    draft.listResolution !== "unresolved" &&
    draft.attachments.every((a) => a.status === "ready") &&
    !pending
  );
}

export type TossBlockReason =
  | "empty-title"
  | "unresolved-person"
  | "unresolved-list"
  | "attachment-pending"
  | "attachment-failed"
  | "attachment-recovery"
  | "pending";

export function tossBlockReason(draft: MagicBoxDraft, pending: boolean): TossBlockReason | null {
  if (pending) return "pending";
  if (!draft.derivedTitle.trim()) return "empty-title";
  if (draft.assignee.status === "unresolved") return "unresolved-person";
  if (draft.listResolution === "unresolved") return "unresolved-list";
  if (draft.attachments.some((a) => a.status === "recovery-failed" || a.createdThingId)) return "attachment-recovery";
  if (draft.attachments.some((a) => a.status === "uploading" || a.status === "finalizing")) return "attachment-pending";
  if (draft.attachments.some((a) => a.status === "failed")) return "attachment-failed";
  return null;
}
