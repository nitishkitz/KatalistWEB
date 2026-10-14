export type DateTimeMode = "date" | "time" | "datetime-local";

const pad = (n: number) => String(n).padStart(2, "0");

/** Wall-clock strings stay local; callers retain their existing timezone conversion. */
export function calendarDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2})?$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

export function dateTimeValue(date: Date | undefined, hour: string, minute: string, period: "AM" | "PM", mode: DateTimeMode): string {
  if (mode !== "time" && (!date || Number.isNaN(date.getTime()))) return "";
  const datePart = date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : "";
  if (mode === "date") return datePart;
  const h = Number(hour), m = Number(minute);
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute) || h < 1 || h > 12 || m < 0 || m > 59) return "";
  const time = `${pad(h % 12 + (period === "PM" ? 12 : 0))}:${pad(m)}`;
  return mode === "time" ? time : `${datePart}T${time}`;
}

export function clockParts(value: string) {
  const match = /(?:^|T)(\d{2}):(\d{2})$/.exec(value);
  const h = match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) : 9;
  return { hour: pad(h % 12 || 12), minute: match && Number(match[2]) < 60 ? match[2]! : "00", period: (h >= 12 ? "PM" : "AM") as "AM" | "PM" };
}
