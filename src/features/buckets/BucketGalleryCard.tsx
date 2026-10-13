import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import type { BucketCard } from "./fixtures";
import bucketArt1 from "@/assets/buckets/bucket-1.png";
import bucketArt2 from "@/assets/buckets/bucket-2.png";
import bucketArt3 from "@/assets/buckets/bucket-3.png";
import bucketArt4 from "@/assets/buckets/bucket-4.png";
import bucketArt5 from "@/assets/buckets/bucket-5.png";
import bucketArt6 from "@/assets/buckets/bucket-6.png";
import bucketArt7 from "@/assets/buckets/bucket-7.png";

/** Illustration plus the matching progress/avatar-count accent, per gallery slot. */
const BUCKET_THEMES = [
  { art: bucketArt1, fill: "#793aff", track: "#eee7ff", label: "#793aff", chipBg: "#efe8ff", chipText: "#793aff" },
  { art: bucketArt2, fill: "#1679ff", track: "#e9eef9", label: "#7295cc", chipBg: "#e9f1ff", chipText: "#1679ff" },
  { art: bucketArt3, fill: "#f74e94", track: "#e9eef9", label: "#7295cc", chipBg: "#ffe8f2", chipText: "#f74e94" },
  { art: bucketArt4, fill: "#00bd79", track: "#e9eef9", label: "#7295cc", chipBg: "#dff8ee", chipText: "#00bd79" },
  { art: bucketArt5, fill: "#ffa000", track: "#e9eef9", label: "#7295cc", chipBg: "#fff1d9", chipText: "#d98500" },
  { art: bucketArt6, fill: "#793aff", track: "#e9eef9", label: "#7295cc", chipBg: "#efe8ff", chipText: "#793aff" },
  { art: bucketArt7, fill: "#747a9e", track: "#e9eef9", label: "#7295cc", chipBg: "#eceef6", chipText: "#747a9e" },
] as const;

export function bucketTheme(index: number) {
  return BUCKET_THEMES[index % BUCKET_THEMES.length]!;
}

type Props = {
  bucket: BucketCard;
  index: number;
  selected: boolean;
  onSelect: () => void;
};

export function BucketGalleryCard({ bucket, index, selected, onSelect }: Props) {
  const theme = bucketTheme(index);
  const total = bucket.progressTotal ?? 0;
  const completed = Math.min(bucket.progressCompleted ?? 0, total);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const people = bucket.collaborators ?? [];
  const visible = people.slice(0, 3);
  const extra = people.length - visible.length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div
      data-testid="bucket-gallery-card"
      data-selected={selected || undefined}
      className={cn(
        "group relative flex h-[226px] w-[240px] min-w-[220px] shrink-0 flex-col gap-[5px] overflow-hidden rounded-[10px] pb-[9px] pl-[16px] pr-[14px] pt-[11px] text-left font-['Inter',sans-serif] transition-colors",
        selected
          ? "border-[1.44px] border-[#9a70ff] bg-[#fbf9ff]"
          : "border-[1.08px] border-[#e7ecf7] bg-white/55 hover:border-[#d6c8f5]",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Show ${bucket.name}`}
        className="absolute inset-0 z-0 rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-[#9a70ff]"
      />
      <div className="pointer-events-none relative z-10 flex h-[108px] shrink-0 items-start justify-center">
        <img src={theme.art} alt="" className="h-[108px] w-[108px] object-contain" draggable={false} />
      </div>
      <p className="pointer-events-none relative z-10 shrink-0 truncate text-[14.4px] font-bold leading-normal text-[#100d36]">
        {bucket.name}
      </p>
      <p className="pointer-events-none relative z-10 shrink-0 text-[12px] leading-normal text-[#858bb2]">
        {plural(bucket.thingCount, "thing")} • {plural(bucket.listCount, "list")}
      </p>
      <div className="pointer-events-none relative z-10 flex h-[26px] shrink-0 items-center gap-[3.6px]">
        {visible.length > 0 ? (
          <div className="flex items-center -space-x-1.5">
            {visible.map((c) => (
              <PersonAvatar
                key={c.id}
                name={c.name}
                src={c.avatarUrl}
                initials={c.initials || c.name.slice(0, 2).toUpperCase()}
                size={25}
                className="ring-2 ring-white"
              />
            ))}
          </div>
        ) : null}
        {extra > 0 ? (
          <span
            className="flex h-[25px] w-[25px] items-center justify-center rounded-full text-[12px] font-semibold"
            style={{ background: theme.chipBg, color: theme.chipText }}
          >
            +{extra}
          </span>
        ) : null}
      </div>
      <div className="pointer-events-none relative z-10 flex h-[14px] shrink-0 items-center gap-[8px]">
        <div
          className="flex h-[8px] flex-1 overflow-hidden rounded-[3.6px]"
          style={{ background: theme.track }}
          role="progressbar"
          aria-label={`${bucket.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="block h-full rounded-[2px]" style={{ width: `${percent}%`, background: theme.fill }} />
        </div>
        <span className="text-[12px] leading-normal" style={{ color: theme.label }}>
          {total ? `${percent}%` : "—"}
        </span>
      </div>
    </div>
  );
}
