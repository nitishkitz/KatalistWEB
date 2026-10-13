import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposerSelections, Interpretation } from "@/domain/coey/contract";
import { buildDraftPlan, commitPath, paceResolutionOf, type DraftPlan } from "@/domain/coey/draft";
import type { Check, Fix, FixOption } from "@/domain/coey/validation";
import { rpcSendContactRequest } from "@/features/hub/rpc";
import { recordDismissal, useCoeyContext } from "./use-coey-context";
import { useCoeyInterpretation, type InterpretationState } from "./use-coey-interpretation";

export type ComposerQuestion = {
  check: Check;
  /** Fix options as shown, with "pick a person" expanded to the user's connections. */
  options: FixOption[];
  /** The pause appeared because the user pressed Send (R4 or an unanswered R3). */
  fromSend: boolean;
};

export type SendDecision =
  | { kind: "ask"; question: string }
  | { kind: "commit"; plan: DraftPlan; interpretation: Interpretation }
  | { kind: "question" }
  | { kind: "unavailable"; reason: string }
  | { kind: "empty" };

const STICKY: Array<keyof ComposerSelections> = ["people", "lane", "manualAction"];

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The Magic Box's single semantic path: Sarvam reads the draft, the shared
 * plan builder places and validates it, the user's explicit choices are
 * constraints, and nothing is created except through `decideSend`.
 */
export function useCoeyComposer({ text, mode, enabled }: { text: string; mode: "work" | "home"; enabled: boolean }) {
  const ctx = useCoeyContext();
  const interpretation = useCoeyInterpretation(text, mode, enabled);
  const [selections, setSelections] = useState<ComposerSelections>({});
  const [pausedForSend, setPausedForSend] = useState(false);
  const idempotency = useRef<{ fingerprint: string; key: string } | null>(null);

  // Answers apply to the text the user reviewed. Person, lane and picked
  // dates are explicit choices that survive small edits.
  useEffect(() => {
    setSelections((current) => Object.fromEntries(STICKY.filter((k) => current[k] !== undefined).map((k) => [k, current[k]])) as ComposerSelections);
    setPausedForSend(false);
  }, [text, mode]);

  const buildPlan = useCallback((state: InterpretationState, sel: ComposerSelections): DraftPlan | null => {
    if (state.status !== "ready" || !ctx.viewer) return null;
    return buildDraftPlan({
      text: state.text,
      mode,
      interpretation: state.interpretation,
      selections: sel,
      candidates: ctx.candidates,
      viewer: ctx.viewer,
      now: Date.now(),
      cal: ctx.calendar,
      holderCals: ctx.holderCals,
      validation: { dismissedCounts: ctx.dismissedCounts },
    });
  }, [ctx.viewer, ctx.candidates, ctx.calendar, ctx.holderCals, ctx.dismissedCounts, mode]);

  const current = interpretation.isCurrent(interpretation.state) ? interpretation.state : null;
  const plan = useMemo(() => (current ? buildPlan(current, selections) : null), [current, selections, buildPlan]);

  const interrupt = plan?.response.interrupt ?? null;
  const question: ComposerQuestion | null = useMemo(() => {
    if (!interrupt) return null;
    // Live while typing: R3 questions show compactly; R4 pauses only on Send; R2 is a one-line hint.
    if (interrupt.level === 4 && !pausedForSend) return null;
    if (interrupt.level === 2) return null;
    const options = interrupt.fixes.flatMap((option): FixOption[] => {
      if (option.fix.type !== "pick_person") return [option];
      const mention = option.fix.mention;
      return ctx.candidates.filter((c) => c.connected).slice(0, 8).map((c) => ({
        id: `person:${c.profileId}`, label: c.name, fix: { type: "choose_person", mention, profileId: c.profileId, name: c.name, avatarUrl: c.avatarUrl },
      }));
    });
    return { check: interrupt, options, fromSend: pausedForSend };
  }, [interrupt, pausedForSend, ctx.candidates]);
  const hint = plan?.response.interrupt?.level === 2 ? plan.response.interrupt : plan?.response.hints[0] ?? null;

  /**
   * Applies a fix as an explicit constraint and returns the new selections, so
   * a "Keep it" send uses them immediately rather than the previous render's.
   */
  const applyFix = useCallback(async (fix: Fix, check: Check | null): Promise<{ outcome: "send" | "updated" | "date"; next: ComposerSelections }> => {
    const s = selections;
    let next: ComposerSelections = s;
    let outcome: "send" | "updated" | "date" = "updated";
    switch (fix.type) {
      case "keep":
        if (check) {
          next = { ...s, dismissed: [...(s.dismissed ?? []), check.id] };
          void recordDismissal(check.id).catch(() => undefined);
        }
        outcome = pausedForSend ? "send" : "updated";
        break;
      case "save_private":
        outcome = "send";
        break;
      case "choose_person":
        next = { ...s, people: { ...s.people, [fix.mention.toLowerCase()]: fix.profileId } };
        break;
      case "keep_text":
        next = { ...s, people: { ...s.people, [fix.mention.toLowerCase()]: "keep" } };
        break;
      case "connect":
        await rpcSendContactRequest(fix.profileId);
        next = { ...s, people: { ...s.people, [fix.mention.toLowerCase()]: "keep" } };
        break;
      case "set_day":
        next = { ...s, dayChoices: { ...s.dayChoices, [fix.key]: fix.date } };
        break;
      case "shift_time":
        next = { ...s, dayChoices: { ...s.dayChoices, [`0:${fix.which}`]: fix.date } };
        break;
      case "pick_date":
        outcome = "date";
        break;
      case "resolve_pace":
        next = { ...s, paceConflict: fix.value };
        break;
      case "split":
        next = { ...s, split: "split" };
        break;
      case "one":
        next = { ...s, split: "one" };
        break;
      case "set_owner":
        next = { ...s, owner: fix.profileId };
        break;
      case "kind":
        next = { ...s, kindOverride: fix.kind };
        break;
      case "accept_inferred":
        next = { ...s, acceptInferred: true };
        break;
      case "pick_person":
        break;
    }
    if (next !== s) setSelections(next);
    return { outcome, next };
  }, [selections, pausedForSend]);

  /** Decide what Send does, interpreting the current revision if needed. Never creates anything itself. */
  const decideSend = useCallback(async (sel: ComposerSelections = selections): Promise<SendDecision> => {
    if (!text.trim()) return { kind: "empty" };
    const state = await interpretation.resolveNow();
    if (state.status === "failed") return { kind: "unavailable", reason: state.reason };
    if (state.status !== "ready") return { kind: "unavailable", reason: "unavailable" };
    const next = buildPlan(state, sel);
    if (!next) return { kind: "unavailable", reason: ctx.error ? "people" : "unavailable" };
    const path = commitPath(next);
    if (path === "answer") return { kind: "ask", question: state.text };
    if (path === "resolve_first" || (next.response.interrupt?.level ?? 0) >= 3) {
      setPausedForSend(true);
      return { kind: "question" };
    }
    return { kind: "commit", plan: next, interpretation: state.interpretation };
  }, [text, selections, interpretation, buildPlan, ctx.error]);

  /** Same key for the same draft and choices, so a retried send never duplicates. */
  const idempotencyKey = useCallback((sel: ComposerSelections) => {
    const fingerprint = JSON.stringify([text, mode, sel]);
    if (idempotency.current?.fingerprint !== fingerprint) idempotency.current = { fingerprint, key: newKey() };
    return idempotency.current.key;
  }, [text, mode]);

  const reset = useCallback(() => {
    setSelections({});
    setPausedForSend(false);
    idempotency.current = null;
  }, []);

  return {
    ctx,
    interpretation,
    plan,
    selections,
    setSelections,
    question,
    hint,
    applyFix,
    decideSend,
    idempotencyKey,
    paceResolution: paceResolutionOf(selections),
    reset,
    pending: interpretation.state.status === "pending",
  };
}
