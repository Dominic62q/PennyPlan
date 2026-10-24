"use client";

import { useId, useState } from "react";
import { areaPath, smoothPath } from "@/lib/assistant/chart-geometry";
import type { ChartSpec } from "@/lib/assistant/chart-spec";
import { Hit, Key, Readout, seriesColor, tidyMax, useMoney, useScrub, W } from "./kit";

type Spec<K extends ChartSpec["kind"]> = Extract<ChartSpec, { kind: K }>;

// ---- Lines: spending over time, and the pace of a month ---------------------------

const H = 196;
const PAD = { l: 40, r: 12, t: 12, b: 26 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

type Line = { name: string; values: number[]; color: string; dashed?: boolean; area?: boolean };

function LineChart({
  currency,
  title,
  lines,
  count,
  axis,
  describe,
  start,
}: {
  currency: string;
  title: string;
  lines: Line[];
  // How many positions the x axis has (a line may stop short of it).
  count: number;
  // The labels under the axis, as [position, text].
  axis: [number, string][];
  describe: (i: number) => { title: string; value: string; note?: string };
  start: number;
}) {
  const m = useMoney(currency);
  const id = useId();
  const scrub = useScrub(count, start);
  const max = tidyMax(Math.max(...lines.flatMap((l) => l.values), 1));
  const x = (i: number) => PAD.l + (count > 1 ? (i / (count - 1)) * PLOT_W : PLOT_W / 2);
  const y = (v: number) => PAD.t + PLOT_H * (1 - v / max);
  const read = describe(scrub.index);
  const primary = lines[0];

  return (
    <div>
      <Readout color={primary.color} title={read.title} value={read.value} note={read.note} />
      <div
        role="slider"
        tabIndex={0}
        aria-label={title}
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={scrub.index + 1}
        aria-valuetext={`${read.title}: ${read.value}`}
        {...scrub.handlers(PAD.l / W, PAD.r / W)}
        className="touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none">
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary.color} stopOpacity="0.38" />
              <stop offset="100%" stopColor={primary.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(max * t)} y2={y(max * t)} stroke={t === 0 ? "var(--line-strong)" : "var(--viz-grid)"} />
              <text x={PAD.l - 6} y={y(max * t) + 3.5} textAnchor="end" fontSize="9.5" className="fill-ink-3">
                {m.short(max * t)}
              </text>
            </g>
          ))}
          {axis.map(([i, label]) => (
            <text key={i} x={x(i)} y={H - 7} textAnchor={i === 0 ? "start" : i === count - 1 ? "end" : "middle"} fontSize="10" className="fill-ink-3">
              {label}
            </text>
          ))}

          {[...lines].reverse().map((line) => {
            const pts = line.values.map((v, i) => ({ x: x(i), y: y(v) }));
            return (
              <g key={line.name}>
                {line.area && pts.length > 1 && (
                  <path d={areaPath(pts, y(0))} fill={`url(#${id}-fill)`} className="viz-fade" />
                )}
                <path
                  d={smoothPath(pts)}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={line.dashed ? 2 : 2.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={line.dashed ? "1 5" : undefined}
                  pathLength={line.dashed ? undefined : 1}
                  className={line.dashed ? "viz-fade" : "viz-draw"}
                />
              </g>
            );
          })}

          <line x1={x(scrub.index)} x2={x(scrub.index)} y1={PAD.t} y2={PAD.t + PLOT_H} stroke="var(--ink-3)" strokeDasharray="3 3" />
          {lines.map((line) =>
            scrub.index < line.values.length ? (
              <circle key={line.name} cx={x(scrub.index)} cy={y(line.values[scrub.index])} r={4.5} fill={line.color} stroke="var(--surface-2)" strokeWidth={2.5} />
            ) : null,
          )}
        </svg>
      </div>
      {lines.length > 1 && <Key items={lines.map((l) => ({ label: l.name, color: l.color, dashed: l.dashed }))} />}
    </div>
  );
}

export function TrendChart({ spec }: { spec: Spec<"trend"> }) {
  const m = useMoney(spec.currency);
  const n = spec.points.length;
  const peak = spec.points.reduce((best, p, i) => (p.amount > spec.points[best].amount ? i : best), 0);
  const lines: Line[] = [{ name: "This period", values: spec.points.map((p) => p.amount), color: "var(--gold)", area: true }];
  if (spec.previous) {
    lines.push({ name: spec.previousLabel ?? "Before", values: spec.previous, color: "var(--ink-2)", dashed: true });
  }
  const ticks = n > 8 ? [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1] : [...Array(n).keys()];
  return (
    <LineChart
      currency={spec.currency}
      title={spec.title}
      lines={lines}
      count={n}
      start={peak}
      axis={ticks.map((i) => [i, spec.points[i].label.replace("Week of ", "")])}
      describe={(i) => ({
        title: spec.points[i].label,
        value: m.full(spec.points[i].amount),
        note: spec.previous ? `Before: ${m.full(spec.previous[i] ?? 0)}` : i === peak ? "The highest point" : undefined,
      })}
    />
  );
}

export function PaceChart({ spec }: { spec: Spec<"pace"> }) {
  const m = useMoney(spec.currency);
  const last = spec.current.length - 1;
  return (
    <LineChart
      currency={spec.currency}
      title={spec.title}
      count={spec.days}
      start={last}
      lines={[
        { name: spec.currentLabel, values: spec.current, color: "var(--gold)", area: true },
        { name: spec.previousLabel, values: spec.previous, color: "var(--ink-2)", dashed: true },
      ]}
      axis={[
        [0, "1"],
        [Math.round((spec.days - 1) / 3), String(Math.round((spec.days - 1) / 3) + 1)],
        [Math.round(((spec.days - 1) * 2) / 3), String(Math.round(((spec.days - 1) * 2) / 3) + 1)],
        [spec.days - 1, String(spec.days)],
      ]}
      describe={(i) => {
        const now = i < spec.current.length ? spec.current[i] : null;
        const before = spec.previous[Math.min(i, spec.previous.length - 1)];
        const gap = now === null ? null : now - before;
        return {
          title: `By day ${i + 1}`,
          value: now === null ? "–" : m.full(now),
          note:
            gap === null
              ? `${spec.previousLabel}: ${m.full(before)}`
              : gap === 0
                ? `Level with ${spec.previousLabel}`
                : `${m.full(Math.abs(gap))} ${gap > 0 ? "more" : "less"} than ${spec.previousLabel}`,
        };
      }}
    />
  );
}

// ---- Columns: income and spending month by month -----------------------------------

const MH = 204;
const MPAD = { l: 40, r: 8, t: 14, b: 26 };

export function MonthsChart({ spec }: { spec: Spec<"months"> }) {
  const m = useMoney(spec.currency);
  const [picked, setPicked] = useState(spec.points.length - 1);
  const n = spec.points.length;
  const slot = (W - MPAD.l - MPAD.r) / n;
  const plotH = MH - MPAD.t - MPAD.b;
  const net = spec.shape === "net";

  const nets = spec.points.map((p) => p.income - p.expense);
  const top = tidyMax(net ? Math.max(...nets, 1) : Math.max(...spec.points.flatMap((p) => [p.income, p.expense]), 1));
  const bottom = net ? Math.min(...nets, 0) : 0;
  const low = net && bottom < 0 ? -tidyMax(-bottom) : 0;
  const y = (v: number) => MPAD.t + plotH * (1 - (v - low) / (top - low));
  const zero = y(0);
  const point = spec.points[picked];
  const delta = point.income - point.expense;

  return (
    <div>
      <Readout
        color={net ? (delta >= 0 ? "var(--income)" : "var(--expense)") : undefined}
        title={point.label}
        value={`${net && delta > 0 ? "+" : ""}${m.full(net ? delta : point.expense)}`}
        note={net ? `Income ${m.full(point.income)} · Spent ${m.full(point.expense)}` : `Income ${m.full(point.income)} · ${delta >= 0 ? "Kept" : "Short by"} ${m.full(Math.abs(delta))}`}
      />
      <svg viewBox={`0 0 ${W} ${MH}`} className="w-full select-none" role="group" aria-label={spec.title}>
        {(low < 0 ? [low, 0, top] : [0, top / 2, top]).map((v) => (
          <g key={v}>
            <line x1={MPAD.l} x2={W - MPAD.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--line-strong)" : "var(--viz-grid)"} />
            <text x={MPAD.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" className="fill-ink-3">
              {m.short(v)}
            </text>
          </g>
        ))}
        {spec.points.map((p, i) => {
          const cx = MPAD.l + slot * i + slot / 2;
          const bar = Math.min(slot * 0.62, 26);
          const pair = Math.min(slot * 0.36, 15);
          const on = i === picked;
          return (
            <Hit key={p.label + i} label={`${p.label}: income ${m.full(p.income)}, spent ${m.full(p.expense)}`} selected={on} onSelect={() => setPicked(i)}>
              <rect x={MPAD.l + slot * i + 1} y={MPAD.t - 4} width={slot - 2} height={plotH + 8} rx={8} fill={on ? "var(--surface-3)" : "transparent"} opacity={0.7} />
              {net ? (
                <rect
                  x={cx - bar / 2}
                  width={bar}
                  y={Math.min(y(nets[i]), zero)}
                  height={Math.max(Math.abs(y(nets[i]) - zero), 2)}
                  rx={4}
                  fill={nets[i] >= 0 ? "var(--income)" : "var(--expense)"}
                  opacity={on ? 1 : 0.75}
                  className="viz-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                />
              ) : (
                (
                  [
                    [p.income, "var(--income)", -pair - 1],
                    [p.expense, "var(--expense)", 1],
                  ] as const
                ).map(([value, color, dx], j) => (
                  <rect
                    key={j}
                    x={cx + dx}
                    width={pair}
                    y={y(value)}
                    height={Math.max(zero - y(value), value > 0 ? 2 : 0)}
                    rx={4}
                    fill={color}
                    opacity={on ? 1 : 0.7}
                    className="viz-up"
                    style={{ animationDelay: `${i * 60 + j * 40}ms` }}
                  />
                ))
              )}
              <text x={cx} y={MH - 8} textAnchor="middle" fontSize="10.5" className={on ? "fill-ink" : "fill-ink-3"} fontWeight={on ? 700 : 400}>
                {p.label}
              </text>
            </Hit>
          );
        })}
      </svg>
      {!net && (
        <Key
          items={[
            { label: "Income", color: "var(--income)" },
            { label: "Spent", color: "var(--expense)" },
          ]}
        />
      )}
    </div>
  );
}

// ---- Stacked columns: where each month went ---------------------------------------

export function StackedChart({ spec }: { spec: Spec<"stacked"> }) {
  const m = useMoney(spec.currency);
  const [sel, setSel] = useState<{ m: number; s: number | null }>({ m: spec.months.length - 1, s: null });
  const n = spec.months.length;
  const slot = (W - MPAD.l - MPAD.r) / n;
  const plotH = MH - MPAD.t - MPAD.b;
  const totals = spec.months.map((mo) => mo.amounts.reduce((a, b) => a + b, 0));
  const top = tidyMax(Math.max(...totals, 1));
  const y = (v: number) => MPAD.t + plotH * (1 - v / top);
  const month = spec.months[sel.m];
  const part = sel.s === null ? null : month.amounts[sel.s];

  return (
    <div>
      <Readout
        color={sel.s === null ? undefined : seriesColor(spec.series[sel.s], sel.s)}
        title={sel.s === null ? month.label : `${month.label} · ${spec.series[sel.s]}`}
        value={m.full(part ?? totals[sel.m])}
        note={sel.s === null ? "Tap a colour to read it" : `${Math.round((part! / Math.max(totals[sel.m], 1)) * 100)}% of the month`}
      />
      <svg viewBox={`0 0 ${W} ${MH}`} className="w-full select-none" role="group" aria-label={spec.title}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={MPAD.l} x2={W - MPAD.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--line-strong)" : "var(--viz-grid)"} />
            <text x={MPAD.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" className="fill-ink-3">
              {m.short(v)}
            </text>
          </g>
        ))}
        {spec.months.map((mo, i) => {
          const cx = MPAD.l + slot * i + slot / 2;
          const bar = Math.min(slot * 0.62, 30);
          let acc = 0;
          return (
            <g key={mo.label + i} opacity={sel.m === i ? 1 : 0.62} style={{ transition: "opacity 0.2s" }}>
              {mo.amounts.map((amount, s) => {
                const from = acc;
                acc += amount;
                if (amount <= 0) return null;
                const height = Math.max(y(from) - y(acc) - 1.5, 1);
                return (
                  <Hit key={s} label={`${mo.label}, ${spec.series[s]}: ${m.full(amount)}`} selected={sel.m === i && sel.s === s} onSelect={() => setSel({ m: i, s })}>
                    <rect
                      x={cx - bar / 2}
                      y={y(acc)}
                      width={bar}
                      height={height}
                      rx={3.5}
                      fill={seriesColor(spec.series[s], s)}
                      stroke={sel.m === i && sel.s === s ? "#fff" : "none"}
                      strokeWidth={1.5}
                      className="viz-up"
                      style={{ animationDelay: `${i * 50 + s * 30}ms` }}
                    />
                  </Hit>
                );
              })}
              <Hit label={`${mo.label}: ${m.full(totals[i])} in total`} selected={sel.m === i && sel.s === null} onSelect={() => setSel({ m: i, s: null })}>
                <text x={cx} y={MH - 8} textAnchor="middle" fontSize="10.5" className={sel.m === i ? "fill-ink" : "fill-ink-3"} fontWeight={sel.m === i ? 700 : 400}>
                  {mo.label}
                </text>
                <rect x={cx - slot / 2} y={MH - 22} width={slot} height={22} fill="transparent" />
              </Hit>
            </g>
          );
        })}
      </svg>
      <Key items={spec.series.map((name, s) => ({ label: name, color: seriesColor(name, s) }))} />
    </div>
  );
}
