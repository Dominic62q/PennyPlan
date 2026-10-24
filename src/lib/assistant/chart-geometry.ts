// Shapes for the charts: arcs, smooth lines, treemap tiles and packed circles.
// Pure maths so it can be tested without a screen. Angles are in degrees, 0 at
// twelve o'clock and growing clockwise.

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const f = (n: number) => Math.round(n * 100) / 100;

export function polar(cx: number, cy: number, r: number, deg: number) {
  return { x: f(cx + r * Math.cos(rad(deg))), y: f(cy + r * Math.sin(rad(deg))) };
}

/** A ring segment (or a pie wedge when `inner` is 0) between two angles. */
export function arcPath(cx: number, cy: number, outer: number, inner: number, from: number, to: number) {
  // A full circle can't be drawn as one arc, so stop just short of it.
  const end = Math.min(to, from + 359.99);
  const large = end - from > 180 ? 1 : 0;
  const a = polar(cx, cy, outer, from);
  const b = polar(cx, cy, outer, end);
  if (inner <= 0) return `M${cx} ${cy}L${a.x} ${a.y}A${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y}Z`;
  const c = polar(cx, cy, inner, end);
  const d = polar(cx, cy, inner, from);
  return `M${a.x} ${a.y}A${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y}L${c.x} ${c.y}A${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y}Z`;
}

/** An open arc line, for rings and gauges. */
export function arcLine(cx: number, cy: number, r: number, from: number, to: number) {
  const end = Math.min(to, from + 359.99);
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, end);
  return `M${a.x} ${a.y}A${r} ${r} 0 ${end - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

export type Point = { x: number; y: number };

/** A smooth line through the points that never dips below or above its neighbours. */
export function smoothPath(points: Point[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${f(points[0].x)} ${f(points[0].y)}`;
  // Monotone cubic interpolation (Fritsch–Carlson), so a flat run stays flat.
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
  }
  const tangent = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  tangent[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangent[i] = (3 * a * slope[i]) / h;
      tangent[i + 1] = (3 * b * slope[i]) / h;
    }
  }
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = points[i].x + dx[i] / 3;
    const c2x = points[i + 1].x - dx[i] / 3;
    d += `C${f(c1x)} ${f(points[i].y + (tangent[i] * dx[i]) / 3)} ${f(c2x)} ${f(points[i + 1].y - (tangent[i + 1] * dx[i]) / 3)} ${f(points[i + 1].x)} ${f(points[i + 1].y)}`;
  }
  return d;
}

/** The area under a line, closed down to `baseline`. */
export function areaPath(points: Point[], baseline: number) {
  if (points.length === 0) return "";
  const line = smoothPath(points);
  const last = points[points.length - 1];
  return `${line}L${f(last.x)} ${f(baseline)}L${f(points[0].x)} ${f(baseline)}Z`;
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Treemap tiles for values sorted biggest first, laid out so the tiles stay close
 * to square (the "squarified" method). Returns one rectangle per value.
 */
export function squarify(values: number[], width: number, height: number): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || values.length === 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const area = (width * height) / total;
  const sizes = values.map((v) => v * area);
  const rects: Rect[] = [];
  let box: Rect = { x: 0, y: 0, w: width, h: height };

  const worst = (row: number[], side: number) => {
    const sum = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  let row: number[] = [];
  let i = 0;
  while (i < sizes.length) {
    const side = Math.min(box.w, box.h);
    const next = [...row, sizes[i]];
    if (row.length === 0 || worst(next, side) <= worst(row, side)) {
      row = next;
      i += 1;
      continue;
    }
    box = layoutRow(row, box, rects);
    row = [];
  }
  if (row.length) layoutRow(row, box, rects);
  return rects;
}

function layoutRow(row: number[], box: Rect, out: Rect[]): Rect {
  const sum = row.reduce((a, b) => a + b, 0);
  if (box.w >= box.h) {
    const w = sum / box.h;
    let y = box.y;
    for (const size of row) {
      const h = size / w;
      out.push({ x: box.x, y, w, h });
      y += h;
    }
    return { x: box.x + w, y: box.y, w: box.w - w, h: box.h };
  }
  const h = sum / box.w;
  let x = box.x;
  for (const size of row) {
    const w = size / h;
    out.push({ x, y: box.y, w, h });
    x += w;
  }
  return { x: box.x, y: box.y + h, w: box.w, h: box.h - h };
}

export type Circle = { x: number; y: number; r: number };

/**
 * Circles with area proportional to each value (biggest first), packed together
 * and scaled to fit the box. Placement is deterministic: each circle goes at the
 * spot nearest the middle where it touches nothing.
 */
export function packCircles(values: number[], width: number, height: number, gap = 3): Circle[] {
  if (values.length === 0) return [];
  const max = Math.max(...values, 1);
  const raw = values.map((v) => Math.sqrt(Math.max(v, 0) / max));
  const placed: Circle[] = [];

  for (const r of raw) {
    if (placed.length === 0) {
      placed.push({ x: 0, y: 0, r });
      continue;
    }
    let spot: Circle | null = null;
    for (let step = 0; step < 4000 && !spot; step++) {
      // A spiral outward from the middle.
      const angle = step * 0.45;
      const dist = 0.02 * step * 0.35;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      if (placed.every((c) => Math.hypot(c.x - x, c.y - y) >= c.r + r + 0.04)) spot = { x, y, r };
    }
    placed.push(spot ?? { x: placed.length * 2, y: 0, r });
  }

  const left = Math.min(...placed.map((c) => c.x - c.r));
  const right = Math.max(...placed.map((c) => c.x + c.r));
  const top = Math.min(...placed.map((c) => c.y - c.r));
  const bottom = Math.max(...placed.map((c) => c.y + c.r));
  const scale = Math.min((width - gap) / (right - left), (height - gap) / (bottom - top));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  return placed.map((c) => ({
    x: f(width / 2 + (c.x - cx) * scale),
    y: f(height / 2 + (c.y - cy) * scale),
    r: f(Math.max(c.r * scale - gap / 2, 1)),
  }));
}
