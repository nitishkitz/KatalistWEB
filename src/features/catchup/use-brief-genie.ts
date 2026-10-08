import { useLayoutEffect, useRef } from "react";
import { toCanvas } from "html-to-image";
import { useMotionPreference } from "@/hooks/use-motion-preference";
import type { BriefRect } from "./brief-genie-geometry";
import { briefGenieRow, renderBriefGenie } from "./brief-genie-renderer";

const DURATION = 500; // UI Layouts reference timing, identical in both directions.
const FADE_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
type Snapshot = { element: HTMLElement; rect: BriefRect; texture: () => Promise<HTMLCanvasElement> };
function visibleRect(element: Element | null): BriefRect | null {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}

function snapshotPanel(panel: HTMLElement): Snapshot | null {
  const rect = visibleRect(panel);
  if (!rect) return null;
  const element = panel.cloneNode(true) as HTMLElement;
  element.removeAttribute("data-brief-motion");
  element.removeAttribute("id");
  element.removeAttribute("role");
  element.removeAttribute("aria-modal");
  element.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
  Object.assign(element.style, {
    position: "fixed", left: "-100000px", top: "0px", width: `${rect.width}px`,
    height: `${rect.height}px`, maxHeight: "none", maxWidth: "none", transform: "none",
    translate: "none", scale: "none", opacity: "1", margin: "0", pointerEvents: "none", background: "#fff",
  });
  document.body.append(element);
  // Rasterization otherwise loses the visible position of nested scroll areas.
  const originals = [panel, ...panel.querySelectorAll<HTMLElement>("*")];
  const copies = [element, ...element.querySelectorAll<HTMLElement>("*")];
  originals.forEach((node, i) => {
    if (!node.scrollTop && !node.scrollLeft) return;
    const copy = copies[i];
    copy.style.overflow = "hidden";
    Array.from(copy.children).forEach(child => {
      if (child instanceof HTMLElement)
        child.style.transform = `translate(${-node.scrollLeft}px, ${-node.scrollTop}px)`;
    });
  });
  // Reuse already-decoded local images. Avoid fetching every avatar again
  // on the critical path between the user's click and the first bend.
  const images = panel.querySelectorAll<HTMLImageElement>("img");
  const imageCopies = element.querySelectorAll<HTMLImageElement>("img");
  images.forEach((image, i) => {
    if (!image.complete || !image.naturalWidth) return;
    try {
      const buffer = document.createElement("canvas");
      buffer.width = Math.min(image.naturalWidth, Math.max(64, image.clientWidth * 2));
      buffer.height = Math.round(buffer.width * image.naturalHeight / image.naturalWidth);
      buffer.getContext("2d")?.drawImage(image, 0, 0, buffer.width, buffer.height);
      imageCopies[i].src = buffer.toDataURL();
      imageCopies[i].removeAttribute("srcset");
    } catch { /* Cross-origin files use html-to-image's normal embedding. */ }
  });
  const texture = () => toCanvas(element, {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2), skipFonts: true,
    cacheBust: false,
    style: { left: "0px", top: "0px", transform: "none", translate: "none", boxShadow: "none" },
    includeStyleProperties: [
      "display", "position", "top", "right", "bottom", "left", "z-index", "box-sizing",
      "width", "height", "min-width", "max-width", "min-height", "max-height",
      "margin", "padding", "overflow", "overflow-x", "overflow-y", "opacity",
      "flex", "flex-direction", "flex-wrap", "flex-shrink", "flex-grow", "flex-basis",
      "align-items", "align-self", "justify-content", "gap", "row-gap", "column-gap", "order",
      "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
      "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
      "color", "text-align", "text-transform", "text-decoration", "text-underline-offset",
      "white-space", "word-break", "overflow-wrap", "text-overflow", "vertical-align",
      "background", "border", "border-radius", "box-shadow", "outline", "transform", "translate",
      "object-fit", "object-position", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
      "content", "visibility", "list-style", "appearance", "-webkit-line-clamp", "-webkit-box-orient",
    ],
  });
  return { element, rect, texture };
}

/** Presentation only. An inert canvas keeps the genuine window content
 * visible during dismissal, while Radix immediately releases focus/modal state. */
export function useBriefGenie(open: boolean) {
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<BriefRect | null>(null);
  const previousOpen = useRef(false);
  const snapshotRef = useRef<Snapshot | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const { reduceMotion } = useMotionPreference();

  useLayoutEffect(() => {
    cancelRef.current?.();
    let raf = 0;
    let disposed = false;
    let ghost: HTMLElement | null = null;
    let snapshot: Snapshot | null = null;
    const animations: Animation[] = [];
    const panel = () => panelRef.current;
    const cleanup = () => {
      disposed = true;
      cancelAnimationFrame(raf);
      animations.forEach(a => a.cancel());
      snapshot?.element.remove();
      ghost?.remove();
      panel()?.removeAttribute("data-brief-motion");
      window.removeEventListener("resize", cleanup);
    };
    cancelRef.current = cleanup;
    const animateFade = (element: Element, closing: boolean) => {
      const a = element.animate(closing ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
        { duration: 140, easing: FADE_EASE, fill: "both" });
      animations.push(a);
      void a.finished.then(cleanup, cleanup);
    };
    const run = () => {
      if (disposed) return;
      const wasOpen = previousOpen.current;
      previousOpen.current = open;
      if (!open && !wasOpen) { snapshotRef.current?.element.remove(); snapshotRef.current = null; return; }
      const element = panel();
      if (open) { snapshotRef.current?.element.remove(); snapshotRef.current = null; }
      if (open) anchorRef.current = visibleRect(document.querySelector("[data-brief-anchor]"));
      const anchor = anchorRef.current;
      const fadeOnly = reduceMotion || window.innerWidth < 1024 || !anchor;
      if (open && fadeOnly && element) { animateFade(element, false); return; }
      snapshot = open && element ? snapshotPanel(element) : snapshotRef.current;
      snapshotRef.current = null;
      if (!snapshot) { cleanup(); return; }
      ghost = document.createElement("div");
      ghost.className = fadeOnly ? "brief-fade-ghost" : "brief-genie-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      if (!open) {
        const shade = document.createElement("div");
        shade.className = "brief-genie-shade";
        ghost.append(shade);
        const a = shade.animate([{opacity: 1}, {opacity: 0}], {duration: fadeOnly ? 140 : DURATION, fill: "both"});
        animations.push(a);
        // The clone remains visible while its texture is being prepared.
        Object.assign(snapshot.element.style, { left: `${snapshot.rect.x}px`, top: `${snapshot.rect.y}px` });
        ghost.append(snapshot.element);
      }
      document.body.append(ghost);
      if (fadeOnly) { animateFade(ghost, true); return; }
      const canvas = document.createElement("canvas");
      canvas.className = "brief-genie-canvas";
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        if (open && element) animateFade(element, false); else animateFade(ghost, true);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Opening stays on DOM bands for its entire duration. Switching to
      // a raster image mid-reveal changes font metrics and causes a jitter.
      // Closing retains its existing canvas handoff.
      const rect = snapshot.rect;
      const bands = Array.from({length: 64}, (_, i) => {
        const band = document.createElement("div");
        band.className = "brief-genie-band";
        const rowHeight = rect.height / 64;
        Object.assign(band.style, {width: `${rect.width}px`, height: `${rowHeight + .3}px`});
        const content = snapshot!.element.cloneNode(true) as HTMLElement;
        Object.assign(content.style, {position: "absolute", left: "0px", top: `${-i * rowHeight}px`});
        band.append(content);
        ghost!.append(band);
        return band;
      });
      const drawBands = (p: number) => bands.forEach((band, i) => {
        const row = briefGenieRow(rect, anchor!, i / bands.length, p);
        const next = briefGenieRow(rect, anchor!, (i + 1) / bands.length, p);
        band.style.transform = `translate(${row.left}px, ${row.y}px) scale(${row.width / rect.width}, ${Math.max(0, next.y - row.y) / (rect.height / bands.length)})`;
      });
      drawBands(open ? 1 : 0);
      // Keep the offscreen source for computed styles, but remove the static
      // closing clone now that its first band frame is already visible.
      Object.assign(snapshot.element.style, {left: "-100000px", top: "0px"});
      document.body.append(snapshot.element);
      if (open && element) {
        element.setAttribute("data-brief-motion", "entering");
        const backdrop = document.querySelector(".morning-brief-backdrop");
        if (backdrop) animations.push(backdrop.animate([{opacity:0},{opacity:1}], {duration:DURATION}));
      }
      let texture: HTMLCanvasElement | null = null;
      let start: number | null = null;
      let preparing = false;
      const frame = (time: number) => {
        if (disposed) return;
        if (start === null) start = time;
        const t = Math.min(1, (time - start) / DURATION);
        const progress = open ? 1 - t : t;
        if (texture) {
          if (!canvas.parentNode) {
            ghost!.append(canvas);
            bands.forEach(band => band.remove());
          }
          renderBriefGenie(ctx, texture, rect, anchor!, progress, window.innerWidth, window.innerHeight);
        } else drawBands(progress);
        // Allow the first bend to paint before doing snapshot work.
        if (!open && t > 0 && !preparing) {
          preparing = true;
          void snapshot!.texture().then(result => {if (!disposed) texture = result;}, () => {});
        }
        if (t < 1) raf = requestAnimationFrame(frame);
        else cleanup();
      };
      raf = requestAnimationFrame(frame);
    };
    window.addEventListener("resize", cleanup, {once:true});
    // Radix mounts its portal after the first layout pass.
    if (open) raf = requestAnimationFrame(() => { void run(); }); else void run();
    return cleanup;
  }, [open, reduceMotion]);

  const capture = () => {
    snapshotRef.current?.element.remove();
    snapshotRef.current = panelRef.current ? snapshotPanel(panelRef.current) : null;
  };
  useLayoutEffect(() => () => { snapshotRef.current?.element.remove(); }, []);
  return { panelRef, capture };
}
