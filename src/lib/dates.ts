import { DEFAULT_LOCALE } from "@/lib/money";

const pad = (n: number) => String(n).padStart(2, "0");

// "2026-10-23" in the device's own time zone (what a person means by "today").
export function localDateKey(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey() {
  return localDateKey(new Date());
}

// A date picked in an <input type="date"> becomes noon that day, so the day
// can't shift when the time zone changes. Today keeps the real time.
export function dateKeyToIso(key: string, now = new Date()) {
  if (key === localDateKey(now)) return now.toISOString();
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

export function startOfMonthIso(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function startOfNextMonthIso(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
}

// "Today", "Yesterday", then "Mon 20 Oct" (adds the year when it differs).
export function dayLabel(key: string, now = new Date()) {
  if (key === localDateKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === localDateKey(yesterday)) return "Yesterday";

  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(y !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

export function monthLabel(now = new Date()) {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(now);
}

// ---- Month keys ("2026-10-01") -----------------------------------------------
// The budget and report functions take the first day of a month.

export function monthKeyOf(date: Date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

export const currentMonthKey = () => monthKeyOf(new Date());

function keyToDate(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function shiftMonthKey(key: string, by: number) {
  const d = keyToDate(key);
  return monthKeyOf(new Date(d.getFullYear(), d.getMonth() + by, 1));
}

// "October 2026" (long), "Oct 2026" (medium) or "Oct" (short).
export function monthKeyLabel(key: string, style: "long" | "medium" | "short" = "long") {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    month: style === "long" ? "long" : "short",
    ...(style !== "short" ? { year: "numeric" as const } : {}),
  }).format(keyToDate(key));
}

// Start (inclusive) and end (exclusive) of a month as ISO timestamps, for
// filtering the transaction list.
export function monthRangeIso(key: string) {
  const d = keyToDate(key);
  return {
    from: d.toISOString(),
    to: new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString(),
  };
}

export function daysInMonthKey(key: string) {
  const d = keyToDate(key);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
