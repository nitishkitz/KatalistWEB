import { useEffect, useId, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describeWriteError } from "./design-library-model";
import type { DesignOperationError } from "./design-queries";
import type { DesignFolder } from "./records";

const buttonClass =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-[9px] px-4 text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-60";

/** Create or rename a folder. The typed name survives a failed save. */
export function FolderNameDialog({
  open,
  folder,
  submitting,
  serverError,
  onSubmit,
  onClose,
  onCloseAutoFocus,
}: {
  open: boolean;
  /** Present when renaming. */
  folder: DesignFolder | null;
  submitting: boolean;
  serverError: DesignOperationError | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
  onCloseAutoFocus: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(folder?.name ?? "");
      setLocalError(null);
    }
  }, [open, folder]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) return setLocalError("Enter a folder name.");
    if (trimmed.length > 80) return setLocalError("Keep the name under 80 characters.");
    setLocalError(null);
    onSubmit(trimmed);
  };
  const error = localError ?? (serverError ? describeWriteError(serverError) : null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-sm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{folder ? "Rename folder" : "New folder"}</DialogTitle>
          <DialogDescription>Folders group designs in this List. They are one level deep.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3">
          <div>
            <label htmlFor={id} className="text-[12.5px] font-medium text-[#4a5578]">Folder name</label>
            <input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              className="mt-1 h-10 w-full rounded-lg border border-[#dfe3f0] bg-white px-3 text-[14px] text-[#000533] outline-none focus:border-[#975ee2] focus-visible:ring-2 focus-visible:ring-[#975ee2]/40 aria-[invalid=true]:border-[#d92d20]"
            />
            {error && <p id={`${id}-error`} role="alert" className="mt-1 text-[12px] text-[#b42318]">{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button type="button" onClick={onClose} className={`${buttonClass} border border-[#eaeffa] bg-white text-[#1d1d1d] hover:bg-[#fafaff]`}>
              Cancel
            </button>
            <button type="submit" disabled={submitting} className={`${buttonClass} bg-[#975ee2] text-white hover:bg-[#8650d1]`}>
              {submitting ? "Saving…" : folder ? "Rename" : "Create folder"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFolderDialog({
  folder,
  submitting,
  serverError,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  folder: DesignFolder | null;
  submitting: boolean;
  serverError: DesignOperationError | null;
  onConfirm: () => void;
  onClose: () => void;
  onCloseAutoFocus: () => void;
}) {
  return (
    <AlertDialog open={folder !== null} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete folder “{folder?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The designs in this folder are not deleted. They move to Unfiled.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {serverError && <p role="alert" className="text-[12.5px] text-[#b42318]">{describeWriteError(serverError)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {submitting ? "Deleting…" : "Delete folder"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
