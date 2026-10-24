import { z } from "zod";

// What a chart is, as plain data. The tools build these from figures the database
// added up, so the model never supplies a number; the screen draws them and a saved
// chat can show them again. Every amount is in minor units (pesewas).

const minor = z.number().int();
const text = z.string().max(100);

const head = {
  title: z.string().max(120),
  subtitle: z.string().max(160).optional(),
  currency: z.string().length(3),
};

const part = z.object({ label: text, amount: minor, count: z.number().int().optional() });

export const chartSpecSchema = z.discriminatedUnion("kind", [
  // One total split into parts: donut, treemap, bubbles or ranked bars.
  z.object({
    ...head,
    kind: z.literal("parts"),
    shape: z.enum(["donut", "treemap", "bubbles", "bars"]),
    total: minor,
    items: z.array(part).min(1).max(12),
  }),
  // An amount over time, optionally against the same-length period before.
  z.object({
    ...head,
    kind: z.literal("trend"),
    points: z.array(z.object({ label: text, amount: minor })).min(2).max(120),
    previous: z.array(minor).max(120).optional(),
    previousLabel: text.optional(),
  }),
  // Running total through a month against the month before.
  z.object({
    ...head,
    kind: z.literal("pace"),
    days: z.number().int().min(28).max(31),
    current: z.array(minor).min(1).max(31),
    previous: z.array(minor).min(1).max(31),
    currentLabel: text,
    previousLabel: text,
  }),
  // One cell per day of a month.
  z.object({
    ...head,
    kind: z.literal("calendar"),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    days: z.array(minor).min(28).max(31),
    // Days after this one haven't happened yet.
    through: z.number().int().min(0).max(31),
  }),
  // The seven weekdays, Monday first.
  z.object({
    ...head,
    kind: z.literal("weekday"),
    days: z.array(z.object({ label: text, total: minor, average: minor })).length(7),
  }),
  // Weeks down, weekdays across, dot size is the amount.
  z.object({
    ...head,
    kind: z.literal("punchcard"),
    weeks: z.array(z.object({ label: text, amounts: z.array(minor).length(7) })).min(1).max(14),
  }),
  // Income against spending for each month, as paired columns or as net bars.
  z.object({
    ...head,
    kind: z.literal("months"),
    shape: z.enum(["columns", "net"]),
    points: z.array(z.object({ label: text, income: minor, expense: minor })).min(2).max(12),
  }),
  // Months stacked by category.
  z.object({
    ...head,
    kind: z.literal("stacked"),
    series: z.array(text).min(1).max(8),
    months: z.array(z.object({ label: text, amounts: z.array(minor).max(8) })).min(2).max(12),
  }),
  // Income minus what it went on, drawn as a waterfall or as flowing ribbons.
  z.object({
    ...head,
    kind: z.literal("cashflow"),
    shape: z.enum(["waterfall", "flow"]),
    income: minor,
    steps: z.array(part).min(1).max(8),
    // Income minus all spending; negative when more went out than came in.
    left: minor,
  }),
  // This period against the one before, per category.
  z.object({
    ...head,
    kind: z.literal("compare"),
    shape: z.enum(["radar", "dumbbell"]),
    currentLabel: text,
    previousLabel: text,
    rows: z.array(z.object({ label: text, current: minor, previous: minor })).min(3).max(8),
  }),
  // Budgets as rings.
  z.object({
    ...head,
    kind: z.literal("budgets"),
    rows: z
      .array(
        z.object({
          label: text,
          spent: minor,
          limit: minor,
          status: z.enum(["ok", "warn", "over"]),
        }),
      )
      .min(1)
      .max(12),
  }),
  // What each account holds.
  z.object({
    ...head,
    kind: z.literal("balances"),
    rows: z.array(z.object({ label: text, amount: minor, type: text })).min(1).max(16),
  }),
  // How much of the income was kept.
  z.object({
    ...head,
    kind: z.literal("gauge"),
    income: minor,
    spent: minor,
    left: minor,
    // Whole percent of income kept; can be negative.
    rate: z.number().int().min(-999).max(100),
  }),
  // Bills coming up, placed on a line of days.
  z.object({
    ...head,
    kind: z.literal("timeline"),
    from: z.string(),
    to: z.string(),
    items: z
      .array(z.object({ label: text, date: z.string(), amount: minor, auto: z.boolean() }))
      .min(1)
      .max(30),
  }),
]);

export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type ChartKind = ChartSpec["kind"];

// ---- What the model can ask for -------------------------------------------------

export const CHART_NAMES = [
  "donut",
  "treemap",
  "bubbles",
  "bars",
  "trend",
  "pace",
  "calendar",
  "weekday",
  "punchcard",
  "income_vs_spending",
  "net_by_month",
  "stacked_months",
  "waterfall",
  "flow",
  "radar",
  "dumbbell",
  "budgets",
  "balances",
  "savings",
  "bills",
] as const;

export type ChartName = (typeof CHART_NAMES)[number];
