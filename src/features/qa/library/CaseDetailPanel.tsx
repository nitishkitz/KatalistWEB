import { useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { draftChanged, draftFromCase, emptyDraft, validateDraft } from "../domain";
import { QaOperationError } from "../qa-queries";
import { PLATFORM_KINDS, PLATFORM_LABEL, PRIORITIES, type PlatformKind, type QaCase, type QaCaseDraft, type QaPriority } from "../types";
import { ErrorNotice, Field, dangerButton, iconButton, inputClass, primaryButton, secondaryButton, textareaClass } from "../ui";

/** Side panel for one case. Saving a change creates a NEW immutable version; earlier runs keep the version they started with. */
export function CaseDetailPanel({
  testCase, canManage, saving, error, onSave, onArchive, onClose, onDirtyChange,
}: {
  /** null = creating a new case */
  testCase: QaCase | null;
  canManage: boolean;
  saving: boolean;
  error: QaOperationError | null;
  onSave: (draft: QaCaseDraft) => void;
  onArchive: (archived: boolean) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<QaCaseDraft>(() => (testCase ? draftFromCase(testCase) : emptyDraft()));
  const [validation, setValidation] = useState<string | null>(null);
  useEffect(() => setDraft(testCase ? draftFromCase(testCase) : emptyDraft()), [testCase]);
  const dirty = testCase ? draftChanged(draft, testCase) : Boolean(draft.title || draft.preconditions || draft.steps.some((s) => s.action || s.expected));
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const set = <K extends keyof QaCaseDraft>(k: K, v: QaCaseDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setStep = (i: number, patch: Partial<{ action: string; expected: string }>) => set("steps", draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveStep = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= draft.steps.length) return;
    const next = [...draft.steps];
    [next[i], next[j]] = [next[j], next[i]];
    set("steps", next);
  };
  const disabled = !canManage;

  return (
    <aside aria-label={testCase ? `${testCase.caseKey} details` : "New test case"} className="flex h-full min-w-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-[#eef0f6] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[12.5px] text-[#6a769c]">{testCase ? `${testCase.caseKey} · version ${testCase.version}` : "New test case"}</div>
          <h3 className="m-0 mt-0.5 text-[17px] font-semibold leading-snug">{draft.title.trim() || "Untitled case"}</h3>
        </div>
        <button type="button" className={iconButton} onClick={onClose} aria-label="Close case panel"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {testCase?.archived && <p className="rounded-md bg-[#fffaf0] p-2 text-[12.5px] text-[#7a5b13]">This case is archived. It stays in past runs and cannot be added to new ones.</p>}
        <Field label="Title" htmlFor={`${id}-t`}><input id={`${id}-t`} className={inputClass} value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={240} disabled={disabled} /></Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Priority" htmlFor={`${id}-p`}>
            <select id={`${id}-p`} className={inputClass} value={draft.priority} onChange={(e) => set("priority", e.target.value as QaPriority)} disabled={disabled}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Module" htmlFor={`${id}-m`}><input id={`${id}-m`} className={inputClass} value={draft.module} onChange={(e) => set("module", e.target.value)} maxLength={80} disabled={disabled} /></Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-[12.5px] font-medium">Applicable platforms</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {PLATFORM_KINDS.map((k: PlatformKind) => (
              <label key={k} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]">
                <input type="checkbox" disabled={disabled} checked={draft.platforms.includes(k)} onChange={() => set("platforms", draft.platforms.includes(k) ? draft.platforms.filter((p) => p !== k) : [...draft.platforms, k])} /> {PLATFORM_LABEL[k].replace(" application", "")}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Preconditions" optional htmlFor={`${id}-pre`}><textarea id={`${id}-pre`} className={textareaClass} value={draft.preconditions} onChange={(e) => set("preconditions", e.target.value)} maxLength={4000} disabled={disabled} /></Field>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12.5px] font-medium">Steps and expected results</span>
            {canManage && <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-[#975ee2] hover:bg-[#f3ecfc]" onClick={() => set("steps", [...draft.steps, { action: "", expected: "" }])}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add step</button>}
          </div>
          <ol className="m-0 space-y-2 p-0">
            {draft.steps.map((s, i) => (
              <li key={i} className="flex gap-2 rounded-lg border border-[#eaeffa] p-2">
                <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eef0fb] text-[12px] font-medium">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <input aria-label={`Step ${i + 1} action`} className={inputClass} placeholder="Action" value={s.action} onChange={(e) => setStep(i, { action: e.target.value })} maxLength={1000} disabled={disabled} />
                  <input aria-label={`Step ${i + 1} expected result`} className={inputClass} placeholder="Expected result" value={s.expected} onChange={(e) => setStep(i, { expected: e.target.value })} maxLength={1000} disabled={disabled} />
                </div>
                {canManage && (
                  <div className="flex flex-col">
                    <button type="button" className={iconButton} onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
                    <button type="button" className={iconButton} onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1} aria-label={`Move step ${i + 1} down`}><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
                    <button type="button" className={iconButton} onClick={() => set("steps", draft.steps.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
        {testCase && canManage && dirty && <Field label="What changed" optional htmlFor={`${id}-n`} hint={`Saving creates version ${testCase.version + 1}. Runs that already started keep version ${testCase.version}.`}><input id={`${id}-n`} className={inputClass} value={draft.changeNote} onChange={(e) => set("changeNote", e.target.value)} maxLength={200} /></Field>}
        {validation && <p role="alert" className="text-[12.5px] text-[#c42a3b]">{validation}</p>}
        {error && <ErrorNotice error={error} title="The case was not saved" />}
      </div>
      {canManage && (
        <div className={cn("flex items-center justify-between gap-2 border-t border-[#eef0f6] bg-white px-4 py-3")}>
          {testCase ? (
            <button type="button" className={testCase.archived ? secondaryButton : dangerButton} onClick={() => onArchive(!testCase.archived)}>{testCase.archived ? "Restore" : "Archive"}</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
            <button
              type="button"
              className={primaryButton}
              disabled={saving || (testCase ? !dirty : false)}
              onClick={() => {
                const problem = validateDraft(draft);
                setValidation(problem);
                if (!problem) onSave(draft);
              }}
            >
              {saving ? "Saving…" : testCase ? "Save new version" : "Create case"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
