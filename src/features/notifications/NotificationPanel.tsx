import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "./use-notifications";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { items, unread, markAll, markOne } = useNotifications();

  return (
    <div className="relative">
      <button
        type="button"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Notifications"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && unread) void markAll.mutate();
        }}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[320px] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-3 py-2 text-[12px] font-semibold">Movement</div>
          <ul className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-3 py-4 text-[12px] text-muted-foreground">You’re caught up.</li>
            ) : (
              items.map((n) => (
                <li
                  key={n.id}
                  className={cn("cursor-pointer border-b border-border/70 px-3 py-2.5", !n.read && "bg-muted/40")}
                  onClick={() => {
                    void (async () => {
                      if (!n.read) await markOne.mutateAsync(n.id);
                      setOpen(false);
                      const path = n.path || "/";
                      if (path.startsWith("/lists/")) {
                        await navigate({ to: "/lists/$listId", params: { listId: path.slice("/lists/".length) } });
                        return;
                      }
                      if (path === "/team") {
                        await navigate({ to: "/team" });
                        return;
                      }
                      const thingMatch = /^\?thing=/.test(path.slice(1)) || path.startsWith("/?thing=");
                      if (thingMatch) {
                        const thing = path.replace(/^\/\?thing=/, "");
                        await navigate({ to: "/", search: { thing } });
                        return;
                      }
                      await navigate({ to: "/" });
                    })();
                  }}
                >
                  <p className="text-[12.5px] font-medium">{n.title}</p>
                  <p className="text-[12px] text-muted-foreground">{n.body}</p>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
