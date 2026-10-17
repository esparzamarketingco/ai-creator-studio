export const US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export const isUsTimezone = (tz: string) => (US_TIMEZONES as readonly string[]).includes(tz);

/** Offset (ms) of `tz` from UTC at instant `date`. */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

/** Convert a wall-clock date ("YYYY-MM-DD") + time ("HH:mm") in an IANA zone to a UTC Date. */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
  if (!m || !t) throw new Error("Invalid date or time");
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  let utc = guess - tzOffsetMs(new Date(guess), tz);
  utc = guess - tzOffsetMs(new Date(utc), tz); // second pass handles DST boundaries
  return new Date(utc);
}

/** "YYYY-MM-DD" of `date` in `tz`. */
export function dateInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function formatInTz(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(date);
}

/** Monday-start week (7 dates) containing `dateStr`. */
export function weekDates(dateStr: string): string[] {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d));
  const dow = (base.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + (i - dow) * 86400000).toISOString().slice(0, 10));
}

export const addDays = (dateStr: string, n: number) => {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) + n * 86400000).toISOString().slice(0, 10);
};
