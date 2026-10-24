"use client";

import { useState } from "react";
import { WEEKDAYS, monthName } from "@/lib/assistant/chart-data";
import { arcPath, polar } from "@/lib/assistant/chart-geometry";
import type { ChartSpec } from "@/lib/assistant/chart-spec";
import { heat, Hit, Readout, useMoney, W } from "./kit";

type Spec<K extends ChartSpec["kind"]> = Extract<ChartSpec, { kind: K }>;

// How spending falls across days, weekdays and weeks.

const FULL_DAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const longDay = (month: string, day: number) => `${day} ${monthName(month)}`;

export function CalendarChart({ spec }: { spec: Spec<"calendar"> }) {
  const m = useMoney(spec.currency);
  const peak = spec.days.reduce((best, a, i) => (a > spec.days[best] ? i : best), 0);
  const [picked, setPicked] = useState(peak);
  const max = Math.max(...spec.days, 1);
  const [y, mo] = spec.month.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
  const total = spec.days.reduce((a, b) => a + b, 0);
  const quiet = spec.days.slice(0, spec.through).filter((a) => a === 0).length;

  return (
    <div>
      <Readout
        title={longDay(spec.month, picked + 1)}
        value={picked < spec.through ? m.full(spec.days[picked]) : "–"}
        note={picked >= spec.through ? "Hasn't happened yet" : picked === peak && spec.days[peak] > 0 ? "Your biggest day" : spec.days[picked] === 0 ? "A day with no spending" : undefined}
      />
      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={spec.title}>
        {WEEKDAYS.map((d) => (
          <span key={d} className="pb-0.5 text-center text-[0.65rem] font-medium text-ink-3">
            {d[0]}
            <span className="sr-only">{d.slice(1)}</span>
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {spec.days.map((amount, i) => {
          const future = i >= spec.through;
          const t = amount / max;
          const on = picked === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setPicked(i)}
              aria-pressed={on}
              aria-label={`${longDay(spec.month, i + 1)}: ${future ? "not yet" : m.full(amount)}`}
              className={`viz-pop relative flex aspect-square items-center justify-center rounded-lg text-[0.68rem] font-semibold tabular-nums transition-shadow ${
                future ? "border border-dashed border-line" : ""
              } ${on ? "ring-2 ring-ink" : ""}`}
              style={{
                background: future ? "transparent" : amount === 0 ? "var(--surface-3)" : heat(0.22 + 0.78 * Math.sqrt(t)),
                color: future ? "var(--ink-3)" : amount === 0 ? "var(--ink-3)" : t > 0.17 ? "#201800" : "var(--ink)",
                animationDelay: `${i * 14}ms`,
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex items-center justify-between text-xs text-ink-2">
        <span>
          {quiet > 0 ? `${quiet} quiet ${quiet === 1 ? "day" : "days"} · ` : ""}
          {m.full(total)} in all
        </span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          Less
          {[0.1, 0.35, 0.6, 0.85, 1].map((t) => (
            <span key={t} className="size-3 rounded-[4px]" style={{ background: heat(0.22 + 0.78 * Math.sqrt(t)) }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

// ---- A flower of weekdays -----------------------------------------------------------

export function WeekdayChart({ spec }: { spec: Spec<"weekday"> }) {
  const m = useMoney(spec.currency);
  const peak = spec.days.reduce((best, d, i) => (d.average > spec.days[best].average ? i : best), 0);
  const [picked, setPicked] = useState(peak);
  const max = Math.max(...spec.days.map((d) => d.average), 1);
  const cx = W / 2;
  const cy = 128;
  const inner = 30;
  const reach = 76;
  const step = 360 / 7;
  const day = spec.days[picked];

  return (
    <div>
      <Readout
        title={FULL_DAYS[picked]}
        value={m.full(day.average)}
        note={`on a typical ${day.label} · ${m.full(day.total)} in all${picked === peak && day.average > 0 ? " · your busiest" : ""}`}
      />
      <svg viewBox={`0 0 ${W} 256`} className="w-full" role="group" aria-label={spec.title}>
        {[1 / 3, 2 / 3, 1].map((t) => (
          <circle key={t} cx={cx} cy={cy} r={inner + reach * t} fill="none" stroke="var(--viz-grid)" strokeDasharray={t === 1 ? undefined : "2 4"} />
        ))}
        {spec.days.map((d, i) => {
          const from = i * step + 1.8;
          const to = (i + 1) * step - 1.8;
          const outer = inner + Math.max((d.average / max) * reach, d.average > 0 ? 4 : 1.5);
          const label = polar(cx, cy, inner + reach + 15, (from + to) / 2);
          const on = picked === i;
          return (
            <Hit key={d.label} label={`${d.label}: ${m.full(d.average)} on average`} selected={on} onSelect={() => setPicked(i)}>
              <path
                d={arcPath(cx, cy, inner + reach + 4, inner - 2, from, to)}
                fill="transparent"
              />
              <path
                d={arcPath(cx, cy, outer, inner, from, to)}
                fill={i === peak ? "var(--gold)" : heat(0.28 + 0.4 * (d.average / max))}
                stroke={on ? "#fff" : "var(--surface-2)"}
                strokeWidth={on ? 2 : 1.5}
                strokeLinejoin="round"
                className="viz-pop"
                style={{ animationDelay: `${i * 70}ms` }}
              />
              <text x={label.x} y={label.y + 3.5} textAnchor="middle" fontSize="10.5" fontWeight={on ? 700 : 500} className={on ? "fill-ink" : "fill-ink-2"}>
                {d.label}
              </text>
            </Hit>
          );
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="9.5" className="fill-ink-3">
          average
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="11.5" fontWeight="700" className="fill-ink">
          {m.short(day.average)}
        </text>
      </svg>
    </div>
  );
}

// ---- A punchcard of weeks and weekdays -------------------------------------------------

export function PunchcardChart({ spec }: { spec: Spec<"punchcard"> }) {
  const m = useMoney(spec.currency);
  const max = Math.max(...spec.weeks.flatMap((w) => w.amounts), 1);
  let best = { w: 0, d: 0 };
  spec.weeks.forEach((w, wi) =>
    w.amounts.forEach((a, di) => {
      if (a > spec.weeks[best.w].amounts[best.d]) best = { w: wi, d: di };
    }),
  );
  const [picked, setPicked] = useState(best);
  const left = 46;
  const col = (W - left - 8) / 7;
  const row = 24;
  const top = 22;
  const height = top + spec.weeks.length * row + 6;
  const chosen = spec.weeks[picked.w];

  return (
    <div>
      <Readout
        title={`${WEEKDAYS[picked.d]}, week of ${chosen.label}`}
        value={m.full(chosen.amounts[picked.d])}
        note={picked.w === best.w && picked.d === best.d && chosen.amounts[picked.d] > 0 ? "The biggest day here" : undefined}
      />
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="group" aria-label={spec.title}>
        {WEEKDAYS.map((d, i) => (
          <text key={d} x={left + col * i + col / 2} y={13} textAnchor="middle" fontSize="10" className="fill-ink-3">
            {d}
          </text>
        ))}
        {spec.weeks.map((week, wi) => (
          <g key={week.label}>
            <text x={left - 8} y={top + wi * row + row / 2 + 3.5} textAnchor="end" fontSize="9.5" className="fill-ink-3">
              {week.label}
            </text>
            <line x1={left} x2={W - 8} y1={top + wi * row + row} y2={top + wi * row + row} stroke="var(--viz-grid)" />
            {week.amounts.map((a, di) => {
              const cx = left + col * di + col / 2;
              const cy = top + wi * row + row / 2;
              const r = a > 0 ? 2.5 + 8.5 * Math.sqrt(a / max) : 1.6;
              const on = picked.w === wi && picked.d === di;
              return (
                <Hit key={di} label={`${WEEKDAYS[di]}, week of ${week.label}: ${a ? m.full(a) : "nothing"}`} selected={on} onSelect={() => setPicked({ w: wi, d: di })}>
                  <rect x={cx - col / 2} y={cy - row / 2} width={col} height={row} fill="transparent" />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={a > 0 ? heat(0.4 + 0.6 * Math.sqrt(a / max)) : "var(--surface-3)"}
                    stroke={on ? "#fff" : "none"}
                    strokeWidth={1.75}
                    className="viz-pop"
                    style={{ animationDelay: `${(wi * 7 + di) * 12}ms` }}
                  />
                </Hit>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
