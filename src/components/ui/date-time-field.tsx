import * as React from "react";
import { addDays, format } from "date-fns";
import { CalendarDays, Clock3, X } from "lucide-react";
import { Calendar, CalendarDayButton } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { calendarDate, clockParts, dateTimeValue, type DateTimeMode } from "./date-time-value";
import { cn } from "@/lib/utils";

function CompactCalendarDayButton(props: React.ComponentProps<typeof CalendarDayButton>) {
  return <CalendarDayButton {...props} className="mx-auto size-8 min-w-0 rounded-full text-xs hover:bg-violet-50 data-[selected-single=true]:bg-violet-600 data-[selected-single=true]:text-white disabled:opacity-30" />;
}

type Props = {
  type: DateTimeMode;
  value?: string;
  defaultValue?: string;
  onChange: (event: { target: { value: string } }) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  required?: boolean;
  timezone?: string;
  allowDateOnly?: boolean;
  removable?: boolean;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApply?: (value: string) => void;
  onRemove?: () => void;
  error?: string | null;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/** Shared transactional picker: navigating and Cancel never change the field. */
export function DateTimeField({ type, value, defaultValue = "", onChange, id, disabled, className, placeholder, min, max, required, timezone, allowDateOnly = false, removable = true, trigger, open: controlledOpen, onOpenChange, onApply, onRemove, error, ...aria }: Props) {
  const [localValue, setLocalValue] = React.useState(defaultValue);
  const current = value ?? localValue;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => { setInternalOpen(next); onOpenChange?.(next); };
  const [date, setDate] = React.useState<Date>();
  const [month, setMonth] = React.useState<Date>();
  const [hour, setHour] = React.useState("09");
  const [minute, setMinute] = React.useState("00");
  const [period, setPeriod] = React.useState<"AM" | "PM">("AM");
  const [includeTime, setIncludeTime] = React.useState(true);
  const headingId = React.useId();
  const dateOnly = type === "date", timeOnly = type === "time";
  const candidate = dateTimeValue(date, hour, minute, period, allowDateOnly && !includeTime ? "date" : type);
  const valid = Boolean(candidate && (!min || candidate >= min) && (!max || candidate <= max));
  const zone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const label = (input: string) => {
    if (!input) return placeholder ?? (timeOnly ? "Choose time" : "Choose date");
    const d = calendarDate(input);
    const c = clockParts(input);
    const time = `${Number(c.hour)}:${c.minute} ${c.period}`;
    return timeOnly ? time : d ? `${format(d, "MMM d, yyyy")}${dateOnly || !input.includes("T") ? "" : ` · ${time}`}` : "Choose date";
  };
  const changeOpen = (next: boolean) => {
    if (next) {
      const selected = calendarDate(current);
      const clock = clockParts(current);
      setDate(selected); setMonth(selected ?? new Date());
      setHour(clock.hour); setMinute(clock.minute); setPeriod(clock.period);
      setIncludeTime(!allowDateOnly || current.includes("T"));
    }
    setOpen(next);
  };
  const commit = (next: string) => {
    setLocalValue(next);
    onChange({ target: { value: next } });
    if (next) onApply?.(next);
    else onRemove?.();
    if (next ? !onApply : !onRemove) setOpen(false);
  };
  const field = "h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100";
  return (
    <Popover open={open && !disabled} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        {trigger ?? <button type="button" id={id} disabled={disabled} {...aria}
          className={cn("flex min-h-9 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-[13px] text-slate-700 outline-none transition-colors hover:border-violet-300 focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50", className)}>
          {timeOnly ? <Clock3 className="size-4 shrink-0" /> : <CalendarDays className="size-4 shrink-0" />}
          <span className={cn("min-w-0 truncate", !current && "text-slate-500")}>{label(current)}</span>
        </button>}
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={16} avoidCollisions aria-labelledby={headingId}
        className="z-[100] flex w-[320px] max-w-[calc(100vw-32px)] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden rounded-2xl border-slate-200 bg-white p-3 text-slate-800 shadow-[0_8px_32px_-8px_rgba(15,23,42,0.22)] motion-reduce:animate-none">
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h3 id={headingId} className="text-sm font-semibold">{timeOnly ? "Choose time" : "Choose date"}</h3>
          <button type="button" aria-label="Close picker" onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-violet-400"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
        {!timeOnly && <>
          <div className="mb-2 flex gap-2">
            {[["Today", 0], ["Tomorrow", 1], ["Next week", 7]].map(([text, offset]) => {
              const next = addDays(new Date(), Number(offset));
              const nextValue = dateTimeValue(next, hour, minute, period, type);
              return <button type="button" key={text} disabled={Boolean((min && nextValue < min) || (max && nextValue > max))}
                onClick={() => { setDate(next); setMonth(next); }}
                className={cn("flex-1 rounded-full border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-40", date && format(date, "yyyy-MM-dd") === format(next, "yyyy-MM-dd") ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 hover:bg-slate-50")}>{text}</button>;
            })}
          </div>
          <Calendar mode="single" selected={date} month={month} onMonthChange={setMonth} onSelect={setDate} weekStartsOn={1}
            disabled={[...(min && calendarDate(min) ? [{ before: calendarDate(min)! }] : []), ...(max && calendarDate(max) ? [{ after: calendarDate(max)! }] : [])]}
            className="w-full bg-white p-0 [--cell-size:2rem]"
            classNames={{ root: "w-full", today: "rounded-full bg-slate-100", month: "flex w-full flex-col gap-2", week: "flex w-full", day: "relative h-8 w-full p-0 text-center" }}
            components={{ DayButton: CompactCalendarDayButton }} />
        </>}
        {!dateOnly && <div className={cn("space-y-2", !timeOnly && "mt-2 border-t border-slate-100 pt-2")}>
          <div className="flex items-center justify-between"><p className="text-sm font-semibold">Time <span className="ml-2 text-xs font-normal text-slate-500">{allowDateOnly ? "Optional" : timeOnly ? "" : "Choose an exact time"}</span></p>
            {allowDateOnly && <button type="button" role="switch" aria-label="Include time" aria-checked={includeTime} onClick={() => setIncludeTime(!includeTime)} className={cn("flex h-5 w-9 items-center rounded-full p-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-violet-400", includeTime ? "bg-violet-600" : "bg-slate-200")}><span className={cn("size-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none", includeTime && "translate-x-4")} /></button>}
          </div>
          {includeTime && <div className="flex items-center gap-2">
            <Clock3 className="mr-1 size-4 shrink-0 text-slate-500" />
            <label className="min-w-0 flex-1"><input aria-label="Hour" inputMode="numeric" maxLength={2} value={hour} onChange={e => setHour(e.target.value.replace(/\D/g, ""))} className={cn(field, "w-full")} /></label>
            <span className="self-start pt-2">:</span>
            <label className="min-w-0 flex-1"><input aria-label="Minute" inputMode="numeric" maxLength={2} value={minute} onChange={e => setMinute(e.target.value.replace(/\D/g, ""))} className={cn(field, "w-full")} /></label>
            <label className="min-w-0 flex-1"><select aria-label="AM or PM" value={period} onChange={e => setPeriod(e.target.value as "AM" | "PM")} className={cn(field, "w-full px-2")}><option>AM</option><option>PM</option></select></label>
          </div>}
          <p className="text-[11px] text-slate-500">Your timezone · {zone}</p>
        </div>}
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
        <div aria-live="polite" className="mt-2 shrink-0 rounded-lg bg-violet-50 px-2 py-1.5 text-xs font-medium text-violet-700">{valid ? label(candidate) : timeOnly ? "Choose a valid time" : dateOnly || !includeTime ? "Choose a valid date" : "Choose a valid date and time"}</div>
        <div className="mt-2 flex shrink-0 items-center gap-2">
          {removable && !required && current && <button type="button" onClick={() => commit("")} className="mr-auto rounded-md px-1 py-2 text-xs text-red-600 hover:bg-red-50">Remove {timeOnly ? "time" : "date"}</button>}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">Cancel</button>
          <button type="button" disabled={!valid || disabled} onClick={() => commit(candidate)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-40">Apply</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
