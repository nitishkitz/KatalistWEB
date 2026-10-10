import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { FileText, Loader2, Paperclip, RotateCcw, X } from "lucide-react";
import { formatBytes, validateEvidenceFile } from "../domain";
import { QaOperationError } from "../qa-queries";
import { useQaEvidence, useQaEvidenceUrls, useQaMutations } from "../use-qa";
import { cn } from "@/lib/utils";
import { secondaryButton } from "../ui";

type Job = { id: string; file: File; state: "uploading" | "failed" | "done"; error?: string; controller: AbortController };

/**
 * Private evidence for one attempt. Each file goes: validate, ask the server for a one-object upload
 * URL, upload, server confirms size, then it becomes visible. A failure or cancel removes the pending
 * row and any partial object, and the file can be retried. Reads use short-lived signed URLs only.
 */
export function EvidencePanel({ listId, attemptId, attemptIds, canUpload }: { listId: string; attemptId: string | null; attemptIds: readonly string[]; canUpload: boolean }) {
  const m = useQaMutations(listId);
  const evidence = useQaEvidence(listId, attemptIds);
  const ready = (evidence.data ?? []).filter((e) => e.status === "ready");
  const urls = useQaEvidenceUrls(listId, ready.map((e) => e.id));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const start = (file: File, existing?: Job) => {
    if (!attemptId) return;
    const problem = validateEvidenceFile(file);
    const id = existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    const base: Job = { id, file, state: problem ? "failed" : "uploading", error: problem ?? undefined, controller };
    setJobs((js) => (existing ? js.map((j) => (j.id === id ? base : j)) : [...js, base]));
    if (problem) return;
    m.uploadEvidence.mutate(
      { attemptId, file, signal: controller.signal },
      {
        onSuccess: () => setJobs((js) => js.filter((j) => j.id !== id)),
        onError: (e) => {
          if ((e as Error)?.name === "AbortError") return setJobs((js) => js.filter((j) => j.id !== id));
          setJobs((js) => js.map((j) => (j.id === id ? { ...j, state: "failed", error: e instanceof QaOperationError ? e.message : "The upload failed." } : j)));
        },
      },
    );
  };
  const add = (files: FileList | File[]) => Array.from(files).forEach((f) => start(f));
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (canUpload && attemptId) add(e.dataTransfer.files); };
  const onPaste = (e: ClipboardEvent) => { const files = Array.from(e.clipboardData.files); if (files.length && canUpload && attemptId) { e.preventDefault(); add(files); } };


  return (
    <section aria-label="Evidence" onPaste={onPaste}>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="m-0 text-[13px] font-semibold">Attachments</h4>
        {canUpload && attemptId && (
          <>
            <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-[#975ee2] hover:bg-[#f3ecfc]" onClick={() => input.current?.click()}><Paperclip className="h-3.5 w-3.5" aria-hidden="true" /> Attach file</button>
            <input ref={input} type="file" multiple hidden aria-label="Attach evidence files" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,application/pdf,text/plain,text/csv" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
          </>
        )}
      </div>
      {!attemptId ? (
        <p className="text-[12.5px] text-[#6a769c]">Save the result first, then attach screenshots or recordings to that attempt.</p>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); if (canUpload) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn("rounded-lg border border-dashed p-2", drag ? "border-[#975ee2] bg-[#f3ecfc]" : "border-[#dfe3f0]")}
        >
          {evidence.isLoading && <p className="text-[12.5px] text-[#6a769c]">Loading attachments…</p>}
          {evidence.error && <p role="alert" className="text-[12.5px] text-[#c42a3b]">Attachments could not be loaded. {evidence.error.message}</p>}
          {ready.length === 0 && jobs.length === 0 && !evidence.isLoading && <p className="m-0 text-[12.5px] text-[#6a769c]">{canUpload ? "Drop a file here, paste a screenshot, or use Attach file. Images, MP4/WebM, PDF, text and CSV up to 25 MB." : "No attachments."}</p>}
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {ready.map((e) => {
              const url = urls.data?.[e.id];
              return (
                <li key={e.id} className="min-w-0 rounded-lg border border-[#eaeffa] p-1.5 text-[12px]">
                  {e.mimeType.startsWith("image/") && url ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={`Evidence ${e.fileName}`} className="h-24 w-full rounded object-cover" /></a> : <div className="flex h-24 items-center justify-center rounded bg-[#fafaff]"><FileText className="h-6 w-6 text-[#9aa3c0]" aria-hidden="true" /></div>}
                  {url && !e.mimeType.startsWith("image/") && <a className="text-[#975ee2] underline" href={url} target="_blank" rel="noopener noreferrer">Open</a>}
                  <div className="qa-truncate mt-1 font-medium" title={e.fileName}>{e.fileName}</div>
                  <div className="text-[#6a769c]">{formatBytes(e.sizeBytes)}</div>
                </li>
              );
            })}
            {jobs.map((j) => (
              <li key={j.id} className="min-w-0 rounded-lg border border-[#eaeffa] p-2 text-[12px]">
                <div className="qa-truncate font-medium" title={j.file.name}>{j.file.name}</div>
                {j.state === "uploading" ? (
                  <div className="mt-1 flex items-center justify-between gap-2 text-[#6a769c]"><span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Uploading…</span><button type="button" className={secondaryButton} onClick={() => { j.controller.abort(); }}><X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel</button></div>
                ) : (
                  <div className="mt-1"><p role="alert" className="m-0 text-[#c42a3b]">{j.error}</p><div className="mt-1 flex gap-1.5"><button type="button" className={secondaryButton} onClick={() => start(j.file, j)}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry</button><button type="button" className={secondaryButton} onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))}>Dismiss</button></div></div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
