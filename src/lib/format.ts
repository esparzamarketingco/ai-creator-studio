export const fmtNumber = (n: number | null | undefined) => (n === null || n === undefined ? "—" : new Intl.NumberFormat("en-US").format(n));
export const fmtPct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`);
export const fmtMoney = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
// dateStyle/timeStyle cannot be combined with timeZoneName, so the fields are spelled out.
const DATE_TIME: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
export const fmtDateTime = (d: Date | string, tz?: string) =>
  new Intl.DateTimeFormat("en-US", { ...DATE_TIME, ...(tz ? { timeZone: tz } : {}) }).format(new Date(d));
export const fmtDate = (d: Date | string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(d));
export const fmtBytes = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
export const weekdayLabel = (dateStr: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${dateStr}T00:00:00Z`));
