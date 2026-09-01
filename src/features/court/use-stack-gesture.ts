import * as React from "react";

import {
  lockGestureAxis,
  resolveHorizontalAction,
  resistedDragOffset,
  type GestureAxis,
} from "./court-stack-model";

const INTENT_THRESHOLD = 8;
const ACTION_THRESHOLD = 54;
const VERTICAL_SWIPE_THRESHOLD = 36;
const WHEEL_THRESHOLD = 32;
const WHEEL_COOLDOWN_MS = 260;

type Offset = { x: number; y: number };

export type StackGestureOptions = {
  canSort: boolean;
  canMoveLater: boolean;
  horizontalDisabled?: boolean;
  interactionDisabled?: boolean;
  onSort: () => void;
  onLater: () => void;
  onStep: (direction: 1 | -1) => void;
};

export function useStackGesture(options: StackGestureOptions): {
  offset: Offset;
  dragging: boolean;
  suppressClickRef: React.MutableRefObject<boolean>;
  gestureProps: Pick<
    React.HTMLAttributes<HTMLElement>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onWheel"
  >;
} {
  const [offset, setOffset] = React.useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
  const pointerStartRef = React.useRef<Offset | null>(null);
  const pointerIdRef = React.useRef<number | null>(null);
  const axisRef = React.useRef<GestureAxis>(null);
  const wheelDeltaRef = React.useRef(0);
  const lastWheelTimeRef = React.useRef(0);
  const dragStartTimeRef = React.useRef(0);
  const suppressClickRef = React.useRef(false);
  const suppressClearRef = React.useRef<
    { id: number; kind: "frame" | "timeout" } | null
  >(null);

  const resetGesture = React.useCallback(() => {
    pointerStartRef.current = null;
    pointerIdRef.current = null;
    axisRef.current = null;
    dragStartTimeRef.current = 0;
    wheelDeltaRef.current = 0;
    setDragging(false);
    setOffset({ x: 0, y: 0 });
  }, []);

  const scheduleSuppressClickClear = React.useCallback(() => {
    suppressClickRef.current = true;

    const clear = () => {
      suppressClickRef.current = false;
      suppressClearRef.current = null;
    };

    if (prefersReducedMotion || typeof requestAnimationFrame === "undefined") {
      suppressClearRef.current = { id: window.setTimeout(clear, 0), kind: "timeout" };
      return;
    }

    suppressClearRef.current = { id: requestAnimationFrame(clear), kind: "frame" };
  }, [prefersReducedMotion]);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  React.useEffect(() => {
    if (options.interactionDisabled) resetGesture();
  }, [options.interactionDisabled, resetGesture]);

  React.useEffect(
    () => () => {
      const pending = suppressClearRef.current;
      if (!pending) return;
      if (pending.kind === "frame") cancelAnimationFrame(pending.id);
      else window.clearTimeout(pending.id);
    },
    [],
  );

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (options.interactionDisabled || !event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      pointerIdRef.current = event.pointerId;
      axisRef.current = null;
      dragStartTimeRef.current = Date.now();
      wheelDeltaRef.current = 0;
    },
    [options.interactionDisabled],
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = pointerStartRef.current;
      if (
        options.interactionDisabled ||
        !start ||
        pointerIdRef.current !== event.pointerId
      ) {
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      const axis = lockGestureAxis(axisRef.current, deltaX, deltaY, INTENT_THRESHOLD);
      axisRef.current = axis;
      if (!axis) return;

      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }

      setDragging(true);
      event.preventDefault();

      if (axis === "horizontal") {
        setOffset({
          x: resistedDragOffset(
            deltaX,
            options.canSort && !options.horizontalDisabled,
            options.canMoveLater && !options.horizontalDisabled,
          ),
          y: 0,
        });
        return;
      }

      setOffset({ x: 0, y: Math.max(-96, Math.min(96, deltaY * 0.35)) });
    },
    [options.canMoveLater, options.canSort, options.horizontalDisabled, options.interactionDisabled],
  );

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = pointerStartRef.current;
      const pointerMatches = pointerIdRef.current === event.pointerId;

      if (pointerMatches && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (options.interactionDisabled || !start || !pointerMatches) {
        resetGesture();
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      const axis = axisRef.current;

      if (axis === "vertical" && Math.abs(deltaY) >= VERTICAL_SWIPE_THRESHOLD) {
        options.onStep(deltaY < 0 ? 1 : -1);
        scheduleSuppressClickClear();
      } else if (axis === "horizontal" && !options.horizontalDisabled) {
        const action = resolveHorizontalAction({
          deltaX,
          threshold: ACTION_THRESHOLD,
          canSort: options.canSort,
          canMoveLater: options.canMoveLater,
        });
        if (action === "sort") {
          options.onSort();
          scheduleSuppressClickClear();
        } else if (action === "later") {
          options.onLater();
          scheduleSuppressClickClear();
        }
      }

      resetGesture();
    },
    [
      options,
      resetGesture,
      scheduleSuppressClickClear,
    ],
  );

  const onPointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (
        pointerIdRef.current === event.pointerId &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      resetGesture();
    },
    [resetGesture],
  );

  const onWheel = React.useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (options.interactionDisabled || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      wheelDeltaRef.current += event.deltaY;
      if (Math.abs(wheelDeltaRef.current) < WHEEL_THRESHOLD) return;

      const now = Date.now();
      if (now - lastWheelTimeRef.current < WHEEL_COOLDOWN_MS) {
        wheelDeltaRef.current = 0;
        return;
      }

      event.preventDefault();
      options.onStep(wheelDeltaRef.current < 0 ? 1 : -1);
      lastWheelTimeRef.current = now;
      wheelDeltaRef.current = 0;
      scheduleSuppressClickClear();
      setOffset({ x: 0, y: 0 });
    },
    [options.interactionDisabled, options.onStep, scheduleSuppressClickClear],
  );

  const gestureProps = React.useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onWheel }),
    [onPointerCancel, onPointerDown, onPointerMove, onPointerUp, onWheel],
  );

  return { offset, dragging, suppressClickRef, gestureProps };
}
