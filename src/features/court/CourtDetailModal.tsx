import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { format } from "date-fns";
import type { Thing } from "@/domain/thing";
import { PDFViewer, type ThingFile } from "@/features/things/PDFViewer";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { markThingAsRead } from "@/features/things/read-state";
import type { CourtLaneId } from "./court-view-model";

type CourtDetailModalProps = {
  thing: Thing | null;
  lane: CourtLaneId | "theirs";
  isOpen: boolean;
  onClose: () => void;
  onOpenFullView: () => void;
  onRefresh?: () => void;
};

export function CourtDetailModal({
  thing,
  isOpen,
  onClose,
  onOpenFullView,
}: CourtDetailModalProps) {
  const [selectedFile, setSelectedFile] = useState<ThingFile | null>(() => {
    return thing?.files?.[0] ?? null;
  });

  useEffect(() => {
    if (thing?.files && thing.files.length > 0) {
      if (!selectedFile || !thing.files.some((f) => f.id === selectedFile.id)) {
        setSelectedFile(thing.files[0]);
      }
    } else {
      setSelectedFile(null);
    }
  }, [thing?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && thing?.id) {
      markThingAsRead(thing.id);
    }
  }, [isOpen, thing?.id]);

  if (!isOpen || !thing) return null;

  const hasFiles = Boolean(thing.files && thing.files.length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={thing.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 md:p-8 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`relative flex w-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-white shadow-2xl animate-in zoom-in-98 duration-150 ${
          hasFiles
            ? "h-[88vh] max-h-[900px] max-w-7xl"
            : "max-h-[88vh] max-w-3xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-[#f5f6fa] text-[#5f5f90] hover:bg-[#eceef5] hover:text-[#000533] transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Modal Body: Left Detail Content + Right PDFViewer (if files attached) */}
        <div className="flex flex-1 min-h-0 flex-row overflow-hidden bg-white">
          <div className="flex-1 min-w-[360px] min-h-0 overflow-y-auto bg-[#fefdfd] px-8 py-6">
            {/* No max-width cap here — a long title/description uses the full
                left pane (itself widened above), not a fixed column, regardless
                of browser window width. */}
            <div className="w-full">
              <ThingDetailContent
                initialThing={thing}
                variant="court"
                onFileSelect={(file) => setSelectedFile(file)}
                onAfterTerminalAction={onClose}
              />
            </div>
          </div>

          {selectedFile && (
            <PDFViewer
              file={selectedFile}
              addedByName={thing.creator.name}
              addedLabel={thing.updatedAt ? format(new Date(thing.updatedAt), "MMM d, h:mm a") : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
