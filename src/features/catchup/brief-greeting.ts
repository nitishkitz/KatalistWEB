import { resolveEffectiveTimezone } from "./morning-brief-schedule";

/** Manual reopening later in the day should not still say good morning. */
export function briefGreeting(now: Date, name?: string | null, timezone?: string | null): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: resolveEffectiveTimezone(timezone), hour: "numeric", hourCycle: "h23",
  }).format(now));
  const salutation = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName ? `${salutation}, ${firstName}` : salutation;
}
