import { useState } from "react";
import { Bell } from "lucide-react";
import { getNotifications, markNotificationsRead, useLocalVersion } from "@/features/things/local-state";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  useLocalVersion();
  const [open, setOpen] = useState(false);
  const items = getNotifications();
  const unread = items.some((n) => !n.read);

  return (
    <div className="relative">
      <button
        type="button"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Notifications"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markNotificationsRead();
        }}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[320px] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-3 py-2 text-[12px] font-semibold">Movement</div>
          <ul className="max-h-80 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className={cn("border-b border-border/70 px-3 py-2.5", !n.read && "bg-muted/40")}>
                <p className="text-[12.5px] font-medium">{n.title}</p>
                <p className="text-[12px] text-muted-foreground">{n.body}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
