"use client";

import { useState } from "react";
import { polar } from "@/lib/assistant/chart-geometry";
import type { ChartSpec } from "@/lib/assistant/chart-spec";
import { clip, Hit, Key, percent, Readout, seriesColor, useMoney, W } from "./kit";

type Spec<K extends ChartSpec["kind"]> = Extract<ChartSpec, { kind: K }>;

// Where money went (waterfall and flowing ribbons) and how this period sits against
// the one before (radar and dumbbells).

type Step = { label: string; amount: number; color: string; kind: "income" | "spend" | "left" };

function steps(spec: Spec<"cashflow">): Step[] {
  return [
    { label: "Income", amount: spec.income, color: "var(--income)", kind: "income" },
    ...spec.steps.map((s, i): Step => ({ label: s.label, amount: s.amount, color: seriesColor(s.label, i), kind: "spend" })),
    {
      label: spec.left >= 0 ? "Left" : "Short",
      amount: Math.abs(spec.left),
      color: spec.left >= 0 ? "var(--gold)" : "var(--viz-warn)",
      kind: "left",
    },
  ];
}

function describeStep(spec: Spec<"cashflow">, step: Step, fmt: (n: number) => string) {
  const base = Math.max(spec.income, 1);
  return {
    title: step.label,
    value: fmt(step.amount),
    note:
      step.kind === "income"
        ? "Money that came in"
        : step.kind === "left"
          ? spec.left >= 0
            ? `${percent(step.amount, base)} of income kept`
            : "More went out than came in"
          : `${percent(step.amount, base)} of income`,
  };
}

export function WaterfallChart({ spec }: { spec: Spec<"cashflow"> }) {
  const m = useMoney(spec.currency);
  const all = steps(spec);
  const [picked, setPicked] = useState(0);
  const H = 232;
  const top = 26;
  const baseY = H - 44;
  const plotH = baseY - top;
  const out = spec.steps.reduce((a, s) => a + s.amount, 0);
  const high = Math.max(spec.income, out, 1);
  const low = Math.min(spec.left, 0);
  const y = (v: number) => top + (plotH * (high - v)) / (high - low);
  const zero = y(0);
  const n = all.length;
  const slot = (W - 12) / n;
  const bar = Math.min(slot * 0.68, 34);

  const rects = all.map((step, i) => {
    let from = 0;
    let to = 0;
    if (step.kind === "income") {
      to = spec.income;
    } else if (step.kind === "spend") {
      const level = spec.income - all.slice(0, i).reduce((n, s) => n + (s.kind === "spend" ? s.amount : 0), 0);
      from = level - step.amount;
      to = level;
    } else {
      from = 0;
      to = spec.left;
    }
    const a = Math.min(y(from), y(to));
    const b = Math.max(y(from), y(to));
    return { step, i, x: 6 + slot * i + (slot - bar) / 2, y: a, h: Math.max(b - a, 2), level: step.kind === "spend" ? from : to };
  });

  const read = describeStep(spec, all[picked], m.full);
  return (
    <div>
      <Readout color={all[picked].color} {...read} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="group" aria-label={spec.title}>
        <line x1={6} x2={W - 6} y1={zero} y2={zero} stroke="var(--line-strong)" />
        {rects.slice(0, -1).map((r, i) => (
          <line
            key={i}
            x1={r.x + bar}
            x2={rects[i + 1].x}
            y1={y(r.level)}
            y2={y(r.level)}
            stroke="var(--ink-3)"
            strokeDasharray="2 3"
            opacity={0.8}
          />
        ))}
        {rects.map((r) => {
          const on = r.i === picked;
          return (
            <Hit key={r.i} label={`${r.step.label}: ${m.full(r.step.amount)}`} selected={on} onSelect={() => setPicked(r.i)}>
              <rect x={r.x - 3} y={0} width={bar + 6} height={H} fill="transparent" />
              <rect
                x={r.x}
                y={r.y}
                width={bar}
                height={r.h}
                rx={5}
                fill={r.step.color}
                opacity={on ? 1 : 0.8}
                stroke={on ? "#fff" : "none"}
                strokeWidth={1.5}
                className="viz-up"
                style={{ animationDelay: `${r.i * 80}ms` }}
              />
              <text x={r.x + bar / 2} y={r.y - 5} textAnchor="middle" fontSize="10" fontWeight="600" className={on ? "fill-ink" : "fill-ink-2"}>
                {r.step.kind === "spend" ? "−" : r.step.kind === "left" && spec.left < 0 ? "−" : ""}
                {m.short(r.step.amount)}
              </text>
              <text x={r.x + bar / 2} y={baseY + 22} textAnchor="middle" fontSize="9.5" className={on ? "fill-ink" : "fill-ink-3"} fontWeight={on ? 700 : 400}>
                {clip(r.step.label, Math.max(Math.floor(slot / 5.3), 4))}
              </text>
            </Hit>
          );
        })}
      </svg>
    </div>
  );
}

export function FlowChart({ spec }: { spec: Spec<"cashflow"> }) {
  const m = useMoney(spec.currency);
  const all = steps(spec);
  const [picked, setPicked] = useState(0);
  const targets = all.slice(1);
  const H = 272;
  const gap = 6;
  const minNode = 24; // room for a name and a figure beside it
  const out = spec.steps.reduce((a, s) => a + s.amount, 0);
  const usable = H - 16 - gap * (targets.length - 1);
  // Shrink until the nodes, each at least tall enough to label, fit the card.
  let scale = usable / (Math.max(spec.income, out + Math.max(spec.left, 0), 1));
  const heightsAt = (k: number) => targets.reduce((a, t) => a + Math.max(t.amount * k, minNode), 0);
  for (let i = 0; i < 40 && heightsAt(scale) > usable; i++) scale *= 0.94;
  const leftX = 6;
  const rightX = 198;
  const nodeW = 12;

  // Right-hand nodes, stacked top to bottom with a gap.
  const nodeHeights = targets.map((step) => Math.max(step.amount * scale, minNode));
  const right = targets.map((step, i) => ({
    step,
    y: 8 + nodeHeights.slice(0, i).reduce((n, h) => n + h + gap, 0),
    h: nodeHeights[i],
  }));

  // The ribbons leave the income bar in order; if more went out than came in they
  // are squeezed to what there was.
  const squeeze = out > spec.income && out > 0 ? spec.income / out : 1;
  const incomeH = Math.max(spec.income * scale, 8);
  const incomeY = Math.max((H - incomeH) / 2 - 6, 8);
  // The ribbon is as thick as the money it carries, even where its label needs a taller node.
  const thickness = right.map((node) =>
    node.step.kind === "left" && spec.left < 0
      ? 0
      : Math.max(node.step.amount * scale * (node.step.kind === "spend" ? squeeze : 1), 1.5),
  );
  const ribbons = right.map((node, i) => ({
    ...node,
    sy: incomeY + thickness.slice(0, i).reduce((n, h) => n + h, 0),
    sh: thickness[i],
  }));

  const read = describeStep(spec, all[picked], m.full);
  const curve = (r: (typeof ribbons)[number]) => {
    const mid = (leftX + nodeW + rightX) / 2;
    const y0 = r.sy;
    const y1 = r.sy + r.sh;
    return `M${leftX + nodeW} ${y0}C${mid} ${y0} ${mid} ${r.y} ${rightX} ${r.y}L${rightX} ${r.y + r.h}C${mid} ${r.y + r.h} ${mid} ${y1} ${leftX + nodeW} ${y1}Z`;
  };

  return (
    <div>
      <Readout color={all[picked].color} {...read} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="group" aria-label={spec.title}>
        <Hit label={`Income: ${m.full(spec.income)}`} selected={picked === 0} onSelect={() => setPicked(0)}>
          <rect x={leftX} y={incomeY} width={nodeW} height={incomeH} rx={4} fill="var(--income)" stroke={picked === 0 ? "#fff" : "none"} strokeWidth={1.5} />
          <rect x={0} y={incomeY - 4} width={nodeW + 12} height={incomeH + 8} fill="transparent" />
        </Hit>
        <text x={leftX + nodeW + 4} y={incomeY - 6} fontSize="10" className="fill-ink-2">
          Income
        </text>
        {ribbons.map((r, i) => {
          const on = picked === i + 1;
          return (
            <Hit key={r.step.label + i} label={`${r.step.label}: ${m.full(r.step.amount)}`} selected={on} onSelect={() => setPicked(i + 1)}>
              {r.sh > 0 && (
                <path d={curve(r)} fill={r.step.color} opacity={on ? 0.62 : 0.3} className="viz-fade" style={{ animationDelay: `${i * 90}ms`, transition: "opacity 0.2s" }} />
              )}
              <rect
                x={rightX}
                y={r.y}
                width={nodeW}
                height={r.h}
                rx={4}
                fill={r.step.color}
                stroke={on ? "#fff" : "none"}
                strokeWidth={1.5}
                className="viz-pop"
                style={{ animationDelay: `${i * 90}ms` }}
              />
              <rect x={rightX - 4} y={r.y - 2} width={W - rightX + 4} height={r.h + 4} fill="transparent" />
              <text x={rightX + nodeW + 7} y={r.y + r.h / 2 - 1} fontSize="10.5" fontWeight="600" className={on ? "fill-ink" : "fill-ink-2"} dominantBaseline="auto">
                {clip(r.step.label, 14)}
              </text>
              <text x={rightX + nodeW + 7} y={r.y + r.h / 2 + 11} fontSize="10" className="fill-ink-3">
                {m.short(r.step.amount)} · {percent(r.step.amount, Math.max(spec.income, 1))}
              </text>
            </Hit>
          );
        })}
      </svg>
    </div>
  );
}

// ---- This period against the one before ------------------------------------------------

function changeText(current: number, previous: number) {
  if (previous === 0 && current === 0) return "–";
  if (previous === 0) return "new";
  if (current === 0) return "none";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? "same" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

export function RadarChart({ spec }: { spec: Spec<"compare"> }) {
  const m = useMoney(spec.currency);
  const [picked, setPicked] = useState(0);
  const n = spec.rows.length;
  const max = Math.max(...spec.rows.flatMap((r) => [r.current, r.previous]), 1);
  const cx = W / 2;
  const cy = 128;
  const R = 78;
  const angle = (i: number) => (360 / n) * i;
  const at = (i: number, value: number) => polar(cx, cy, (value / max) * R, angle(i));
  const shape = (pick: (r: (typeof spec.rows)[number]) => number) =>
    spec.rows.map((r, i) => at(i, pick(r))).map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("") + "Z";
  const row = spec.rows[picked];

  return (
    <div>
      <Readout
        color="var(--gold)"
        title={row.label}
        value={m.full(row.current)}
        note={`${spec.previousLabel}: ${m.full(row.previous)} · ${changeText(row.current, row.previous)}`}
      />
      <svg viewBox={`0 0 ${W} 256`} className="w-full select-none" role="group" aria-label={spec.title}>
        {[1 / 3, 2 / 3, 1].map((t) => (
          <path
            key={t}
            d={Array.from({ length: n }, (_, i) => polar(cx, cy, R * t, angle(i))).map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("") + "Z"}
            fill="none"
            stroke="var(--viz-grid)"
            strokeWidth={1.2}
          />
        ))}
        {spec.rows.map((_, i) => {
          const edge = polar(cx, cy, R, angle(i));
          return <line key={i} x1={cx} y1={cy} x2={edge.x} y2={edge.y} stroke="var(--viz-grid)" />;
        })}
        <path d={shape((r) => r.previous)} fill="none" stroke="var(--ink-2)" strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" strokeLinejoin="round" className="viz-fade" />
        <path d={shape((r) => r.current)} fill="var(--gold)" fillOpacity={0.2} stroke="var(--gold)" strokeWidth={2.75} strokeLinejoin="round" className="viz-pop" />
        {spec.rows.map((r, i) => {
          const p = at(i, r.current);
          const label = polar(cx, cy, R + 17, angle(i));
          const on = picked === i;
          return (
            <Hit key={r.label} label={`${r.label}: ${m.full(r.current)}, before ${m.full(r.previous)}`} selected={on} onSelect={() => setPicked(i)}>
              <circle cx={label.x} cy={label.y} r={20} fill="transparent" />
              <circle cx={p.x} cy={p.y} r={on ? 6 : 4.5} fill="var(--gold)" stroke="var(--surface-2)" strokeWidth={2.5} />
              <text
                x={label.x}
                y={label.y + 3.5}
                textAnchor={Math.abs(label.x - cx) < 6 ? "middle" : label.x > cx ? "start" : "end"}
                fontSize="10.5"
                fontWeight={on ? 700 : 500}
                className={on ? "fill-ink" : "fill-ink-2"}
              >
                {clip(r.label, 11)}
              </text>
            </Hit>
          );
        })}
      </svg>
      <Key
        items={[
          { label: spec.currentLabel, color: "var(--gold)" },
          { label: spec.previousLabel, color: "var(--ink-2)", dashed: true },
        ]}
      />
    </div>
  );
}

export function DumbbellChart({ spec }: { spec: Spec<"compare"> }) {
  const m = useMoney(spec.currency);
  const [picked, setPicked] = useState(0);
  const max = Math.max(...spec.rows.flatMap((r) => [r.current, r.previous]), 1);
  const left = 92;
  const right = W - 50;
  const row = 36;
  const H = spec.rows.length * row + 8;
  const x = (v: number) => left + ((right - left) * v) / max;
  const chosen = spec.rows[picked];

  return (
    <div>
      <Readout
        color="var(--gold)"
        title={chosen.label}
        value={m.full(chosen.current)}
        note={`${spec.previousLabel}: ${m.full(chosen.previous)} · ${changeText(chosen.current, chosen.previous)}`}
      />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="group" aria-label={spec.title}>
        {spec.rows.map((r, i) => {
          const cy = 4 + i * row + row / 2;
          const on = picked === i;
          const a = x(Math.min(r.current, r.previous));
          const b = x(Math.max(r.current, r.previous));
          return (
            <Hit key={r.label} label={`${r.label}: ${m.full(r.current)}, before ${m.full(r.previous)}`} selected={on} onSelect={() => setPicked(i)}>
              <rect x={0} y={cy - row / 2} width={W} height={row} rx={8} fill={on ? "var(--surface-3)" : "transparent"} opacity={0.7} />
              <text x={8} y={cy + 3.5} fontSize="11" fontWeight={on ? 700 : 500} className={on ? "fill-ink" : "fill-ink-2"}>
                {clip(r.label, 13)}
              </text>
              <line x1={left} x2={right} y1={cy} y2={cy} stroke="var(--viz-grid)" strokeWidth={2} strokeLinecap="round" />
              <line x1={a} x2={b} y1={cy} y2={cy} stroke="var(--ink-3)" strokeWidth={4} strokeLinecap="round" className="viz-fade" />
              <circle cx={x(r.previous)} cy={cy} r={5.5} fill="var(--surface-2)" stroke="var(--ink-2)" strokeWidth={2} />
              <circle cx={x(r.current)} cy={cy} r={6.5} fill="var(--gold)" stroke="var(--surface-2)" strokeWidth={2} className="viz-pop" style={{ animationDelay: `${i * 60}ms` }} />
              <text x={W - 6} y={cy + 3.5} textAnchor="end" fontSize="10.5" fontWeight="600" className="fill-ink-2">
                {changeText(r.current, r.previous)}
              </text>
            </Hit>
          );
        })}
      </svg>
      <Key
        items={[
          { label: spec.currentLabel, color: "var(--gold)" },
          { label: spec.previousLabel, color: "var(--ink-2)", dashed: true },
        ]}
      />
    </div>
  );
}
