import { useEffect, useRef, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CourtDetailModal } from "@/features/court/CourtDetailModal";
import { useNotifications } from "@/features/notifications/use-notifications";
import { useThing } from "@/features/things/use-thing";

export const OPEN_ASSIGNED_THING_EVENT = "katalist:open-assigned-thing";

export function AssignedThingAlerts(): ReactElement | null {
  const { user } = useSession();
  const notifications = useNotifications();
  const [assignedThingId, setAssignedThingId] = useState<string | null>(null);
  const assignedThing = useThing(assignedThingId);
  const seenAssignmentsRef = useRef<{ userId: string; startedAt: number; ids: Set<string> } | null>(
    null,
  );

  // Identity guard: clear state when user changes or logs out
  useEffect(() => {
    setAssignedThingId(null);
    seenAssignmentsRef.current = null;
  }, [user?.id]);

  // Clean up any agent-opened PiP window on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "documentPictureInPicture" in window) {
      const dpip = (window as unknown as { documentPictureInPicture?: { window?: Window } }).documentPictureInPicture;
      if (dpip?.window) {
        try {
          dpip.window.close();
        } catch {
          // ignore error
        }
      }
    }
  }, []);

  // Fresh-assignment detection and alert dispatch
  useEffect(() => {
    if (!user?.id || notifications.isLoading) return;
    const assignments = notifications.items.filter(
      (item) => item.kind === "thing_assigned" && item.thingId,
    );
    const seen = seenAssignmentsRef.current;
    if (!seen || seen.userId !== user.id) {
      seenAssignmentsRef.current = {
        userId: user.id,
        startedAt: Date.now(),
        ids: new Set(assignments.map((item) => item.id)),
      };
      return;
    }
    const fresh = assignments.filter((item) => !seen.ids.has(item.id));
    assignments.forEach((item) => seen.ids.add(item.id));
    for (const item of fresh.reverse()) {
      if (Date.parse(item.createdAt) < seen.startedAt - 5_000 || !item.thingId) continue;
      const thingId = item.thingId;
      toast.info("New Thing assigned to you", {
        description: item.body || "Open your Court to review it.",
        action: {
          label: "Open Thing",
          onClick: () =>
            window.dispatchEvent(
              new CustomEvent(OPEN_ASSIGNED_THING_EVENT, {
                detail: { thingId, notificationId: item.id },
              }),
            ),
        },
      });
    }
  }, [notifications.isLoading, notifications.items, user?.id]);

  // Open handler for assigned Thing
  useEffect(() => {
    const handleOpenAssignedThing = (event: Event) => {
      const detail = (event as CustomEvent<{ thingId?: string; notificationId?: string }>).detail;
      if (!detail?.thingId || !user?.id) return;
      setAssignedThingId(detail.thingId);
      if (detail.notificationId) {
        notifications.markOne.mutate([detail.notificationId]);
      }
    };
    window.addEventListener(OPEN_ASSIGNED_THING_EVENT, handleOpenAssignedThing);
    return () => window.removeEventListener(OPEN_ASSIGNED_THING_EVENT, handleOpenAssignedThing);
  }, [notifications.markOne, user?.id]);

  return (
    <>
      <Dialog
        open={Boolean(assignedThingId && !assignedThing.thing)}
        onOpenChange={(open) => {
          if (!open) setAssignedThingId(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto rounded-2xl p-5 sm:p-7">
          <DialogTitle className="sr-only">Assigned Thing details</DialogTitle>
          <DialogDescription className="sr-only">
            Review the Thing assigned to you.
          </DialogDescription>
          {assignedThing.isLoading ? (
            <p role="status" className="py-10 text-center text-sm text-muted-foreground">
              Loading Thing…
            </p>
          ) : (
            <div className="py-8 text-center">
              <p>This Thing is no longer available or couldn't be loaded.</p>
              <button
                type="button"
                className="mt-3 rounded-lg bg-[#e9defb] px-3 py-2 text-xs font-semibold text-[#6541ad]"
                onClick={() => void assignedThing.refetch()}
              >
                Try again
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <CourtDetailModal
        thing={assignedThing.thing}
        isOpen={Boolean(assignedThingId && assignedThing.thing)}
        onClose={() => setAssignedThingId(null)}
      />
    </>
  );
}
