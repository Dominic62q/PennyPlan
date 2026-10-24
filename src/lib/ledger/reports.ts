import { z } from "zod";
import { daysInMonthKey, monthKeyOf } from "@/lib/dates";

// What the budget_progress and monthly_report functions return, checked on
// arrival so a bad shape fails loudly instead of rendering nonsense.

const minor = z.coerce.number().int();

export const budgetProgressRowSchema = z.object({
  budget_id: z.uuid(),
  category_id: z.uuid().nullable(),
  amount: minor,
  currency: z.string(),
  spent: minor,
});

export type BudgetProgress = {
  id: string;
  categoryId: string | null;
  amount: number;
  spent: number;
  currency: string;
};

export const monthlyReportSchema = z.object({
  month: z.string(),
  currency: z.string(),
  income: minor,
  expense: minor,
  count: z.coerce.number().int(),
  prev_income: minor,
  prev_expense: minor,
  categories: z.array(
    z.object({
      category_id: z.uuid().nullable(),
      name: z.string(),
      icon: z.string().nullable(),
      color: z.string().nullable(),
      amount: minor,
      count: z.coerce.number().int(),
    }),
  ),
  daily: z.array(z.object({ day: z.string(), amount: minor })),
  trend: z.array(z.object({ month: z.string(), income: minor, expense: minor })),
});

export type MonthlyReport = z.infer<typeof monthlyReportSchema>;

// Change from last period as a fraction (0.12 = up 12%). Null when there is
// nothing to compare against.
export function changeRatio(current: number, previous: number) {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

export type BudgetStatus = "ok" | "warn" | "over";

export function budgetStatus(spent: number, amount: number): BudgetStatus {
  if (amount <= 0) return "ok";
  const ratio = spent / amount;
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

// Where month-end spending lands if the pace so far holds. Only meaningful
// for the current month; past months return what was actually spent.
export function projectMonthEnd(spent: number, monthKey: string, now = new Date()) {
  if (monthKey !== monthKeyOf(now)) return spent;
  const days = daysInMonthKey(monthKey);
  const elapsed = Math.max(1, now.getDate());
  return Math.round((spent / elapsed) * days);
}

// Days left including today, for "GH₵120 a day left".
export function daysLeftInMonth(monthKey: string, now = new Date()) {
  if (monthKey !== monthKeyOf(now)) return 0;
  return daysInMonthKey(monthKey) - now.getDate() + 1;
}
