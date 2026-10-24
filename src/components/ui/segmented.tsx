"use client";

import * as m from "motion/react-m";
import { useId } from "react";

type Option<T extends string> = { value: T; label: string };

// A pill switch whose highlight glides between options.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  tone = "surface",
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  label: string;
  tone?: "surface" | "dark";
}) {
  const id = useId();
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`relative grid rounded-full p-1 text-sm font-semibold ${
        tone === "dark" ? "bg-white/10" : "bg-surface-2"
      }`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`relative z-10 min-h-11 rounded-full px-3 transition-colors ${
              active
                ? tone === "dark"
                  ? "text-ink"
                  : "text-ink"
                : tone === "dark"
                  ? "text-white/70"
                  : "text-ink-2"
            }`}
          >
            {active && (
              <m.span
                layoutId={`seg-${id}`}
                transition={{ type: "spring", stiffness: 520, damping: 38 }}
                className={`absolute inset-0 -z-10 rounded-full ${
                  tone === "dark" ? "bg-white" : "bg-surface-3 shadow-card"
                }`}
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
