import { useState } from "react";
import { Laptop, LoaderCircle, LogOut, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatLastUsed, parseUserAgent } from "./device-utils";
import { useLoggedInDevices, type LoggedInDeviceSession } from "./use-logged-in-devices";

function DeviceIcon({ kind }: { kind: "phone" | "computer" }) {
  const Icon = kind === "phone" ? Smartphone : Laptop;
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f3ebfe] text-[#8050d8]">
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </span>
  );
}

function DeviceRow({
  session,
  pending,
  onConfirm,
}: {
  session: LoggedInDeviceSession;
  pending: boolean;
  onConfirm: () => void;
}) {
  const device = parseUserAgent(session.user_agent);
  return (
    <div className="flex items-center gap-3 py-3">
      <DeviceIcon kind={device.kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[#1b2955]">{device.label}</p>
        <p className="mt-0.5 text-[12px] text-[#6a769c]">Last used · {formatLastUsed(session.last_used_at)}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            className="h-8 shrink-0 rounded-lg border-[#fccad5] bg-[#fef9fa] px-2.5 text-[12px] text-[#e23354] hover:bg-[#fdeef1]"
          >
            {pending ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LogOut className="mr-1.5 h-3.5 w-3.5" />}
            Log out
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Log out this device?</AlertDialogTitle>
            <AlertDialogDescription>
              {device.label} will need to sign in again. Its current access token may remain active until it expires.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#e23354] hover:bg-[#c92847]"
              onClick={() => void onConfirm()}
            >
              Log out device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function LoggedInDevices() {
  const { data, isLoading, isError, error, refetch, demoSession, revoke, signOutOthers } = useLoggedInDevices();
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const current = data?.find((session) => session.is_current) ?? null;
  const others = data?.filter((session) => !session.is_current) ?? [];
  const fallbackCurrent = parseUserAgent(typeof navigator === "undefined" ? null : navigator.userAgent);

  async function logOutDevice(sessionId: string) {
    setPendingSessionId(sessionId);
    try {
      await revoke.mutateAsync(sessionId);
      toast.success("Device logged out");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t log out that device.");
    } finally {
      setPendingSessionId(null);
    }
  }

  async function logOutAllOthers() {
    try {
      await signOutOthers.mutateAsync();
      toast.success("Other devices logged out");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t log out the other devices.");
    }
  }

  if (demoSession) {
    return (
      <p className="mt-4 rounded-xl bg-[#f7f5fb] p-3 text-[12px] leading-relaxed text-[#6a769c]">
        Device sessions are available for phone and email sign-ins. Demo sessions are stored only in this browser.
      </p>
    );
  }

  return (
    <div className="mt-4 max-h-[min(65vh,520px)] space-y-4 overflow-y-auto pr-1">
      <section className="rounded-xl border border-[#eceaf3] bg-white px-3.5">
        <h3 className="pt-3 text-[12px] font-semibold uppercase tracking-wide text-[#8992ae]">This device</h3>
        <div className="flex items-center gap-3 py-3">
          <DeviceIcon kind={current ? parseUserAgent(current.user_agent).kind : fallbackCurrent.kind} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[#1b2955]">
              {current ? parseUserAgent(current.user_agent).label : fallbackCurrent.label}
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-[#16966a]">Active now</p>
          </div>
          <span className="rounded-full bg-[#e9f8f1] px-2.5 py-1 text-[11px] font-semibold text-[#16966a]">Current</span>
        </div>
      </section>

      <section className="rounded-xl border border-[#eceaf3] bg-white px-3.5">
        <div className="flex items-center justify-between gap-2 pt-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#8992ae]">Other devices</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={others.length === 0 || signOutOthers.isPending}
            onClick={() => void logOutAllOthers()}
            className="h-7 px-2 text-[11px] text-[#6a769c]"
          >
            {signOutOthers.isPending ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Log out all
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-5 text-[12px] text-[#6a769c]">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading devices…
          </div>
        ) : isError ? (
          <div className="py-4">
            <p className="text-[12px] leading-relaxed text-[#6a769c]">
              {error instanceof Error ? error.message : "Couldn’t load your devices."}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} className="mt-3 h-8 rounded-lg text-[12px]">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        ) : others.length === 0 ? (
          <p className="py-4 text-[12px] text-[#6a769c]">No other devices are signed in.</p>
        ) : (
          <div className="divide-y divide-[#eef0f6]">
            {others.map((session) => (
              <div key={session.id} className={cn(pendingSessionId === session.id && "opacity-60")}>
                <DeviceRow
                  session={session}
                  pending={pendingSessionId === session.id}
                  onConfirm={() => logOutDevice(session.id)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-[#8992ae]">
        After logging out a device, its current access token may work until it expires. It cannot refresh its session.
      </p>
    </div>
  );
}
