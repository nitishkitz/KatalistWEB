import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Thing } from "@/domain/thing";
import { CatchUpStack } from "./CatchUpStack";
import type { CatchUpMoment } from "./use-catchup";

type Props = {
  open: boolean;
  onClose: () => void;
  moments: CatchUpMoment[];
  myActorId: string | null;
  surfaceMoment: (momentKey: string) => void;
  onOpenThing: (thing: Thing) => void;
  onRefresh: () => void;
};

export function CatchUpOverlay({
  open,
  onClose,
  moments,
  myActorId,
  surfaceMoment,
  onOpenThing,
  onRefresh,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-xl gap-5 rounded-2xl border-none bg-slate-50 p-6">
        <div className="pr-6">
          <DialogTitle className="text-[20px] font-bold text-slate-900">Catch Up</DialogTitle>
          <DialogDescription className="text-[12.5px] text-slate-500">
            {moments.length} {moments.length === 1 ? "moment needs" : "moments need"} you
          </DialogDescription>
        </div>
        {open && moments.length > 0 ? (
          <CatchUpStack
            moments={moments}
            myActorId={myActorId}
            surfaceMoment={surfaceMoment}
            onOpenThing={onOpenThing}
            onClose={onClose}
            onRefresh={onRefresh}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
