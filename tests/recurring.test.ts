import { describe, expect, it } from "vitest";
import { recurringInputSchema } from "@/lib/ledger/schemas";
import {
  addDaysKey,
  daysBetween,
  dueStatus,
  groupRules,
  isEnded,
  monthlyEquivalent,
  needsAttention,
  ordinal,
  scheduleLabel,
} from "@/lib/ledger/recurring";
import type { RecurringRule } from "@/lib/ledger/types";

const TODAY = "2026-10-23";

function rule(over: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: "r1",
    kind: "expense",
    name: "Rent",
    amount: 150_000,
    currency: "GHS",
    accountId: "a1",
    categoryId: null,
    frequency: "monthly",
    repeatEvery: 1,
    anchorDay: 25,
    nextDue: "2026-10-25",
    endDate: null,
    autoPost: false,
    paused: false,
    ...over,
  };
}

describe("day arithmetic", () => {
  it("counts whole days between calendar days", () => {
    expect(daysBetween("2026-10-23", "2026-10-25")).toBe(2);
    expect(daysBetween("2026-10-23", "2026-10-23")).toBe(0);
    expect(daysBetween("2026-10-23", "2026-10-20")).toBe(-3);
    // Across a month and a leap day.
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("adds days across month and year ends", () => {
    expect(addDaysKey("2026-10-23", 14)).toBe("2026-11-06");
    expect(addDaysKey("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [31, "31st"],
  ])("writes %i as %s", (n, text) => {
    expect(ordinal(n)).toBe(text);
  });
});

describe("scheduleLabel", () => {
  it("describes each kind of schedule", () => {
    expect(scheduleLabel(rule())).toBe("Monthly, on the 25th");
    expect(scheduleLabel(rule({ repeatEvery: 3 }))).toBe("Every 3 months, on the 25th");
    // 2026-10-23 is a Friday.
    expect(
      scheduleLabel(rule({ frequency: "weekly", nextDue: "2026-10-23", repeatEvery: 2 })),
    ).toBe("Every 2 weeks, on Fridays");
    expect(scheduleLabel(rule({ frequency: "weekly", nextDue: "2026-10-23" }))).toBe(
      "Weekly, on Fridays",
    );
    expect(scheduleLabel(rule({ frequency: "yearly", anchorDay: 5, nextDue: "2027-03-05" }))).toBe(
      "Yearly, on 5 Mar",
    );
  });
});

describe("monthlyEquivalent", () => {
  it("turns any schedule into an average month", () => {
    expect(monthlyEquivalent(rule({ amount: 12_000 }))).toBe(12_000);
    expect(monthlyEquivalent(rule({ amount: 30_000, repeatEvery: 3 }))).toBe(10_000);
    expect(monthlyEquivalent(rule({ amount: 12_000, frequency: "yearly" }))).toBe(1_000);
    expect(monthlyEquivalent(rule({ amount: 1_200, frequency: "weekly" }))).toBe(5_200);
    expect(monthlyEquivalent(rule({ amount: 1_200, frequency: "weekly", repeatEvery: 2 }))).toBe(
      2_600,
    );
  });
});

describe("dueStatus", () => {
  it.each([
    ["2026-10-20", "overdue", "Overdue by 3 days"],
    ["2026-10-22", "overdue", "Overdue by 1 day"],
    ["2026-10-23", "today", "Due today"],
    ["2026-10-24", "soon", "Due tomorrow"],
    ["2026-10-30", "soon", "Due in 7 days"],
  ])("%s is %s", (due, tone, label) => {
    const s = dueStatus(due, TODAY);
    expect(s.tone).toBe(tone);
    expect(s.label).toBe(label);
  });

  it("uses a date for anything further away", () => {
    const s = dueStatus("2026-12-25", TODAY);
    expect(s.tone).toBe("later");
    expect(s.label).toMatch(/^Due .*Dec/);
  });
});

describe("what needs attention", () => {
  it("is a bill that has fallen due and waits for a tap", () => {
    expect(needsAttention(rule({ nextDue: "2026-10-23" }), TODAY)).toBe(true);
    expect(needsAttention(rule({ nextDue: "2026-10-01" }), TODAY)).toBe(true);
    expect(needsAttention(rule({ nextDue: "2026-10-24" }), TODAY)).toBe(false);
  });

  it("ignores auto-post, paused and finished rules", () => {
    expect(needsAttention(rule({ nextDue: "2026-10-01", autoPost: true }), TODAY)).toBe(false);
    expect(needsAttention(rule({ nextDue: "2026-10-01", paused: true }), TODAY)).toBe(false);
    expect(
      needsAttention(rule({ nextDue: "2026-10-01", endDate: "2026-09-01" }), TODAY),
    ).toBe(false);
  });

  it("knows a rule has ended once its next date passes the end date", () => {
    expect(isEnded(rule({ nextDue: "2026-11-25", endDate: "2026-10-25" }))).toBe(true);
    expect(isEnded(rule({ nextDue: "2026-10-25", endDate: "2026-10-25" }))).toBe(false);
    expect(isEnded(rule())).toBe(false);
  });
});

describe("groupRules", () => {
  it("sorts rules into due, upcoming, paused and ended, soonest first", () => {
    const rules = [
      rule({ id: "later", name: "Later", nextDue: "2026-12-01" }),
      rule({ id: "soon", name: "Soon", nextDue: "2026-10-28" }),
      rule({ id: "due", name: "Due", nextDue: "2026-10-22" }),
      rule({ id: "auto", name: "Auto", nextDue: "2026-10-01", autoPost: true }),
      rule({ id: "paused", name: "Paused", paused: true }),
      rule({ id: "ended", name: "Ended", nextDue: "2026-11-01", endDate: "2026-10-01" }),
    ];
    const g = groupRules(rules, TODAY);
    expect(g.due.map((r) => r.id)).toEqual(["due"]);
    expect(g.upcoming.map((r) => r.id)).toEqual(["auto", "soon", "later"]);
    expect(g.paused.map((r) => r.id)).toEqual(["paused"]);
    expect(g.ended.map((r) => r.id)).toEqual(["ended"]);
  });
});

describe("recurringInputSchema", () => {
  const base = {
    id: "3f1f6b8e-6f64-4a53-9f63-0f8e5d3b9a10",
    kind: "expense",
    name: "  Rent ",
    amount: 150_000,
    currency: "GHS",
    accountId: "3f1f6b8e-6f64-4a53-9f63-0f8e5d3b9a11",
    frequency: "monthly",
    nextDue: "2026-11-01",
  };

  it("accepts a rule and fills in the defaults", () => {
    const parsed = recurringInputSchema.parse(base);
    expect(parsed.name).toBe("Rent");
    expect(parsed.repeatEvery).toBe(1);
    expect(parsed.autoPost).toBe(false);
    expect(parsed.categoryId).toBeNull();
    expect(parsed.endDate).toBeNull();
  });

  it.each([
    ["a zero amount", { amount: 0 }],
    ["fractional money", { amount: 10.5 }],
    ["an unknown frequency", { frequency: "daily" }],
    ["a repeat of zero", { repeatEvery: 0 }],
    ["a repeat above twelve", { repeatEvery: 13 }],
    ["an empty name", { name: "   " }],
    ["a date that does not exist", { nextDue: "2026-02-30" }],
    ["a malformed date", { nextDue: "01/11/2026" }],
    ["an end before the next due date", { endDate: "2026-10-01" }],
    ["an income-or-expense kind that is neither", { kind: "transfer" }],
  ])("rejects %s", (_label, change) => {
    expect(recurringInputSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
});
