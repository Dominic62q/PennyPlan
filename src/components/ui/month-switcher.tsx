"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonthKey, monthKeyLabel, shiftMonthKey } from "@/lib/dates";

// Steps one month back or forward. It never goes past the current month, since
// nothing has happened there yet.
export function MonthSwitcher({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  const atLatest = month >= currentMonthKey();
  const step = "flex size-11 items-center justify-center rounded-full text-ink-2 transition active:scale-90 active:bg-surface-2 disabled:opacity-30";

  return (
    <div className="flex items-center justify-between rounded-full border border-line bg-surface p-1 shadow-card">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonthKey(month, -1))}
        className={step}
      >
        <ChevronLeft size={22} />
      </button>
      <p aria-live="polite" className="text-base font-semibold">
        {monthKeyLabel(month)}
      </p>
      <button
        type="button"
        aria-label="Next month"
        disabled={atLatest}
        onClick={() => onChange(shiftMonthKey(month, 1))}
        className={step}
      >
        <ChevronRight size={22} />
      </button>
    </div>
  );
}
