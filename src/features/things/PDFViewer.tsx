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
  Loader2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThingFile, ThingFileType } from "@/domain/thing";
import { downloadFile } from "@/lib/file-utils";
import { resignThingAttachmentUrl } from "./attachments";
import { PdfCanvas, type PdfErrorKind } from "./PdfCanvas";

export type { ThingFile, ThingFileType };

/** Office Online can only fetch publicly reachable http(s) URLs, not blob:/data:. */
function isRemoteUrl(url?: string): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * H04: every URL this app ever hands to a third-party viewer comes from
 * this app's own Supabase Storage signing -- a signed (private) URL's path
 * contains `/object/sign/`, a durably public bucket's contains
 * `/object/public/`. Default to treating anything else (unrecognized
 * shape) as private too -- explicit proof of public-ness is required to
 * ever send a URL to an external embed, not the other way around.
 */
function isPrivateFileUrl(url: string): boolean {
  return !url.includes("/object/public/");
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
  // H03: per-file so a rapid switch between files never shows one file's
  // download/PDF-error state on a different, currently-selected file.
  const [downloadState, setDownloadState] = useState<{ fileId: string; status: "pending" | "failed" } | null>(null);
  const [pdfError, setPdfError] = useState<{ fileId: string; kind: PdfErrorKind } | null>(null);
  const [resignedUrl, setResignedUrl] = useState<{ fileId: string; url: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [resignAttempted, setResignAttempted] = useState(false);

  // Reset paging AND any stale download/error/resign state when the
  // previewed file changes -- H03's "preserve file ownership when
  // selection changes" applies to this transient state too, not only page.
  useEffect(() => {
    setPage(1);
    setNumPages(1);
    setDownloadState(null);
    setPdfError(null);
    setResignedUrl(null);
    setResignAttempted(false);
  }, [file.id]);

  async function handleDownload() {
    setDownloadState({ fileId: file.id, status: "pending" });
    try {
      await downloadFile(file);
      setDownloadState(null);
    } catch {
      setDownloadState({ fileId: file.id, status: "failed" });
    }
  }

  async function handlePdfError(kind: PdfErrorKind) {
    // H03: exactly one resign-and-retry attempt for a URL that pdf.js
    // rejected as unsupported/expired -- a fresh sign goes through the
    // same RLS-scoped path as the original load, so a genuine access
    // denial fails again and correctly stays denied instead of looping.
    if (kind === "unsupported" && file.storageKey && !resignAttempted) {
      setResignAttempted(true);
      try {
        const fresh = await resignThingAttachmentUrl(file.storageKey);
        if (fresh) {
          setResignedUrl({ fileId: file.id, url: fresh });
          return;
        }
      } catch {
        // fall through to showing the classified error below
      }
    }
    setPdfError({ fileId: file.id, kind });
  }

  const effectivePdfUrl = resignedUrl?.fileId === file.id ? resignedUrl.url : file.url;
  const currentDownloadState = downloadState?.fileId === file.id ? downloadState.status : null;
  const currentPdfError = pdfError?.fileId === file.id ? pdfError.kind : null;

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
          <p className="mt-0.5 text-[12px] text-[#434f80]">
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
          onClick={() => void handleDownload()}
          disabled={currentDownloadState === "pending"}
          className={cn(
            "inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed",
            currentDownloadState === "failed" ? "text-destructive hover:text-destructive/80" : "text-[#434f80] hover:text-[#000533]",
          )}
        >
          {currentDownloadState === "pending" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : currentDownloadState === "failed" ? (
            <RotateCcw className="h-3.5 w-3.5" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <span>
            {currentDownloadState === "pending"
              ? "Downloading…"
              : currentDownloadState === "failed"
                ? "Download failed — retry"
                : "Download"}
          </span>
        </button>

        {isPdf ? (
          <div className="flex items-center gap-2.5 text-[12px] text-[#434f80]">
            <span className="font-medium">{page} / {totalPages}</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                // D01/T08: a real 32px desktop hit target (icon artwork
                // stays h-3.5 w-3.5) -- was h-6 w-6 (24px), below the
                // desktop minimum, with no accessible name.
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-[#eceef5] disabled:opacity-30 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-[#eceef5] disabled:opacity-30 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="max-h-[520px] w-auto max-w-full rounded-xl object-contain border border-slate-200 bg-white"
            />
          </div>
        ) : isVideo && file.url ? (
          <div className="w-full flex flex-col items-center justify-center">
            <video
              src={file.url}
              controls
              autoPlay
              className="w-full max-h-[480px] rounded-xl bg-black"
            />
          </div>
        ) : isPdf && file.url && currentPdfError === "denied" ? (
          <div className="flex min-h-[200px] w-full max-w-[420px] flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-[13px] font-medium text-destructive">You don't have access to preview this file.</p>
            <p className="text-[12px] text-muted-foreground">This stays denied — a refreshed link won't change that.</p>
          </div>
        ) : isPdf && file.url && currentPdfError === "unsupported" ? (
          <div className="flex min-h-[200px] w-full max-w-[420px] flex-col items-center justify-center gap-2 rounded-lg border border-border/50 bg-white p-6 text-center">
            <p className="text-[13px] font-medium text-foreground">This file can't be previewed here.</p>
            <p className="text-[12px] text-muted-foreground">Use Download to open it in another app.</p>
          </div>
        ) : isPdf && file.url && currentPdfError === "network" ? (
          <div className="flex min-h-[200px] w-full max-w-[420px] flex-col items-center justify-center gap-3 rounded-lg border border-border/50 bg-white p-6 text-center">
            <p className="text-[13px] font-medium text-foreground">Couldn't load this PDF.</p>
            <p className="text-[12px] text-muted-foreground">Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => {
                setPdfError(null);
                setRetryNonce((n) => n + 1);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        ) : isPdf && file.url ? (
          <div className="w-full self-stretch overflow-auto rounded-lg border border-border/50 bg-white p-3">
            <PdfCanvas
              url={effectivePdfUrl ?? file.url}
              page={page}
              onNumPages={setNumPages}
              onError={(kind) => void handlePdfError(kind)}
              retryNonce={retryNonce}
              className="mx-auto max-w-[760px]"
            />
          </div>
        ) : (isDoc || isExcel) && isRemoteUrl(file.url) && !isPrivateFileUrl(file.url) ? (
          <iframe
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}`}
            className="w-full h-full min-h-[500px] rounded-lg border border-border/50 bg-white"
            title={file.name}
          />
        ) : isRemoteUrl(file.url) && !isImage && !isVideo && !isPrivateFileUrl(file.url) ? (
          <iframe
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(file.url)}&embedded=true`}
            className="w-full h-full min-h-[500px] rounded-lg border border-border/50 bg-white"
            title={file.name}
          />
        ) : (
          <div className="w-full max-w-[420px] bg-white rounded-xl border border-slate-200/80 p-8 text-slate-800 text-center font-sans flex flex-col items-center justify-center min-h-[340px] my-auto">
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
                onClick={() => void handleDownload()}
                disabled={currentDownloadState === "pending"}
                className="inline-flex items-center gap-1.5 text-[12px] text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              >
                {currentDownloadState === "pending" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>
                  {currentDownloadState === "pending"
                    ? "Downloading…"
                    : currentDownloadState === "failed"
                      ? "Download failed — retry"
                      : `Download ${typeLabel[file.type] || "file"}`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {(addedByName || addedLabel) && (
        <div className="px-5 py-3 text-[12px] text-[#434f80]">
          Added{addedByName ? ` by ${addedByName}` : ""}
          {addedLabel ? ` • ${addedLabel}` : ""}
        </div>
      )}
    </aside>
  );
}
