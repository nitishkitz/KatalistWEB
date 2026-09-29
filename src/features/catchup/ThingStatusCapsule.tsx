import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, Send, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSonner } from "sonner";
import coeyAvatar from "@/assets/coey-catchup.png";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import { isActiveThing, theirStateFor } from "@/domain/thing";
import {
  useNotifications,
  type NotificationItem,
} from "@/features/notifications/use-notifications";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { runThingAction, type ThingActionRequest } from "@/features/things/run-thing-action";
import { domainErrorMessage } from "@/lib/domain-error";
import {
  handledToday,
  latestNotification,
  localDayKey,
  parseDailyReceipt,
  receiptMessage,
  scopeCounts,
  scopeNotifications,
  type CapsuleAction,
  type DailyReceipt,
} from "./detail-capsule-model";
import "./thing-status-capsule.css";

type Props = {
  scopeKey: string;
  scopeLabel: "List" | "Bucket";
  scopeName?: string;
  things: Thing[];
  myActorId: string | null;
  canMutate?: boolean;
  onOpenThing: (thing: Thing) => void;
};
type Preview = {
  key: string;
  thingId?: string;
  title: ReactNode;
  detail?: ReactNode;
  error?: boolean;
};

function readReceipt(key: string): DailyReceipt {
  try {
    return parseDailyReceipt(window.localStorage.getItem(key), localDayKey());
  } catch {
    return { day: localDayKey(), actions: [] };
  }
}
function requestFor(action: CapsuleAction, thing: Thing): ThingActionRequest | null {
  switch (action) {
    case "catch":
      return { kind: "catch", thingId: thing.id, pace: "next" };
    case "move":
      return { kind: "move_now", thingId: thing.id };
    case "sort":
      return { kind: "sort", thingId: thing.id };
    case "nudge":
      return {
        kind: "nudge",
        thingId: thing.id,
        reason: theirStateFor(thing) === "waiting_for_catch" ? "waiting_for_catch" : "stale",
      };
    default:
      return null;
  }
}
function eventMessage(item: NotificationItem, things: Thing[]) {
  const actor = things
    .flatMap((thing) => [thing.owner, thing.assignee, thing.creator])
    .find(
      (person) => person.id === item.actorId || (item.actorId && person.actorId === item.actorId),
    );
  if (item.kind.toLowerCase().includes("nudge"))
    return actor ? `${actor.name} nudged you` : "You were nudged";
  if (item.kind === "thing_assigned")
    return actor ? `${actor.name} assigned you a Thing` : "A new Thing was assigned to you";
  return item.title || "A new update on this Thing";
}
function sentenceFor(thing: Thing, actorId: string | null) {
  if (thing.acknowledgement === "waiting_for_catch")
    return thing.assignee.id === actorId
      ? "Waiting for you to catch"
      : `Waiting for ${thing.assignee.name} to catch`;
  return thing.workStatus === "under_progress"
    ? `${thing.assignee.id === actorId ? "You’re" : `${thing.assignee.name} is`} moving this forward.`
    : `${thing.assignee.id === actorId ? "You have" : `${thing.assignee.name} has`} this ready to start.`;
}

export function ThingStatusCapsule(props: Props) {
  // Route and identity changes retire all presentation state and in-flight receipts.
  return (
    <ScopedCapsule
      key={`${props.scopeLabel}:${props.scopeKey}:${props.myActorId ?? "pending"}`}
      {...props}
    />
  );
}

function ScopedCapsule({
  scopeKey,
  scopeLabel,
  scopeName,
  things,
  myActorId,
  canMutate = true,
  onOpenThing,
}: Props) {
  const qc = useQueryClient();
  const notifications = useNotifications();
  const { toasts } = useSonner();
  const storageKey = `katalist.detail-capsule.actions.v1:${myActorId ?? "anonymous"}:${scopeKey}`;
  const [today, setToday] = useState(localDayKey);
  const [receipts, setReceipts] = useState(() => readReceipt(storageKey));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    thingId: string;
    action: CapsuleAction;
    message: string;
  } | null>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [height, setHeight] = useState(180);
  const detailsRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seenNotifications = useRef<Set<string> | null>(null);
  const knownThings = useRef<Map<string, string> | null>(null);
  const seenToasts = useRef(new Set(toasts.map((item) => item.id)));
  const startedAt = useRef(Date.now());
  const panelId = useId();
  const interactive = hovered || focused || pinned || Boolean(busyId) || Boolean(failure);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const heldPreviews = useRef<Preview[]>([]);
  const expanded = !dismissed && (interactive || previews.length > 0);
  const activePreview = previews[0];
  const scopedItems = useMemo(
    () => scopeNotifications(notifications.items, things),
    [notifications.items, things],
  );
  const counts = useMemo(() => scopeCounts(things), [things]);
  const moments = useMemo(
    () =>
      things
        .filter((thing) => {
          const event = latestNotification(scopedItems, thing.id);
          return (
            (isActiveThing(thing) || Boolean(event)) &&
            !handledToday(receipts, thing.id, today, event)
          );
        })
        .sort((a, b) => {
          const eventA = latestNotification(scopedItems, a.id);
          const eventB = latestNotification(scopedItems, b.id);
          if (eventA || eventB)
            return (
              (eventB ? Date.parse(eventB.createdAt) : 0) -
              (eventA ? Date.parse(eventA.createdAt) : 0)
            );
          const nudgeA =
            getThingCapabilities(a, myActorId).canNudge && theirStateFor(a) !== "moving";
          const nudgeB =
            getThingCapabilities(b, myActorId).canNudge && theirStateFor(b) !== "moving";
          return Number(nudgeB) - Number(nudgeA);
        }),
    [things, scopedItems, receipts, today, myActorId],
  );
  const followups = moments.filter(
    (thing) =>
      canMutate &&
      getThingCapabilities(thing, myActorId).canNudge &&
      theirStateFor(thing) !== "moving",
  );
  const lastReceipt =
    receipts.day === today
      ? receipts.actions.filter((item) => item.action !== "open").at(-1)
      : undefined;
  const name = scopeName || `this ${scopeLabel.toLowerCase()}`;
  const summary = followups.length
    ? `${followups.length} ${followups.length === 1 ? "Thing needs" : "Things need"} a nudge`
    : moments.length
      ? `${moments.length === 1 ? "One Thing needs" : `${moments.length} Things need`} your attention`
      : "Nothing else to act on today";
  const totals = [
    counts.sorted && `${counts.sorted === 1 ? "One Thing" : `${counts.sorted} Things`} sorted`,
    counts.waiting && `${counts.waiting} waiting`,
    counts.pending && `${counts.pending} pending`,
    counts.moving && `${counts.moving} moving`,
  ]
    .filter(Boolean)
    .join(". ");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(hoverTimer.current);
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      setToday(localDayKey());
      setReceipts(readReceipt(storageKey));
    };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(
        () => {
          refresh();
          schedule();
        },
        midnight.getTime() - now.getTime() + 100,
      );
    };
    refresh();
    schedule();
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [storageKey]);
  const enqueue = useCallback((incoming: Preview[]) => {
    if (!incoming.length) return;
    if (interactiveRef.current) {
      heldPreviews.current = [...heldPreviews.current, ...incoming].slice(0, 12);
      return;
    }
    setPreviews((current) =>
      [
        ...current,
        ...incoming.filter((item) => !current.some((existing) => existing.key === item.key)),
      ].slice(0, 12),
    );
  }, []);
  useEffect(() => {
    if (interactive || !heldPreviews.current.length) return;
    const pending = heldPreviews.current;
    heldPreviews.current = [];
    enqueue(pending);
  }, [interactive, enqueue]);
  useEffect(() => {
    if (notifications.isLoading || notifications.error) return;
    if (!seenNotifications.current) {
      seenNotifications.current = new Set(notifications.items.map((item) => item.id));
      return;
    }
    const fresh = scopedItems.filter((item) => !seenNotifications.current?.has(item.id));
    fresh.forEach((item) => seenNotifications.current?.add(item.id));
    enqueue(
      fresh
        .filter((item) => Date.parse(item.createdAt) >= startedAt.current - 5000)
        .map((item) => ({
          key: item.id,
          thingId: item.thingId ?? undefined,
          title: eventMessage(item, things),
          detail: things.find((thing) => thing.id === item.thingId)?.title || item.body,
        })),
    );
  }, [
    notifications.isLoading,
    notifications.error,
    notifications.items,
    scopedItems,
    things,
    enqueue,
  ]);
  useEffect(() => {
    if (!things.length) return;
    const next = new Map(
      things.map((thing) => [thing.id, `${thing.personalPace}:${thing.workStatus}`]),
    );
    if (knownThings.current) {
      const added = things.filter((thing) => !knownThings.current?.has(thing.id));
      enqueue(
        added.map((thing) => ({
          key: `added:${thing.id}`,
          thingId: thing.id,
          title: `A new Thing in ${name}`,
          detail: thing.title,
        })),
      );
      const changes = things.filter(
        (thing) =>
          knownThings.current?.has(thing.id) &&
          knownThings.current.get(thing.id) !== next.get(thing.id),
      );
      enqueue(
        changes
          .filter((thing) => !busyRef.current)
          .map((thing) => ({
            key: `change:${thing.id}:${next.get(thing.id)}:${thing.updatedAt}`,
            thingId: thing.id,
            title: thing.workStatus === "sorted" ? "A Thing was sorted" : "A Thing moved forward",
            detail: thing.title,
          })),
      );
    }
    knownThings.current = next;
  }, [things, enqueue, name]);
  useEffect(() => {
    const fresh = toasts.filter((item) => !seenToasts.current.has(item.id));
    fresh.forEach((item) => seenToasts.current.add(item.id));
    enqueue(
      fresh.map((item) => ({
        key: `toast:${item.id}`,
        title: typeof item.title === "function" ? "An update is ready" : item.title,
        detail: typeof item.description === "function" ? undefined : item.description,
        error: item.type === "error",
      })),
    );
  }, [toasts, enqueue]);
  useEffect(() => {
    if (!activePreview || interactive) return;
    const timer = setTimeout(() => setPreviews((current) => current.slice(1)), 3000);
    return () => clearTimeout(timer);
  }, [activePreview?.key, interactive]);
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const measure = () => setHeight(70 + details.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(details);
    measure();
    return () => observer.disconnect();
  }, []);
  const remember = (thing: Thing, action: CapsuleAction) => {
    const next = {
      day: localDayKey(),
      actions: [
        ...readReceipt(storageKey).actions,
        {
          thingId: thing.id,
          action,
          title: thing.title,
          person: thing.assignee.name,
          at: Date.now(),
        },
      ],
    };
    setToday(next.day);
    setReceipts(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Session receipt remains available. */
    }
    heldPreviews.current = heldPreviews.current.filter((item) => item.thingId !== thing.id);
    setPreviews((current) => current.filter((item) => item.thingId !== thing.id));
  };
  const close = () => {
    heldPreviews.current = [];
    setDismissed(true);
    setPinned(false);
    setPreviews([]);
    setFailure(null);
  };
  const perform = async (thing: Thing, action: CapsuleAction) => {
    if (busyRef.current) return;
    if (action === "open") {
      close();
      onOpenThing(thing);
      return;
    }
    if (!canMutate) return;
    const request = requestFor(action, thing);
    if (!request) return;
    busyRef.current = true;
    setBusyId(thing.id);
    setFailure(null);
    const epoch = getIdentityEpoch(qc).epoch;
    const outcome = await runThingAction(qc, request, { dismissGhost: async () => undefined });
    busyRef.current = false;
    if (!mounted.current || !isEpochCurrent(qc, epoch)) return;
    setBusyId(null);
    if (outcome.status === "failed") {
      setFailure({ thingId: thing.id, action, message: domainErrorMessage(outcome.error) });
      return;
    }
    if (outcome.status !== "performed") return;
    remember(thing, action);
    enqueue([
      {
        key: `receipt:${thing.id}:${Date.now()}`,
        title:
          action === "nudge"
            ? `You nudged ${thing.assignee.name}`
            : action === "sort"
              ? "You sorted a Thing"
              : action === "catch"
                ? "You picked up a Thing"
                : "You moved a Thing to Now",
        detail: thing.title,
      },
    ]);
  };

  return (
    <div
      className="coey-capsule-anchor"
      onPointerEnter={(event) => {
        if (
          event.pointerType === "touch" ||
          !window.matchMedia("(hover: hover) and (pointer: fine)").matches
        )
          return;
        clearTimeout(hoverTimer.current);
        setDismissed(false);
        hoverTimer.current = setTimeout(() => setHovered(true), 110);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
          setHovered(false);
          setPinned(false);
        }, 180);
      }}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible")) setFocused(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
          setDismissed(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          headerRef.current?.focus();
        }
      }}
    >
      <section
        className="coey-capsule"
        data-expanded={expanded}
        data-error={Boolean(failure)}
        style={{ height: expanded ? height : 56 }}
        aria-label={`${name} updates`}
      >
        <div className="coey-capsule-header">
          <button
            ref={headerRef}
            className="coey-capsule-trigger"
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => {
              setDismissed(false);
              setPinned((value) => !value);
            }}
          >
            <img className="coey-capsule-avatar" src={coeyAvatar} alt="Coey" />
            <span className="coey-capsule-heading">
              {scopeLabel !== "List" && (
                <span className="coey-capsule-scope">{scopeName || scopeLabel}</span>
              )}
              <span className="coey-capsule-headline">
                {expanded
                  ? activePreview?.title || summary
                  : lastReceipt && !moments.length
                    ? receiptMessage(lastReceipt)
                    : summary}
              </span>
            </span>
            <ChevronDown size={14} className="coey-capsule-chevron" aria-hidden="true" />
          </button>
          {expanded && (
            <button
              type="button"
              className="coey-capsule-dismiss"
              aria-label="Dismiss updates"
              onClick={close}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="coey-capsule-reveal" inert={!expanded} aria-hidden={!expanded} id={panelId}>
          <div ref={detailsRef} className="coey-capsule-details">
            {activePreview && (
              <div className="coey-capsule-preview" data-error={activePreview.error}>
                <span className="coey-capsule-event-label">
                  {activePreview.error ? "Needs your attention" : "Just now"}
                </span>
                {activePreview.detail && <p>{activePreview.detail}</p>}
                {activePreview.thingId &&
                  things.find((thing) => thing.id === activePreview.thingId) && (
                    <button
                      className="coey-capsule-link"
                      onClick={() =>
                        void perform(
                          things.find((thing) => thing.id === activePreview.thingId)!,
                          "open",
                        )
                      }
                    >
                      Open Thing <ExternalLink size={12} />
                    </button>
                  )}
              </div>
            )}
            <div className="coey-capsule-moments">
              {(showMore ? moments : moments.slice(0, 3)).map((thing) => {
                const capabilities = getThingCapabilities(thing, myActorId);
                const notification = latestNotification(scopedItems, thing.id);
                const nudgeable =
                  canMutate && capabilities.canNudge && theirStateFor(thing) !== "moving";
                const actions: { id: CapsuleAction; label: string }[] = [
                  ...(nudgeable
                    ? [
                        {
                          id: "nudge" as const,
                          label: `Nudge ${thing.assignee.name.split(" ")[0]}`,
                        },
                      ]
                    : []),
                  ...(canMutate && capabilities.canCatch
                    ? [{ id: "catch" as const, label: "Catch" }]
                    : []),
                  ...(canMutate && capabilities.canSetPace && thing.personalPace !== "now"
                    ? [{ id: "move" as const, label: "Move to Now" }]
                    : []),
                  ...(canMutate && capabilities.canSort
                    ? [{ id: "sort" as const, label: "Mark sorted" }]
                    : []),
                ];
                return (
                  <div className="coey-capsule-moment" key={thing.id}>
                    <Avatar className="coey-capsule-person" title={thing.assignee.name}>
                      <AvatarImage
                        src={thing.assignee.avatarUrl || undefined}
                        alt={thing.assignee.name}
                      />
                      <AvatarFallback className="coey-capsule-person-fallback">
                        {thing.assignee.initials ||
                          thing.assignee.name
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("") ||
                          "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="coey-capsule-message">
                      <p>
                        {notification
                          ? eventMessage(notification, things)
                          : sentenceFor(thing, myActorId)}
                      </p>
                      <button
                        type="button"
                        className="coey-capsule-title"
                        onClick={() => void perform(thing, "open")}
                      >
                        {thing.title}
                      </button>
                      <div className="coey-capsule-actions-reveal">
                        <div className="coey-capsule-actions">
                          {actions.map((action, index) => (
                            <button
                              key={action.id}
                              type="button"
                              className={index === 0 ? "coey-capsule-primary" : "coey-capsule-link"}
                              disabled={Boolean(busyId)}
                              onClick={() => void perform(thing, action.id)}
                            >
                              {busyId === thing.id ? (
                                "Working…"
                              ) : (
                                <>
                                  {action.id === "nudge" && <Send size={12} />}
                                  {action.label}
                                </>
                              )}
                            </button>
                          ))}
                          <button
                            className="coey-capsule-link"
                            type="button"
                            disabled={Boolean(busyId)}
                            onClick={() => void perform(thing, "open")}
                          >
                            Open Thing <ExternalLink size={12} />
                          </button>
                        </div>
                      </div>
                      {failure?.thingId === thing.id && (
                        <div className="coey-capsule-failure" role="alert">
                          <p>{failure.message}</p>
                          <button
                            type="button"
                            className="coey-capsule-link"
                            onClick={() => void perform(thing, failure.action)}
                          >
                            Try again
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {moments.length > 3 && (
              <button
                className="coey-capsule-more"
                type="button"
                onClick={() => setShowMore((value) => !value)}
              >
                {showMore
                  ? "Show less"
                  : `${moments.length - 3} more ${moments.length - 3 === 1 ? "update" : "updates"}`}
                <ChevronDown size={13} />
              </button>
            )}
            {!moments.length && !activePreview && (
              <p className="coey-capsule-empty">Nothing else needs your attention here today.</p>
            )}
            {totals && <p className="coey-capsule-totals">{totals}.</p>}
            {lastReceipt && (
              <p className="coey-capsule-receipt" role="status">
                <Check size={14} aria-hidden="true" />
                <span>
                  {receiptMessage(lastReceipt)}
                  <time dateTime={new Date(lastReceipt.at).toISOString()}>
                    {new Intl.DateTimeFormat(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(lastReceipt.at)}
                  </time>
                </span>
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
