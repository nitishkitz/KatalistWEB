import { useEffect, type ReactNode } from "react";
import { Calendar, ChevronLeft, FileText, X } from "lucide-react";
import { format } from "date-fns";
import type { Thing } from "@/domain/thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import { ThingDetailContent } from "./ThingDetailContent";

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
};

function ListThingNavigator({
  things,
  selectedThingId,
  onSelect,
  title = "Things",
}: {
  things: Thing[];
  selectedThingId: string;
  onSelect: (thingId: string) => void;
  title?: string;
}) {
  return (
    <nav
      className="flex flex-col rounded-2xl border border-border/80 bg-white p-3.5 shadow-2xs w-full"
      aria-label={`${title} Navigator`}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <h2 className="truncate text-[12.5px] font-bold tracking-[0.04em] text-foreground">
            {title}
          </h2>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary shrink-0">
          {things.length}
        </span>
      </div>

      {/* List Items */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto max-h-[calc(100vh-14rem)] pr-0.5">
        {things.map((item) => {
          const selected = selectedThingId === item.id;
          const isWaiting = item.acknowledgement === "waiting_for_catch";
          const isProgress = item.workStatus === "under_progress";
          const isCompleted = item.workStatus === "sorted";

          const statusText = isWaiting
            ? "Waiting"
            : isProgress
              ? "In Progress"
              : isCompleted
                ? "Done"
                : "Not Started";

          const importanceColor =
            item.ownerImportance === "now"
              ? "text-red-600 bg-red-50 border-red-200"
              : item.ownerImportance === "next"
                ? "text-blue-600 bg-blue-50 border-blue-200"
                : "text-purple-600 bg-purple-50 border-purple-200";

          return (
            <button
              key={item.id}
              type="button"
              aria-current={selected}
              onClick={() => onSelect(item.id)}
              className={cn(
                "group w-full rounded-xl p-3 text-left shadow-2xs outline-none transition-all duration-200 focus-visible:ring-1 focus-visible:ring-primary cursor-pointer",
                selected
                  ? "border-2 border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs font-semibold"
                  : "border border-border/70 bg-white hover:border-primary/40 hover:bg-muted/20",
              )}
            >
              <div className="flex items-start justify-between gap-1.5">
                <span className="block line-clamp-2 text-[12.5px] font-bold leading-snug text-foreground group-hover:text-primary transition-colors">
                  {item.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded border px-1.5 py-0.2 text-[9.5px] font-bold uppercase",
                    importanceColor,
                  )}
                >
                  {item.ownerImportance}
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 text-[10.5px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <PersonAvatar
                    name={item.assignee.name}
                    initials={item.assignee.initials}
                    src={item.assignee.avatarUrl}
                    size={18}
                  />
                  <span className="truncate text-muted-foreground font-medium max-w-[90px]">
                    {item.assignee.name}
                  </span>
                </div>

                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-medium text-[10px]",
                    isWaiting
                      ? "text-orange-600"
                      : isProgress
                        ? "text-blue-600"
                        : isCompleted
                          ? "text-emerald-600"
                          : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isWaiting
                        ? "bg-orange-500"
                        : isProgress
                          ? "bg-blue-500"
                          : isCompleted
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/60",
                    )}
                  />
                  {statusText}
                </span>
              </div>

              {item.dueAt ? (
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                  <Calendar className="h-3 w-3" />
                  <span>{format(new Date(item.dueAt), "MMM d")}</span>
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

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
}: InlineThingDetailWorkspaceProps) {
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

  if (!thing) return <>{children}</>;

  const headerAction = (
    <div className="flex items-center justify-between w-full">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground hover:text-primary outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        aria-label={`Back to ${backLabel || "list"}`}
      >
        <ChevronLeft className="h-3.5 w-3.5 text-foreground" />
        Back to {backLabel || "List"}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close Thing details"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground outline-none hover:border-primary/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const hasNavigator = Boolean(items && items.length > 0 && onSelectThing);

  return (
    <section
      aria-label="Inline Thing details"
      className={cn(
        "grid min-w-0 items-start gap-6 transition-all duration-200 lg:grid-cols-[minmax(280px,330px)_minmax(0,1fr)]",
        className,
      )}
    >
      <div className={cn("min-w-0", sourceClassName)}>
        {hasNavigator ? (
          <ListThingNavigator
            things={items!}
            selectedThingId={thing.id}
            onSelect={onSelectThing!}
            title={navTitle || backLabel || "Things"}
          />
        ) : (
          children
        )}
      </div>

      <div className="min-w-0 rounded-2xl border border-border/80 bg-white p-6 md:p-8 shadow-xs motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
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
