import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  Circle,
  ArrowUpRight,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DrawOp } from "./call-room";

type Tool = "pointer" | "pen" | "eraser" | "rect" | "ellipse" | "arrow";

const COLORS = ["#0b0c29", "#fc404d", "#fdb412", "#1cc574", "#3f8efa", "#815cfa"];

const TOOLS: { id: Tool; Icon: typeof MousePointer2; label: string }[] = [
  { id: "pointer", Icon: MousePointer2, label: "Select" },
  { id: "pen", Icon: Pencil, label: "Pen" },
  { id: "eraser", Icon: Eraser, label: "Eraser" },
  { id: "rect", Icon: Square, label: "Rectangle" },
  { id: "ellipse", Icon: Circle, label: "Ellipse" },
  { id: "arrow", Icon: ArrowUpRight, label: "Arrow" },
];

const PEN_WIDTH = 0.004; // fraction of canvas width
const ERASER_WIDTH = 0.03;

function drawOp(ctx: CanvasRenderingContext2D, op: DrawOp, w: number, h: number) {
  if (op.kind === "clear") return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (op.kind === "stroke") {
    if (op.points.length === 0) return;
    ctx.globalCompositeOperation = op.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width * w;
    ctx.beginPath();
    ctx.moveTo(op.points[0].x * w, op.points[0].y * h);
    for (const p of op.points.slice(1)) ctx.lineTo(p.x * w, p.y * h);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  // shape
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = op.color;
  ctx.lineWidth = op.width * w;
  const x1 = op.x1 * w;
  const y1 = op.y1 * h;
  const x2 = op.x2 * w;
  const y2 = op.y2 * h;
  if (op.tool === "rect") {
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (op.tool === "ellipse") {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // arrow: shaft + a simple two-line arrowhead at (x2, y2)
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(10, op.width * w * 4);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
}

/**
 * Collaborative whiteboard overlay for the call's expanded/screen-share view
 * (Figma parity). Every stroke/shape is broadcast over the call's existing
 * Realtime channel (see call-room.ts DrawOp) and replayed in order by every
 * viewer — ephemeral, never persisted, cleared when the call ends.
 */
export function AnnotateCanvas({
  drawOps,
  onSend,
  className,
}: {
  drawOps: DrawOp[];
  onSend: (op: DrawOp) => void;
  className?: string;
}) {
  const [tool, setTool] = useState<Tool>("pointer");
  const [color, setColor] = useState(COLORS[0]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const drawingRef = useRef(false);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<DrawOp | null>(null);

  const active = tool !== "pointer";

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    ctx.clearRect(0, 0, w, h);
    for (const op of drawOps) drawOp(ctx, op, w, h);
    if (preview) drawOp(ctx, preview, w, h);
  }, [drawOps, preview]);

  // Keep the canvas pixel size matched to its container (crisp at any window size).
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      ctx?.scale(dpr, dpr);
      sizeRef.current = { w: rect.width, h: rect.height };
      redraw();
    });
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const toNorm = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const p = toNorm(e);
    drawingRef.current = true;
    if (tool === "pen" || tool === "eraser") {
      pointsRef.current = [p];
      setPreview({
        kind: "stroke",
        id: crypto.randomUUID(),
        tool,
        color,
        width: tool === "eraser" ? ERASER_WIDTH : PEN_WIDTH,
        points: [p],
      });
    } else {
      shapeStartRef.current = p;
      setPreview({ kind: "shape", id: crypto.randomUUID(), tool, color, width: PEN_WIDTH, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !drawingRef.current) return;
    const p = toNorm(e);
    if (tool === "pen" || tool === "eraser") {
      pointsRef.current = [...pointsRef.current, p];
      setPreview((prev) =>
        prev && prev.kind === "stroke" ? { ...prev, points: pointsRef.current } : prev,
      );
    } else if (shapeStartRef.current) {
      setPreview((prev) => (prev && prev.kind === "shape" ? { ...prev, x2: p.x, y2: p.y } : prev));
    }
  };

  const onPointerUp = () => {
    if (!active || !drawingRef.current) return;
    drawingRef.current = false;
    const final = preview;
    setPreview(null);
    shapeStartRef.current = null;
    pointsRef.current = [];
    if (!final) return;
    if (final.kind === "stroke" && final.points.length < 2) return; // a tap, not a stroke
    onSend(final);
  };

  const clearBoard = () => onSend({ kind: "clear" });

  const cursor = useMemo(() => {
    if (!active) return "default";
    if (tool === "eraser") return "cell";
    return "crosshair";
  }, [active, tool]);

  return (
    <div ref={containerRef} className={cn("pointer-events-none absolute inset-0", className)}>
      <canvas
        ref={canvasRef}
        className={cn(active ? "pointer-events-auto" : "pointer-events-none", "absolute inset-0")}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* Toolbar */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-black/10 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
        {TOOLS.map(({ id, Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            title={label}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer",
              tool === id ? "bg-[#7b56fd] text-white" : "text-[#3d3f74] hover:bg-muted",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-black/10" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            title={c}
            className={cn(
              "h-5 w-5 shrink-0 rounded-full border-2 transition-transform cursor-pointer",
              color === c ? "scale-110 border-black/50" : "border-transparent",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <span className="mx-0.5 h-5 w-px bg-black/10" />
        <button
          type="button"
          onClick={clearBoard}
          title="Clear board"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#3d3f74] hover:bg-muted cursor-pointer"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
