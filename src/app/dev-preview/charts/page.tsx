"use client";

import { ChartCard } from "@/components/assistant/charts/chart-card";
import {
  buildBalances,
  buildBudgets,
  buildCalendar,
  buildCashflow,
  buildCompare,
  buildGauge,
  buildMonths,
  buildPace,
  buildParts,
  buildPunchcard,
  buildStacked,
  buildTimeline,
  buildTrend,
  buildWeekday,
  monthsEndingAt,
  type Summary,
} from "@/lib/assistant/chart-data";
import type { ChartSpec } from "@/lib/assistant/chart-spec";

// Every assistant chart with made-up figures, to look at them on one page. Dev only
// (the layout above 404s in production).

const head = { currency: "GHS" };
const g = (label: string, amount: number, count = 3, id: string | null = label) => ({ id, label, amount, count });
const sum = (groups: ReturnType<typeof g>[]): Summary => ({
  total: groups.reduce((s, x) => s + x.amount, 0),
  count: groups.reduce((s, x) => s + x.count, 0),
  group_count: groups.length,
  groups,
});

const categories = sum([
  g("Food", 128_000, 22),
  g("Transport", 74_500, 14),
  g("Rent", 60_000, 1),
  g("Airtime & data", 31_000, 6),
  g("Fun", 24_500, 5),
  g("Health", 18_000, 2),
  g("Gifts", 9_500, 2),
  g("Clothes", 7_200, 1),
  g("Misc", 3_100, 2),
]);
const lastMonth = sum([
  g("Rent", 60_000, 1),
  g("Food", 98_000, 20),
  g("Transport", 91_000, 16),
  g("Airtime & data", 29_000, 6),
  g("Fun", 41_000, 7),
  g("Health", 6_000, 1),
  g("Gifts", 21_000, 3),
]);

const days = (month: string, seed: number, upTo: number) =>
  sum(
    Array.from({ length: upTo }, (_, i) => {
      const wave = Math.abs(Math.sin((i + seed) * 1.7)) * 9_000 + (i % 7 === 5 ? 9_000 : 0);
      return g(`${month}-${String(i + 1).padStart(2, "0")}`, i % 6 === 3 ? 0 : Math.round(wave / 10) * 10, 1);
    }).filter((x) => x.amount > 0),
  );

const months = monthsEndingAt("2026-10", 6);
const expenseByMonth = sum(months.map((m, i) => g(m, 280_000 + ((i * 53_000) % 140_000), 20)));
const incomeByMonth = sum(months.map((m, i) => g(m, 320_000 + ((i * 29_000) % 90_000) - (i === 3 ? 60_000 : 0), 2)));
const perMonth = months.map((_, i) =>
  sum([
    g("Food", 90_000 + i * 6_000),
    g("Rent", 60_000),
    g("Transport", 50_000 + ((i * 17_000) % 30_000)),
    g("Fun", 20_000 + ((i * 11_000) % 25_000)),
    g("Health", 8_000 + (i % 3) * 7_000),
    g("Gifts", 12_000),
    g("Misc", 9_000),
  ]),
);

const SPECS: ChartSpec[] = [
  buildParts("donut", { ...head, title: "Where October went", subtitle: "1 Oct – 24 Oct" }, categories),
  buildParts("bars", { ...head, title: "Biggest categories", subtitle: "This month" }, categories),
  buildParts("treemap", { ...head, title: "October as tiles", subtitle: "Bigger tile, bigger spend" }, categories),
  buildParts("bubbles", { ...head, title: "October as bubbles", subtitle: "Bigger bubble, bigger spend" }, categories),
  buildTrend(
    { ...head, title: "Daily spending", subtitle: "1 Oct – 24 Oct, against the 24 days before" },
    "day",
    { from: "2026-10-01", to: "2026-10-24" },
    days("2026-10", 3, 24),
    { from: "2026-09-07", to: "2026-09-30", summary: days("2026-09", 8, 24) },
  ),
  buildPace(
    { ...head, title: "October against September", subtitle: "Running total by day" },
    "2026-10",
    24,
    days("2026-10", 3, 24),
    days("2026-09", 11, 30),
  ),
  buildCalendar({ ...head, title: "Your October, day by day" }, "2026-10", 24, days("2026-10", 5, 24)),
  buildWeekday(
    { ...head, title: "Which days you spend most", subtitle: "Average per weekday, last 12 weeks" },
    { from: "2026-08-03", to: "2026-10-25" },
    days("2026-09", 2, 30),
  ),
  buildPunchcard(
    { ...head, title: "Week by week", subtitle: "Bigger dot, bigger day" },
    { from: "2026-08-03", to: "2026-10-24" },
    days("2026-09", 6, 30),
  ),
  buildMonths({ ...head, title: "Income and spending" }, "columns", months, expenseByMonth, incomeByMonth),
  buildMonths({ ...head, title: "What you kept each month", subtitle: "Income minus spending" }, "net", months, expenseByMonth, incomeByMonth),
  buildStacked({ ...head, title: "What each month went on" }, months, categories, perMonth),
  buildCashflow({ ...head, title: "From income to what's left", subtitle: "October" }, "waterfall", 520_000, categories),
  buildCashflow({ ...head, title: "Where your income flowed", subtitle: "October" }, "flow", 520_000, categories),
  buildCashflow({ ...head, title: "More out than in", subtitle: "October, flowing" }, "flow", 300_000, categories),
  buildCompare({ ...head, title: "This month against last" }, "radar", { current: "Oct", previous: "Sep" }, categories, lastMonth),
  buildCompare({ ...head, title: "What changed since September" }, "dumbbell", { current: "Oct", previous: "Sep" }, categories, lastMonth),
  buildBudgets({ ...head, title: "Your budgets", subtitle: "October" }, [
    { label: "Food", spent: 128_000, limit: 150_000, status: "warn" },
    { label: "Transport", spent: 74_500, limit: 120_000, status: "ok" },
    { label: "Fun", spent: 24_500, limit: 20_000, status: "over" },
    { label: "Airtime & data", spent: 31_000, limit: 60_000, status: "ok" },
    { label: "All spending", spent: 356_000, limit: 450_000, status: "ok" },
  ]),
  buildBalances({ ...head, title: "Your accounts" }, [
    { label: "MoMo", amount: 142_000, type: "Mobile money" },
    { label: "GCB Bank", amount: 610_000, type: "Bank" },
    { label: "Cash", amount: 38_500, type: "Cash" },
    { label: "Susu", amount: 250_000, type: "Savings" },
    { label: "Credit card", amount: -45_000, type: "Card" },
  ]),
  buildGauge({ ...head, title: "How much you kept", subtitle: "October" }, 520_000, 356_000),
  buildGauge({ ...head, title: "Spent more than earned", subtitle: "October" }, 300_000, 356_000),
  buildTimeline({ ...head, title: "Bills coming up", subtitle: "Next 30 days" }, { from: "2026-10-24", to: "2026-11-23" }, [
    { label: "Rent", date: "2026-11-01", amount: 60_000, auto: true },
    { label: "Netflix", date: "2026-10-28", amount: 9_900, auto: false },
    { label: "Data bundle", date: "2026-10-28", amount: 12_000, auto: false },
    { label: "Gym", date: "2026-11-05", amount: 15_000, auto: true },
    { label: "ECG prepaid", date: "2026-11-14", amount: 20_000, auto: false },
    { label: "Susu contribution", date: "2026-11-20", amount: 30_000, auto: true },
  ]),
];

export default function ChartGallery() {
  return (
    <div className="min-h-dvh bg-bg px-4 py-6 text-ink">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-xl font-bold">Penny chart gallery</h1>
        {SPECS.map((spec, i) => (
          <div key={i} className="pl-9">
            <ChartCard spec={spec} />
          </div>
        ))}
      </div>
    </div>
  );
}
