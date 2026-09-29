import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import type { ThingFile } from "@/features/things/PDFViewer";

/**
 * T09 item 5: the Files section from the court variant's Thing detail
 * panel. The default detail panel has no equivalent Files list of its own
 * (its only file-attach surface is the comment composer, covered by
 * ThingDiscussion) -- checked directly against ThingDetailContent.tsx
 * before extracting, so this is deliberately a single-variant component
 * rather than forced into a `variant` branch with nothing on the other
 * side. All upload/selection logic stays owned by ThingDetailContent: this
 * component only renders `files` and calls `onAddFile`/`onSelectFile`.
 */
export type ThingAttachmentsProps = {
  files: ThingFile[];
  activeFileId: string | null;
  showInlinePreview?: boolean;
  viewOnly: boolean;
  isLoading: boolean;
  attachmentsUnavailable: boolean;
  onRetry: () => void;
  onSelectFile: (file: ThingFile) => void;
  onAddFileClick: () => void;
  fileInput: React.ReactNode;
};

/** File-type chip colors matching the Figma detail dialog. */
function fileTypeChip(type: ThingFile["type"]): {
  label: string;
  bg: string;
  text: string;
  border: string;
} {
  switch (type) {
    case "pdf":
      return { label: "PDF", bg: "#fef9fa", text: "#ff080a", border: "#fdecec" };
    case "docx":
      return { label: "DOCX", bg: "#dde9fe", text: "#0238fa", border: "#dde9fe" };
    case "excel":
      return { label: "XLS", bg: "#dcfce7", text: "#16a34a", border: "#bbf7d0" };
    case "video":
      return { label: "VID", bg: "#eadffe", text: "#4218f0", border: "#eadffe" };
    case "image":
    case "png":
    case "jpg":
      return { label: "PNG", bg: "#eadffe", text: "#4218f0", border: "#eadffe" };
    default:
      return { label: "FILE", bg: "#eef0f6", text: "#515b8e", border: "#e4e6ef" };
  }
}

export function ThingAttachments({
  files,
  activeFileId,
  showInlinePreview = true,
  viewOnly,
  isLoading,
  attachmentsUnavailable,
  onRetry,
  onSelectFile,
  onAddFileClick,
  fileInput,
}: ThingAttachmentsProps): React.ReactNode {
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const imageFiles = files.filter((file) => file.type === "image" || file.type === "png" || file.type === "jpg");
  const previewImage = imageFiles.find((file) => file.id === previewImageId) ?? imageFiles[0];

  return (
    <div className="py-3 border-b border-border/40">
      {fileInput}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[#000533]">Files</span>
          {files.length > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#eef0f6] px-1 text-[12px] font-medium text-[#000533]">
              {files.length}
            </span>
          )}
        </div>
        {!viewOnly && (
          <button
            type="button"
            onClick={onAddFileClick}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[#975ee2] hover:opacity-80 transition-opacity cursor-pointer"
          >
            + Add file
          </button>
        )}
      </div>
      {(isLoading || attachmentsUnavailable) && (
        <div role="status" className="mb-2 text-xs text-amber-700">
          {attachmentsUnavailable ? "Files could not be loaded." : "Loading files…"}
          {attachmentsUnavailable && (
            <button type="button" className="ml-2 underline" onClick={onRetry}>Retry</button>
          )}
        </div>
      )}
      {files.length > 0 ? (
        <div className="overflow-hidden rounded-[8px] border border-[#eeeff6] bg-[#fdfcfd]">
          {files.map((file, idx) => {
            const isSelected = file.id === activeFileId;
            const chip = fileTypeChip(file.type);
            return (
              <button
                key={file.id}
                type="button"
                onClick={() => {
                  if (file.type === "image" || file.type === "png" || file.type === "jpg") setPreviewImageId(file.id);
                  onSelectFile(file);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  idx > 0 && "border-t border-[#eeeff6]",
                  isSelected ? "bg-[#f3f6ff]" : "hover:bg-[#f6f7fb]",
                )}
              >
                <span
                  className="inline-flex h-[22px] items-center justify-center rounded-[6px] border px-2 text-[12px] font-medium uppercase"
                  style={{ backgroundColor: chip.bg, color: chip.text, borderColor: chip.border }}
                >
                  {chip.label}
                </span>
                <span className="flex-1 truncate text-[12px] text-black">{file.name}</span>
                {file.sizeLabel && (
                  <span className="shrink-0 text-[12px] text-[#515b8e]">{file.sizeLabel}</span>
                )}
                {file.isNew && (
                  <span className="shrink-0 rounded bg-[#975ee2] px-1 py-0.5 text-[12px] font-bold text-white">
                    New
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-[12px] text-[#6a769c] italic">No files attached yet</p>
      )}
      {showInlinePreview && previewImage?.url ? (
        <figure className="mt-3 overflow-hidden rounded-[8px] border border-[#eeeff6] bg-[#f6f7fb]">
          <img
            src={previewImage.url}
            alt={previewImage.name}
            className="max-h-64 w-full object-contain"
            loading="lazy"
          />
          <figcaption className="truncate border-t border-[#eeeff6] bg-white px-3 py-1.5 text-[11px] text-[#6a769c]">
            {previewImage.name}
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}
