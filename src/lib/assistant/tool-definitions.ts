import { z } from "zod";
import { CHART_NAMES } from "@/lib/assistant/chart-spec";
import { ACCOUNT_TYPES } from "@/lib/ledger/types";

// One definition per tool, used twice: the server turns it into the schema the
// model sees, and the browser uses it to check what the model sent before
// running anything. The model never supplies its own list.

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("A calendar day as YYYY-MM-DD");

const id = z.uuid().describe("An id taken from list_accounts or list_categories, never guessed");

export const TOOLS = {
  get_overview: {
    description:
      "A quick picture of one month: income, spending, what was left, the change from the month before, the biggest spending categories, account balances and budget progress. Defaults to the current month.",
    args: z.object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe("A month as YYYY-MM"),
    }),
  },
  list_accounts: {
    description:
      "The person's accounts with their ids, types and current balances. Archived accounts are left out unless include_archived is true (needed to find one to restore).",
    args: z.object({ include_archived: z.boolean().optional() }),
  },
  list_categories: {
    description:
      "The person's spending and income categories with their ids. Subcategories name their parent. Use this to turn a category name into an id.",
    args: z.object({
      kind: z.enum(["expense", "income"]).optional(),
      include_archived: z.boolean().optional().describe("True to include archived ones, e.g. to restore one"),
    }),
  },
  find_transactions: {
    description:
      "Looks up individual transactions, newest first, with a count of all matches. Returns at most 50 rows. For totals or breakdowns use summarize_spending instead of adding rows up.",
    args: z.object({
      from: day.optional().describe("First day to include"),
      to: day.optional().describe("Last day to include"),
      type: z.enum(["expense", "income", "transfer"]).optional(),
      account_id: id.optional(),
      category_id: id
        .optional()
        .describe("A category id; a parent category also matches its subcategories"),
      text: z.string().max(60).optional().describe("Matches the payee or the note"),
      min_amount: z.number().positive().optional().describe("In cedis, e.g. 20 or 45.5"),
      max_amount: z.number().positive().optional().describe("In cedis, e.g. 20 or 45.5"),
      limit: z.number().int().min(1).max(50).optional().describe("How many rows, default 20"),
    }),
  },
  summarize_spending: {
    description:
      "Adds up spending (or income) over a date range, worked out by the database, grouped by category, subcategory, payee, account, day, week or month. Can include the same-length period just before for comparison.",
    args: z.object({
      from: day.describe("First day to include"),
      to: day.describe("Last day to include"),
      group_by: z
        .enum(["category", "subcategory", "payee", "account", "day", "week", "month"])
        .optional()
        .describe("Default category; category rolls subcategories into their parent"),
      type: z.enum(["expense", "income"]).optional().describe("Default expense"),
      compare_to_previous: z.boolean().optional(),
    }),
  },
  show_chart: {
    description:
      "Draws a chart in the conversation from the person's real figures (the database adds everything up; you only choose the chart). Use it when they ask to see, show, chart, graph or plot something, or when a picture would answer better than a list. Pick the chart that fits the question: donut, treemap, bubbles or bars = where money went by category (or payee/account via group_by); trend = daily/weekly/monthly line, against the period before; pace = this month against last, day by day; calendar = a heatmap of a month's days; weekday = which weekdays they spend most; punchcard = weeks by weekday dots; income_vs_spending = paired columns per month; net_by_month = what was kept each month; stacked_months = months stacked by category; waterfall = income down to what is left; flow = income flowing into categories; radar or dumbbell = this month against last by category; budgets = budget rings; balances = account balances; savings = how much of income was kept; bills = bills falling due soon. Dates: from+to for a range, or month (YYYY-MM), or neither for this month so far (weekday and punchcard default to recent weeks). Returns a few facts about the chart to comment on. At most 3 charts per question.",
    args: z.object({
      chart: z.enum(CHART_NAMES),
      from: day.optional().describe("First day, with to"),
      to: day.optional().describe("Last day, with from"),
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe("A month as YYYY-MM; for multi-month charts, the last month shown"),
      months: z.number().int().min(2).max(12).optional().describe("How many months, for the per-month charts; default 6"),
      type: z.enum(["expense", "income"]).optional().describe("Default expense"),
      group_by: z
        .enum(["category", "subcategory", "payee", "account"])
        .optional()
        .describe("For donut, treemap, bubbles and bars only; default category"),
      days: z.number().int().min(7).max(90).optional().describe("For bills: how many days ahead, default 30"),
    }),
  },
  list_budgets: {
    description:
      "The person's monthly budgets for one month, each with its limit, what has been spent, what is left and a status. Defaults to the current month. A budget with no category is the overall budget for all spending.",
    args: z.object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe("A month as YYYY-MM"),
    }),
  },
  set_budget: {
    description:
      "Sets or changes a monthly spending limit. Saved straight away with an Undo button. It applies to every month from now on, not just this one. Look up the category id with list_categories first (spending categories only). Leave category_id out ONLY for the overall budget across all spending. Returns the budget read back from the database.",
    args: z.object({
      category_id: id.optional().describe("An expense category id; leave out only for the overall budget"),
      amount: z.number().positive().describe("The monthly limit in cedis, e.g. 500"),
    }),
  },
  remove_budget: {
    description:
      "Removes a monthly budget (the limit only; no transactions are touched). Saved straight away with an Undo button. Leave category_id out ONLY for the overall budget.",
    args: z.object({
      category_id: id.optional().describe("The category whose budget to remove; leave out only for the overall budget"),
    }),
  },
  create_account: {
    description:
      "Creates a new account (cash, bank, savings, credit card, mobile money, investment or loan) in cedis. Saved straight away with an Undo button. Ask for the name and kind if they are unclear. The opening balance is what is in it now (negative for money owed on a credit card or loan); leave it out for 0. Returns the account read back from the database.",
    args: z.object({
      name: z.string().trim().min(1).max(60),
      type: z.enum(ACCOUNT_TYPES),
      opening_balance: z.number().optional().describe("In cedis; leave out for 0"),
    }),
  },
  update_account: {
    description:
      "Renames, archives or restores an account. Archiving hides it from pickers but keeps all its history; it does not delete anything. Saved straight away with an Undo button. Get the id from list_accounts (include_archived to restore).",
    args: z.object({
      account_id: id,
      name: z.string().trim().min(1).max(60).optional().describe("The new name"),
      archived: z.boolean().optional().describe("true to archive, false to restore"),
    }),
  },
  create_category: {
    description:
      "Creates a spending or income category, or a subcategory under a top-level category of the same kind. Saved straight away with an Undo button. Check list_categories first so you don't duplicate one. Returns the category read back from the database.",
    args: z.object({
      name: z.string().trim().min(1).max(60),
      kind: z.enum(["expense", "income"]),
      parent_id: id.optional().describe("A top-level category of the same kind, to make this a subcategory"),
    }),
  },
  update_category: {
    description:
      "Renames, archives or restores a category. Archiving hides it from pickers; existing transactions keep it and nothing is deleted. Saved straight away with an Undo button. Get the id from list_categories (include_archived to restore).",
    args: z.object({
      category_id: id,
      name: z.string().trim().min(1).max(60).optional().describe("The new name"),
      archived: z.boolean().optional().describe("true to archive, false to restore"),
    }),
  },
  list_bills: {
    description:
      "The person's bills and repeating payments (rent, subscriptions, a salary that arrives every month): amount, schedule, next due date, whether it is due, paused or ended, and roughly what the live ones come to per month. Use it before changing, paying or skipping a bill, and to answer what is due soon.",
    args: z.object({}),
  },
  create_bill: {
    description:
      "Adds a repeating bill (expense) or repeating income. Saved straight away with an Undo button. The first due date must be today or later. It is NOT recorded as paid yet: the person marks it paid when it falls due, unless auto_post is true, which records it by itself when the app is opened on or after the due day (only set that when they clearly ask). Ask for anything unclear (amount, how often, which account, first due date) rather than guessing. Returns the bill read back from the database.",
    args: z.object({
      name: z.string().trim().min(1).max(60).describe("e.g. Rent, Netflix, Salary"),
      kind: z.enum(["expense", "income"]),
      amount: z.number().positive().describe("Each time, in the account's currency, e.g. 1200"),
      account_id: id,
      category_id: id.optional().describe("Must match the kind; leave out if none fits"),
      frequency: z.enum(["weekly", "monthly", "yearly"]),
      repeat_every: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("1 = every week/month/year (default), 2 = every other one, and so on"),
      first_due: day.describe("The first day it falls due: today or later"),
      end_date: day.optional().describe("Last day it can fall due; leave out if it goes on"),
      auto_post: z.boolean().optional().describe("true only when the person asked for it to be recorded automatically"),
    }),
  },
  update_bill: {
    description:
      "Changes a bill: name, amount, account (same currency), category, end date, auto_post, or pauses and resumes it. Only the fields you pass change. Saved straight away with an Undo button. It cannot change how often it repeats or the due date, and it cannot delete a bill; for those, or to cancel one, tell the person to use the Bills screen (or pause it). Get the id from list_bills.",
    args: z.object({
      bill_id: z.uuid().describe("An id taken from list_bills, never guessed"),
      name: z.string().trim().min(1).max(60).optional(),
      amount: z.number().positive().optional().describe("The new amount each time"),
      account_id: id.optional().describe("Another open account in the same currency"),
      category_id: id.nullable().optional().describe("null removes the category"),
      end_date: day.nullable().optional().describe("null removes the end date; must not be before the next due date"),
      auto_post: z.boolean().optional(),
      paused: z.boolean().optional().describe("true pauses it, false resumes it"),
    }),
  },
  pay_bill: {
    description:
      "Marks the bill's current due occurrence as paid (or, for income, received): records it as a transaction dated today and moves the bill to its next due date. Saved straight away with an Undo button. Pass amount only if the person paid something different from the usual amount. Get the id from list_bills. Returns the bill read back from the database.",
    args: z.object({
      bill_id: z.uuid().describe("An id taken from list_bills, never guessed"),
      amount: z.number().positive().optional().describe("Only if it differs from the usual amount"),
    }),
  },
  skip_bill: {
    description:
      "Skips the bill's current due occurrence without recording anything and moves it to its next due date. Saved straight away with an Undo button. Get the id from list_bills.",
    args: z.object({ bill_id: z.uuid().describe("An id taken from list_bills, never guessed") }),
  },
  transfer_money: {
    description:
      "Moves money from one of the person's own open accounts to another (e.g. Cash to Savings, bank to mobile money). Saved straight away with an Undo button; it is not spending or income, so it never counts in totals. Look up both account ids first, and ask which accounts and how much if unclear. amount is what leaves the first account. Only when the two accounts use different currencies, also pass amount_received (what arrives, in the second account's currency); never invent an exchange rate. An optional fee (e.g. a mobile money charge) is taken from the first account on top of the amount. Returns both new balances read back from the database.",
    args: z.object({
      from_account_id: id.describe("The account the money leaves"),
      to_account_id: id.describe("The account the money goes into"),
      amount: z.number().positive().describe("In the first account's currency, e.g. 200"),
      amount_received: z
        .number()
        .positive()
        .optional()
        .describe("Only for accounts in different currencies: what arrives, in the second account's currency"),
      fee: z.number().positive().optional().describe("A charge taken from the first account on top of amount"),
      fee_category_id: id.optional().describe("An expense category for the fee; leave out if none fits"),
      date: day.optional().describe("Defaults to today"),
      allow_future: z.boolean().optional().describe("True only when the person clearly asked for a future date"),
      note: z.string().max(500).optional(),
    }),
  },
  add_transaction: {
    description:
      "Records one expense or income. It is saved straight away and the person sees an Undo button. Look up the account and category ids first. Ask the person instead of guessing when the amount, account or what it was for is unclear. Returns the saved entry read back from the database.",
    args: z.object({
      type: z.enum(["expense", "income"]),
      amount: z.number().positive().describe("In the account's currency, e.g. 45 or 12.5"),
      account_id: id,
      category_id: id.optional().describe("Must match the type; leave out if none fits"),
      payee: z.string().max(120).optional().describe("Who was paid or who paid"),
      note: z.string().max(500).optional(),
      date: day.optional().describe("Defaults to today"),
      allow_future: z
        .boolean()
        .optional()
        .describe("True only when the person clearly asked for a date in the future"),
    }),
  },
  propose_transactions: {
    description:
      "For adding MANY expenses or incomes at once (more than 5, e.g. a pasted list or a week of spending). Nothing is saved by this call: the person gets a card listing every entry with Add and Skip buttons and decides. Look up the account and category ids first, and ask instead of guessing when an amount, account or what an entry was for is unclear. Between 2 and 5 entries, use add_transaction instead. At most 30.",
    args: z.object({
      entries: z
        .array(
          z.object({
            type: z.enum(["expense", "income"]),
            amount: z.number().positive().describe("In the account's currency, e.g. 45 or 12.5"),
            account_id: id,
            category_id: id.optional().describe("Must match the type; leave out if none fits"),
            payee: z.string().max(120).optional(),
            note: z.string().max(500).optional(),
            date: day.optional().describe("Defaults to today; not in the future"),
          }),
        )
        .min(2)
        .max(30),
    }),
  },
  update_transaction: {
    description:
      "Changes fields of one existing expense or income (not a transfer). Only the fields you pass change. It is saved straight away and the person sees an Undo button. Get the transaction_id from find_transactions. Returns the entry read back from the database.",
    args: z.object({
      transaction_id: z.uuid().describe("An id taken from find_transactions, never guessed"),
      amount: z.number().positive().optional().describe("In the account's currency"),
      account_id: id.optional().describe("Another account in the same currency"),
      category_id: id.nullable().optional().describe("null removes the category"),
      payee: z.string().max(120).nullable().optional().describe("null clears it"),
      note: z.string().max(500).nullable().optional().describe("null clears it"),
      date: day.optional(),
      allow_future: z.boolean().optional(),
    }),
  },
  delete_transactions: {
    description:
      "Asks the person to confirm deleting transactions. Nothing is deleted by this call: they get a card with Delete and Keep buttons and decide. Use it whenever they ask to delete or remove entries. Get the ids from find_transactions and make sure they are the ones meant. At most 20.",
    args: z.object({
      transaction_ids: z.array(z.uuid()).min(1).max(20).describe("Ids taken from find_transactions"),
    }),
  },
  set_my_name: {
    description:
      "Saves what the person wants to be called (their first name), so you and the app can greet them by it. Use it when they tell you their name or ask you to call them something. Saved straight away; they can change it any time in their profile. Only the name they gave, never a guess.",
    args: z.object({
      name: z.string().trim().min(1).max(40).describe("Their first name, e.g. Ama"),
    }),
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = new Set<string>(Object.keys(TOOLS));
export const isToolName = (name: string): name is ToolName => TOOL_NAMES.has(name);

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/** The tool list in the shape the model provider expects. */
export function toolDefinitions(): ToolDefinition[] {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => {
    const parameters = z.toJSONSchema(TOOLS[name].args, { io: "input" }) as Record<string, unknown>;
    delete parameters.$schema;
    return {
      type: "function",
      function: { name, description: TOOLS[name].description, parameters },
    };
  });
}
