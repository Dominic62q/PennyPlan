import { describe, expect, it } from "vitest";
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
  chartTable,
  foldParts,
  monthsEndingAt,
  type Summary,
} from "@/lib/assistant/chart-data";
import { arcPath, packCircles, smoothPath, squarify } from "@/lib/assistant/chart-geometry";
import { chartSpecSchema } from "@/lib/assistant/chart-spec";

const head = { title: "Test", currency: "GHS" };
const group = (label: string, amount: number, count = 1, id: string | null = null) => ({ id, label, amount, count });
const summary = (groups: ReturnType<typeof group>[], total = groups.reduce((s, g) => s + g.amount, 0)): Summary => ({
  total,
  count: groups.reduce((s, g) => s + g.count, 0),
  group_count: groups.length,
  groups,
});
const fmt = (minor: number) => `GH₵${(minor / 100).toFixed(2)}`;

describe("chart geometry", () => {
  it("lays treemap tiles out inside the box with areas in proportion", () => {
    const values = [500, 300, 120, 60, 20];
    const rects = squarify(values, 300, 200);
    expect(rects).toHaveLength(5);
    const total = values.reduce((a, b) => a + b, 0);
    rects.forEach((r, i) => {
      expect(r.x).toBeGreaterThanOrEqual(-0.001);
      expect(r.y).toBeGreaterThanOrEqual(-0.001);
      expect(r.x + r.w).toBeLessThanOrEqual(300.001);
      expect(r.y + r.h).toBeLessThanOrEqual(200.001);
      expect((r.w * r.h) / (300 * 200)).toBeCloseTo(values[i] / total, 3);
    });
  });

  it("packs circles without overlap, inside the box, bigger value = bigger circle", () => {
    const values = [900, 500, 400, 250, 100, 40, 10];
    const circles = packCircles(values, 300, 200);
    expect(circles).toHaveLength(7);
    for (let i = 0; i < circles.length; i++) {
      const a = circles[i];
      expect(a.x - a.r).toBeGreaterThanOrEqual(-0.5);
      expect(a.x + a.r).toBeLessThanOrEqual(300.5);
      expect(a.y - a.r).toBeGreaterThanOrEqual(-0.5);
      expect(a.y + a.r).toBeLessThanOrEqual(200.5);
      if (i > 0) expect(a.r).toBeLessThanOrEqual(circles[i - 1].r);
      for (let j = i + 1; j < circles.length; j++) {
        const b = circles[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r - 0.01);
      }
    }
  });

  it("draws arcs and smooth lines as paths, even for a full circle or one point", () => {
    expect(arcPath(50, 50, 40, 25, 0, 90)).toMatch(/^M.*A.*Z$/);
    expect(arcPath(50, 50, 40, 25, 0, 360)).toContain("A40 40 0 1 1");
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M1 2");
    const flat = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 30 },
    ]);
    expect(flat.startsWith("M0 10C")).toBe(true);
  });
});

describe("chart data", () => {
  it("folds the small groups into Other and keeps the total", () => {
    const s = summary(
      [group("Food", 500), group("Rent", 400), group("Fun", 100), group("Gifts", 50), group("Misc", 10)],
      1060,
    );
    const items = foldParts(s, 3);
    expect(items.map((i) => i.label)).toEqual(["Food", "Rent", "Fun", "Other"]);
    expect(items[3]).toMatchObject({ amount: 60, count: 2 });
    expect(items.reduce((a, i) => a + i.amount, 0)).toBe(1060);
  });

  it("keeps groups the database cut off inside Other", () => {
    const s = { ...summary([group("A", 100), group("B", 50)], 400), group_count: 30 };
    expect(foldParts(s, 7).at(-1)).toMatchObject({ label: "Other", amount: 250 });
  });

  it("builds every shape of parts", () => {
    const s = summary([group("Food", 700), group("Rent", 300)]);
    for (const shape of ["donut", "treemap", "bubbles", "bars"] as const) {
      expect(chartSpecSchema.parse(buildParts(shape, head, s))).toMatchObject({ kind: "parts", shape, total: 1000 });
    }
  });

  it("shows quiet days as zero and lines the earlier period up for a trend", () => {
    const now = summary([group("2026-10-01", 100), group("2026-10-03", 50)]);
    const before = summary([group("2026-09-28", 70), group("2026-09-30", 30)]);
    const spec = chartSpecSchema.parse(
      buildTrend(head, "day", { from: "2026-10-01", to: "2026-10-04" }, now, {
        from: "2026-09-27",
        to: "2026-09-30",
        summary: before,
      }),
    );
    expect(spec).toMatchObject({
      kind: "trend",
      points: [
        { label: "1 Oct", amount: 100 },
        { label: "2 Oct", amount: 0 },
        { label: "3 Oct", amount: 50 },
        { label: "4 Oct", amount: 0 },
      ],
      previous: [0, 70, 0, 30],
    });
  });

  it("leaves the earlier line out when that period had no spending", () => {
    const spec = buildTrend(
      head,
      "week",
      { from: "2026-10-01", to: "2026-10-20" },
      summary([group("2026-09-28", 5)]),
      { from: "2026-09-10", to: "2026-09-29", summary: summary([]) },
    );
    expect(spec).not.toHaveProperty("previous");
    // 1 Oct is a Thursday, so the first week starts on Monday 28 Sep.
    expect(spec).toMatchObject({ points: [{ label: "Week of 28 Sep", amount: 5 }, { amount: 0 }, { amount: 0 }, { amount: 0 }] });
  });

  it("builds running totals for the pace chart", () => {
    const now = summary([group("2026-10-01", 100), group("2026-10-03", 50)]);
    const before = summary([group("2026-09-02", 40), group("2026-09-30", 10)]);
    const spec = chartSpecSchema.parse(buildPace(head, "2026-10", 4, now, before));
    expect(spec).toMatchObject({ kind: "pace", days: 31, current: [100, 100, 150, 150], currentLabel: "Oct 2026" });
    if (spec.kind === "pace") {
      expect(spec.previous).toHaveLength(30);
      expect(spec.previous.at(-1)).toBe(50);
    }
  });

  it("fills a calendar with one number per day", () => {
    const spec = chartSpecSchema.parse(buildCalendar(head, "2026-02", 28, summary([group("2026-02-14", 900)])));
    expect(spec).toMatchObject({ kind: "calendar", through: 28 });
    if (spec.kind === "calendar") {
      expect(spec.days).toHaveLength(28);
      expect(spec.days[13]).toBe(900);
    }
  });

  it("totals and averages by weekday over the days in the range", () => {
    // 2026-10-05 is a Monday; two weeks Mon 5 Oct to Sun 18 Oct.
    const s = summary([group("2026-10-05", 100), group("2026-10-12", 300), group("2026-10-17", 50)]);
    const spec = chartSpecSchema.parse(buildWeekday(head, { from: "2026-10-05", to: "2026-10-18" }, s));
    if (spec.kind !== "weekday") throw new Error("wrong kind");
    expect(spec.days[0]).toEqual({ label: "Mon", total: 400, average: 200 });
    expect(spec.days[5]).toEqual({ label: "Sat", total: 50, average: 25 });
    expect(spec.days[2]).toEqual({ label: "Wed", total: 0, average: 0 });
  });

  it("builds a punchcard of weeks by weekday and ignores days outside the range", () => {
    const s = summary([group("2026-10-07", 20), group("2026-10-14", 30)]);
    const spec = chartSpecSchema.parse(buildPunchcard(head, { from: "2026-10-07", to: "2026-10-14" }, s));
    if (spec.kind !== "punchcard") throw new Error("wrong kind");
    expect(spec.weeks).toHaveLength(2);
    expect(spec.weeks[0]).toEqual({ label: "5 Oct", amounts: [0, 0, 20, 0, 0, 0, 0] });
    expect(spec.weeks[1].amounts[2]).toBe(30);
  });

  it("pairs income with spending for each month", () => {
    const months = monthsEndingAt("2026-10", 3);
    expect(months).toEqual(["2026-08", "2026-09", "2026-10"]);
    const spec = chartSpecSchema.parse(
      buildMonths(head, "net", months, summary([group("2026-09", 300)]), summary([group("2026-10", 800)])),
    );
    expect(spec).toMatchObject({
      points: [
        { label: "Aug", income: 0, expense: 0 },
        { label: "Sep", income: 0, expense: 300 },
        { label: "Oct", income: 800, expense: 0 },
      ],
    });
  });

  it("stacks the top five categories per month and puts the rest in Other", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const overall = summary(names.map((n, i) => group(n, 600 - i * 100)));
    const jan = summary(names.map((n, i) => group(n, 300 - i * 50)));
    const feb = summary([group("A", 100)], 150);
    const spec = chartSpecSchema.parse(buildStacked(head, ["2026-01", "2026-02"], overall, [jan, feb]));
    if (spec.kind !== "stacked") throw new Error("wrong kind");
    expect(spec.series).toEqual(["A", "B", "C", "D", "E", "Other"]);
    expect(spec.months[0].amounts).toEqual([300, 250, 200, 150, 100, 50]);
    expect(spec.months[1].amounts).toEqual([100, 0, 0, 0, 0, 50]);
  });

  it("works out what is left over, including when more went out than came in", () => {
    const spend = summary([group("Food", 500), group("Rent", 800)]);
    expect(buildCashflow(head, "waterfall", 2000, spend)).toMatchObject({ left: 700, income: 2000 });
    const over = buildCashflow(head, "flow", 1000, spend);
    expect(chartSpecSchema.parse(over)).toMatchObject({ left: -300 });
  });

  it("compares two periods by category, matching by id and keeping the biggest", () => {
    const now = summary([group("Food", 500, 1, "f"), group("Rent", 800, 1, "r"), group("Fun", 50, 1, "u")]);
    const before = summary([group("Rent", 800, 1, "r"), group("Fuel", 600, 1, "g"), group("Food", 200, 1, "f")]);
    const spec = chartSpecSchema.parse(
      buildCompare(head, "dumbbell", { current: "Oct", previous: "Sep" }, now, before),
    );
    if (spec.kind !== "compare") throw new Error("wrong kind");
    expect(spec.rows.map((r) => r.label)).toEqual(["Rent", "Fuel", "Food", "Fun"]);
    expect(spec.rows[1]).toMatchObject({ current: 0, previous: 600 });
    expect(spec.rows[2]).toMatchObject({ current: 500, previous: 200 });
  });

  it("builds budgets, balances, a savings gauge and a timeline", () => {
    const budgets = buildBudgets(head, [{ label: "Food", spent: 900, limit: 1000, status: "warn" }]);
    expect(chartSpecSchema.parse(budgets)).toMatchObject({ kind: "budgets" });

    const balances = buildBalances(head, [
      { label: "Cash", amount: 100, type: "Cash" },
      { label: "Bank", amount: 900, type: "Bank" },
      { label: "Card", amount: -50, type: "Card" },
    ]);
    expect(chartSpecSchema.parse(balances)).toMatchObject({ rows: [{ label: "Bank" }, { label: "Cash" }, { label: "Card" }] });

    expect(buildGauge(head, 1000, 400)).toMatchObject({ left: 600, rate: 60 });
    expect(buildGauge(head, 1000, 1500)).toMatchObject({ left: -500, rate: -50 });
    expect(buildGauge(head, 0, 100)).toMatchObject({ rate: 0 });

    const timeline = buildTimeline(head, { from: "2026-10-24", to: "2026-11-23" }, [
      { label: "Rent", date: "2026-11-01", amount: 90000, auto: true },
    ]);
    expect(chartSpecSchema.parse(timeline)).toMatchObject({ kind: "timeline" });
  });

  it("gives every kind of chart a table", () => {
    const s = summary([group("Food", 700), group("Rent", 300)]);
    const specs = [
      buildParts("donut", head, s),
      buildTrend(head, "day", { from: "2026-10-01", to: "2026-10-02" }, s),
      buildPace(head, "2026-10", 2, s, s),
      buildCalendar(head, "2026-10", 3, s),
      buildWeekday(head, { from: "2026-10-05", to: "2026-10-11" }, s),
      buildPunchcard(head, { from: "2026-10-05", to: "2026-10-11" }, s),
      buildMonths(head, "columns", ["2026-09", "2026-10"], s, s),
      buildStacked(head, ["2026-09", "2026-10"], s, [s, s]),
      buildCashflow(head, "waterfall", 5000, s),
      buildCompare(head, "radar", { current: "a", previous: "b" }, s, summary([group("Fun", 5), group("Gifts", 5)])),
      buildBudgets(head, [{ label: "Food", spent: 1, limit: 2, status: "ok" }]),
      buildBalances(head, [{ label: "Cash", amount: 1, type: "Cash" }]),
      buildGauge(head, 100, 50),
      buildTimeline(head, { from: "2026-10-01", to: "2026-10-31" }, [
        { label: "Rent", date: "2026-10-05", amount: 5, auto: false },
      ]),
    ];
    for (const spec of specs) {
      const parsed = chartSpecSchema.safeParse(spec);
      expect(parsed.success, `${spec.kind} should be a valid spec`).toBe(true);
      const table = chartTable(spec, fmt);
      expect(table.rows.length).toBeGreaterThan(0);
      for (const row of table.rows) expect(row).toHaveLength(table.columns.length);
    }
  });
});
