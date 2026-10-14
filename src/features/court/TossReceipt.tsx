import { useState, type ReactElement } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Eye, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDestinationLabel, type TossFeedbackItem } from "./toss-feedback-model";
import "./toss-feedback.css";

export interface TossReceiptProps {
  items: TossFeedbackItem[];
  collapsed: boolean;
  expandedDetails: boolean;
  onExpandDetails: (expanded: boolean) => void;
  onShow: (thingId: string) => void;
  onOpen: (thingId: string) => void;
  onDismiss: (thingId?: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function TossReceipt({
  items,
  collapsed,
  expandedDetails,
  onExpandDetails,
  onShow,
  onOpen,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: TossReceiptProps): ReactElement | null {
  if (items.length === 0) return null;

  const isMulti = items.length > 1;
  const latestItem = items[items.length - 1];

  // If collapsed to compact receipt
  if (collapsed && !expandedDetails) {
    return (
      <div
        className="toss-receipt-container mb-2"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <div className="toss-receipt-card py-1.5 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 truncate text-xs text-foreground">
              {isMulti ? (
                <span>
                  <strong className="font-semibold">{items.length} Things saved</strong>
                  {" · "}
                  <span className="text-muted-foreground">{formatDestinationLabel(latestItem.destination)}</span>
                </span>
              ) : (
                <span>
                  <strong className="font-semibold">{formatDestinationLabel(latestItem.destination)}</strong>
                  {" · "}
                  <span className="text-muted-foreground truncate">{latestItem.title}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onShow(latestItem.thingId)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Eye className="h-3 w-3" />
              Show
            </button>
            {isMulti && (
              <button
                type="button"
                onClick={() => onExpandDetails(true)}
                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Expand details"
              >
                <span>Details</span>
                <ChevronDown className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss()}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss receipt"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Full expanded receipt
  return (
    <div
      className="toss-receipt-container mb-2"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="toss-receipt-card flex-col items-stretch gap-2 p-3">
        {/* Main top header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              {isMulti ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {items.length} Things tossed
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {formatDestinationLabel(latestItem.destination)}
                  </span>
                </div>
              ) : (
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {latestItem.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDestinationLabel(latestItem.destination)}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {!isMulti && (
              <>
                <button
                  type="button"
                  onClick={() => onShow(latestItem.thingId)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Show in Court
                </button>
                <button
                  type="button"
                  onClick={() => onOpen(latestItem.thingId)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </button>
              </>
            )}
            {isMulti && (
              <button
                type="button"
                onClick={() => onExpandDetails(!expandedDetails)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{expandedDetails ? "Hide items" : `View all (${items.length})`}</span>
                {expandedDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss()}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss receipt"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Multi-item expanded list */}
        {isMulti && expandedDetails && (
          <div className="mt-2 divide-y divide-slate-100 border-t border-slate-100 pt-2">
            {items.map((item) => (
              <div key={item.thingId} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDestinationLabel(item.destination)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onShow(item.thingId)}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Eye className="h-3 w-3" />
                    Show
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(item.thingId)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(item.thingId)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Dismiss ${item.title}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
