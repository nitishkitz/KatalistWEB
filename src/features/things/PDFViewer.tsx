import { useEffect, useState } from "react";
import {
  ExternalLink,
  Download,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Video,
  FileSpreadsheet,
  File as FileIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThingFile, ThingFileType } from "@/domain/thing";
import { downloadFile } from "@/lib/file-utils";
import { PdfCanvas } from "./PdfCanvas";

export type { ThingFile, ThingFileType };

/** Office Online can only fetch publicly reachable http(s) URLs, not blob:/data:. */
function isRemoteUrl(url?: string): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

type PDFViewerProps = {
  file: ThingFile;
  onClose?: () => void;
  /** Optional "Added by … • …" footer (matches the Figma detail dialog). */
  addedByName?: string;
  addedLabel?: string;
};

export function PDFViewer({ file, addedByName, addedLabel }: PDFViewerProps) {
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const totalPages = numPages;

  // Reset paging when the previewed file changes.
  useEffect(() => {
    setPage(1);
    setNumPages(1);
  }, [file.id]);

  const isImage =
    file.type === "image" ||
    file.type === "png" ||
    file.type === "jpg";
  const isVideo = file.type === "video";
  const isPdf = file.type === "pdf";
  const isExcel = file.type === "excel";
  const isDoc = file.type === "docx";

  const typeLabel: Record<string, string> = {
    pdf: "PDF",
    docx: "DOCX",
    png: "PNG",
    jpg: "JPG",
    image: "Image",
    video: "Video",
    excel: "Spreadsheet",
    other: "File",
  };

  const typeColor: Record<string, string> = {
    pdf: "text-red-600 bg-red-50 border-red-200",
    docx: "text-blue-600 bg-blue-50 border-blue-200",
    png: "text-green-600 bg-green-50 border-green-200",
    jpg: "text-green-600 bg-green-50 border-green-200",
    image: "text-emerald-600 bg-emerald-50 border-emerald-200",
    video: "text-purple-600 bg-purple-50 border-purple-200",
    excel: "text-emerald-700 bg-emerald-50 border-emerald-200",
    other: "text-slate-600 bg-slate-50 border-slate-200",
  };

  return (
    <aside className="flex flex-col w-[420px] lg:w-[460px] xl:w-[500px] min-w-[300px] border-l border-[#eef0f6] bg-[#f6f6fa] h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-2">
        <span className="flex h-[40px] w-[38px] shrink-0 items-center justify-center rounded-[6px] border border-[#ebedf3] bg-[#fafafd] text-[#975ee2]">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-medium text-[#000533] leading-tight">{file.name}</h3>
          <p className="mt-0.5 text-[11.5px] text-[#434f80]">
            {typeLabel[file.type] || "File"}
            {"  •  "}
            {file.sizeLabel || "Attachment"}
          </p>
        </div>
        {file.url && (
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] border border-[#ebedf3] bg-white text-[#5f5f90] hover:text-[#000533] transition-colors"
            aria-label="Open file in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 pb-3">
        <button
          type="button"
          onClick={() => downloadFile(file)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#434f80] hover:text-[#000533] transition-colors cursor-pointer"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Download</span>
        </button>

        {isPdf ? (
          <div className="flex items-center gap-2.5 text-[11px] text-[#434f80]">
            <span className="font-medium">{page} / {totalPages}</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-[#eceef5] disabled:opacity-30 transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-[#eceef5] disabled:opacity-30 transition-colors cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Main Preview Area */}
      <div className="flex-1 overflow-auto bg-[#f6f6fa] px-5 pb-4 flex flex-col items-center justify-center">
        {isImage && file.url ? (
          <div className="flex flex-col items-center justify-center max-w-full">
            <img
              src={file.url}
              alt={file.name}
              className="max-h-[520px] w-auto max-w-full rounded-xl object-contain shadow-xs border border-slate-200 bg-white"
            />
          </div>
        ) : isVideo && file.url ? (
          <div className="w-full flex flex-col items-center justify-center">
            <video
              src={file.url}
              controls
              autoPlay
              className="w-full max-h-[480px] rounded-xl shadow-xs bg-black"
            />
          </div>
        ) : isPdf && file.url ? (
          <div className="w-full self-stretch overflow-auto rounded-lg border border-border/50 bg-white p-3">
            <PdfCanvas
              url={file.url}
              page={page}
              onNumPages={setNumPages}
              className="mx-auto max-w-[760px]"
            />
          </div>
        ) : (isDoc || isExcel) && isRemoteUrl(file.url) ? (
          <iframe
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}`}
            className="w-full h-full min-h-[500px] rounded-lg border border-border/50 bg-white"
            title={file.name}
          />
        ) : isRemoteUrl(file.url) && !isImage && !isVideo ? (
          <iframe
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(file.url)}&embedded=true`}
            className="w-full h-full min-h-[500px] rounded-lg border border-border/50 bg-white"
            title={file.name}
          />
        ) : (
          <div className="w-full max-w-[420px] bg-white rounded-xl shadow-xs border border-slate-200/80 p-8 text-slate-800 text-center font-sans flex flex-col items-center justify-center min-h-[340px] my-auto">
            <div className={cn(
              "h-16 w-16 rounded-2xl border flex items-center justify-center mb-4",
              isExcel
                ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                : isDoc
                  ? "bg-blue-50 border-blue-200 text-blue-600"
                  : isVideo
                    ? "bg-purple-50 border-purple-200 text-purple-600"
                    : isImage
                      ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                      : "bg-slate-100 border-slate-200/80 text-slate-500"
            )}>
              {isExcel ? (
                <FileSpreadsheet className="h-8 w-8" />
              ) : isDoc ? (
                <FileText className="h-8 w-8" />
              ) : isVideo ? (
                <Video className="h-8 w-8" />
              ) : isImage ? (
                <ImageIcon className="h-8 w-8" />
              ) : (
                <FileIcon className="h-8 w-8" />
              )}
            </div>
            <h2 className="text-[16px] font-bold text-slate-900 tracking-tight max-w-[320px] truncate">
              {file.name}
            </h2>
            <p className="text-[12px] font-medium text-slate-500 mt-1">
              {typeLabel[file.type] || "File"} {file.sizeLabel ? `· ${file.sizeLabel}` : ""}
            </p>
            <div className="mt-6 flex flex-col items-center gap-2.5">
              <button
                type="button"
                onClick={() => downloadFile(file)}
                className="inline-flex items-center gap-1.5 text-[12px] text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 font-semibold transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download {typeLabel[file.type] || "file"}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {(addedByName || addedLabel) && (
        <div className="px-5 py-3 text-[10.5px] text-[#434f80]">
          Added{addedByName ? ` by ${addedByName}` : ""}
          {addedLabel ? ` • ${addedLabel}` : ""}
        </div>
      )}
    </aside>
  );
}
