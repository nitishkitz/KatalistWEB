import { useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, Clock, Loader2, Moon, Paperclip, Play, Send, Users } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import type { CoeyPresentation, CoeyRecord, RecordAction, RecordGroup, ResultBlock, ResultEntry } from "@/domain/coey/presentation";
import { cn } from "@/lib/utils";
import { useRecordActions, type RowState } from "./use-record-actions";
import { CoeyMarkdown } from "./CoeyMarkdown";

/**
 * One renderer for Coey's results: a clear outcome, optional counts, and
 * grouped rows whose states and buttons come from the server. Short answers
 * stay compact; long ones collapse the later groups.
 */
const PRIMARY_LABEL: Record<string, string> = { catch: "Catch", mark_sorted: "Mark Sorted", nudge: "Nudge", bring_back: "Bring back" };
const PENDING_LABEL: Record<string, string> = { catch: "Catching…", mark_sorted: "Sorting…", nudge: "Nudging…", bring_back: "Bringing back…" };
const LIFECYCLE: Record<CoeyRecord["lifecycle"], string> = { waiting_for_catch: "Waiting for Catch", in_progress: "In progress", sorted: "Sorted" };
const GROUP_ICON: Record<string, { icon: typeof Clock; tone: string }> = {
  now: { icon: Clock, tone: "text-red-500" },
  next: { icon: Play, tone: "text-blue-600" },
  later: { icon: CalendarDays, tone: "text-violet-600" },
  with_others: { icon: Users, tone: "text-slate-500" },
  snoozed: { icon: Moon, tone: "text-amber-500" },
  sorted: { icon: CheckCircle2, tone: "text-emerald-600" },
};

export function when(iso: string): string {
  const d = new Date(iso);
  const time = format(d, "h:mm a");
  if (isToday(d)) return `Today, ${time}`;
  if (isTomorrow(d)) return `Tomorrow, ${time}`;
  return format(d, "EEE d MMM");
}

export function CoeyResults({ presentation, onOpenThing }: { presentation: CoeyPresentation; onOpenThing: (thingId: string) => void }) {
  const actions = useRecordActions();
  const list = presentation.blocks.find((b) => b.type === "thing_list");
  const groups = list?.type === "thing_list" ? list.groups : [];
  const total = groups.reduce((n, g) => n + g.records.length, 0);
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[19px] font-bold leading-snug tracking-[-0.01em] text-slate-900">{presentation.summary.heading}</h3>
        {presentation.summary.description ? <p className="mt-1 text-sm leading-relaxed text-slate-600">{presentation.summary.description}</p> : null}
      </div>
      {presentation.scope.filters?.length && total > 3 ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Showing">
          <span className="text-xs text-slate-500">Showing</span>
          {presentation.scope.filters.map((f) => (
            <span key={f} className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">{f}</span>
          ))}
        </div>
      ) : null}
      {presentation.blocks.map((block, i) =>
        block.type === "counts" ? (
          <div key={i} className="flex flex-wrap gap-1.5" aria-label="Counts">
            {block.items.map((item) => (
              <span key={item.label} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600">
                <b className="font-semibold text-slate-800">{item.count}</b> {item.label}
              </span>
            ))}
          </div>
        ) : block.type === "thing_detail" ? (
          <ThingDetail key={i} block={block} actions={actions} onOpenThing={onOpenThing} />
        ) : block.type === "timeline" || block.type === "comments" ? (
          <Entries key={i} title={block.title} entries={block.entries} quote={block.type === "comments"} onOpenThing={onOpenThing} />
        ) : block.type === "text" ? (
          <CoeyMarkdown key={i} text={block.markdown} />
        ) : block.type === "notice" ? (
          <p key={i} role="status" className={cn("rounded-lg px-3 py-2 text-xs", block.tone === "warning" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600")}>{block.text}</p>
        ) : null,
      )}
      {groups.length === 1 && !groups[0]!.title ? (
        <RecordList records={groups[0]!.records} actions={actions} onOpenThing={onOpenThing} />
      ) : (
        groups.map((group, index) => (
          <Group key={group.key} group={group} defaultOpen={index < 2 || total <= 6} actions={actions} onOpenThing={onOpenThing} />
        ))
      )}
    </div>
  );
}

type Actions = ReturnType<typeof useRecordActions>;

const stamp = (iso: string) => format(new Date(iso), isToday(new Date(iso)) ? "'Today,' h:mm a" : "EEE d MMM, h:mm a");

function ThingDetail({ block, actions, onOpenThing }: { block: Extract<ResultBlock, { type: "thing_detail" }>; actions: Actions; onOpenThing: (id: string) => void }) {
  const record = actions.current(block.record);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={`About ${record.title}`}>
      <ul><RecordRow record={record} row={actions.rows[record.id] ?? {}} onRun={(kind) => void actions.run(record, kind)} onOpenThing={onOpenThing} /></ul>
      <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5 text-xs text-slate-700">
        {block.notes ? <p className="whitespace-pre-line leading-relaxed"><span className="font-semibold text-slate-800">Notes. </span>{block.notes}</p> : null}
        {block.files.length ? (
          <p className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-slate-800">Files</span>
            {block.files.map((f) => <span key={f} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5"><Paperclip className="h-3 w-3" aria-hidden="true" />{f}</span>)}
          </p>
        ) : null}
        {block.comments.length ? (
          <div><p className="mb-1 font-semibold text-slate-800">Latest comments</p>
            <ul className="space-y-1">{block.comments.slice(0, 5).map((c, i) => <li key={i} className="rounded-lg bg-white px-2 py-1.5"><span className="font-medium">{c.by}</span> <span className="text-slate-400">· {stamp(c.at)}</span><p className="mt-0.5 text-slate-700">{c.text}</p></li>)}</ul>
          </div>
        ) : null}
        {block.history.length ? (
          <div><p className="mb-1 font-semibold text-slate-800">History</p>
            <ol className="space-y-0.5">{block.history.slice(0, 8).map((h, i) => <li key={i} className="flex gap-2"><span className="w-32 shrink-0 text-slate-400">{stamp(h.at)}</span><span>{h.text}{h.by && h.by !== "Katalist member" ? <span className="text-slate-400"> · {h.by}</span> : null}</span></li>)}</ol>
          </div>
        ) : null}
        {block.nudged_at.length ? <p className="text-slate-500">Nudged {block.nudged_at.length === 1 ? "once" : `${block.nudged_at.length} times`}, last {stamp(block.nudged_at[0]!)}.</p> : null}
      </div>
    </section>
  );
}

function Entries({ title, entries, quote, onOpenThing }: { title: string; entries: ResultEntry[]; quote: boolean; onOpenThing: (id: string) => void }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={title}>
      <p className="border-b border-slate-100 px-3 py-2 text-[13px] font-semibold text-slate-800">{title} <span className="font-normal text-slate-500">· {entries.length}</span></p>
      <ol className="divide-y divide-slate-100">
        {entries.map((e, i) => (
          <li key={i} className="px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-1.5 text-slate-500">
              <span>{stamp(e.at)}</span><span aria-hidden="true">·</span><span className="font-medium text-slate-700">{e.by}</span><span aria-hidden="true">·</span>
              <button type="button" onClick={() => onOpenThing(e.thing_id)} className="max-w-[16rem] truncate font-medium text-violet-700 hover:underline focus-visible:ring-2 focus-visible:ring-violet-500">{e.thing_title}</button>
            </div>
            <p className={cn("mt-0.5 text-slate-800", quote ? "border-l-2 border-violet-200 pl-2" : "")}>{e.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Group({ group, defaultOpen, actions, onOpenThing }: { group: RecordGroup; defaultOpen: boolean; actions: Actions; onOpenThing: (id: string) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = GROUP_ICON[group.key];
  const Icon = meta?.icon;
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={`${group.title} · ${group.total}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
        {Icon ? <Icon className={cn("h-4 w-4", meta.tone)} aria-hidden="true" /> : null}
        <span className="flex-1">{group.title} <span className="font-normal text-slate-500">· {group.total}</span></span>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", open ? "rotate-180" : "")} aria-hidden="true" />
      </button>
      {open ? <RecordList records={group.records} actions={actions} onOpenThing={onOpenThing} bordered /> : null}
    </section>
  );
}

function RecordList({ records, actions, onOpenThing, bordered }: { records: CoeyRecord[]; actions: Actions; onOpenThing: (id: string) => void; bordered?: boolean }) {
  return (
    <ul className={cn("divide-y divide-slate-100", bordered ? "border-t border-slate-100" : "overflow-hidden rounded-xl border border-slate-200 bg-white")}>
      {records.map((r) => (
        <RecordRow key={r.id} record={actions.current(r)} row={actions.rows[r.id] ?? {}} onRun={(kind) => void actions.run(actions.current(r), kind)} onOpenThing={onOpenThing} />
      ))}
    </ul>
  );
}

export function RecordRow({ record, row, onRun, onOpenThing }: { record: CoeyRecord; row: RowState; onRun: (kind: "catch" | "mark_sorted" | "nudge" | "bring_back") => void; onOpenThing: (id: string) => void }) {
  const primary = record.actions.find((a): a is RecordAction & { kind: "catch" | "mark_sorted" | "nudge" | "bring_back" } => a.kind !== "open");
  const person = record.relation === "you_sent" ? record.holder : record.from;
  const who = record.relation === "you_sent" ? `With ${record.holder}` : record.from === "You" ? "Your own" : `From ${record.from}`;
  const overdue = record.due_at && new Date(record.due_at).getTime() < Date.now() && record.lifecycle !== "sorted";
  const dueSoon = record.due_at && (isToday(new Date(record.due_at)) || overdue);
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white", person === "You" ? "bg-pink-600" : "bg-teal-600")}>
          {(person === "You" ? "Y" : person.trim()[0] ?? "?").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpenThing(record.id)} className="block max-w-full truncate text-left text-[13.5px] font-semibold text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500" title={record.title}>
            {record.title}
          </button>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
            <span>{who}</span><span aria-hidden="true">·</span><span>{LIFECYCLE[record.lifecycle]}</span>
            {record.file_count ? <><span aria-hidden="true">·</span><span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" aria-hidden="true" />{record.file_count} {record.file_count === 1 ? "file" : "files"}</span></> : null}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {record.due_at ? <Badge tone={dueSoon ? "red" : "slate"} icon={Clock}>{overdue ? "Overdue · " : "Due "}{when(record.due_at)}</Badge> : null}
            {record.snoozed_until ? <Badge tone="violet" icon={Moon}>Snoozed until {when(record.snoozed_until)}</Badge> : null}
            {record.promise_at ? <Badge tone="slate" icon={CalendarDays}>Promised {when(record.promise_at)}</Badge> : null}
            {record.follow_up && record.lifecycle !== "sorted" ? <Badge tone="amber" icon={Clock}>{record.follow_up}</Badge> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => onOpenThing(record.id)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-500">Open Thing</button>
          {primary ? (
            <button
              type="button"
              disabled={primary.status !== "available" || Boolean(row.pending)}
              aria-disabled={primary.status !== "available"}
              onClick={() => onRun(primary.kind)}
              title={primary.reason}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-violet-500",
                primary.status === "available" ? "bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-70" : "cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400",
              )}
            >
              {row.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : primary.kind === "nudge" ? <Send className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              {row.pending ? PENDING_LABEL[row.pending] : PRIMARY_LABEL[primary.kind]}
            </button>
          ) : null}
        </div>
      </div>
      {primary?.status === "unavailable" && primary.reason && !row.done ? (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{primary.reason}</span>
        </p>
      ) : null}
      {row.done ? <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">{row.done}</p> : null}
      {row.error ? <p role="alert" className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{row.error}</p> : null}
    </li>
  );
}

function Badge({ tone, icon: Icon, children }: { tone: "red" | "slate" | "violet" | "amber"; icon: typeof Clock; children: React.ReactNode }) {
  const tones = { red: "border-red-200 bg-red-50 text-red-700", slate: "border-slate-200 bg-slate-50 text-slate-600", violet: "border-violet-200 bg-violet-50 text-violet-700", amber: "border-amber-200 bg-amber-50 text-amber-800" };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>
      <Icon className="h-3 w-3" aria-hidden="true" />{children}
    </span>
  );
}
