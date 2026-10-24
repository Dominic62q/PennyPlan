"use client";

import { useId, useState } from "react";
import { arcPath, packCircles, polar, squarify } from "@/lib/assistant/chart-geometry";
import type { ChartSpec } from "@/lib/assistant/chart-spec";
import { clip, Hit, percent, Readout, seriesColor, useMoney, W } from "./kit";

type Parts = Extract<ChartSpec, { kind: "parts" }>;

// One total split into parts, four ways. Tapping a part reads it out; tapping it
// again lets go.

function useChoice() {
  const [picked, setPicked] = useState<number | null>(null);
  return { picked, toggle: (i: number) => setPicked((p) => (p === i ? null : i)) };
}

function ReadPart({ spec, index }: { spec: Parts; index: number | null }) {
  const m = useMoney(spec.currency);
  const item = index === null ? null : spec.items[index];
  if (!item) return <Readout title="Total" value={m.full(spec.total)} note="Tap a part to read it" />;
  return (
    <Readout
      color={seriesColor(item.label, index!)}
      title={item.label}
      value={m.full(item.amount)}
      note={`${percent(item.amount, spec.total)} of the total${item.count ? ` · ${item.count} ${item.count === 1 ? "entry" : "entries"}` : ""}`}
    />
  );
}

function Rows({ spec, picked, onPick }: { spec: Parts; picked: number | null; onPick: (i: number) => void }) {
  const m = useMoney(spec.currency);
  return (
    <ul className="mt-1 divide-y divide-line">
      {spec.items.map((item, i) => (
        <li key={item.label}>
          <button
            type="button"
            onClick={() => onPick(i)}
            aria-pressed={picked === i}
            className={`flex w-full items-center gap-2.5 rounded-lg px-1 py-2 text-left text-sm transition-colors ${
              picked === i ? "bg-surface-3" : ""
            }`}
          >
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: seriesColor(item.label, i) }} />
            <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
            <span className="shrink-0 tabular-nums text-ink-2">{percent(item.amount, spec.total)}</span>
            <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{m.full(item.amount)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DonutChart({ spec }: { spec: Parts }) {
  const m = useMoney(spec.currency);
  const { picked, toggle } = useChoice();
  const cx = W / 2;
  const cy = 104;
  const sweeps = spec.items.map((item) => (spec.total > 0 ? (item.amount / spec.total) * 360 : 0));
  const slices = spec.items.map((item, i) => {
    const from = sweeps.slice(0, i).reduce((n, s) => n + s, 0);
    return { item, i, from, to: from + sweeps[i] };
  });
  const chosen = picked === null ? null : spec.items[picked];

  return (
    <div>
      <ReadPart spec={spec} index={picked} />
      <svg viewBox={`0 0 ${W} 208`} className="w-full" role="group" aria-label={spec.title}>
        {slices.map(({ item, i, from, to }, n) => {
          const mid = polar(0, 0, 1, (from + to) / 2);
          const pop = picked === i ? 6 : 0;
          return (
            <Hit key={item.label} label={`${item.label}: ${m.full(item.amount)}`} selected={picked === i} onSelect={() => toggle(i)}>
              <g style={{ transform: `translate(${mid.x * pop}px, ${mid.y * pop}px)`, transition: "transform 0.2s" }}>
                <path
                  d={arcPath(cx, cy, 94, 62, from, to)}
                  fill={seriesColor(item.label, i)}
                  stroke="var(--surface-2)"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  opacity={picked === null || picked === i ? 1 : 0.45}
                  className="viz-pop"
                  style={{ animationDelay: `${n * 70}ms`, transition: "opacity 0.2s" }}
                />
              </g>
            </Hit>
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-ink-2" fontSize="11">
          {chosen ? clip(chosen.label, 16) : "Total"}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="fill-ink" fontSize="20" fontWeight="700">
          {m.short(chosen ? chosen.amount : spec.total)}
        </text>
      </svg>
      <Rows spec={spec} picked={picked} onPick={toggle} />
    </div>
  );
}

export function BarsChart({ spec }: { spec: Parts }) {
  const m = useMoney(spec.currency);
  const { picked, toggle } = useChoice();
  const max = Math.max(...spec.items.map((i) => i.amount), 1);
  return (
    <div>
      <ReadPart spec={spec} index={picked} />
      <ul className="mt-1 flex flex-col gap-2.5">
        {spec.items.map((item, i) => (
          <li key={item.label}>
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-pressed={picked === i}
              className="block w-full text-left"
              style={{ opacity: picked === null || picked === i ? 1 : 0.5, transition: "opacity 0.2s" }}
            >
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{item.label}</span>
                <span className="shrink-0 font-semibold tabular-nums">{m.full(item.amount)}</span>
              </span>
              <span className="mt-1 block h-3 overflow-hidden rounded-full bg-surface-3">
                <span
                  className="viz-right block h-full rounded-full"
                  style={{
                    width: `${Math.max((item.amount / max) * 100, 1.5)}%`,
                    background: seriesColor(item.label, i),
                    animationDelay: `${i * 60}ms`,
                  }}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TreemapChart({ spec }: { spec: Parts }) {
  const m = useMoney(spec.currency);
  const { picked, toggle } = useChoice();
  const height = 220;
  const tiles = squarify(
    spec.items.map((i) => i.amount),
    W,
    height,
  );
  return (
    <div>
      <ReadPart spec={spec} index={picked} />
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="group" aria-label={spec.title}>
        {tiles.map((t, i) => {
          const item = spec.items[i];
          const gap = 1.5;
          const w = Math.max(t.w - gap * 2, 0);
          const h = Math.max(t.h - gap * 2, 0);
          const roomForText = w > 58 && h > 36;
          return (
            <Hit key={item.label} label={`${item.label}: ${m.full(item.amount)}`} selected={picked === i} onSelect={() => toggle(i)}>
              <rect
                x={t.x + gap}
                y={t.y + gap}
                width={w}
                height={h}
                rx={9}
                fill={seriesColor(item.label, i)}
                opacity={picked === null || picked === i ? 1 : 0.4}
                className="viz-pop"
                style={{ animationDelay: `${i * 60}ms`, transition: "opacity 0.2s" }}
              />
              {picked === i && (
                <rect x={t.x + gap + 1.5} y={t.y + gap + 1.5} width={Math.max(w - 3, 0)} height={Math.max(h - 3, 0)} rx={8} fill="none" stroke="#fff" strokeWidth={2} />
              )}
              {roomForText && (
                <>
                  <text x={t.x + 10} y={t.y + 22} fontSize="11.5" fontWeight="700" fill="#fff" style={{ paintOrder: "stroke" }} stroke="rgb(0 0 0 / 0.25)" strokeWidth={2.5}>
                    {clip(item.label, Math.floor(w / 6.4))}
                  </text>
                  <text x={t.x + 10} y={t.y + 38} fontSize="11" fill="#fff" opacity={0.92} stroke="rgb(0 0 0 / 0.25)" strokeWidth={2.5} style={{ paintOrder: "stroke" }}>
                    {m.short(item.amount)} · {percent(item.amount, spec.total)}
                  </text>
                </>
              )}
            </Hit>
          );
        })}
      </svg>
      <Rows spec={spec} picked={picked} onPick={toggle} />
    </div>
  );
}

export function BubbleChart({ spec }: { spec: Parts }) {
  const m = useMoney(spec.currency);
  const id = useId();
  const { picked, toggle } = useChoice();
  const height = 236;
  const circles = packCircles(
    spec.items.map((i) => i.amount),
    W,
    height,
  );
  return (
    <div>
      <ReadPart spec={spec} index={picked} />
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="group" aria-label={spec.title}>
        <defs>
          <radialGradient id={`${id}-shine`} cx="32%" cy="28%" r="75%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.38" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.22" />
          </radialGradient>
        </defs>
        {circles.map((c, i) => {
          const item = spec.items[i];
          const color = seriesColor(item.label, i);
          return (
            <Hit key={item.label} label={`${item.label}: ${m.full(item.amount)}`} selected={picked === i} onSelect={() => toggle(i)}>
              <g className="viz-pop" style={{ animationDelay: `${i * 80}ms`, opacity: picked === null || picked === i ? 1 : 0.45, transition: "opacity 0.2s" }}>
                <circle cx={c.x} cy={c.y} r={c.r} fill={color} />
                <circle cx={c.x} cy={c.y} r={c.r} fill={`url(#${id}-shine)`} />
                {picked === i && <circle cx={c.x} cy={c.y} r={c.r + 1} fill="none" stroke="#fff" strokeWidth={2} />}
                {c.r > 24 && (
                  <>
                    <text x={c.x} y={c.y - 1} textAnchor="middle" fontSize={c.r > 40 ? 12 : 10.5} fontWeight="700" fill="#fff" stroke="rgb(0 0 0 / 0.25)" strokeWidth={2.5} style={{ paintOrder: "stroke" }}>
                      {clip(item.label, Math.floor((c.r * 2) / 6.6))}
                    </text>
                    <text x={c.x} y={c.y + 12} textAnchor="middle" fontSize="10.5" fill="#fff" stroke="rgb(0 0 0 / 0.25)" strokeWidth={2.5} style={{ paintOrder: "stroke" }}>
                      {m.short(item.amount)}
                    </text>
                  </>
                )}
              </g>
            </Hit>
          );
        })}
      </svg>
      <Rows spec={spec} picked={picked} onPick={toggle} />
    </div>
  );
}
