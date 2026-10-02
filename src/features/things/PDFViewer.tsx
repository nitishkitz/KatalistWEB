import { useEffect, useRef, useState } from "react";
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

function DocxPreview({ file }: { file: ThingFile }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !file.url) return;
    const controller = new AbortController();
    let cancelled = false;
    host.replaceChildren();
    setStatus("loading");
    setPage(1);
    setPageCount(1);

    const releaseDocumentUrls = () => {
      host.querySelectorAll<HTMLElement>("*").forEach((element) => {
        for (const value of [element.getAttribute("src"), element.getAttribute("href")]) {
          if (value?.startsWith("blob:")) URL.revokeObjectURL(value);
        }
      });
      host.replaceChildren();
    };

    const load = async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        let response = await fetch(file.url!, { signal: controller.signal });
        if (!response.ok && file.storageKey) {
          const refreshedUrl = await resignThingAttachmentUrl(file.storageKey);
          if (refreshedUrl) response = await fetch(refreshedUrl, { signal: controller.signal });
        }
        if (!response.ok) throw new Error("The document could not be loaded.");
        const bytes = await response.arrayBuffer();
        if (cancelled) return;

        const styles = document.createElement("div");
        const body = document.createElement("div");
        body.className = "docx-preview-body";
        host.append(styles, body);
        await renderAsync(bytes, body, styles, {
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderAltChunks: false,
          renderChanges: false,
          renderComments: false,
          useBase64URL: true,
        });
        if (!cancelled) {
          setPageCount(Math.max(1, body.querySelectorAll("section.docx").length));
          setStatus("ready");
        }
        else releaseDocumentUrls();
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        releaseDocumentUrls();
        setStatus("error");
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      releaseDocumentUrls();
    };
  }, [file.id, file.storageKey, file.url, retry]);

  // Render Word's page boxes at their authored dimensions, then scale the
  // page to the available preview width. Keep only the selected page mounted
  // in the viewport so page navigation behaves like a document viewer.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "ready") return;
    const pages = Array.from(host.querySelectorAll<HTMLElement>("section.docx"));
    const wrapper = host.querySelector<HTMLElement>(".docx-wrapper");
    if (!pages.length || !wrapper) return;

    pages.forEach((pageElement, index) => {
      pageElement.style.display = index + 1 === page ? "flex" : "none";
    });
    const fitPage = () => {
      const selectedPage = pages[page - 1];
      if (!selectedPage) return;
      wrapper.style.zoom = "1";
      const naturalWidth = selectedPage.getBoundingClientRect().width;
      const availableWidth = Math.max(1, host.clientWidth - 24);
      wrapper.style.zoom = String(Math.min(1, availableWidth / naturalWidth));
    };
    fitPage();
    const observer = new ResizeObserver(fitPage);
    observer.observe(host);
    return () => observer.disconnect();
  }, [page, pageCount, status]);

  return (
    <div className="flex h-full w-full min-h-[340px] flex-col overflow-hidden bg-transparent">
      <div className="mb-1 flex shrink-0 items-center justify-center gap-2 text-[12px] text-slate-600" aria-label="Word document page controls">
        <button type="button" aria-label="Previous page" disabled={page <= 1 || status !== "ready"} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md bg-white/70 p-1 disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Page number</span>
          <input type="number" min={1} max={pageCount} value={page} disabled={status !== "ready"} onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) setPage(Math.min(pageCount, Math.max(1, value)));
          }} className="h-7 w-12 rounded-md bg-white/70 text-center tabular-nums outline-none focus:ring-1 focus:ring-violet-300" />
          <span>of {pageCount}</span>
        </label>
        <button type="button" aria-label="Next page" disabled={page >= pageCount || status !== "ready"} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded-md bg-white/70 p-1 disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {status === "loading" ? (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-[13px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Word document…
        </div>
      ) : null}
      {status === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p role="alert" className="text-[13px] text-slate-600">Couldn’t preview this Word document.</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50">
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={cn(
          "docx-preview-host min-h-0 min-w-0 flex-1 overflow-auto [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0 [&_.docx]:!m-0 [&_.docx]:!max-w-none [&_.docx]:!shadow-none",
          status !== "ready" && "hidden",
        )}
      />
    </div>
  );
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
  const isDocx = isDoc && (
    file.name.toLowerCase().endsWith(".docx") ||
    file.mimeType?.toLowerCase().includes("wordprocessingml") === true
  );

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
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={!file.url || currentDownloadState === "pending"}
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
          {file.url && (
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#ebedf3] bg-white text-[#5f5f90] hover:text-[#000533] transition-colors"
              aria-label="Open file in new tab"
              title="Open file in new tab"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

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
        {!file.url && file.urlError ? (
          <div className="flex min-h-[200px] w-full max-w-[420px] flex-col items-center justify-center rounded-lg border border-border/50 bg-white p-6 text-center">
            <p className="text-[13px] font-medium text-foreground">Preview unavailable</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{file.urlError}</p>
          </div>
        ) : isImage && file.url ? (
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
        ) : isDocx && file.url ? (
          <DocxPreview key={file.id} file={file} />
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
