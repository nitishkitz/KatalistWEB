import { Paperclip, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraftAttachment } from "./types";

export function AttachmentTray({
  attachments,
  onRemove,
  onRetry,
}: {
  attachments: DraftAttachment[];
  onRemove: (clientId: string) => void;
  onRetry: (clientId: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Attachments">
      {attachments.map((item) => (
        <li
          key={item.clientId}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            item.status === "failed" || item.status === "recovery-failed"
              ? "border-status-waiting/50 text-status-waiting"
              : "border-border text-foreground",
          )}
        >
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="truncate">{item.file.name}</span>
          {item.status === "uploading" || item.status === "finalizing" ? (
            <span className="text-muted-foreground">…</span>
          ) : null}
          {item.status === "failed" || item.status === "recovery-failed" ? (
            <button
              type="button"
              onClick={() => onRetry(item.clientId)}
              className="inline-flex h-4 w-4 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Retry ${item.file.name}`}
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(item.clientId)}
            className="inline-flex h-4 w-4 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Remove ${item.file.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
