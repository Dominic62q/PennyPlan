import type { ChartSpec } from "./chart-spec";

// Turns figures the database already added up into chart specs. Nothing here asks
// the model for a number. Days are plain "YYYY-MM-DD" keys and weeks start on
// Monday, as the database groups them.

export type Summary = {
  total: number;
  count: number;
  group_count: number;
  groups: { id: string | null; label: string; amount: number; count: number }[];
};

type Head = { title: string; subtitle?: string; currency: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// ---- Days -----------------------------------------------------------------------

const utc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const keyOf = (date: Date) => date.toISOString().slice(0, 10);

export const addDays = (key: string, by: number) => keyOf(new Date(utc(key).getTime() + by * 86_400_000));
export const daysBetween = (from: string, to: string) =>
  Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);

/** Monday = 0 … Sunday = 6. */
export const weekdayOf = (key: string) => (utc(key).getUTCDay() + 6) % 7;
export const mondayOf = (key: string) => addDays(key, -weekdayOf(key));

export function dayLabel(key: string) {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function monthName(monthKey: string, withYear = false) {
  const [y, m] = monthKey.split("-").map(Number);
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}

export const monthDays = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** "2026-03" shifted by whole months. */
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last `count` months ending at `end`, oldest first. */
export const monthsEndingAt = (end: string, count: number) =>
  Array.from({ length: count }, (_, i) => shiftMonth(end, i - (count - 1)));

// ---- Folding groups ---------------------------------------------------------------

/** The biggest `keep` groups, with everything else folded into "Other". */
export function foldParts(summary: Summary, keep: number) {
  const top = summary.groups.slice(0, keep).filter((g) => g.amount > 0);
  const shown = top.reduce((sum, g) => sum + g.amount, 0);
  const items = top.map((g) => ({ label: g.label, amount: g.amount, count: g.count }));
  const rest = summary.total - shown;
  if (rest > 0) {
    const restCount = summary.count - top.reduce((sum, g) => sum + g.count, 0);
    items.push({ label: "Other", amount: rest, count: Math.max(restCount, 0) });
  }
  return items;
}

const amountsByKey = (summary: Summary) => new Map(summary.groups.map((g) => [g.label, g.amount]));

// ---- Specs ----------------------------------------------------------------------------

export function buildParts(
  shape: Extract<ChartSpec, { kind: "parts" }>["shape"],
  head: Head,
  summary: Summary,
): ChartSpec {
  return { ...head, kind: "parts", shape, total: summary.total, items: foldParts(summary, shape === "bars" ? 9 : 7) };
}

type Bucket = "day" | "week" | "month";

/** The buckets from `from` to `to`, each with its label, so quiet ones show as zero. */
export function bucketKeys(bucket: Bucket, from: string, to: string) {
  const keys: string[] = [];
  if (bucket === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d);
  } else if (bucket === "week") {
    for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) keys.push(d);
  } else {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) keys.push(m);
  }
  return keys;
}

const bucketLabel = (bucket: Bucket, key: string) =>
  bucket === "month" ? monthName(key) : bucket === "week" ? `Week of ${dayLabel(key)}` : dayLabel(key);

function bucketAmounts(summary: Summary, keys: string[]) {
  const by = amountsByKey(summary);
  return keys.map((k) => by.get(k) ?? 0);
}

export function buildTrend(
  head: Head,
  bucket: Bucket,
  range: { from: string; to: string },
  summary: Summary,
  previous?: { from: string; to: string; summary: Summary },
): ChartSpec {
  const keys = bucketKeys(bucket, range.from, range.to);
  const amounts = bucketAmounts(summary, keys);
  let prior: number[] | undefined;
  if (previous) {
    prior = bucketAmounts(previous.summary, bucketKeys(bucket, previous.from, previous.to)).slice(0, keys.length);
  }
  return {
    ...head,
    kind: "trend",
    points: keys.map((k, i) => ({ label: bucketLabel(bucket, k), amount: amounts[i] })),
    ...(prior && prior.some((a) => a > 0)
      ? { previous: prior, previousLabel: `${dayLabel(previous!.from)} – ${dayLabel(previous!.to)}` }
      : {}),
  };
}

/** Running totals for the month so far (up to `through`) and the whole month before. */
export function buildPace(
  head: Head,
  month: string,
  through: number,
  current: Summary,
  previous: Summary,
): ChartSpec {
  const run = (summary: Summary, m: string, last: number) => {
    const by = amountsByKey(summary);
    let total = 0;
    return Array.from({ length: last }, (_, i) => (total += by.get(`${m}-${String(i + 1).padStart(2, "0")}`) ?? 0));
  };
  const before = shiftMonth(month, -1);
  const days = Math.max(monthDays(month), 28);
  return {
    ...head,
    kind: "pace",
    days,
    current: run(current, month, Math.min(Math.max(through, 1), monthDays(month))),
    previous: run(previous, before, monthDays(before)),
    currentLabel: monthName(month, true),
    previousLabel: monthName(before, true),
  };
}

export function buildCalendar(head: Head, month: string, through: number, summary: Summary): ChartSpec {
  const by = amountsByKey(summary);
  const days = Array.from({ length: monthDays(month) }, (_, i) => by.get(`${month}-${String(i + 1).padStart(2, "0")}`) ?? 0);
  return { ...head, kind: "calendar", month, days, through: Math.min(through, days.length) };
}

export function buildWeekday(head: Head, range: { from: string; to: string }, summary: Summary): ChartSpec {
  const totals = Array<number>(7).fill(0);
  const occurrences = Array<number>(7).fill(0);
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) occurrences[weekdayOf(d)] += 1;
  for (const g of summary.groups) totals[weekdayOf(g.label)] += g.amount;
  return {
    ...head,
    kind: "weekday",
    days: WEEKDAYS.map((label, i) => ({
      label,
      total: totals[i],
      average: occurrences[i] ? Math.round(totals[i] / occurrences[i]) : 0,
    })),
  };
}

export function buildPunchcard(head: Head, range: { from: string; to: string }, summary: Summary): ChartSpec {
  const by = amountsByKey(summary);
  const weeks: { label: string; amounts: number[] }[] = [];
  for (let monday = mondayOf(range.from); monday <= range.to; monday = addDays(monday, 7)) {
    weeks.push({
      label: dayLabel(monday),
      amounts: Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i);
        return day < range.from || day > range.to ? 0 : (by.get(day) ?? 0);
      }),
    });
  }
  return { ...head, kind: "punchcard", weeks: weeks.slice(-14) };
}

export function buildMonths(
  head: Head,
  shape: "columns" | "net",
  months: string[],
  expense: Summary,
  income: Summary,
): ChartSpec {
  const spent = amountsByKey(expense);
  const earned = amountsByKey(income);
  return {
    ...head,
    kind: "months",
    shape,
    points: months.map((m) => ({ label: monthName(m), income: earned.get(m) ?? 0, expense: spent.get(m) ?? 0 })),
  };
}

/** `perMonth` is each month's spending by category, in the same order as `months`. */
export function buildStacked(head: Head, months: string[], overall: Summary, perMonth: Summary[]): ChartSpec {
  const top = overall.groups.filter((g) => g.amount > 0).slice(0, 5).map((g) => g.label);
  const series = [...top, "Other"];
  return {
    ...head,
    kind: "stacked",
    series,
    months: months.map((m, i) => {
      const by = amountsByKey(perMonth[i]);
      const amounts = top.map((label) => by.get(label) ?? 0);
      const other = perMonth[i].total - amounts.reduce((a, b) => a + b, 0);
      return { label: monthName(m), amounts: [...amounts, Math.max(other, 0)] };
    }),
  };
}

export function buildCashflow(
  head: Head,
  shape: "waterfall" | "flow",
  income: number,
  expense: Summary,
): ChartSpec {
  return {
    ...head,
    kind: "cashflow",
    shape,
    income,
    steps: foldParts(expense, 5),
    left: income - expense.total,
  };
}

export function buildCompare(
  head: Head,
  shape: "radar" | "dumbbell",
  labels: { current: string; previous: string },
  current: Summary,
  previous: Summary,
): ChartSpec {
  const idOf = (g: Summary["groups"][number]) => g.id ?? g.label;
  const before = new Map(previous.groups.map((g) => [idOf(g), g]));
  const now = new Map(current.groups.map((g) => [idOf(g), g]));
  const names = new Map([...previous.groups, ...current.groups].map((g) => [idOf(g), g.label]));
  const rows = [...names.keys()]
    .map((k) => ({
      label: names.get(k)!,
      current: now.get(k)?.amount ?? 0,
      previous: before.get(k)?.amount ?? 0,
    }))
    .sort((a, b) => Math.max(b.current, b.previous) - Math.max(a.current, a.previous))
    .slice(0, shape === "radar" ? 6 : 7);
  return { ...head, kind: "compare", shape, currentLabel: labels.current, previousLabel: labels.previous, rows };
}

export function buildBudgets(
  head: Head,
  rows: { label: string; spent: number; limit: number; status: "ok" | "warn" | "over" }[],
): ChartSpec {
  return { ...head, kind: "budgets", rows: rows.slice(0, 12) };
}

export function buildBalances(head: Head, rows: { label: string; amount: number; type: string }[]): ChartSpec {
  return { ...head, kind: "balances", rows: [...rows].sort((a, b) => b.amount - a.amount).slice(0, 16) };
}

export function buildGauge(head: Head, income: number, spent: number): ChartSpec {
  const left = income - spent;
  const rate = income > 0 ? Math.max(Math.round((left / income) * 100), -999) : 0;
  return { ...head, kind: "gauge", income, spent, left, rate: Math.min(rate, 100) };
}

export function buildTimeline(
  head: Head,
  range: { from: string; to: string },
  items: { label: string; date: string; amount: number; auto: boolean }[],
): ChartSpec {
  return { ...head, kind: "timeline", from: range.from, to: range.to, items: items.slice(0, 30) };
}

// ---- A table for each chart -------------------------------------------------------------

export type ChartTable = { columns: string[]; rows: string[][] };

/**
 * Every chart can also be read as a table (for screen readers and for anyone who
 * would rather see the numbers). `format` turns minor units into money text.
 */
export function chartTable(spec: ChartSpec, format: (minor: number) => string): ChartTable {
  switch (spec.kind) {
    case "parts":
      return {
        columns: ["Name", "Amount", "Share"],
        rows: spec.items.map((i) => [
          i.label,
          format(i.amount),
          spec.total > 0 ? `${Math.round((i.amount / spec.total) * 100)}%` : "–",
        ]),
      };
    case "trend":
      return {
        columns: spec.previous ? ["Period", "Amount", spec.previousLabel ?? "Before"] : ["Period", "Amount"],
        rows: spec.points.map((p, i) => [
          p.label,
          format(p.amount),
          ...(spec.previous ? [format(spec.previous[i] ?? 0)] : []),
        ]),
      };
    case "pace":
      return {
        columns: ["Day", spec.currentLabel, spec.previousLabel],
        rows: Array.from({ length: Math.max(spec.current.length, spec.previous.length) }, (_, i) => [
          String(i + 1),
          i < spec.current.length ? format(spec.current[i]) : "–",
          i < spec.previous.length ? format(spec.previous[i]) : "–",
        ]),
      };
    case "calendar":
      return {
        columns: ["Day", "Spent"],
        rows: spec.days.map((amount, i) => [`${monthName(spec.month)} ${i + 1}`, format(amount)]),
      };
    case "weekday":
      return {
        columns: ["Day", "Total", "Average"],
        rows: spec.days.map((d) => [d.label, format(d.total), format(d.average)]),
      };
    case "punchcard":
      return {
        columns: ["Week of", ...WEEKDAYS],
        rows: spec.weeks.map((w) => [w.label, ...w.amounts.map((a) => (a ? format(a) : "–"))]),
      };
    case "months":
      return {
        columns: ["Month", "Income", "Spent", "Net"],
        rows: spec.points.map((p) => [p.label, format(p.income), format(p.expense), format(p.income - p.expense)]),
      };
    case "stacked":
      return {
        columns: ["Month", ...spec.series],
        rows: spec.months.map((m) => [m.label, ...spec.series.map((_, i) => format(m.amounts[i] ?? 0))]),
      };
    case "cashflow":
      return {
        columns: ["Step", "Amount"],
        rows: [
          ["Income", format(spec.income)],
          ...spec.steps.map((s) => [s.label, format(s.amount)]),
          [spec.left >= 0 ? "Left over" : "Overspent by", format(Math.abs(spec.left))],
        ],
      };
    case "compare":
      return {
        columns: ["Category", spec.currentLabel, spec.previousLabel],
        rows: spec.rows.map((r) => [r.label, format(r.current), format(r.previous)]),
      };
    case "budgets":
      return {
        columns: ["Budget", "Spent", "Limit"],
        rows: spec.rows.map((r) => [r.label, format(r.spent), format(r.limit)]),
      };
    case "balances":
      return { columns: ["Account", "Balance"], rows: spec.rows.map((r) => [r.label, format(r.amount)]) };
    case "gauge":
      return {
        columns: ["", "Amount"],
        rows: [
          ["Income", format(spec.income)],
          ["Spent", format(spec.spent)],
          [spec.left >= 0 ? "Kept" : "Overspent by", format(Math.abs(spec.left))],
          ["Share of income kept", `${spec.rate}%`],
        ],
      };
    case "timeline":
      return {
        columns: ["Bill", "Due", "Amount"],
        rows: spec.items.map((i) => [i.label, dayLabel(i.date), format(i.amount)]),
      };
  }
}

// ---- What the model is told about a chart ----------------------------------------------------

const sign = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "level");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");

/**
 * A few plain facts about a chart, with money already formatted, so Penny can
 * comment on what the person is looking at without adding anything up herself.
 */
export function describeChart(spec: ChartSpec, money: (minor: number) => string): string[] {
  switch (spec.kind) {
    case "parts":
      return [
        `Total ${money(spec.total)}.`,
        ...spec.items.slice(0, 3).map((i) => `${i.label}: ${money(i.amount)} (${pct(i.amount, spec.total)})`),
      ];
    case "trend": {
      const total = spec.points.reduce((a, p) => a + p.amount, 0);
      const peak = spec.points.reduce((best, p) => (p.amount > best.amount ? p : best), spec.points[0]);
      const lines = [`Total ${money(total)}.`, `Highest: ${peak.label} at ${money(peak.amount)}.`];
      if (spec.previous) {
        const before = spec.previous.reduce((a, b) => a + b, 0);
        lines.push(`The period before (dotted line) totalled ${money(before)}.`);
      }
      return lines;
    }
    case "pace": {
      const now = spec.current[spec.current.length - 1] ?? 0;
      const day = spec.current.length;
      const before = spec.previous[Math.min(day, spec.previous.length) - 1] ?? 0;
      const gap = now - before;
      return [
        `By day ${day}: ${money(now)} in ${spec.currentLabel}, against ${money(before)} by the same day of ${spec.previousLabel} (${gap === 0 ? "level" : `${money(Math.abs(gap))} ${gap > 0 ? "more" : "less"}`}).`,
        `${spec.previousLabel} finished at ${money(spec.previous[spec.previous.length - 1] ?? 0)}.`,
      ];
    }
    case "calendar": {
      const spent = spec.days.slice(0, spec.through);
      const peak = spent.reduce((best, a, i) => (a > spent[best] ? i : best), 0);
      return [
        `Total ${money(spent.reduce((a, b) => a + b, 0))}.`,
        `Biggest day: ${peak + 1} ${monthName(spec.month)} at ${money(spent[peak] ?? 0)}.`,
        `${spent.filter((a) => a === 0).length} days with no spending.`,
      ];
    }
    case "weekday": {
      const best = spec.days.reduce((b, d) => (d.average > b.average ? d : b), spec.days[0]);
      const quiet = spec.days.reduce((b, d) => (d.average < b.average ? d : b), spec.days[0]);
      return [
        `Busiest weekday: ${best.label}, about ${money(best.average)} on a typical one.`,
        `Quietest: ${quiet.label}, about ${money(quiet.average)}.`,
      ];
    }
    case "punchcard": {
      const all = spec.weeks.flatMap((w) => w.amounts.map((a, d) => ({ a, week: w.label, d })));
      const peak = all.reduce((b, x) => (x.a > b.a ? x : b), all[0]);
      return [`Biggest day: ${WEEKDAYS[peak.d]} in the week of ${peak.week}, ${money(peak.a)}.`];
    }
    case "months": {
      const nets = spec.points.map((p) => ({ label: p.label, net: p.income - p.expense }));
      const best = nets.reduce((b, n) => (n.net > b.net ? n : b), nets[0]);
      const worst = nets.reduce((b, n) => (n.net < b.net ? n : b), nets[0]);
      const spent = spec.points.reduce((a, p) => a + p.expense, 0);
      const earned = spec.points.reduce((a, p) => a + p.income, 0);
      return [
        `Over these months: income ${money(earned)}, spending ${money(spent)}.`,
        `Best month: ${best.label} (${best.net >= 0 ? "kept" : "short by"} ${money(Math.abs(best.net))}).`,
        `Weakest month: ${worst.label} (${worst.net >= 0 ? "kept" : "short by"} ${money(Math.abs(worst.net))}).`,
      ];
    }
    case "stacked": {
      const totals = spec.months.map((m) => ({ label: m.label, total: m.amounts.reduce((a, b) => a + b, 0) }));
      const top = totals.reduce((b, t) => (t.total > b.total ? t : b), totals[0]);
      return [`Biggest month: ${top.label} at ${money(top.total)}.`, `Categories shown: ${spec.series.join(", ")}.`];
    }
    case "cashflow":
      return [
        `Income ${money(spec.income)}.`,
        ...spec.steps.slice(0, 3).map((s) => `${s.label}: ${money(s.amount)}`),
        spec.left >= 0 ? `Left over: ${money(spec.left)}.` : `Spent ${money(-spec.left)} more than came in.`,
      ];
    case "compare": {
      const moves = spec.rows.map((r) => ({ ...r, diff: r.current - r.previous }));
      const up = moves.reduce((b, r) => (r.diff > b.diff ? r : b), moves[0]);
      const down = moves.reduce((b, r) => (r.diff < b.diff ? r : b), moves[0]);
      return [
        up.diff > 0 ? `Biggest rise: ${up.label}, ${money(up.diff)} ${sign(up.diff)} (${money(up.previous)} to ${money(up.current)}).` : "Nothing rose.",
        down.diff < 0 ? `Biggest drop: ${down.label}, ${money(-down.diff)} ${sign(down.diff)} (${money(down.previous)} to ${money(down.current)}).` : "Nothing fell.",
      ];
    }
    case "budgets":
      return spec.rows.map(
        (r) => `${r.label}: ${money(r.spent)} of ${money(r.limit)} (${r.status === "over" ? "over" : r.status === "warn" ? "close to the limit" : "on track"}).`,
      );
    case "balances": {
      const total = spec.rows.reduce((a, r) => a + r.amount, 0);
      return [`Total ${money(total)} across ${spec.rows.length} accounts.`, ...spec.rows.slice(0, 3).map((r) => `${r.label}: ${money(r.amount)}`)];
    }
    case "gauge":
      return spec.income <= 0
        ? ["No income was recorded, so there is no savings rate."]
        : [
            `Income ${money(spec.income)}, spent ${money(spec.spent)}.`,
            spec.left >= 0 ? `Kept ${money(spec.left)}, which is ${spec.rate}% of income.` : `Spent ${money(-spec.left)} more than came in.`,
          ];
    case "timeline": {
      const total = spec.items.reduce((a, i) => a + i.amount, 0);
      const next = [...spec.items].sort((a, b) => a.date.localeCompare(b.date))[0];
      return [`${spec.items.length} ${spec.items.length === 1 ? "bill" : "bills"} worth ${money(total)} in all.`, `Next: ${next.label} on ${dayLabel(next.date)}, ${money(next.amount)}.`];
    }
  }
}

/** True when there is nothing to draw: every figure in the chart is zero. */
export function chartIsEmpty(spec: ChartSpec): boolean {
  const zero = (values: number[]) => values.every((v) => v === 0);
  switch (spec.kind) {
    case "parts":
      return spec.total <= 0 || spec.items.length === 0;
    case "trend":
      return zero(spec.points.map((p) => p.amount));
    case "pace":
      return zero(spec.current) && zero(spec.previous);
    case "calendar":
      return zero(spec.days);
    case "weekday":
      return zero(spec.days.map((d) => d.total));
    case "punchcard":
      return zero(spec.weeks.flatMap((w) => w.amounts));
    case "months":
      return zero(spec.points.flatMap((p) => [p.income, p.expense]));
    case "stacked":
      return zero(spec.months.flatMap((m) => m.amounts));
    case "cashflow":
      return spec.income <= 0 || spec.steps.length === 0;
    case "compare":
      return zero(spec.rows.flatMap((r) => [r.current, r.previous]));
    case "gauge":
      return spec.income === 0 && spec.spent === 0;
    case "budgets":
    case "balances":
    case "timeline":
      return false;
  }
}
