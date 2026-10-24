"use client";

import { useId, useState } from "react";
import { addDays, daysBetween, dayLabel } from "@/lib/assistant/chart-data";
import { arcLine, polar } from "@/lib/assistant/chart-geometry";
import type { ChartSpec } from "@/lib/assistant/chart-spec";
import { clip, Hit, percent, Readout, seriesColor, useMoney, W } from "./kit";

type Spec<K extends ChartSpec["kind"]> = Extract<ChartSpec, { kind: K }>;

// Where things stand right now: budgets, accounts, savings and bills coming up.

const TONE = {
  ok: { color: "var(--income)", word: "On track" },
  warn: { color: "var(--warning)", word: "Close" },
  over: { color: "var(--expense)", word: "Over" },
} as const;

export function BudgetsChart({ spec }: { spec: Spec<"budgets"> }) {
  const m = useMoney(spec.currency);
  const [picked, setPicked] = useState(0);
  const row = spec.rows[picked];
  const left = row.limit - row.spent;

  return (
    <div>
      <Readout
        color={TONE[row.status].color}
        title={row.label}
        value={`${m.full(row.spent)} of ${m.short(row.limit)}`}
        note={left >= 0 ? `${m.full(left)} left · ${TONE[row.status].word}` : `Over by ${m.full(-left)}`}
      />
      <ul className="grid grid-cols-3 gap-1.5" aria-label={spec.title}>
        {spec.rows.map((r, i) => {
          const ratio = r.limit > 0 ? r.spent / r.limit : 0;
          const tone = TONE[r.status];
          const on = picked === i;
          return (
            <li key={r.label + i}>
              <button
                type="button"
                onClick={() => setPicked(i)}
                aria-pressed={on}
                aria-label={`${r.label}: ${m.full(r.spent)} of ${m.full(r.limit)}, ${tone.word}`}
                className={`flex w-full flex-col items-center gap-1 rounded-2xl px-1 pb-2 pt-2.5 transition-colors ${on ? "bg-surface-3" : ""}`}
              >
                <svg viewBox="0 0 84 84" className="size-[5.25rem]" aria-hidden="true">
                  <circle cx={42} cy={42} r={34} fill="none" stroke="var(--surface-3)" strokeWidth={9} />
                  <circle
                    cx={42}
                    cy={42}
                    r={34}
                    fill="none"
                    stroke={tone.color}
                    strokeWidth={9}
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray={`${Math.min(Math.max(ratio, 0.012), 1)} 1`}
                    transform="rotate(-90 42 42)"
                    className="viz-sweep"
                    style={{ animationDelay: `${i * 80}ms` }}
                  />
                  <text x={42} y={47} textAnchor="middle" fontSize="15" fontWeight="700" className="fill-ink">
                    {Math.round(ratio * 100)}%
                  </text>
                </svg>
                <span className="w-full truncate text-center text-xs font-semibold">{r.label}</span>
                <span className="text-[0.65rem] font-medium" style={{ color: tone.color }}>
                  {tone.word}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BalancesChart({ spec }: { spec: Spec<"balances"> }) {
  const m = useMoney(spec.currency);
  const [picked, setPicked] = useState(0);
  const positive = spec.rows.filter((r) => r.amount > 0);
  const sumPositive = positive.reduce((a, r) => a + r.amount, 0);
  const total = spec.rows.reduce((a, r) => a + r.amount, 0);
  const chosen = spec.rows[picked];
  // Where each held amount starts along the strip; only positive balances take room.
  const starts = spec.rows.map((_, i) =>
    spec.rows.slice(0, i).reduce((n, r) => n + (r.amount > 0 ? (r.amount / sumPositive) * W : 0), 0),
  );

  return (
    <div>
      <Readout
        color={chosen.amount > 0 ? seriesColor(chosen.label, picked) : undefined}
        title={chosen.label}
        value={m.full(chosen.amount)}
        note={chosen.amount > 0 ? `${percent(chosen.amount, sumPositive)} of what you hold · ${chosen.type}` : chosen.type}
      />
      {sumPositive > 0 && (
        <svg viewBox={`0 0 ${W} 34`} className="w-full" role="group" aria-label={spec.title}>
          {spec.rows.map((r, i) => {
            if (r.amount <= 0) return null;
            const w = (r.amount / sumPositive) * W;
            const at = starts[i];
            return (
              <Hit key={r.label + i} label={`${r.label}: ${m.full(r.amount)}`} selected={picked === i} onSelect={() => setPicked(i)}>
                <rect
                  x={at + 1}
                  y={3}
                  width={Math.max(w - 2, 1)}
                  height={28}
                  rx={7}
                  fill={seriesColor(r.label, i)}
                  opacity={picked === i ? 1 : 0.7}
                  stroke={picked === i ? "#fff" : "none"}
                  strokeWidth={1.5}
                  className="viz-right"
                  style={{ animationDelay: `${i * 70}ms` }}
                />
              </Hit>
            );
          })}
        </svg>
      )}
      <ul className="mt-1 divide-y divide-line">
        {spec.rows.map((r, i) => (
          <li key={r.label + i}>
            <button
              type="button"
              onClick={() => setPicked(i)}
              aria-pressed={picked === i}
              className={`flex w-full items-center gap-2.5 rounded-lg px-1 py-2 text-left text-sm transition-colors ${picked === i ? "bg-surface-3" : ""}`}
            >
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: r.amount > 0 ? seriesColor(r.label, i) : "var(--expense)" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.label}</span>
                <span className="block truncate text-xs text-ink-2">{r.type}</span>
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${r.amount < 0 ? "text-expense" : ""}`}>{m.full(r.amount)}</span>
            </button>
          </li>
        ))}
        <li className="flex items-center justify-between px-1 pt-2 text-sm">
          <span className="text-ink-2">All together</span>
          <span className="font-bold tabular-nums">{m.full(total)}</span>
        </li>
      </ul>
    </div>
  );
}

export function GaugeChart({ spec }: { spec: Spec<"gauge"> }) {
  const m = useMoney(spec.currency);
  const id = useId();
  const cx = W / 2;
  const cy = 148;
  const r = 104;
  const kept = Math.min(Math.max(spec.rate, 0), 100);
  const end = -90 + (180 * kept) / 100;
  const tip = polar(cx, cy, r, end);
  const noIncome = spec.income <= 0;
  const over = spec.left < 0;

  return (
    <div>
      <svg viewBox={`0 0 ${W} 184`} className="w-full" role="img" aria-label={`${spec.title}: ${noIncome ? "no income recorded" : `${spec.rate}% of income kept`}`}>
        <defs>
          <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--gold)" />
            <stop offset="100%" stopColor="var(--income)" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((t) => {
          const a = polar(cx, cy, r + 17, -90 + 1.8 * t);
          const b = polar(cx, cy, r + 11, -90 + 1.8 * t);
          const label = polar(cx, cy, r + 27, -90 + 1.8 * t);
          return (
            <g key={t}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--ink-3)" />
              <text x={label.x} y={label.y + 3} textAnchor="middle" fontSize="9.5" className="fill-ink-3">
                {t}%
              </text>
            </g>
          );
        })}
        <path d={arcLine(cx, cy, r, -90, 90)} fill="none" stroke="var(--surface-3)" strokeWidth={20} strokeLinecap="round" />
        {kept > 0 && (
          <path d={arcLine(cx, cy, r, -90, end)} fill="none" stroke={`url(#${id}-arc)`} strokeWidth={20} strokeLinecap="round" className="viz-fade" />
        )}
        {kept > 0 && <circle cx={tip.x} cy={tip.y} r={5} fill="#fff" className="viz-pop" style={{ animationDelay: "0.5s" }} />}
        <text x={cx} y={cy - 22} textAnchor="middle" fontSize="40" fontWeight="800" fill={over ? "var(--expense)" : "var(--ink)"}>
          {noIncome ? "–" : `${spec.rate}%`}
        </text>
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="11.5" className="fill-ink-2">
          {noIncome ? "No income recorded" : over ? "overspent" : "of income kept"}
        </text>
      </svg>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Income", m.whole(spec.income), "var(--income)"],
          ["Spent", m.whole(spec.spent), "var(--expense)"],
          [over ? "Short by" : "Kept", m.whole(Math.abs(spec.left)), over ? "var(--expense)" : "var(--gold)"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-2xl bg-surface-3/60 px-1.5 py-2">
            <dt className="flex items-center justify-center gap-1.5 text-[0.7rem] text-ink-2">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: color }} />
              {label}
            </dt>
            <dd className="mt-0.5 truncate text-[0.82rem] font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function TimelineChart({ spec }: { spec: Spec<"timeline"> }) {
  const m = useMoney(spec.currency);
  const items = [...spec.items].sort((a, b) => a.date.localeCompare(b.date));
  const [picked, setPicked] = useState(0);
  const span = Math.max(daysBetween(spec.from, spec.to), 1);
  const left = 22;
  const right = 22;
  const x = (date: string) => left + ((W - left - right) * Math.min(Math.max(daysBetween(spec.from, date), 0), span)) / span;
  const max = Math.max(...items.map((i) => i.amount), 1);
  const base = 74;
  const ticks = Array.from({ length: Math.floor(span / 7) + 1 }, (_, i) => i * 7);
  const seen = new Map<string, number>();
  const chosen = items[picked];
  const until = (date: string) => {
    const n = daysBetween(spec.from, date);
    return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
  };

  return (
    <div>
      <Readout
        color="var(--gold)"
        title={chosen.label}
        value={m.full(chosen.amount)}
        note={`${dayLabel(chosen.date)} · ${until(chosen.date)} · ${chosen.auto ? "pays itself" : "you mark it paid"}`}
      />
      <svg viewBox={`0 0 ${W} 112`} className="w-full" role="group" aria-label={spec.title}>
        <line x1={left} x2={W - right} y1={base} y2={base} stroke="var(--line-strong)" strokeWidth={2} strokeLinecap="round" />
        {ticks.map((t) => {
          const date = addDays(spec.from, t);
          return (
            <g key={t}>
              <line x1={x(date)} x2={x(date)} y1={base - 4} y2={base + 4} stroke="var(--ink-3)" />
              <text x={x(date)} y={base + 18} textAnchor="middle" fontSize="9.5" className="fill-ink-3">
                {t === 0 ? "Today" : dayLabel(date)}
              </text>
            </g>
          );
        })}
        {items.map((item, i) => {
          const stack = seen.get(item.date) ?? 0;
          seen.set(item.date, stack + 1);
          const radius = 6 + 9 * Math.sqrt(item.amount / max);
          const cy = base - 16 - radius - stack * 22;
          const on = picked === i;
          return (
            <Hit key={item.label + i} label={`${item.label}: ${m.full(item.amount)} on ${dayLabel(item.date)}`} selected={on} onSelect={() => setPicked(i)}>
              <line x1={x(item.date)} x2={x(item.date)} y1={cy + radius} y2={base} stroke="var(--ink-3)" strokeDasharray="2 3" />
              <circle cx={x(item.date)} cy={base} r={3.5} fill="var(--gold)" />
              <circle
                cx={x(item.date)}
                cy={cy}
                r={radius}
                fill={seriesColor(item.label, i)}
                stroke={on ? "#fff" : "var(--surface-2)"}
                strokeWidth={on ? 2 : 1.5}
                className="viz-pop"
                style={{ animationDelay: `${i * 70}ms` }}
              />
              <text x={x(item.date)} y={cy + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" stroke="rgb(0 0 0 / 0.25)" strokeWidth={2} style={{ paintOrder: "stroke" }}>
                {i + 1}
              </text>
            </Hit>
          );
        })}
      </svg>
      <ol className="divide-y divide-line">
        {items.map((item, i) => (
          <li key={item.label + i}>
            <button
              type="button"
              onClick={() => setPicked(i)}
              aria-pressed={picked === i}
              className={`flex w-full items-center gap-2.5 rounded-lg px-1 py-2 text-left text-sm transition-colors ${picked === i ? "bg-surface-3" : ""}`}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold text-white" style={{ background: seriesColor(item.label, i) }}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{clip(item.label, 28)}</span>
              <span className="shrink-0 text-xs text-ink-2">{dayLabel(item.date)}</span>
              <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{m.full(item.amount)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
