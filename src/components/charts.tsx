"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Money } from "@/components/ui/money";
import { niceMax } from "@/lib/chart-scale";
import { dayLabel, monthKeyLabel } from "@/lib/dates";
import { DEFAULT_LOCALE, formatMoney, minorUnitDigits } from "@/lib/money";

// Both charts are plain HTML so text stays crisp and every column is a real,
// finger-sized target. Hovering or tapping only reveals a value that the table
// view and the readout already carry, so nothing depends on it.

const CHART_HEIGHT = 168;

function compact(minor: number, currency: string) {
  const major = minor / 10 ** minorUnitDigits(currency);
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(major);
}

function Frame({
  max,
  currency,
  children,
}: {
  max: number;
  currency: string;
  children: ReactNode;
}) {
  return (
    <div className="pt-2">
      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {[1, 0.5].map((t) => (
          <div
            key={t}
            aria-hidden
            className="absolute inset-x-0 flex translate-y-1/2 items-center gap-2"
            style={{ bottom: `${t * 100}%` }}
          >
            <span className="w-9 shrink-0 text-right text-[0.65rem] tabular-nums text-ink-3">
              {compact(max * t, currency)}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
        ))}
        <span aria-hidden className="absolute bottom-0 left-11 right-0 h-px bg-line-strong" />
        <div className="absolute inset-y-0 left-11 right-0">{children}</div>
      </div>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-[3px]"
      style={{ background: color }}
    />
  );
}

export type TrendPoint = { month: string; income: number; expense: number };

// Income and spending side by side for each of the last few months.
export function TrendChart({
  data,
  currency,
  initial,
}: {
  data: TrendPoint[];
  currency: string;
  initial: string;
}) {
  const start = Math.max(
    0,
    data.findIndex((d) => d.month.slice(0, 7) === initial.slice(0, 7)),
  );
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked ?? start;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => [d.income, d.expense])), currency);
  const point = data[selected];
  if (!point) return null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="shrink-0 text-sm font-semibold">
          {monthKeyLabel(`${point.month.slice(0, 7)}-01`, "medium")}
        </p>
        <p className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm tabular-nums">
          <span className="flex items-center gap-1.5">
            <Swatch color="var(--chart-income)" />
            <span className="text-ink-2">Income</span>
            <span className="font-semibold">{formatMoney(point.income, currency)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Swatch color="var(--chart-expense)" />
            <span className="text-ink-2">Spent</span>
            <span className="font-semibold">{formatMoney(point.expense, currency)}</span>
          </span>
        </p>
      </div>

      <Frame max={max} currency={currency}>
        <div className="flex h-full">
          {data.map((d, i) => {
            const on = i === selected;
            return (
              <button
                key={d.month}
                type="button"
                aria-pressed={on}
                aria-label={`${monthKeyLabel(`${d.month.slice(0, 7)}-01`)}: income ${formatMoney(d.income, currency)}, spent ${formatMoney(d.expense, currency)}`}
                onClick={() => setPicked(i)}
                className={`flex h-full flex-1 items-end justify-center gap-0.5 rounded-xl px-1 transition-colors ${
                  on ? "bg-surface-2" : ""
                }`}
              >
                {(
                  [
                    [d.income, "var(--chart-income)"],
                    [d.expense, "var(--chart-expense)"],
                  ] as const
                ).map(([value, color], j) => (
                  <span
                    key={j}
                    className="block w-3.5 max-w-[40%] rounded-t-[4px]"
                    style={{
                      height: `${Math.min(100, (value / max) * 100)}%`,
                      minHeight: value > 0 ? 3 : 0,
                      background: color,
                      opacity: on ? 1 : 0.6,
                      transformOrigin: "bottom",
                      animation: `col-grow 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 70 + j * 40}ms both`,
                    }}
                  />
                ))}
              </button>
            );
          })}
        </div>
      </Frame>

      <div className="ml-11 mt-2 flex">
        {data.map((d, i) => (
          <span
            key={d.month}
            className={`flex-1 text-center text-xs ${
              i === selected ? "font-semibold text-ink" : "text-ink-3"
            }`}
          >
            {monthKeyLabel(`${d.month.slice(0, 7)}-01`, "short")}
          </span>
        ))}
      </div>
    </div>
  );
}

export type DayPoint = { day: string; amount: number };

// Spending for each day of the month. Drag a finger across it, or use the
// arrow keys, to read a day.
export function DailyChart({
  data,
  currency,
  initial,
}: {
  data: DayPoint[];
  currency: string;
  initial?: number;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const n = data.length;
  const selected = Math.min(Math.max(picked ?? initial ?? 0, 0), Math.max(n - 1, 0));
  const max = niceMax(Math.max(0, ...data.map((d) => d.amount)), currency);
  const point = data[selected];
  if (!point) return null;

  function pick(clientX: number) {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const i = Math.floor(((clientX - box.left) / box.width) * n);
    setPicked(Math.min(Math.max(i, 0), n - 1));
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setPicked(Math.min(Math.max(selected + step, 0), n - 1));
  }

  const markers = [0, 7, 14, 21, 28].filter((i) => i < n);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Swatch color="var(--chart-expense)" />
          {dayLabel(point.day.slice(0, 10))}
        </p>
        <Money minor={point.amount} currency={currency} size="md" />
      </div>

      <Frame max={max} currency={currency}>
        <div
          ref={ref}
          role="slider"
          tabIndex={0}
          aria-label="Daily spending"
          aria-valuemin={1}
          aria-valuemax={n}
          aria-valuenow={selected + 1}
          aria-valuetext={`${dayLabel(point.day.slice(0, 10))}: ${formatMoney(point.amount, currency)}`}
          onKeyDown={onKeyDown}
          onPointerDown={(e: PointerEvent) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e.clientX);
          }}
          onPointerMove={(e: PointerEvent) => {
            if (e.buttons === 1) pick(e.clientX);
          }}
          className="flex h-full cursor-pointer touch-pan-y items-end gap-px rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {data.map((d, i) => (
            <span key={d.day} className="flex h-full flex-1 items-end">
              <span
                className="block w-full rounded-t-[3px]"
                style={{
                  height: `${Math.min(100, (d.amount / max) * 100)}%`,
                  minHeight: d.amount > 0 ? 3 : 2,
                  background: d.amount > 0 ? "var(--chart-expense)" : "var(--surface-3)",
                  opacity: i === selected ? 1 : d.amount > 0 ? 0.6 : 1,
                  transformOrigin: "bottom",
                  animation: `col-grow 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 12}ms both`,
                }}
              />
            </span>
          ))}
        </div>
      </Frame>

      <div aria-hidden className="relative ml-11 mt-2 h-4">
        {markers.map((i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 text-xs tabular-nums text-ink-3"
            style={{ left: `${((i + 0.5) / n) * 100}%` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
