import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { cn } from "@/lib/utils";

/**
 * Canvas-based PDF renderer (pdf.js). Unlike an <iframe>/<embed> to the file
 * URL — which depends on the browser's native PDF plugin and is frequently
 * blocked inside sandboxed/partitioned iframes or when the object is served
 * with the wrong content-type — this renders the page to a <canvas> in pure JS,
 * so a PDF is always visible. Used both for the full preview (paged) and for
 * small first-page thumbnails on cards.
 */
type PdfCanvasProps = {
  url: string;
  page?: number;
  className?: string;
  /** Called once the document is parsed, with the real page count. */
  onNumPages?: (numPages: number) => void;
};

export function PdfCanvas({ url, page = 1, className, onNumPages }: PdfCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Load the document whenever the URL changes.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    docRef.current = null;

    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          doc.destroy?.();
          return;
        }
        docRef.current = doc;
        onNumPages?.(doc.numPages);
        await renderPage(page);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
      docRef.current?.destroy?.();
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Re-render when the requested page changes.
  useEffect(() => {
    if (docRef.current) void renderPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function renderPage(pageNum: number) {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container) return;
    try {
      renderTaskRef.current?.cancel?.();
      const clamped = Math.min(Math.max(1, pageNum), doc.numPages);
      const pdfPage = await doc.getPage(clamped);
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
      setStatus("ready");
    } catch (err: any) {
      if (err?.name === "RenderingCancelledException") return;
      setStatus("error");
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
        <div className="flex h-full min-h-[120px] w-full items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
          Preview unavailable. Use Download to open this file.
        </div>
      )}
    </div>
  );
}
