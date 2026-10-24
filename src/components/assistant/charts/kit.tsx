"use client";

import {
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { DEFAULT_LOCALE, formatMoney, minorUnitDigits } from "@/lib/money";

// Pieces every chart shares: money text, colours, a readout line, tappable marks and
// a scrubber for line charts. Charts are SVG drawn on a 320-wide canvas that scales
// to the card, so shapes and text keep their proportions on any phone.

export const W = 320;

const SLOTS = 8;
const SERIES = Array.from({ length: SLOTS }, (_, i) => `var(--viz-${i + 1})`);

/** A category keeps its slot; "Other" is always the quiet grey. */
export const seriesColor = (label: string, index: number) =>
  label === "Other" ? "var(--viz-other)" : SERIES[index % SLOTS];

/** Gold from nearly nothing to full strength, for "how much" on one scale. */
export const heat = (t: number) =>
  `color-mix(in oklab, var(--surface-3), var(--gold) ${Math.round(Math.min(Math.max(t, 0), 1) * 100)}%)`;

export function useMoney(currency: string) {
  const digits = minorUnitDigits(currency);
  const compact = new Intl.NumberFormat(DEFAULT_LOCALE, { notation: "compact", maximumFractionDigits: 1 });
  return {
    full: (minor: number) => formatMoney(minor, currency),
    // No pesewas, for tight spots like small tiles.
    whole: (minor: number) =>
      new Intl.NumberFormat(DEFAULT_LOCALE, { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 10 ** digits),
    // 1.2K for axis ticks and tight labels.
    short: (minor: number) => compact.format(minor / 10 ** digits),
  };
}

export const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

/** Shortens a name to fit a label. */
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The line above a chart that says what the finger is on. */
export function Readout({
  color,
  title,
  value,
  note,
}: {
  color?: string;
  title: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3" aria-live="polite">
      <div className="flex min-w-0 items-center gap-2">
        {color && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          {note && <p className="line-clamp-2 text-xs leading-snug text-ink-2">{note}</p>}
        </div>
      </div>
      <p className="shrink-0 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

/** A tappable mark inside an SVG: works with a finger, a mouse and the keyboard. */
export function Hit({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="cursor-pointer outline-none focus-visible:[&_.focus-ring]:opacity-100"
    >
      {children}
    </g>
  );
}

/** A dot and a name, for keys under a chart. */
export function Key({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0 w-4 rounded-full border-t-[3px]"
            style={{ borderColor: item.color, borderTopStyle: item.dashed ? "dotted" : "solid" }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Lets a finger or the arrow keys pick one of `count` evenly spaced positions across
 * an area. Returns the picked index and handlers for the element covering the area.
 */
export function useScrub(count: number, start: number) {
  const [picked, setPicked] = useState<number | null>(null);
  const index = Math.min(Math.max(picked ?? start, 0), Math.max(count - 1, 0));

  // The pads are fractions of the width, so they hold as the chart scales.
  function pick(area: Element, clientX: number, padLeft = 0, padRight = 0) {
    const box = area.getBoundingClientRect();
    if (box.width === 0) return;
    const span = box.width * (1 - padLeft - padRight);
    const t = span > 0 ? (clientX - box.left - box.width * padLeft) / span : 0;
    setPicked(Math.min(Math.max(Math.round(t * (count - 1)), 0), count - 1));
  }

  return {
    index,
    setIndex: setPicked,
    handlers: (padLeft: number, padRight: number) => ({
      onPointerDown: (e: PointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e.currentTarget, e.clientX, padLeft, padRight);
      },
      onPointerMove: (e: PointerEvent) => {
        if (e.buttons === 1 || e.pointerType === "mouse") pick(e.currentTarget, e.clientX, padLeft, padRight);
      },
      onKeyDown: (e: KeyboardEvent) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        setPicked(Math.min(Math.max(index + step, 0), count - 1));
      },
    }),
  };
}

/** Round up to a tidy top for an axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function tidyMax(value: number) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= value) ?? 10 * pow);
}
