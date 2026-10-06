import { Linkified } from "@/components/katalist/Linkified";
import type * as React from "react";
import { format } from "date-fns";
import { ThingViewOnlyBanner } from "./ThingViewOnlyBanner";

/**
 * T09 item 5: title + subtitle + view-only/load-error banners, pulled out of
 * ThingDetailContent's two variant render trees. The court and default
 * variants show genuinely different subtitles and banner combinations (court
 * splits "overview load failed" and "comment counts unavailable" into two
 * separate banners; default collapses all three failure conditions into one
 * combined banner) -- kept as two branches behind `variant` rather than
 * forced into one shape, per the same "don't unify divergent markup" rule
 * ThingViewOnlyBanner's own extraction established.
 *
 * All data here is display-only. Retry/refetch is the one callback, and it
 * is whatever ThingDetailContent's own `live.refetch()` already was --
 * this component does not fetch or mutate anything itself.
 */
export type ThingIdentityHeaderProps = {
  variant: "default" | "court";
  title: string;
  headerAction?: React.ReactNode;
  viewOnly: boolean;
  onRetry: () => void;
  /** court-only */
  creatorName?: string;
  updatedAt?: string | null;
  showOverviewLoadError?: boolean;
  commentCountsUnavailable?: boolean;
  /** default-only */
  context?: string;
  listName?: string | null;
  showCombinedError?: boolean;
};

export function ThingIdentityHeader({
  variant,
  title,
  headerAction,
  viewOnly,
  onRetry,
  creatorName,
  updatedAt,
  showOverviewLoadError,
  commentCountsUnavailable,
  context,
  listName,
  showCombinedError,
}: ThingIdentityHeaderProps): React.ReactNode {
  if (variant === "court") {
    return (
      <>
        {headerAction && <div className="mb-2">{headerAction}</div>}

        {/* Title */}
        <div className="flex items-start justify-between gap-3 pr-9">
          <h1 className="text-[25px] font-medium leading-tight tracking-tight text-[#000533] break-words flex-1">
            <Linkified text={title} />
          </h1>
        </div>

        {/* Subtitle */}
        <p className="mt-1 text-[12px] text-[#6a769c] font-medium">
          Created by {creatorName}
          {updatedAt ? ` • Updated ${format(new Date(updatedAt), "MMM d, h:mm a")}` : ""}
        </p>

        {viewOnly && <ThingViewOnlyBanner />}
        {showOverviewLoadError && (
          <div role="alert" className="mt-3 text-xs text-amber-700">
            Full Thing detail could not be loaded. The information below may be incomplete.
            <button type="button" className="ml-2 underline" onClick={onRetry}>Retry</button>
          </div>
        )}
        {commentCountsUnavailable && (
          <div role="status" className="mt-3 text-xs text-amber-700">
            Comment counts could not be loaded.
            <button type="button" className="ml-2 underline" onClick={onRetry}>Retry</button>
          </div>
        )}
      </>
    );
  }

  return (
    <header className="border-b border-border/70 px-5 py-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[18px] font-semibold leading-snug text-foreground break-words"><Linkified text={title} /></h2>
        {headerAction}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="capitalize">{context}</span>
        {listName ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{listName}</span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span>Updated {updatedAt ? format(new Date(updatedAt), "MMM d · h:mm a") : ""}</span>
      </p>
      {viewOnly && <ThingViewOnlyBanner />}
      {showCombinedError && (
        <div role="alert" className="mt-3 text-xs text-amber-700">
          Some Thing details could not be loaded.
          <button type="button" className="ml-2 underline" onClick={onRetry}>Retry</button>
        </div>
      )}
    </header>
  );
}
