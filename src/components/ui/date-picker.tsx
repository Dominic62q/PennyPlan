"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { dayLabel, monthKeyLabel, todayKey } from "@/lib/dates";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

// A month calendar in the app's own sheet instead of the browser's date picker.
// Days outside `min` and `max` (both "YYYY-MM-DD") cannot be chosen.
export function DatePickerSheet({
  open,
  onClose,
  title = "Pick a date",
  value,
  onChange,
  min,
  max,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  value: string;
  onChange: (key: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {/* Mounted only while open, so it always starts on the chosen month. */}
      {open && <Calendar value={value} onPick={(k) => (onChange(k), onClose())} min={min} max={max} />}
    </Sheet>
  );
}

function Calendar({
  value,
  onPick,
  min,
  max,
}: {
  value: string;
  onPick: (key: string) => void;
  min?: string;
  max?: string;
}) {
  const today = todayKey();
  const start = value || today;
  const [year, setYear] = useState(Number(start.slice(0, 4)));
  const [month, setMonth] = useState(Number(start.slice(5, 7)) - 1);

  // Monday first: blanks before the 1st, then every day of the month.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];

  const blocked = (key: string) => (min !== undefined && key < min) || (max !== undefined && key > max);
  const shift = (by: number) => {
    const d = new Date(year, month + by, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };
  const firstOfMonth = keyOf(year, month, 1);
  const lastOfMonth = keyOf(year, month, days);
  const canPrev = min === undefined || min < firstOfMonth;
  const canNext = max === undefined || max > lastOfMonth;

  return (
    <div className="flex flex-col gap-3 pb-1">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={!canPrev}
          onClick={() => shift(-1)}
          className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition active:scale-95 disabled:opacity-30"
        >
          <ChevronLeft size={20} />
        </button>
        <p aria-live="polite" className="font-semibold">
          {monthKeyLabel(firstOfMonth, "long")}
        </p>
        <button
          type="button"
          aria-label="Next month"
          disabled={!canNext}
          onClick={() => shift(1)}
          className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition active:scale-95 disabled:opacity-30"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-medium text-ink-3">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} />;
          const key = keyOf(year, month, d);
          const selected = key === value;
          return (
            <button
              key={key}
              type="button"
              disabled={blocked(key)}
              aria-pressed={selected}
              aria-label={dayLabel(key)}
              onClick={() => onPick(key)}
              className={`mx-auto flex size-11 items-center justify-center rounded-full text-[0.95rem] tabular-nums transition active:scale-90 disabled:opacity-25 ${
                selected
                  ? "bg-gold font-bold text-on-gold"
                  : key === today
                    ? "bg-surface-2 font-semibold text-gold-text"
                    : "text-ink"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>

      {!blocked(today) && (
        <button
          type="button"
          onClick={() => onPick(today)}
          className="min-h-11 self-center rounded-full px-5 text-sm font-semibold text-gold-text transition active:scale-95"
        >
          Today
        </button>
      )}
    </div>
  );
}

// A field that shows a date and opens the calendar when tapped.
export function DateField({
  value,
  onChange,
  min,
  max,
  title,
  label,
  placeholder = "Choose a date",
  className = "",
}: {
  value: string;
  onChange: (key: string) => void;
  min?: string;
  max?: string;
  title?: string;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={label}
        onClick={() => setOpen(true)}
        className={className}
      >
        {value ? dayLabel(value) : <span className="text-ink-3">{placeholder}</span>}
      </button>
      <DatePickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
      />
    </>
  );
}
