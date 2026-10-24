import { describe, expect, it } from "vitest";
import { niceMax } from "@/lib/chart-scale";
import {
  daysInMonthKey,
  monthKeyLabel,
  monthKeyOf,
  monthRangeIso,
  shiftMonthKey,
} from "@/lib/dates";
import { budgetInputSchema, categoryPatchSchema } from "@/lib/ledger/schemas";
import {
  budgetStatus,
  changeRatio,
  daysLeftInMonth,
  monthlyReportSchema,
  projectMonthEnd,
} from "@/lib/ledger/reports";

describe("month keys", () => {
  it("builds the first-of-month key", () => {
    expect(monthKeyOf(new Date(2026, 9, 23))).toBe("2026-10-01");
    expect(monthKeyOf(new Date(2026, 0, 31))).toBe("2026-01-01");
  });

  it.each([
    ["2026-10-01", 1, "2026-11-01"],
    ["2026-12-01", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-01"],
    ["2026-10-01", -10, "2025-12-01"],
    ["2026-10-01", 0, "2026-10-01"],
    ["2026-01-01", 14, "2027-03-01"],
  ])("shifts %s by %i to %s", (key, by, expected) => {
    expect(shiftMonthKey(key, by)).toBe(expected);
  });

  it.each([
    ["2026-10-01", 31],
    ["2026-11-01", 30],
    ["2026-02-01", 28],
    ["2028-02-01", 29],
  ])("counts the days in %s", (key, days) => {
    expect(daysInMonthKey(key)).toBe(days);
  });

  it("labels a month in three lengths", () => {
    expect(monthKeyLabel("2026-10-01")).toMatch(/October.*2026/);
    expect(monthKeyLabel("2026-10-01", "medium")).toMatch(/Oct.*2026/);
    expect(monthKeyLabel("2026-10-01", "short")).toBe("Oct");
  });

  it("gives a range from the 1st to the 1st of the next month", () => {
    const { from, to } = monthRangeIso("2026-12-01");
    const start = new Date(from);
    const end = new Date(to);
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 11, 1]);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe("changeRatio", () => {
  it("is the fraction up or down", () => {
    expect(changeRatio(120, 100)).toBeCloseTo(0.2);
    expect(changeRatio(50, 100)).toBeCloseTo(-0.5);
    expect(changeRatio(100, 100)).toBe(0);
  });

  it("is null when there is nothing to compare with", () => {
    expect(changeRatio(10, 0)).toBeNull();
    expect(changeRatio(0, 0)).toBeNull();
  });
});

describe("budgetStatus", () => {
  it.each([
    [0, 100, "ok"],
    [79, 100, "ok"],
    [80, 100, "warn"],
    [99, 100, "warn"],
    [100, 100, "over"],
    [250, 100, "over"],
    [50, 0, "ok"],
  ] as const)("spent %i of %i is %s", (spent, amount, expected) => {
    expect(budgetStatus(spent, amount)).toBe(expected);
  });
});

describe("month-end projection", () => {
  const tenth = new Date(2026, 9, 10);

  it("extends the pace so far over the whole month", () => {
    expect(projectMonthEnd(10_000, "2026-10-01", tenth)).toBe(31_000);
    expect(projectMonthEnd(500, "2026-10-01", new Date(2026, 9, 1))).toBe(15_500);
  });

  it("returns what was actually spent for a past month", () => {
    expect(projectMonthEnd(12_345, "2026-09-01", tenth)).toBe(12_345);
  });

  it("counts the days left, today included", () => {
    expect(daysLeftInMonth("2026-10-01", tenth)).toBe(22);
    expect(daysLeftInMonth("2026-10-01", new Date(2026, 9, 31))).toBe(1);
    expect(daysLeftInMonth("2026-09-01", tenth)).toBe(0);
  });
});

describe("niceMax", () => {
  it.each([
    [407_400, 500_000],
    [250_000, 250_000],
    [150, 200],
    [100, 100],
    [101, 200],
    [1_234_500, 2_000_000],
  ])("rounds %i up to %i", (value, expected) => {
    expect(niceMax(value, "GHS")).toBe(expected);
  });

  it("still gives a usable axis for an empty chart", () => {
    expect(niceMax(0, "GHS")).toBeGreaterThan(0);
  });
});

describe("budget and category schemas", () => {
  it("accepts an overall budget and a category budget", () => {
    expect(budgetInputSchema.safeParse({ categoryId: null, amount: 50_000 }).success).toBe(true);
    expect(
      budgetInputSchema.safeParse({
        categoryId: "3f1f6b8e-6f64-4a53-9f63-0f8e5d3b9a10",
        amount: 1,
      }).success,
    ).toBe(true);
  });

  it.each([0, -5, 12.5, 1e15])("rejects a budget amount of %s", (amount) => {
    expect(budgetInputSchema.safeParse({ categoryId: null, amount }).success).toBe(false);
  });

  it("rejects a category id that is not a uuid", () => {
    expect(budgetInputSchema.safeParse({ categoryId: "food", amount: 100 }).success).toBe(false);
  });

  it("checks category colours and trims names", () => {
    expect(categoryPatchSchema.safeParse({ color: "#e8590c" }).success).toBe(true);
    expect(categoryPatchSchema.safeParse({ color: "red" }).success).toBe(false);
    expect(categoryPatchSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(categoryPatchSchema.parse({ name: "  Rent  " }).name).toBe("Rent");
  });
});

describe("monthlyReportSchema", () => {
  const report = {
    month: "2026-10-01",
    currency: "GHS",
    income: "250000",
    expense: 120000,
    count: "14",
    prev_income: 0,
    prev_expense: 90000,
    categories: [
      {
        category_id: null,
        name: "Uncategorised",
        icon: null,
        color: null,
        amount: "5000",
        count: 1,
      },
    ],
    daily: [{ day: "2026-10-01", amount: 5000 }],
    trend: [{ month: "2026-10-01", income: 250000, expense: 120000 }],
  };

  it("turns numeric strings from the database into numbers", () => {
    const parsed = monthlyReportSchema.parse(report);
    expect(parsed.income).toBe(250_000);
    expect(parsed.count).toBe(14);
    expect(parsed.categories[0]?.amount).toBe(5_000);
  });

  it("rejects a report with a missing field", () => {
    expect(monthlyReportSchema.safeParse({ ...report, trend: undefined }).success).toBe(false);
  });

  it("rejects fractional money", () => {
    expect(monthlyReportSchema.safeParse({ ...report, expense: 10.5 }).success).toBe(false);
  });
});
