import { useState } from "react";
import { cn } from "@/lib/utils";

export type ClarificationChoice = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

/** One legible question above the composer. Selection never submits a Thing. */
export function MagicBoxClarification({
  id, questionKey, question, detail, choices, onContinue, onEdit,
}: {
  id: string;
  questionKey: string;
  question: string;
  detail?: string;
  choices: ClarificationChoice[];
  onContinue(id: string): void;
  onEdit(): void;
}) {
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null);
  const selected = selection?.key === questionKey ? choices.find((choice) => choice.id === selection.id && !choice.disabled) : undefined;
  return (
    <section id={id} aria-label="Magic Box clarification" className="relative z-10 mb-3 flex max-h-[50dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-[0_12px_40px_rgba(15,23,42,0.16)]">
      <div aria-live="polite" aria-atomic="true" className="shrink-0 border-b border-slate-100 px-3 py-2">

        <h2 id={`${id}-title`} className="break-words text-sm font-semibold leading-5">{question}</h2>
        {detail ? <p className="mt-0.5 break-words text-xs leading-4 text-slate-600">{detail}</p> : null}
      </div>
      {choices.length ? (
        <fieldset aria-labelledby={`${id}-title`} className="min-h-0 min-w-0 space-y-1.5 overflow-y-auto overscroll-contain p-2">
          <legend className="sr-only">Choose one answer</legend>
          {choices.map((choice, index) => (
            <label key={choice.id} className={cn("flex min-h-10 items-start gap-2 rounded-lg border bg-white px-2.5 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-violet-500 focus-within:ring-offset-2", choice.disabled ? "cursor-not-allowed border-slate-200 text-slate-500" : "cursor-pointer hover:border-violet-300 hover:bg-violet-50", selected?.id === choice.id ? "border-violet-500 bg-violet-50" : "border-slate-200")}>
              <input type="radio" name={`${id}-choice`} value={choice.id} checked={selected?.id === choice.id} disabled={choice.disabled} onChange={() => setSelection({ key: questionKey, id: choice.id })} className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600" />
              <span className="min-w-0 flex-1 break-words">
                <span className="block font-medium leading-5"><span className="mr-1.5 text-slate-500">{index + 1}.</span>{choice.label}</span>
                {choice.description ? <span className="mt-0.5 block text-xs leading-4 text-slate-600">{choice.description}</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white px-3 py-2">
        <button type="button" onClick={onEdit} className="min-h-8 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Edit message</button>
        {choices.length ? <button type="button" disabled={!selected} onClick={() => { if (selected) onContinue(selected.id); }} className="min-h-8 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">Continue</button> : null}
      </div>
    </section>
  );
}
