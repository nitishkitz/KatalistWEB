import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Calendar,
  ChevronLeft,
  FileText,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { format } from "date-fns";
import type { Thing } from "@/domain/thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import { ThingDetailContent } from "./ThingDetailContent";
import { formatCourtDue } from "@/features/court/court-view-model";
import { MagicBox } from "@/features/court/MagicBox";
import katalistMark from "@/assets/katalist-mark.png.asset.json";

type InlineThingDetailWorkspaceProps = {
  thing: Thing | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  sourceClassName?: string;
  viewOnly?: boolean;
  backLabel?: string;
  items?: Thing[];
  onSelectThing?: (thingId: string) => void;
  navTitle?: string;
  magicBoxProps?: { listId?: string; listName?: string };
  /** Opt into the flat white-card look used by the restyled Team/Bucket-detail screens (hex borders, rounded-[10px], no shadcn shadow token) instead of the generic card default. */
  flatPanel?: boolean;
};

const FLAT_PANEL_SHADOW = "0 3px 9.4px 0 rgba(0,0,0,0.05)";

export function InlineThingDetailWorkspace({
  thing,
  onClose,
  children,
  className,
  sourceClassName,
  viewOnly = false,
  backLabel,
  items,
  onSelectThing,
  navTitle,
  magicBoxProps,
  flatPanel = false,
}: InlineThingDetailWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!thing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [thing, onClose]);

  const hasNavigator = Boolean(items && items.length > 0 && onSelectThing);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.assignee.name.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  if (!thing) return <>{children}</>;

  const headerAction = (
    <div className="flex items-center justify-between w-full mb-2">
      <button
        type="button"
        onClick={onClose}
        className={cn(
          "inline-flex items-center gap-1.5 text-[12px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
          flatPanel ? "text-[#6a769c] hover:text-[#000533]" : "text-foreground hover:text-primary",
        )}
        aria-label={`Back to ${backLabel || "List"}`}
      >
        <ChevronLeft className={cn("h-4 w-4", flatPanel ? "text-[#6a769c]" : "text-foreground")} />
        Back to {backLabel || "List"}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close Thing details"
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
          flatPanel
            ? "rounded-[8px] border border-[#eef0f6] text-[#6a769c] hover:bg-[#f4f6fd] hover:text-[#000533]"
            : "rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/30",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // Full-screen focused workspace matching CourtFocusView when navigating items (Buckets & Lists)
  if (hasNavigator) {
    return (
      <>
        {/* Render base page content inert behind focus workspace */}
        <div aria-hidden="true" className="contents">
          {children}
        </div>

        <section
          aria-label="Inline Thing details"
          className="fixed inset-0 z-40 bg-[#fafafa] flex flex-col motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[0.99] duration-[240ms] ease-out motion-reduce:transition-none motion-reduce:animate-none"
        >
          {/* Top Header Bar */}
          <header className="h-14 shrink-0 border-b border-border/70 bg-white px-6 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src={katalistMark?.url ?? "/katalist-mark-app.png"}
                alt="Katalist"
                className="h-6 w-6 object-contain"
              />
              <span className="text-[17px] font-bold text-foreground tracking-tight">Katalist</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[12.5px] font-semibold text-muted-foreground hidden sm:inline">
                {navTitle || backLabel}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Thing details"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/30 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* Main Content Split: Left Navigator + Right Thing Detail */}
          <main className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left Column: Navigator + In-List Search + Things List */}
            <aside className="w-[320px] shrink-0 border-r border-border/70 bg-white/75 backdrop-blur flex flex-col min-h-0">
              {/* Header with Title and Count */}
              <div className="p-3 border-b border-border/60 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <h2 className="truncate text-[13px] font-bold text-foreground">
                    {navTitle || backLabel || "Things"}
                  </h2>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary shrink-0">
                  {items!.length}
                </span>
              </div>

              {/* In-List Search */}
              <div className="px-3 pt-2.5 pb-2">
                <div className="relative flex items-center">
                  <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Search in ${navTitle || backLabel || "Things"}...`}
                    className="h-8 w-full rounded-lg border border-border/70 bg-muted/20 pl-8 pr-8 text-[12px] text-foreground outline-none focus:border-primary focus:bg-white transition-colors"
                  />
                  <SlidersHorizontal className="absolute right-2.5 h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
                </div>
              </div>

              {/* Scrollable Things List */}
              <div className="flex-1 overflow-auto px-3 py-1.5 space-y-1.5 min-h-0">
                {filteredItems.map((item) => {
                  const isSelected = item.id === thing.id;
                  const due = formatCourtDue(item);
                  const isWaiting = item.acknowledgement === "waiting_for_catch";
                  const isProgress = item.workStatus === "under_progress";
                  const isCompleted = item.workStatus === "sorted";

                  const statusText = isWaiting
                    ? "Waiting"
                    : isProgress
                      ? "In Progress"
                      : isCompleted
                        ? "Completed"
                        : "Not Started";

                  if (isSelected) {
                    return (
                      <div
                        key={item.id}
                        onClick={() => onSelectThing?.(item.id)}
                        className="relative rounded-2xl border-2 border-primary/40 bg-primary/[0.04] p-3 transition-all cursor-pointer text-left shadow-xs"
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <PersonAvatar
                            name={item.assignee.name}
                            initials={item.assignee.initials}
                            src={item.assignee.avatarUrl}
                            size={24}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-bold leading-snug text-foreground line-clamp-2">
                              {item.title}
                            </p>
                            <div className="mt-1 flex items-center justify-between gap-1.5 text-[10.5px]">
                              <span className="font-medium text-muted-foreground">
                                {statusText}
                              </span>
                              {due.label && due.label !== "No due date" ? (
                                <span
                                  className={cn(
                                    "font-semibold shrink-0",
                                    due.urgent ? "text-red-600" : "text-muted-foreground",
                                  )}
                                >
                                  {due.label}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        {/* Active connector badge pointing right into detail view */}
                        <span className="absolute -right-[6px] top-1/2 -translate-y-1/2 h-4 w-2 rounded-l-full bg-primary/40 hidden md:block" />
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectThing?.(item.id)}
                      className="rounded-xl border border-border/60 bg-white hover:bg-muted/30 p-3 transition-colors cursor-pointer text-left flex items-start gap-2.5 shadow-2xs"
                    >
                      <PersonAvatar
                        name={item.assignee.name}
                        initials={item.assignee.initials}
                        src={item.assignee.avatarUrl}
                        size={24}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold leading-snug text-foreground line-clamp-2">
                          {item.title}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-1.5 text-[10.5px]">
                          <span className="font-medium text-muted-foreground">
                            {statusText}
                          </span>
                          {due.label && due.label !== "No due date" ? (
                            <span
                              className={cn(
                                "font-semibold shrink-0",
                                due.urgent ? "text-red-600" : "text-muted-foreground",
                              )}
                            >
                              {due.label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredItems.length === 0 && (
                  <div className="py-8 text-center text-[11px] text-muted-foreground">
                    No Things match search.
                  </div>
                )}
              </div>
            </aside>

            {/* Right Column: Thing Detail Workspace */}
            <div className="flex-1 flex flex-col min-h-0 overflow-auto bg-white">
              <div className="w-full max-w-4xl mx-auto px-8 py-6 flex flex-col gap-6 flex-1">
                <div
                  key={`detail-${thing.id}`}
                  className="w-full flex-1 motion-safe:animate-in motion-safe:fade-in-0 duration-[240ms] motion-reduce:transition-none motion-reduce:animate-none"
                >
                  <ThingDetailContent
                    initialThing={thing}
                    headerAction={headerAction}
                    onAfterTerminalAction={onClose}
                    variant="court"
                    viewOnly={viewOnly}
                  />
                </div>

                {magicBoxProps && !viewOnly && (
                  <div className="mt-auto pt-6 pb-2 flex justify-center">
                    <div className="w-full max-w-2xl">
                      <MagicBox listId={magicBoxProps.listId} listName={magicBoxProps.listName} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </main>
        </section>
      </>
    );
  }

  // Fallback inline workspace for callers without a list of items (e.g. mobile Court, Nudges, With Others)
  return (
    <section
      aria-label="Inline Thing details"
      className={cn(
        "grid min-w-0 items-start gap-6 transition-all duration-200 lg:grid-cols-[minmax(280px,330px)_minmax(0,1fr)]",
        className,
      )}
    >
      <div className={cn("min-w-0 overflow-x-hidden", sourceClassName)}>{children}</div>

      <div
        className={cn(
          "min-w-0 p-6 md:p-8 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200",
          flatPanel ? "rounded-[10px] bg-white" : "rounded-2xl border border-border/80 bg-white shadow-xs",
        )}
        style={flatPanel ? { boxShadow: FLAT_PANEL_SHADOW } : undefined}
      >
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto overscroll-contain">
          <ThingDetailContent
            initialThing={thing}
            headerAction={headerAction}
            onAfterTerminalAction={onClose}
            variant="court"
            viewOnly={viewOnly}
          />
        </div>
      </div>
    </section>
  );
}
