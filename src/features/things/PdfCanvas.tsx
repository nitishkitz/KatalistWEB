import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { cn } from "@/lib/utils";

/**
 * Canvas-based PDF renderer (pdf.js). Unlike an <iframe>/<embed> to the file
 * URL — which depends on the browser's native PDF plugin and is frequently
 * blocked inside sandboxed/partitioned iframes or when the object is served
 * with the wrong content-type — this renders the page to a <canvas> in pure JS,
 * so a PDF is always visible. Used both for the full preview (paged) and for
 * small first-page thumbnails on cards.
 */
export type PdfErrorKind = "unsupported" | "denied" | "network";

type PdfCanvasProps = {
  url: string;
  page?: number;
  className?: string;
  /** Called once the document is parsed, with the real page count. */
  onNumPages?: (numPages: number) => void;
  /** Called on load/render failure with a best-effort classification. */
  onError?: (kind: PdfErrorKind) => void;
  /** Bump to force a reload attempt of the SAME `url` (e.g. a manual retry
   *  after a network failure) -- a freshly re-signed URL differs and
   *  already reloads via the `url` dependency, so this is only needed for
   *  "try the exact same request again". */
  retryNonce?: number;
};

/** Best-effort classification of a pdf.js failure. pdf.js's own exception
 *  names/status are the only signal available client-side -- there is no
 *  richer contract to rely on. */
function classifyPdfError(err: unknown): PdfErrorKind {
  if (err && typeof err === "object") {
    const name = "name" in err ? String((err as { name?: unknown }).name) : "";
    if (name === "InvalidPDFException" || name === "MissingPDFException") return "unsupported";
    const status = "status" in err ? Number((err as { status?: unknown }).status) : NaN;
    if (status === 401 || status === 403) return "denied";
    if (status >= 400 && status < 500) return "unsupported";
  }
  return "network";
}

export function PdfCanvas({ url, page = 1, className, onNumPages, onError, retryNonce }: PdfCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // H02: a boolean `cancelled` flag can't distinguish "this exact load
  // request" from "a later one" -- only "still current or not". Separate
  // monotonic generations for the document load and for each page render
  // let a late continuation recognize precisely which request it belongs
  // to, checked after every await, not just once at the top.
  const docGenRef = useRef(0);
  const renderGenRef = useRef(0);
  // The load effect's own closure captures `page` at the time it started;
  // a page change that arrives while the document is still loading must
  // still be honored once the document resolves, not the stale value.
  const pageRef = useRef(page);
  pageRef.current = page;

  // Load the document whenever the URL changes (or a manual retry is requested).
  useEffect(() => {
    const myDocGen = ++docGenRef.current;
    setStatus("loading");
    docRef.current = null;

    let task: PDFDocumentLoadingTask | null = null;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (docGenRef.current !== myDocGen) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        // Created (and retained) before awaiting `.promise` so cleanup can
        // `.destroy()` an in-flight load, not only an already-resolved one.
        task = pdfjs.getDocument({ url });
        loadingTaskRef.current = task;
        const doc = await task.promise;
        if (docGenRef.current !== myDocGen) {
          doc.destroy?.();
          return;
        }
        docRef.current = doc;
        onNumPages?.(doc.numPages);
        await renderPage(pageRef.current, myDocGen);
      } catch (err) {
        if (docGenRef.current !== myDocGen) return;
        setStatus("error");
        onError?.(classifyPdfError(err));
      }
    })();

    return () => {
      docGenRef.current += 1;
      renderTaskRef.current?.cancel?.();
      // Destroys whether still loading or already resolved -- safe either
      // way, and this is the only handle that can actually abort an
      // in-flight fetch/worker task before it resolves.
      loadingTaskRef.current?.destroy?.();
      loadingTaskRef.current = null;
      docRef.current?.destroy?.();
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, retryNonce]);

  // Re-render when the requested page changes (document already loaded).
  useEffect(() => {
    if (docRef.current) void renderPage(page, docGenRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function renderPage(pageNum: number, ownerDocGen: number) {
    const myRenderGen = ++renderGenRef.current;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container) return;
    try {
      renderTaskRef.current?.cancel?.();
      const clamped = Math.min(Math.max(1, pageNum), doc.numPages);
      const pdfPage = await doc.getPage(clamped);
      // H02: after this await, a newer render (a later page flip, or a
      // whole new document load superseding this one) may already own
      // the canvas -- painting here would draw the wrong content into it.
      if (docGenRef.current !== ownerDocGen || renderGenRef.current !== myRenderGen) return;
      if (docRef.current !== doc || canvasRef.current !== canvas) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const containerWidth = container.clientWidth || 400;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const scale = (containerWidth / base.width) * dpr;
      const viewport = pdfPage.getViewport({ scale });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      const task = pdfPage.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      if (docGenRef.current !== ownerDocGen || renderGenRef.current !== myRenderGen) return;
      setStatus("ready");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "RenderingCancelledException") return;
      if (docGenRef.current !== ownerDocGen || renderGenRef.current !== myRenderGen) return;
      setStatus("error");
      onError?.(classifyPdfError(err));
    }
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <canvas
        ref={canvasRef}
        className={cn("block w-full rounded-md", status === "ready" ? "" : "invisible")}
      />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      )}
      {status === "error" && (
        <div className="flex h-full min-h-[120px] w-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
          Preview unavailable. Use Download to open this file.
        </div>
      )}
    </div>
  );
}
