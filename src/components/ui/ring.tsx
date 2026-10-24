"use client";

import { useEffect, useState, type ReactNode } from "react";
import { meterTone, type MeterTone } from "./meter";

const STROKE: Record<MeterTone, string> = {
  ok: "var(--income)",
  warn: "var(--warning)",
  over: "var(--expense)",
};

// A circular progress ring that sweeps to its value when it appears.
export function Ring({
  ratio,
  size = 132,
  thickness = 12,
  label,
  children,
}: {
  ratio: number;
  size?: number;
  thickness?: number;
  label: string;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(ratio));
    return () => cancelAnimationFrame(id);
  }, [ratio]);

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(shown, 1));

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STROKE[meterTone(ratio)]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - filled)}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.2, 0.8, 0.2, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
