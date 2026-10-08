import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, ExternalLink, Maximize2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { KIND_LABELS } from "./design-library-model";
import { deriveDesignEmbed, type DesignResource } from "./records";

/** How long to wait before offering the external-open fallback prominently. */
export const VIEWER_SLOW_AFTER_MS = 12_000;

const actionButton =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#eaeffa] bg-white px-3 text-[13.5px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-60";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Official Figma embed for one selected design. Only the selected design is mounted.
 * The iframe source is always derived from the stored link by the validated URL contract.
 * Katalist cannot see inside the iframe: a `load` event does not mean the design is
 * accessible, so nothing here claims success; Figma shows its own access messages.
 */
export function DesignViewer({
  resource,
  onClose,
  slowAfterMs = VIEWER_SLOW_AFTER_MS,
  children,
}: {
  resource: DesignResource;
  onClose: () => void;
  slowAfterMs?: number;
  /** Extra panels below the viewer, such as linked Things. */
  children?: ReactNode;
}) {
  const embed = deriveDesignEmbed(resource);
  const frameRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);

  // A new design or a manual retry restarts the slow-load timer.
  useEffect(() => {
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(timer);
  }, [resource.id, attempt, slowAfterMs]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [resource.id]);

  const supportsFullscreen = typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function";
  const target = embed.ok ? embed.value : null;

  const copyLink = async () => {
    if (!target) return;
    if (await copyText(target.normalizedUrl)) toast.success("Link copied.");
    else toast.error("Could not copy. Use Open in Figma and copy the address from there.");
  };

  const fullscreen = async () => {
    try {
      await frameRef.current?.requestFullscreen();
    } catch {
      toast.error("Fullscreen is not available here. Use Open in Figma instead.");
    }
  };

  return (
    <section aria-label={`Viewer: ${resource.title}`} data-testid="design-viewer" className="rounded-[10px] border border-[#eaeffa] bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 ref={headingRef} tabIndex={-1} className="break-words text-[15px] font-semibold text-[#000533] outline-none">
            {resource.title}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-[#6a769c]">
            <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 font-medium text-[#475467]">View only</span>
            <span>{KIND_LABELS[resource.kind]}</span>
            <span>Edits happen in Figma.</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {target && (
            <a
              href={target.normalizedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={actionButton}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Figma
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <button type="button" onClick={() => void copyLink()} disabled={!target} className={actionButton}>
            <Copy className="h-4 w-4" aria-hidden="true" /> Copy link
          </button>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} disabled={!target} className={actionButton}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
          {supportsFullscreen && (
            <button type="button" onClick={() => void fullscreen()} disabled={!target} className={actionButton}>
              <Maximize2 className="h-4 w-4" aria-hidden="true" /> Fullscreen
            </button>
          )}
          <button type="button" onClick={onClose} className={actionButton}>
            <X className="h-4 w-4" aria-hidden="true" /> Close viewer
          </button>
        </div>
      </div>

      {target ? (
        <>
          <div ref={frameRef} className="mt-3 overflow-hidden rounded-lg border border-[#eaeffa] bg-[#f4f5fb]">
            <iframe
              key={`${resource.id}:${attempt}`}
              title={`Figma ${KIND_LABELS[resource.kind].toLowerCase()}: ${resource.title}`}
              src={target.embedUrl}
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="block h-[70dvh] min-h-[360px] w-full border-0"
            />
          </div>
          <div className="mt-2 space-y-1 text-[12.5px] text-[#6a769c]" aria-live="polite">
            <p>
              Figma controls access to this design. If you see a Figma sign-in or access message, or the viewer stays blank,
              use Open in Figma.
            </p>
            {!target.embedHonorsVersion && target.versionId && (
              <p>This link names a specific version, but the viewer may show the latest. Open in Figma shows the exact version.</p>
            )}
            {slow && (
              <p role="status" className="rounded-lg bg-[#fffaeb] px-3 py-2 text-[#93370d]" data-testid="viewer-slow">
                The viewer is taking a while, and Katalist cannot tell why. Try Retry, or open the design in Figma.
              </p>
            )}
          </div>
        </>
      ) : (
        <div role="alert" className="mt-3 rounded-lg border border-[#f4c7c3] bg-[#fef3f2] px-3 py-2 text-[13px] text-[#912018]">
          This saved link is not a valid Figma link, so it was not loaded. Edit the design to fix its link.
        </div>
      )}
      {children}
    </section>
  );
}
