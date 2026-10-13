import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatMinutes, parseMinutes } from "@/domain/coey/calendar";
import { useCoeyContext } from "@/features/court/coey/use-coey-context";

type LooseRpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
const DAYS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]] as const;

/**
 * The holder calendar every lane, cadence and delivery window uses (spec §3.3,
 * §7.4). Coey never nudges outside these hours, on days off, holidays or leave.
 */
export function WorkingTimeSettings() {
  const { calendar } = useCoeyContext();
  const qc = useQueryClient();
  const [days, setDays] = useState<number[]>(calendar.workDays);
  const [start, setStart] = useState(formatMinutes(calendar.workStart));
  const [end, setEnd] = useState(formatMinutes(calendar.workEnd));
  const [offSat, setOffSat] = useState(calendar.offSaturdays.includes(2) && calendar.offSaturdays.includes(4));
  const [homeStart, setHomeStart] = useState(formatMinutes(calendar.homeStart));
  const [homeEnd, setHomeEnd] = useState(formatMinutes(calendar.homeEnd));
  const [holidays, setHolidays] = useState(calendar.holidays.join(", "));
  const [leaveStart, setLeaveStart] = useState(calendar.leave[0]?.start ?? "");
  const [leaveEnd, setLeaveEnd] = useState(calendar.leave[0]?.end ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDays(calendar.workDays);
    setStart(formatMinutes(calendar.workStart));
    setEnd(formatMinutes(calendar.workEnd));
    setOffSat(calendar.offSaturdays.includes(2) && calendar.offSaturdays.includes(4));
    setHomeStart(formatMinutes(calendar.homeStart));
    setHomeEnd(formatMinutes(calendar.homeEnd));
    setHolidays(calendar.holidays.join(", "));
    setLeaveStart(calendar.leave[0]?.start ?? "");
    setLeaveEnd(calendar.leave[0]?.end ?? "");
  }, [calendar]);

  const save = async () => {
    const ws = parseMinutes(start), we = parseMinutes(end), hs = parseMinutes(homeStart), he = parseMinutes(homeEnd);
    if (ws === null || we === null || ws >= we) { toast.error("Work hours need a start before the end."); return; }
    if (hs === null || he === null || hs >= he) { toast.error("Home hours need a start before the end."); return; }
    if (!days.length) { toast.error("Choose at least one working day."); return; }
    const holidayList = holidays.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean);
    if (holidayList.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) { toast.error("Write holidays as YYYY-MM-DD, separated by commas."); return; }
    if ((leaveStart && !leaveEnd) || (!leaveStart && leaveEnd) || (leaveStart && leaveEnd && leaveStart > leaveEnd)) { toast.error("Leave needs a start and an end date."); return; }
    setSaving(true);
    const { error } = await (supabase.rpc as unknown as LooseRpc)("set_my_calendar", {
      p_calendar: {
        work_days: days, work_start: ws, work_end: we, off_saturdays: offSat ? [2, 4] : [],
        holidays: holidayList, festivals: [], leave: leaveStart ? [{ start: leaveStart, end: leaveEnd }] : [],
        home_start: hs, home_end: he,
      },
    });
    setSaving(false);
    if (error) { toast.error("Couldn’t save your working time. Try again."); return; }
    toast.success("Working time saved");
    void qc.invalidateQueries({ queryKey: ["coey"] });
    void qc.invalidateQueries({ queryKey: ["court"] });
  };

  const input = "h-9 rounded-lg border border-border px-2 text-[13px]";
  return (
    <div className="space-y-4 text-[13px]">
      <p className="text-[12.5px] text-muted-foreground">Coey counts time only inside these hours, in {calendar.timezone}. It never follows up on days off, holidays or leave.</p>
      <fieldset>
        <legend className="mb-1.5 font-medium">Working days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map(([label, value]) => (
            <button key={value} type="button" aria-pressed={days.includes(value)} onClick={() => setDays((d) => (d.includes(value) ? d.filter((x) => x !== value) : [...d, value]))}
              className="rounded-full border border-border px-3 py-1 aria-pressed:border-violet-400 aria-pressed:bg-violet-50 aria-pressed:text-violet-700">{label}</button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={offSat} onChange={(e) => setOffSat(e.target.checked)} /> 2nd and 4th Saturday off
        </label>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">Work starts<input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1">Work ends<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1">Home time starts<input type="time" value={homeStart} onChange={(e) => setHomeStart(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1">Home time ends<input type="time" value={homeEnd} onChange={(e) => setHomeEnd(e.target.value)} className={input} /></label>
      </div>
      <label className="flex flex-col gap-1">Holidays (YYYY-MM-DD, comma separated)
        <input value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder="2026-11-08, 2026-12-25" className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">Leave from<input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1">Leave until<input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} className={input} /></label>
      </div>
      <button type="button" disabled={saving} onClick={() => void save()} className="h-9 rounded-lg bg-violet-600 px-4 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save working time"}</button>
    </div>
  );
}
