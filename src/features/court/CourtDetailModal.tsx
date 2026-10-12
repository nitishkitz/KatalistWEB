import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { format } from "date-fns";
import type { Thing } from "@/domain/thing";
import { PDFViewer, type ThingFile } from "@/features/things/PDFViewer";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { useThing } from "@/features/things/use-thing";
import type { CourtLaneId } from "./court-view-model";

type CourtDetailModalProps = {
  thing: Thing | null;
  lane?: CourtLaneId | "theirs";
  isOpen: boolean;
  onClose: () => void;
  onOpenFullView?: () => void;
  onRefresh?: (epoch: number) => void;
};

export function CourtDetailModal({ thing, isOpen, onClose }: CourtDetailModalProps) {
  const detail = useThing(isOpen ? thing?.id ?? null : null);
  const detailFiles = detail.thing?.detailLevel === "overview" ? undefined : detail.thing?.files;
  const [selectedFile, setSelectedFile] = useState<ThingFile | null>(null);
  useEffect(() => {
    setSelectedFile((current) => {
      if (!detailFiles?.length) return null;
      return current && detailFiles.some((file) => file.id === current.id) ? current : detailFiles[0];
    });
  }, [thing?.id, detailFiles]);

  if (!isOpen || !thing) return null;
  const hasFiles = (thing.attachmentCount ?? 0) > 0 || (detailFiles?.length ?? 0) > 0 || (thing.files?.length ?? 0) > 0;
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-xs motion-safe:animate-in motion-safe:fade-in duration-150" />
        <DialogPrimitive.Content aria-label={thing.title} aria-describedby={undefined} className={`fixed left-1/2 top-1/2 z-[71] flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/80 bg-white katalist-elevation-dialog outline-none motion-safe:animate-in motion-safe:fade-in duration-150 md:w-[calc(100%-4rem)] ${hasFiles ? "h-[88vh] max-h-[900px] max-w-7xl" : "max-h-[88vh] max-w-3xl"}`}>
          <DialogPrimitive.Title className="sr-only">{thing.title}</DialogPrimitive.Title>
          <DialogPrimitive.Close aria-label="Close dialog" className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f6fa] text-[#5f5f90] hover:bg-[#eceef5] hover:text-[#000533] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white md:flex-row">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[#fefdfd] px-4 py-6 md:px-8">
              <ThingDetailContent initialThing={thing} variant="court" onFileSelect={setSelectedFile} onAfterTerminalAction={onClose} />
            </div>
            {selectedFile && <PDFViewer file={selectedFile} addedByName={thing.creator.name} addedLabel={thing.updatedAt ? format(new Date(thing.updatedAt), "MMM d, h:mm a") : undefined} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
