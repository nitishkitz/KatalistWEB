import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
// Reserve three readable lanes plus their two internal gaps. The outer
// layout has a separate 16px gap containing the splitter's hit target.
const MIN_LANES_WIDTH = 720;
const SPLIT_GAP = 16;

export function CourtSidebarPane({
  children,
  className,
  onOccupiedWidthChange,
}: {
  children: ReactNode;
  className: string;
  onOccupiedWidthChange?: (width: number) => void;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; width: number } | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_WIDTH);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [wide, setWide] = useState(false);
  const [dragging, setDragging] = useState(false);
  const maxWidth = Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, availableWidth - MIN_LANES_WIDTH - SPLIT_GAP),
  );
  const width = Math.max(MIN_WIDTH, Math.min(maxWidth, preferredWidth));
  const canResize = wide && maxWidth > MIN_WIDTH;

  useEffect(() => {
    onOccupiedWidthChange?.(wide ? width + SPLIT_GAP : 0);
  }, [wide, width, onOccupiedWidthChange]);

  useEffect(() => () => onOccupiedWidthChange?.(0), [onOccupiedWidthChange]);

  const finishDrag = (cancel = false) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (drag && cancel) setPreferredWidth(drag.width);
    if (drag && separatorRef.current?.hasPointerCapture(drag.id))
      separatorRef.current.releasePointerCapture(drag.id);
  };

  useEffect(() => {
    const parent = paneRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setAvailableWidth(parent.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    measure();
    const media = window.matchMedia("(min-width: 1280px)");
    const updateMedia = () => {
      const drag = dragRef.current;
      setWide(media.matches);
      dragRef.current = null;
      setDragging(false);
      if (drag && separatorRef.current?.hasPointerCapture(drag.id))
        separatorRef.current.releasePointerCapture(drag.id);
    };
    updateMedia();
    media.addEventListener("change", updateMedia);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateMedia);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const body = document.body;
    const previousCursor = body.style.cursor;
    const previousSelect = body.style.userSelect;
    body.style.cursor = "col-resize";
    body.style.userSelect = "none";
    const end = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (drag && separatorRef.current?.hasPointerCapture(drag.id))
        separatorRef.current.releasePointerCapture(drag.id);
    };
    window.addEventListener("blur", end);
    return () => {
      body.style.cursor = previousCursor;
      body.style.userSelect = previousSelect;
      window.removeEventListener("blur", end);
    };
  }, [dragging]);

  const clamp = (value: number) => Math.max(MIN_WIDTH, Math.min(maxWidth, value));

  return (
    <div
      ref={paneRef}
      data-court-sidebar-pane=""
      className={`${className} relative min-w-0 shrink-0 w-[325px] xl:w-[var(--court-sidebar-width)]`}
      style={{ "--court-sidebar-width": `${width}px` } as CSSProperties}
    >
      <div
        ref={separatorRef}
        role="separator"
        aria-label="Resize With Others"
        aria-orientation="vertical"
        aria-controls="court-with-others"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        aria-valuetext={`${Math.round(width)} pixels wide`}
        tabIndex={canResize ? 0 : -1}
        aria-disabled={!canResize}
        title="Drag to resize With Others. Use arrow keys, or double-click to reset."
        className={`group absolute -left-4 top-0 z-20 hidden h-[calc(100vh-8rem)] w-4 touch-none select-none cursor-col-resize outline-none ${canResize ? "xl:block" : ""}`}
        onPointerDown={(event) => {
          if (!canResize || event.button !== 0 || !event.isPrimary || dragRef.current) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { id: event.pointerId, x: event.clientX, width };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.id !== event.pointerId) return;
          // Use current container geometry even if it changed during this drag.
          const containerWidth =
            paneRef.current?.parentElement?.getBoundingClientRect().width ?? availableWidth;
          const limit = Math.max(
            MIN_WIDTH,
            Math.min(MAX_WIDTH, containerWidth - MIN_LANES_WIDTH - SPLIT_GAP),
          );
          setPreferredWidth(
            Math.max(MIN_WIDTH, Math.min(limit, drag.width + drag.x - event.clientX)),
          );
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.id !== event.pointerId) return;
          finishDrag();
        }}
        onPointerCancel={(event) => {
          if (dragRef.current?.id === event.pointerId) finishDrag(true);
        }}
        onLostPointerCapture={() => finishDrag()}
        onDoubleClick={() => {
          finishDrag();
          setPreferredWidth(clamp(DEFAULT_WIDTH));
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && dragRef.current) {
            event.preventDefault();
            finishDrag(true);
            return;
          }
          if (!canResize || dragRef.current) return;
          const step = event.shiftKey ? 40 : 10;
          const target =
            event.key === "ArrowLeft"
              ? width + step
              : event.key === "ArrowRight"
                ? width - step
                : event.key === "Home"
                  ? MIN_WIDTH
                  : event.key === "End"
                    ? maxWidth
                    : null;
          if (target === null) return;
          event.preventDefault();
          setPreferredWidth(clamp(target));
        }}
      >
        <span
          className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 group-hover:w-0.5 group-hover:bg-primary/60 group-focus-visible:w-0.5 group-focus-visible:bg-primary ${dragging ? "!w-0.5 !bg-primary" : ""}`}
        />
        <span
          className={`absolute left-1/2 top-12 h-8 w-1 -translate-x-1/2 rounded-full bg-primary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 ${dragging ? "!opacity-100" : ""}`}
        />
      </div>
      {children}
    </div>
  );
}
