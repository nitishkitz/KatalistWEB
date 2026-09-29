import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Phone, PhoneOff, Video, X } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { Logo } from "@/components/katalist/Logo";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
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
      // Same signal as the hub branch above — belt-and-suspenders alongside
      // the sessionStorage flag and the in-memory autojoin-signal, in case
      // either of those is lost (e.g. sessionStorage disabled, or a second
      // ring overwrites the single in-memory pending slot before this page
      // finishes mounting).
      void navigate({ to: "/lists/$listId", params: { listId }, search: { call: "1" } });
    }
  };

  const isVideo = ring.callType === "video";
  const CallIcon = isVideo ? Video : Phone;

  return (
    <div
      className="fixed right-4 top-4 z-[70] w-[min(303px,calc(100vw-2rem))] animate-in slide-in-from-top-2 overflow-hidden rounded-[10px] border border-[#eeedf3] bg-white p-2.5 text-[#171717] shadow-[0_14px_40px_rgba(20,16,32,0.2)]"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex h-7 items-center justify-between">
        <Logo markClassName="h-[18px] w-[18px] rounded-[3px] p-[3px]" textClassName="text-[12px]" className="gap-1.5" />
        <div className="flex items-center gap-1 text-[#51466c]">
          <button type="button" onClick={dismiss} className="rounded p-1 hover:bg-[#f4f1fa]" aria-label="More call options" title="More options">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <button type="button" onClick={dismiss} className="rounded p-1 hover:bg-[#f4f1fa]" aria-label="Close incoming call">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center px-2 pb-2 pt-2">
        <span className="relative mb-2 inline-flex rounded-full border border-[#d6d3dc] p-1 shadow-[0_8px_24px_rgba(118,105,251,0.12)]">
          <PersonAvatar name={ring.fromName} src={ring.fromAvatarUrl} size={78} className="ring-1 ring-white" />
          <span className="absolute bottom-0 right-0 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white bg-[#7669fb] text-white shadow-sm">
            <CallIcon className="h-3 w-3" fill={isVideo ? "none" : "currentColor"} />
          </span>
        </span>
        <p className="max-w-full truncate text-center text-[13px] font-semibold leading-[18px] text-black">
          {ring.fromName} is calling you
        </p>
        <p className="mt-0.5 text-[9px] leading-[14px] text-[#55515d]">
          {ring.callType ? `${isVideo ? "Video" : "Audio"} Call` : "Incoming call"}
          {ring.kind === "dm" ? null : <span className="text-[#77727e]"> · {ring.listName}</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={join} className="inline-flex h-[31px] items-center justify-center gap-1.5 rounded-[4px] bg-[#7669fb] text-[10px] font-medium text-white transition hover:bg-[#6658ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7669fb] focus-visible:ring-offset-2">
          <CallIcon className="h-3 w-3" /> Answer
        </button>
        <button type="button" onClick={dismiss} className="inline-flex h-[31px] items-center justify-center gap-1.5 rounded-[4px] bg-[#f95559] text-[10px] font-medium text-white transition hover:bg-[#e7464b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f95559] focus-visible:ring-offset-2">
          <PhoneOff className="h-3 w-3" /> Decline
        </button>
      </div>
    </div>
  );
}
