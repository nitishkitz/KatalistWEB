import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Phone, PhoneOff } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { subscribeToRings, getDeviceId, type RingPayload } from "./call-lobby";
import { createRingtone, unlockAudio, type Ringtone } from "./ringtone";
import { requestAutojoin } from "./autojoin-signal";

const RING_TTL_MS = 30_000;

/**
 * App-wide incoming-call listener. Mounted once at the root; shows a ring
 * banner when another member starts a call in a list you belong to. "Join"
 * navigates to the list and auto-joins (via a sessionStorage handoff the list
 * page reads on mount).
 */
export function CallRingProvider() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [ring, setRing] = useState<RingPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneRef = useRef<Ringtone | null>(null);

  useEffect(() => {
    const selfId = user?.id;
    if (!selfId) return;
    const unsubscribe = subscribeToRings(selfId, getDeviceId(), (p) => {
      setRing(p);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setRing(null), RING_TTL_MS);
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user?.id]);

  // Unlock audio on the first user gesture so the ringtone can actually play
  // later (browsers keep AudioContext suspended until a gesture).
  useEffect(() => {
    const handler = () => unlockAudio();
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", handler, opts);
    window.addEventListener("touchstart", handler, opts);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("touchstart", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);

  // Play a looping ringtone while an incoming call is showing.
  useEffect(() => {
    if (!ringtoneRef.current) ringtoneRef.current = createRingtone();
    const rt = ringtoneRef.current;
    if (ring) rt.start();
    else rt.stop();
    return () => rt.stop();
  }, [ring]);

  if (!ring) return null;

  const dismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRing(null);
  };

  const join = () => {
    const listId = ring.listId;
    // Team-hub conversations (DM/group) live at /team/$conversationId; task
    // Lists live at /lists/$listId. Route the "Join" accordingly.
    const isHub = ring.kind === "dm" || ring.kind === "group";
    const path = isHub ? `/team/${listId}` : `/lists/${listId}`;
    // Unlock audio/mic within this click gesture (iOS Safari requires it).
    unlockAudio();
    // Durable in-memory signal: consumed by the destination page as soon as it
    // is ready (covers navigating in), and delivered live to it if already open.
    requestAutojoin(listId);
    dismiss();
    // Only navigate if we are NOT already on this conversation/list. Navigating
    // to the same route re-mounts the page and would tear down the call that the
    // live autojoin listener just started.
    const alreadyHere = typeof window !== "undefined" && window.location.pathname.includes(path);
    if (alreadyHere) return;
    // Persist a one-shot flag the destination page consumes on mount (belt-and-
    // suspenders alongside the in-memory signal, which survives SPA navigation).
    try {
      sessionStorage.setItem(`katalist.autojoin.${listId}`, "1");
    } catch {
      // sessionStorage may be unavailable; the in-memory signal still covers it.
    }
    if (isHub) {
      void navigate({
        to: "/team/$conversationId",
        params: { conversationId: listId },
        search: { call: "1" },
      });
    } else {
      void navigate({ to: "/lists/$listId", params: { listId } });
    }
  };

  return (
    <div
      className="fixed right-4 top-4 z-[70] w-[340px] animate-in slide-in-from-top-2 rounded-2xl border-2 border-[#12a15f]/50 bg-white p-4"
      style={{ boxShadow: "0 0 0 4px rgba(18,161,95,0.15), 0 18px 40px rgba(15,23,42,0.3)" }}
      role="alert"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e4fcf0] text-[#12a15f]">
          <span className="absolute inset-0 animate-ping rounded-full bg-[#12a15f]/30" />
          <Phone className="relative h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[#000533]">Incoming call</p>
          <p className="truncate text-[12.5px] text-[#6a769c]">
            {ring.fromName} · {ring.listName}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted"
        >
          <PhoneOff className="h-3.5 w-3.5" />
          Dismiss
        </button>
        <button
          type="button"
          onClick={join}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#12a15f] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:brightness-95"
        >
          <Phone className="h-3.5 w-3.5" />
          Join
        </button>
      </div>
    </div>
  );
}
