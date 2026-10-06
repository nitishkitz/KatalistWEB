import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { extractLinks } from "@/lib/linkify";

type LinkPreview = {
  url: string;
  host: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const MAX_CARDS = 3;

async function fetchPreview(url: string, signal?: AbortSignal): Promise<LinkPreview | null> {
  const res = await authedFetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { signal });
  if (!res.ok) return null;
  const json = (await res.json()) as { preview?: LinkPreview | null };
  return json.preview ?? null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function LinkCard({ url }: { url: string }) {
  const { data: preview } = useQuery({
    queryKey: ["link-preview", url],
    queryFn: ({ signal }) => fetchPreview(url, signal),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  const host = preview?.host ?? hostOf(url);
  const title = preview?.title ?? host;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="flex items-stretch gap-3 overflow-hidden rounded-xl border border-[#eef0f6] bg-white hover:border-[#d6dbec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {preview?.image ? (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-20 w-28 shrink-0 object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pr-3 pl-3 first:pl-3">
        <span className="truncate text-[13px] font-medium text-[#000533]">{title}</span>
        {preview?.description ? (
          <span className="line-clamp-2 text-[12px] leading-snug text-[#6a769c]">{preview.description}</span>
        ) : null}
        <span className="flex items-center gap-1 truncate text-[12px] text-[#8487a7]">
          <ExternalLink className="h-3 w-3 shrink-0" />
          {preview?.siteName ? `${preview.siteName} · ${host}` : host}
        </span>
      </span>
    </a>
  );
}

/** Safe link cards for every URL in a Thing; each falls back to a clickable host link. */
export function LinkPreviewCards({ texts }: { texts: Array<string | null | undefined> }) {
  const links = extractLinks(...texts).slice(0, MAX_CARDS);
  if (links.length === 0) return null;
  return (
    <div className="space-y-2 border-b border-[#eef0f6] py-3" aria-label="Links">
      <h3 className="text-[13px] font-medium text-[#000533]">Links</h3>
      {links.map((url) => (
        <LinkCard key={url} url={url} />
      ))}
    </div>
  );
}
