import { usePushNotifications } from "@/features/notifications/use-push-notifications";

export function PushNotificationControl() {
  const { state, enable, disable } = usePushNotifications();

  if (state.kind === "unavailable") {
    return <p className="mt-4 text-[13px] text-muted-foreground">Notification setup is unavailable</p>;
  }
  if (state.kind === "unsupported") {
    return <p className="mt-4 text-[13px] text-muted-foreground">Browser notifications aren’t supported here</p>;
  }
  if (state.kind === "denied") {
    return <p className="mt-4 text-[13px] text-muted-foreground">Notifications are blocked in this browser</p>;
  }
  if (state.kind === "enabled") {
    return (
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-foreground">Browser notifications enabled</p>
        <button type="button" className="text-[13px] text-primary" onClick={() => void disable()}>
          Disable
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="mt-4 rounded-lg border border-border px-3 py-2 text-[13px] text-foreground hover:bg-muted"
      onClick={() => void enable()}
    >
      Enable browser notifications
    </button>
  );
}
