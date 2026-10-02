import { useEffect, useRef, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { File, FileText, Film, Link2, Paperclip, Pin, Play } from "lucide-react";
import { PdfCanvas } from "@/features/things/PdfCanvas";
import type { BucketNote } from "./use-bucket-notes";
import type { NoteCover, NoteSummary } from "./use-bucket-note-summaries";
import { cn } from "@/lib/utils";

type Props = {
  note: BucketNote;
  summary?: NoteSummary;
  onOpen: () => void;
  onPin: () => void;
};

function coverLabel(cover: NoteCover) {
  if (cover.kind === "pdf") return "PDF";
  if (cover.kind === "video") return "VIDEO";
  if (cover.kind === "document") return cover.name.split(".").pop()?.toUpperCase() || "DOC";
  return "FILE";
}

function CoverIcon({ kind }: { kind: NoteCover["kind"] }) {
  if (kind === "video") return <Film aria-hidden="true" />;
  if (kind === "file") return <File aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

function VisiblePdf({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !host.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "140px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [visible]);
  return <div ref={host} className="bucket-note-pdf-page">{visible ? <PdfCanvas url={url} /> : null}</div>;
}

export function BucketNoteCover({ cover, compact = false }: { cover: NoteCover; compact?: boolean }) {
  if (compact) {
    return <span className={cn("bucket-note-mini-cover", `is-${cover.kind}`)} aria-hidden="true">
      {cover.kind === "image" && cover.url ? <img src={cover.url} alt="" loading="lazy" /> : <CoverIcon kind={cover.kind} />}
    </span>;
  }
  return <div className={cn("bucket-note-cover", `is-${cover.kind}`)}>
    {cover.kind === "image" && cover.url ? <img src={cover.url} alt="" loading="lazy" /> : null}
    {cover.kind === "pdf" && cover.url ? <VisiblePdf url={cover.url} /> : null}
    {cover.kind === "video" && cover.url ? <video src={cover.url} preload="metadata" muted playsInline aria-hidden="true" /> : null}
    {(cover.kind === "document" || cover.kind === "file" || !cover.url) ? <div className="bucket-note-file-symbol"><CoverIcon kind={cover.kind} /></div> : null}
    {cover.kind === "video" ? <span className="bucket-note-play"><Play size={14} fill="currentColor" aria-hidden="true" /></span> : null}
    {cover.kind !== "image" ? <span className="bucket-note-cover-label">{coverLabel(cover)}</span> : null}
    {cover.kind !== "image" ? <span className="bucket-note-cover-name">{cover.name}</span> : null}
  </div>;
}

export function BucketNoteMeta({ summary, compact = false }: { summary?: NoteSummary; compact?: boolean }) {
  if (!summary || (!summary.thingCount && !summary.listCount && !summary.fileCount)) return null;
  return <span className={cn("bucket-note-meta", compact && "is-compact")}>
    {summary.thingCount > 0 ? <span title={`${summary.thingCount} linked ${summary.thingCount === 1 ? "Thing" : "Things"}`}><Link2 aria-hidden="true" />{summary.thingCount} {summary.thingCount === 1 ? "Thing" : "Things"}</span> : null}
    {summary.listCount > 0 ? <span title={`${summary.listCount} linked ${summary.listCount === 1 ? "List" : "Lists"}`}><Link2 aria-hidden="true" />{summary.listCount} {summary.listCount === 1 ? "List" : "Lists"}</span> : null}
    {summary.fileCount > 0 ? <span title={`${summary.fileCount} attached ${summary.fileCount === 1 ? "file" : "files"}`}><Paperclip aria-hidden="true" />{summary.fileCount} {summary.fileCount === 1 ? "file" : "files"}</span> : null}
  </span>;
}

export function BucketNoteCard({ note, summary, onOpen, onPin }: Props) {
  return <article className="bucket-note-card">
    <button type="button" onClick={onOpen} style={{ viewTransitionName: `bucket-note-${note.id}` }} className="bucket-note-card-main" aria-label={`Open note ${note.title || "Untitled note"}`}>
      {summary?.cover ? <BucketNoteCover cover={summary.cover} /> : null}
      <span className="bucket-note-card-body">
        <strong className="bucket-note-card-title">{note.title || "Untitled note"}</strong>
        <span className="bucket-note-card-excerpt">{note.plainText || note.body || "Start writing…"}</span>
        <span className="bucket-note-card-footer"><BucketNoteMeta summary={summary} /><time dateTime={note.updatedAt}>{formatDistanceToNowStrict(new Date(note.updatedAt), { addSuffix: true })}</time></span>
      </span>
    </button>
    <button type="button" onClick={onPin} aria-label={note.pinnedAt ? "Unpin note" : "Pin note"} className={cn("bucket-note-pin", note.pinnedAt && "is-pinned")}><Pin size={15} aria-hidden="true" /></button>
  </article>;
}
