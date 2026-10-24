"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_LOCALE, minorUnitDigits } from "@/lib/money";

function parts(minor: number, currency: string) {
  const digits = minorUnitDigits(currency);
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).formatToParts(minor / 10 ** digits);
}

// Counts up to its value the first time it appears, then eases between values.
function useCountUp(target: number, enabled: boolean) {
  const reduced = useReducedMotion();
  const run = enabled && !reduced;
  const [value, setValue] = useState(run ? 0 : target);
  const from = useRef(run ? 0 : target);

  useEffect(() => {
    if (!run) {
      from.current = target;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(target);
      return;
    }
    const controls = animate(from.current, target, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        from.current = v;
        setValue(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [target, run]);

  return value;
}

type Size = "hero" | "xl" | "lg" | "md" | "sm";

const SIZE: Record<Size, { whole: string; small: string }> = {
  hero: { whole: "text-[3.4rem] leading-none tracking-tighter", small: "text-2xl" },
  xl: { whole: "text-4xl leading-none tracking-tight", small: "text-lg" },
  lg: { whole: "text-2xl leading-tight tracking-tight", small: "text-base" },
  md: { whole: "text-lg leading-tight", small: "text-sm" },
  sm: { whole: "text-sm", small: "text-xs" },
};

// Amount with a small currency symbol and decimals, so the whole part leads.
export function Money({
  minor,
  currency,
  size = "md",
  animated = false,
  signed = false,
  className = "",
}: {
  minor: number;
  currency: string;
  size?: Size;
  animated?: boolean;
  // Show an explicit + for positive amounts and − for negative.
  signed?: boolean;
  className?: string;
}) {
  const shown = useCountUp(minor, animated);
  const negative = shown < 0;
  const px = parts(Math.abs(shown), currency);
  const s = SIZE[size];

  return (
    <span
      className={`inline-flex items-baseline font-semibold tabular-nums ${className}`}
      aria-label={`${negative ? "minus " : ""}${new Intl.NumberFormat(DEFAULT_LOCALE, { style: "currency", currency }).format(Math.abs(minor) / 10 ** minorUnitDigits(currency))}`}
    >
      {(negative || signed) && (
        <span className={s.whole} aria-hidden>
          {negative ? "−" : "+"}
        </span>
      )}
      {px.map((p, i) => {
        const small = p.type === "currency" || p.type === "decimal" || p.type === "fraction";
        return (
          <span
            key={i}
            aria-hidden
            className={`${small ? `${s.small} font-medium opacity-70` : s.whole} ${
              p.type === "currency" ? "mr-0.5" : ""
            }`}
          >
            {p.value}
          </span>
        );
      })}
    </span>
  );
}
