import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { isToolName, TOOLS, type ToolName } from "@/lib/assistant/tool-definitions";
import { ToolError, changeMessage } from "@/lib/assistant/changes";
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
  chartIsEmpty,
  dayLabel as chartDay,
  describeChart,
  monthDays,
  monthName,
  monthsEndingAt,
  shiftMonth,
  type Summary,
} from "@/lib/assistant/chart-data";
import { chartSpecSchema, type ChartSpec } from "@/lib/assistant/chart-spec";
import type { ChangeNote, NewEntry, Proposal } from "@/lib/assistant/types";
import { currentMonthKey, dateKeyToIso, dayLabel, localDateKey, todayKey } from "@/lib/dates";
import { budgetStatus, changeRatio } from "@/lib/ledger/reports";
import { dueStatus, isEnded, monthlyEquivalent, needsAttention, scheduleLabel } from "@/lib/ledger/recurring";
import {
  ACCOUNT_TYPE_LABELS,
  type Category,
  type LedgerTransaction,
  type RecurringRule,
} from "@/lib/ledger/types";
import { DEFAULT_CURRENCY, formatMoney, MAX_MINOR_UNITS, minorUnitDigits } from "@/lib/money";
import {
  accountsQuery,
  budgetsQuery,
  categoriesQuery,
  ledgerKeys,
  monthlyReportQuery,
  recurringQuery,
  toTransaction,
  TRANSACTION_COLUMNS,
} from "@/lib/queries";
import { profileNameKey, saveDisplayName } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";

// The tools Penny can use. They run in the browser as the signed-in person, so
// the database's row level security decides what they can see. Every amount in
// a result is already formatted: the model quotes it and never does the sums.

const MAX_RESULT_CHARS = 9_000;

// `onChange` tells the screen about each change so it can show the green line.
// `changes` lives for one question: it caps how much Penny changes without the
// person looking, and stops the same entry being added twice.
export type ToolContext = {
  queryClient: QueryClient;
  onChange?: (note: ChangeNote) => void;
  // Puts a confirm card in front of the person (deleting never happens without one).
  onProposal?: (proposal: Proposal) => void;
  changes?: { count: number; seen: Set<string> };
  // Puts a chart in the conversation.
  onChart?: (chart: ChartSpec) => void;
  // How many charts this question has drawn (capped, so one question can't flood the chat).
  charts?: { count: number };
  // Set once a bulk-add card has been put up, so one question can't stack several.
  addCards?: number;
};
type Context = ToolContext;

export const MAX_CHANGES_PER_QUESTION = 5;
export const MAX_CHARTS_PER_QUESTION = 3;

const money = (minor: number, currency = DEFAULT_CURRENCY) => formatMoney(minor, currency);

// ---- Dates ------------------------------------------------------------------

function dayParts(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new ToolError(`"${key}" is not a real date.`);
  }
  return date;
}

const keyOf = (date: Date) => date.toISOString().slice(0, 10);
const shiftDays = (key: string, by: number) => keyOf(new Date(dayParts(key).getTime() + by * 86_400_000));
const daysBetween = (from: string, to: string) =>
  Math.round((dayParts(to).getTime() - dayParts(from).getTime()) / 86_400_000);

const MAX_RANGE_DAYS = 3_660;

function checkRange(from: string, to: string) {
  const days = daysBetween(from, to);
  if (days < 0) throw new ToolError("The start day is after the end day. Swap them.");
  if (days > MAX_RANGE_DAYS) throw new ToolError("That range is too long. Use 10 years or less.");
}

// Start of a calendar day on this device, as the timestamp the list filters use.
const startOfDayIso = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString();
};

function change(current: number, previous: number) {
  const ratio = changeRatio(current, previous);
  if (ratio === null) return null;
  const pct = Math.round(Math.abs(ratio) * 100);
  if (pct === 0) return "about the same";
  return `${ratio > 0 ? "up" : "down"} ${pct}%`;
}

// ---- Shared lookups -----------------------------------------------------------

// Always asks the database: an answer from a minute ago could be wrong now.
const accounts = (c: Context) => c.queryClient.fetchQuery({ ...accountsQuery(), staleTime: 0 });
const categories = (c: Context) => c.queryClient.fetchQuery({ ...categoriesQuery(), staleTime: 0 });

function categoryNames(list: Category[]) {
  const byId = new Map(list.map((cat) => [cat.id, cat]));
  return (id: string | null) => {
    if (!id) return "Uncategorised";
    const cat = byId.get(id);
    if (!cat) return "Unknown";
    const parent = cat.parentId ? byId.get(cat.parentId) : null;
    return parent ? `${parent.name} › ${cat.name}` : cat.name;
  };
}

// ---- The tools ----------------------------------------------------------------

type Args<N extends ToolName> = z.infer<(typeof TOOLS)[N]["args"]>;

async function listAccounts(c: Context, { include_archived }: Args<"list_accounts">) {
  const list = (await accounts(c)).filter((a) => include_archived || !a.archivedAt);
  return {
    accounts: list.map((a) => ({
      id: a.id,
      name: a.name,
      type: ACCOUNT_TYPE_LABELS[a.type],
      balance: money(a.balance, a.currency),
      opening_balance: money(a.openingBalance, a.currency),
      ...(a.archivedAt ? { archived: true } : {}),
    })),
  };
}

async function listCategories(c: Context, { kind, include_archived }: Args<"list_categories">) {
  const all = (await categories(c)).filter(
    (cat) => (include_archived || !cat.archivedAt) && (!kind || cat.kind === kind),
  );
  const byId = new Map(all.map((cat) => [cat.id, cat]));
  return {
    categories: all.map((cat) => ({
      id: cat.id,
      name: cat.name,
      kind: cat.kind,
      ...(cat.parentId && byId.get(cat.parentId) ? { parent: byId.get(cat.parentId)!.name } : {}),
      ...(cat.archivedAt ? { archived: true } : {}),
    })),
  };
}

async function getOverview(c: Context, { month }: Args<"get_overview">) {
  const monthKey = month ? `${month}-01` : currentMonthKey();
  if (month) dayParts(monthKey);

  const [report, accountList, budgets, cats] = await Promise.all([
    c.queryClient.fetchQuery({ ...monthlyReportQuery(monthKey), staleTime: 0 }),
    accounts(c),
    budgetRows(c, monthKey),
    categories(c),
  ]);

  const name = categoryNames(cats);
  const open = accountList.filter((a) => !a.archivedAt);
  const byCurrency = new Map<string, number>();
  for (const a of open) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + a.balance);

  return {
    month: monthKey.slice(0, 7),
    income: money(report.income, report.currency),
    spent: money(report.expense, report.currency),
    left_over: money(report.income - report.expense, report.currency),
    transactions: report.count,
    spending_vs_last_month: change(report.expense, report.prev_expense),
    income_vs_last_month: change(report.income, report.prev_income),
    ...(monthKey === currentMonthKey()
      ? {
          caution:
            "This month isn't over yet, so the vs_last_month figures compare part of a month with a whole one. Say so when you quote them.",
        }
      : {}),
    top_spending_categories: report.categories.slice(0, 5).map((cat) => ({
      name: cat.name,
      spent: money(cat.amount, report.currency),
    })),
    total_across_accounts: [...byCurrency].map(([currency, total]) => money(total, currency)),
    accounts: open.length,
    budgets: budgets.map((b) => budgetLine(b, name)),
  };
}

// ---- Budgets ----------------------------------------------------------------------

const budgetRows = (c: Context, monthKey: string) =>
  c.queryClient.fetchQuery({ ...budgetsQuery(monthKey), staleTime: 0 });

type BudgetRow = Awaited<ReturnType<typeof budgetRows>>[number];

const budgetLine = (b: BudgetRow, name: (id: string | null) => string) => ({
  ...(b.categoryId ? { category_id: b.categoryId } : {}),
  category: b.categoryId ? name(b.categoryId) : "All spending",
  limit: money(b.amount, b.currency),
  spent: money(b.spent, b.currency),
  remaining:
    b.spent <= b.amount
      ? money(b.amount - b.spent, b.currency)
      : `over by ${money(b.spent - b.amount, b.currency)}`,
  status: budgetStatus(b.spent, b.amount),
});

async function listBudgets(c: Context, { month }: Args<"list_budgets">) {
  const monthKey = month ? `${month}-01` : currentMonthKey();
  if (month) dayParts(monthKey);
  const [rows, cats] = await Promise.all([budgetRows(c, monthKey), categories(c)]);
  const name = categoryNames(cats);
  return {
    month: monthKey.slice(0, 7),
    budgets: rows.map((b) => budgetLine(b, name)),
    ...(rows.length === 0 ? { note: "No budgets are set." } : {}),
  };
}

const toMinor = (cedis: number) => Math.round(cedis * 10 ** minorUnitDigits(DEFAULT_CURRENCY));

async function findTransactions(c: Context, args: Args<"find_transactions">) {
  if (args.from && args.to) checkRange(args.from, args.to);
  if (args.from) dayParts(args.from);
  if (args.to) dayParts(args.to);
  if (args.min_amount && args.max_amount && args.min_amount > args.max_amount) {
    throw new ToolError("min_amount is bigger than max_amount. Swap them.");
  }

  const [catList, accountList] = await Promise.all([categories(c), accounts(c)]);
  const limit = args.limit ?? 20;

  let q = createClient()
    .from("transactions")
    .select(TRANSACTION_COLUMNS, { count: "exact" })
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (args.account_id) {
    if (!accountList.some((a) => a.id === args.account_id)) {
      throw new ToolError("No account has that id. Call list_accounts.");
    }
    q = q.eq("account_id", args.account_id);
  }
  if (args.category_id) {
    if (!catList.some((cat) => cat.id === args.category_id)) {
      throw new ToolError("No category has that id. Call list_categories.");
    }
    const ids = catList
      .filter((cat) => cat.id === args.category_id || cat.parentId === args.category_id)
      .map((cat) => cat.id);
    q = q.in("category_id", ids);
  }
  if (args.type === "transfer") q = q.in("type", ["transfer_in", "transfer_out"]);
  else if (args.type) q = q.eq("type", args.type);
  if (args.from) q = q.gte("occurred_at", startOfDayIso(args.from));
  if (args.to) q = q.lt("occurred_at", startOfDayIso(shiftDays(args.to, 1)));
  if (args.min_amount) q = q.gte("amount", toMinor(args.min_amount));
  if (args.max_amount) q = q.lte("amount", toMinor(args.max_amount));
  const term = args.text?.trim().replace(/[%,()*_\\]/g, " ").trim();
  if (term) q = q.or(`payee.ilike.%${term}%,note.ilike.%${term}%`);

  const { data, error, count } = await q;
  if (error) throw new ToolError("The lookup failed. Try again.");

  const rows = (data as Parameters<typeof toTransaction>[0][]).map(toTransaction);
  const name = categoryNames(catList);
  const accountName = new Map(accountList.map((a) => [a.id, a.name]));
  const total = count ?? rows.length;

  const sum = (type: LedgerTransaction["type"]) =>
    rows.filter((t) => t.type === type).reduce((acc, t) => acc + t.amount, 0);
  const complete = rows.length === total;

  return {
    matches: total,
    shown: rows.length,
    transactions: rows.map((t) => ({
      id: t.id,
      date: localDateKey(t.occurredAt),
      type: t.type.replace("_", " "),
      amount: money(t.amount, t.currency),
      category: t.type.startsWith("transfer") ? null : name(t.categoryId),
      account: accountName.get(t.accountId) ?? "Unknown",
      payee: t.payee,
      note: t.note ? t.note.slice(0, 80) : null,
    })),
    ...(complete
      ? {
          totals: {
            spent: money(sum("expense")),
            income: money(sum("income")),
          },
        }
      : {
          note: "More transactions match than are shown. Narrow the search, or use summarize_spending for totals.",
        }),
  };
}

const spendingSummarySchema = z.object({
  total: z.coerce.number().int(),
  count: z.coerce.number().int(),
  group_count: z.coerce.number().int(),
  groups: z.array(
    z.object({
      id: z.string().nullable(),
      label: z.string(),
      amount: z.coerce.number().int(),
      count: z.coerce.number().int(),
    }),
  ),
});

async function runSummary(from: string, to: string, type: string, groupBy: string) {
  const { data, error } = await createClient().rpc("spending_summary", {
    p_from: from,
    p_to: to,
    p_type: type,
    p_group: groupBy,
  });
  if (error) throw new ToolError("The summary failed. Try again.");
  return spendingSummarySchema.parse(data);
}

async function summarizeSpending(_c: Context, args: Args<"summarize_spending">) {
  checkRange(args.from, args.to);
  const type = args.type ?? "expense";
  const groupBy = args.group_by ?? "category";
  const result = await runSummary(args.from, args.to, type, groupBy);
  const timeline = ["day", "week", "month"].includes(groupBy);

  let previous: { period: { from: string; to: string }; total: string; change: string | null } | undefined;
  if (args.compare_to_previous) {
    const length = daysBetween(args.from, args.to) + 1;
    const prevTo = shiftDays(args.from, -1);
    const prevFrom = shiftDays(prevTo, -(length - 1));
    const prev = await runSummary(prevFrom, prevTo, type, "category");
    previous = {
      period: { from: prevFrom, to: prevTo },
      total: money(prev.total),
      change: change(result.total, prev.total),
    };
  }

  return {
    period: { from: args.from, to: args.to },
    type,
    group_by: groupBy,
    total: money(result.total),
    transactions: result.count,
    groups: result.groups.map((g) => ({
      ...(g.id ? { id: g.id } : {}),
      name: g.label,
      total: money(g.amount),
      transactions: g.count,
      ...(!timeline && result.total > 0
        ? { share: `${Math.round((g.amount / result.total) * 100)}%` }
        : {}),
    })),
    ...(result.group_count > result.groups.length
      ? { more_groups_not_shown: result.group_count - result.groups.length }
      : {}),
    ...(previous ? { previous_period: previous } : {}),
  };
}

// ---- Changes ----------------------------------------------------------------------
// Each one is saved straight away through a database function that records it as
// Penny's and hands back a token for Undo. It is then read back, so what she says
// is what was saved.

function toMinorIn(amount: number, currency: string) {
  const digits = minorUnitDigits(currency);
  const minor = Math.round(amount * 10 ** digits);
  if (Math.abs(amount * 10 ** digits - minor) > 1e-6) {
    throw new ToolError(`That amount has more than ${digits} decimal places.`);
  }
  if (minor < 1 || minor > MAX_MINOR_UNITS) throw new ToolError("That amount is out of range.");
  return minor;
}

function checkDate(key: string, allowFuture = false) {
  dayParts(key);
  if (key < "2000-01-01") throw new ToolError("That date is too far back.");
  if (key > todayKey() && !allowFuture) {
    throw new ToolError(
      "That date is in the future. If the person really meant it, call again with allow_future set to true.",
    );
  }
}

async function openAccount(c: Context, id: string) {
  const account = (await accounts(c)).find((a) => a.id === id && !a.archivedAt);
  if (!account) throw new ToolError("No open account has that id. Call list_accounts.");
  return account;
}

async function usableCategory(c: Context, id: string, kind: "expense" | "income") {
  const cat = (await categories(c)).find((x) => x.id === id && !x.archivedAt);
  if (!cat) throw new ToolError("No category has that id. Call list_categories.");
  if (cat.kind !== kind) {
    throw new ToolError(`That is an ${cat.kind} category but this entry is ${kind}. Pick a ${kind} category.`);
  }
}

// Limits how much changes without the person looking, and blocks exact repeats.
// Returns a function to call once the change has been saved.
function allowChange(c: Context, key: string) {
  const state = (c.changes ??= { count: 0, seen: new Set() });
  if (state.seen.has(key)) {
    throw new ToolError("That exact change was already made a moment ago. Don't repeat it.");
  }
  if (state.count >= MAX_CHANGES_PER_QUESTION) {
    throw new ToolError(
      `That's already ${MAX_CHANGES_PER_QUESTION} changes in a row. Stop, tell the person what you have done, and ask before doing more.`,
    );
  }
  return () => {
    state.count += 1;
    state.seen.add(key);
  };
}

const changeResultSchema = z.object({ id: z.uuid(), undo_token: z.uuid().nullable() });

async function readBack(id: string) {
  const { data, error } = await createClient()
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) {
    throw new ToolError(
      "The change was sent but could not be confirmed. Check with find_transactions before telling the person it worked.",
    );
  }
  return toTransaction(data as Parameters<typeof toTransaction>[0]);
}

async function reportChange(c: Context, verb: string, id: string, undoToken: string | null) {
  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const [t, catList, accountList] = await Promise.all([readBack(id), categories(c), accounts(c)]);
  const category = t.categoryId ? categoryNames(catList)(t.categoryId) : null;
  const account = accountList.find((a) => a.id === t.accountId)?.name ?? "Unknown";
  const amount = money(t.amount, t.currency);

  c.onChange?.({
    label: `${verb} ${amount} ${t.type}`,
    detail: [t.payee, category, account, dayLabel(localDateKey(t.occurredAt))].filter(Boolean).join(" · "),
    ...(undoToken ? { undoTokens: [undoToken] } : {}),
  });
  return {
    saved: true,
    transaction: {
      id: t.id,
      date: localDateKey(t.occurredAt),
      type: t.type,
      amount,
      category,
      account,
      payee: t.payee,
      note: t.note,
    },
    note: "The person now sees a green line with an Undo button. Confirm in one short sentence and don't repeat every detail.",
  };
}

async function addTransactionTool(c: Context, a: Args<"add_transaction">) {
  const account = await openAccount(c, a.account_id);
  if (a.category_id) await usableCategory(c, a.category_id, a.type);
  const dateKey = a.date ?? todayKey();
  checkDate(dateKey, a.allow_future);
  const amount = toMinorIn(a.amount, account.currency);
  const done = allowChange(
    c,
    `add:${JSON.stringify([a.type, amount, account.id, a.category_id, a.payee, a.note, dateKey])}`,
  );

  const id = crypto.randomUUID();
  const { data, error } = await createClient().rpc("assistant_add_transaction", {
    p_id: id,
    p_account: account.id,
    p_type: a.type,
    p_amount: amount,
    p_occurred_at: dateKeyToIso(dateKey),
    p_category: a.category_id ?? null,
    p_payee: a.payee ?? null,
    p_note: a.note ?? null,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  return reportChange(c, "Added", id, changeResultSchema.parse(data).undo_token);
}

async function updateTransactionTool(c: Context, a: Args<"update_transaction">) {
  const { data, error: lookupError } = await createClient()
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", a.transaction_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupError) throw new ToolError("The lookup failed. Try again.");
  if (!data) throw new ToolError("No transaction has that id. Call find_transactions.");
  const existing = toTransaction(data as Parameters<typeof toTransaction>[0]);
  if (existing.type !== "expense" && existing.type !== "income") {
    throw new ToolError("Transfers can't be edited this way. Tell the person to edit it in the app.");
  }

  const patch: Record<string, unknown> = {};
  if (a.amount !== undefined) patch.amount = toMinorIn(a.amount, existing.currency);
  if (a.account_id !== undefined) {
    const account = await openAccount(c, a.account_id);
    if (account.currency !== existing.currency) {
      throw new ToolError("That account uses another currency, so the entry can't move there.");
    }
    patch.account_id = account.id;
  }
  if (a.category_id !== undefined) {
    if (a.category_id) await usableCategory(c, a.category_id, existing.type);
    patch.category_id = a.category_id;
  }
  if (a.payee !== undefined) patch.payee = a.payee;
  if (a.note !== undefined) patch.note = a.note;
  if (a.date !== undefined) {
    checkDate(a.date, a.allow_future);
    if (a.date !== localDateKey(existing.occurredAt)) patch.occurred_at = dateKeyToIso(a.date);
  }
  if (Object.keys(patch).length === 0) {
    throw new ToolError("Nothing would change. Say which field to update.");
  }
  const done = allowChange(c, `update:${JSON.stringify([a.transaction_id, patch])}`);

  const { data: result, error } = await createClient().rpc("assistant_update_transaction", {
    p_id: a.transaction_id,
    p_patch: patch,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  return reportChange(c, "Updated", a.transaction_id, changeResultSchema.parse(result).undo_token);
}

// Nothing is deleted here. The rows are checked, laid out on a card, and the
// person decides; the delete itself runs from the card's Delete button.
async function deleteTransactionsTool(c: Context, a: Args<"delete_transactions">) {
  const ids = [...new Set(a.transaction_ids)];
  const { data, error } = await createClient()
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw new ToolError("The lookup failed. Try again.");
  const found = (data as Parameters<typeof toTransaction>[0][]).map(toTransaction);
  if (found.length !== ids.length) {
    throw new ToolError("Some of those ids don't match a transaction. Call find_transactions again.");
  }
  if (found.some((t) => t.type !== "expense" && t.type !== "income")) {
    throw new ToolError("Transfers can't be deleted this way. Tell the person to delete them in the app.");
  }

  const [catList, accountList] = await Promise.all([categories(c), accounts(c)]);
  const name = categoryNames(catList);
  const accountName = new Map(accountList.map((x) => [x.id, x.name]));
  const rows = found
    .sort((x, y) => y.occurredAt.localeCompare(x.occurredAt))
    .map((t) => ({
      id: t.id,
      title: t.payee || (t.categoryId ? name(t.categoryId) : "No payee"),
      detail: [t.categoryId ? name(t.categoryId) : null, accountName.get(t.accountId), dayLabel(localDateKey(t.occurredAt))]
        .filter(Boolean)
        .join(" · "),
      amount: `${t.type === "income" ? "+" : "−"}${money(t.amount, t.currency)}`,
    }));

  c.onProposal?.({ action: "delete", rows });
  return {
    awaiting_confirmation: true,
    would_delete: rows.length,
    note: "NOTHING HAS BEEN DELETED. The person sees a card with Delete and Keep buttons. Tell them in one short sentence to check the card and confirm. Never say it is deleted.",
  };
}

// Nothing is saved here either. Every entry is checked the way a single add would be,
// then laid out on a card; the Add button on the card does the saving.
async function proposeTransactionsTool(c: Context, a: Args<"propose_transactions">) {
  if (c.addCards) {
    throw new ToolError("A card for adding entries is already on screen. Wait for the person to answer it.");
  }
  const [accountList, catList] = await Promise.all([accounts(c), categories(c)]);
  const name = categoryNames(catList);
  const today = todayKey();

  const checked = a.entries.map((e, i) => {
    const fail = (message: string) => new ToolError(`Entry ${i + 1}: ${message}`);
    const account = accountList.find((x) => x.id === e.account_id && !x.archivedAt);
    if (!account) throw fail("no open account has that id. Call list_accounts.");
    if (e.category_id) {
      const cat = catList.find((x) => x.id === e.category_id && !x.archivedAt);
      if (!cat) throw fail("no category has that id. Call list_categories.");
      if (cat.kind !== e.type) throw fail(`that is an ${cat.kind} category but the entry is ${e.type}.`);
    }
    const date = e.date ?? today;
    try {
      checkDate(date);
      const amount = toMinorIn(e.amount, account.currency);
      return { e, account, date, amount };
    } catch (error) {
      throw fail(error instanceof ToolError ? error.message : "that is not valid.");
    }
  });

  const entries: NewEntry[] = checked.map(({ e, account, date, amount }) => ({
    type: e.type,
    amount,
    accountId: account.id,
    categoryId: e.category_id ?? null,
    payee: e.payee?.trim() || null,
    note: e.note?.trim() || null,
    date,
  }));
  const rows = checked.map(({ e, account, date, amount }) => ({
    id: crypto.randomUUID(),
    title: e.payee?.trim() || (e.category_id ? name(e.category_id) : e.type === "income" ? "Income" : "Expense"),
    detail: [e.category_id ? name(e.category_id) : null, account.name, dayLabel(date)].filter(Boolean).join(" · "),
    amount: `${e.type === "income" ? "+" : "−"}${money(amount, account.currency)}`,
  }));
  const total = (type: "expense" | "income") =>
    entries.filter((x) => x.type === type).reduce((n, x) => n + x.amount, 0);
  const summary = [
    total("expense") ? `Spending ${money(total("expense"))}` : null,
    total("income") ? `Income ${money(total("income"))}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  c.addCards = 1;
  c.onProposal?.({ action: "add", rows, entries, summary });
  return {
    awaiting_confirmation: true,
    would_add: entries.length,
    summary,
    note: "NOTHING HAS BEEN ADDED. The person sees a card with Add and Skip buttons. Tell them in one short sentence to check the card and confirm. Never say it is added.",
  };
}

// ---- Account and category changes -------------------------------------------------

const structureResultSchema = z.object({
  id: z.uuid(),
  undo_token: z.uuid().nullable(),
  active_bills: z.number().int().optional(),
  open_subcategories: z.number().int().optional(),
});

const notConfirmed = (check: string) =>
  new ToolError(
    `The change was sent but could not be confirmed. Check with ${check} before telling the person it worked.`,
  );

function signedMinor(amount: number, currency: string) {
  const digits = minorUnitDigits(currency);
  const minor = Math.round(amount * 10 ** digits);
  if (Math.abs(amount * 10 ** digits - minor) > 1e-6) {
    throw new ToolError(`That amount has more than ${digits} decimal places.`);
  }
  if (Math.abs(minor) > MAX_MINOR_UNITS) throw new ToolError("That amount is out of range.");
  return minor;
}

// Only the fields that really differ are sent, so "rename it to what it already is" is caught.
function renameOrArchivePatch(
  current: { name: string; archivedAt: string | null },
  want: { name?: string; archived?: boolean },
  // Another field is already changing, so "name and archive unchanged" is fine.
  otherChange = false,
) {
  const patch: { name?: string; archived?: boolean } = {};
  const name = want.name?.trim();
  if (name !== undefined && name !== current.name) patch.name = name;
  if (want.archived !== undefined && want.archived !== Boolean(current.archivedAt)) patch.archived = want.archived;
  if (patch.name === undefined && patch.archived === undefined && !otherChange) {
    throw new ToolError(
      want.name === undefined && want.archived === undefined
        ? "Nothing to change. Say whether to rename it, archive it or restore it."
        : "Nothing would change: it is already like that.",
    );
  }
  return patch;
}

function renameLabel(oldName: string, newName: string, patch: { name?: string; archived?: boolean }) {
  if (patch.name !== undefined && patch.archived === undefined) return `Renamed ${oldName} to ${newName}`;
  if (patch.name !== undefined) return `Updated ${newName}`;
  return patch.archived ? `Archived ${newName}` : `Restored ${newName}`;
}

async function createAccountTool(c: Context, a: Args<"create_account">) {
  const name = a.name.trim();
  const opening = a.opening_balance === undefined ? 0 : signedMinor(a.opening_balance, DEFAULT_CURRENCY);
  const done = allowChange(c, `account:${JSON.stringify([name.toLowerCase(), a.type, opening])}`);

  const id = crypto.randomUUID();
  const { data, error } = await createClient().rpc("assistant_create_account", {
    p_id: id,
    p_name: name,
    p_type: a.type,
    p_currency: DEFAULT_CURRENCY,
    p_opening: opening,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = structureResultSchema.parse(data);

  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const saved = (await accounts(c)).find((x) => x.id === id);
  if (!saved) throw notConfirmed("list_accounts");
  const balance = money(saved.balance, saved.currency);
  c.onChange?.({
    label: `Created ${saved.name} account`,
    detail: `${ACCOUNT_TYPE_LABELS[saved.type]} · starts at ${balance}`,
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    account: { id: saved.id, name: saved.name, type: ACCOUNT_TYPE_LABELS[saved.type], balance },
    note: "The person now sees a green line with an Undo button. Confirm in one short sentence.",
  };
}

// Like the name/archive patch, plus the opening balance in whole minor units.
function accountPatch(
  current: { name: string; archivedAt: string | null; openingBalance: number; currency: string },
  want: { name?: string; archived?: boolean; opening_balance?: number },
) {
  const patch: { name?: string; archived?: boolean; opening_balance?: number } = {};
  if (want.opening_balance !== undefined) {
    const minor = signedMinor(want.opening_balance, current.currency);
    if (minor !== current.openingBalance) patch.opening_balance = minor;
  }
  if (want.name === undefined && want.archived === undefined) {
    if (want.opening_balance === undefined) {
      throw new ToolError(
        "Nothing to change. Say whether to rename it, change its opening balance, archive it or restore it.",
      );
    }
    if (patch.opening_balance === undefined) throw new ToolError("Nothing would change: it is already like that.");
    return patch;
  }
  const rest = renameOrArchivePatch(
    current,
    { name: want.name, archived: want.archived },
    patch.opening_balance !== undefined,
  );
  return { ...rest, ...patch };
}

async function updateAccountTool(c: Context, a: Args<"update_account">) {
  const existing = (await accounts(c)).find((x) => x.id === a.account_id);
  if (!existing) throw new ToolError("No account has that id. Call list_accounts.");
  const patch = accountPatch(existing, { name: a.name, archived: a.archived, opening_balance: a.opening_balance });
  const done = allowChange(c, `account-update:${JSON.stringify([a.account_id, patch])}`);

  const { data, error } = await createClient().rpc("assistant_update_account", {
    p_id: a.account_id,
    p_patch: patch,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = structureResultSchema.parse(data);

  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const saved = (await accounts(c)).find((x) => x.id === a.account_id);
  if (!saved) throw notConfirmed("list_accounts");

  const balance = money(saved.balance, saved.currency);
  const opening = money(saved.openingBalance, saved.currency);
  const openingOnly =
    patch.opening_balance !== undefined && patch.name === undefined && patch.archived === undefined;
  c.onChange?.({
    label: openingOnly
      ? `Changed ${saved.name} opening balance`
      : renameLabel(existing.name, saved.name, patch),
    ...(patch.opening_balance !== undefined
      ? { detail: `Opening balance ${opening} · balance now ${balance}` }
      : patch.archived
        ? { detail: `History kept · balance ${balance}` }
        : {}),
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    account: {
      id: saved.id,
      name: saved.name,
      archived: Boolean(saved.archivedAt),
      balance,
      opening_balance: opening,
    },
    ...(patch.archived && saved.balance !== 0
      ? { warning: `It still holds ${balance}. Archiving does not move or remove that money; mention it.` }
      : {}),
    ...(patch.archived && result.active_bills
      ? { bills_still_using_it: result.active_bills, bills_note: "Tell the person those bills still use this account." }
      : {}),
    note: "Nothing was deleted. The person now sees a green line with an Undo button. Confirm in one short sentence.",
  };
}

async function createCategoryTool(c: Context, a: Args<"create_category">) {
  const name = a.name.trim();
  if (a.parent_id) {
    const parent = (await categories(c)).find((x) => x.id === a.parent_id && !x.archivedAt);
    if (!parent) throw new ToolError("No open category has that id. Call list_categories.");
    if (parent.kind !== a.kind) {
      throw new ToolError(`That parent is an ${parent.kind} category but this one is ${a.kind}.`);
    }
    if (parent.parentId) {
      throw new ToolError("Categories only go two levels deep. Pick a top-level category as the parent.");
    }
  }
  const done = allowChange(c, `category:${JSON.stringify([name.toLowerCase(), a.kind, a.parent_id ?? null])}`);

  const id = crypto.randomUUID();
  const { data, error } = await createClient().rpc("assistant_create_category", {
    p_id: id,
    p_name: name,
    p_kind: a.kind,
    p_parent: a.parent_id ?? null,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = structureResultSchema.parse(data);

  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const fresh = await categories(c);
  const saved = fresh.find((x) => x.id === id);
  if (!saved) throw notConfirmed("list_categories");
  const path = categoryNames(fresh)(id);
  c.onChange?.({
    label: `Created ${saved.kind} category ${path}`,
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    category: { id, name: saved.name, kind: saved.kind, ...(saved.parentId ? { path } : {}) },
    note: "The person now sees a green line with an Undo button. Confirm in one short sentence.",
  };
}

async function updateCategoryTool(c: Context, a: Args<"update_category">) {
  const existing = (await categories(c)).find((x) => x.id === a.category_id);
  if (!existing) throw new ToolError("No category has that id. Call list_categories.");
  const patch = renameOrArchivePatch(existing, { name: a.name, archived: a.archived });
  const done = allowChange(c, `category-update:${JSON.stringify([a.category_id, patch])}`);

  const { data, error } = await createClient().rpc("assistant_update_category", {
    p_id: a.category_id,
    p_patch: patch,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = structureResultSchema.parse(data);

  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const saved = (await categories(c)).find((x) => x.id === a.category_id);
  if (!saved) throw notConfirmed("list_categories");

  c.onChange?.({
    label: renameLabel(existing.name, saved.name, patch),
    ...(patch.archived ? { detail: "Past entries keep it" } : {}),
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    category: { id: saved.id, name: saved.name, archived: Boolean(saved.archivedAt) },
    ...(patch.archived && result.open_subcategories
      ? {
          open_subcategories: result.open_subcategories,
          subcategories_note: "Its subcategories were not archived. Tell the person.",
        }
      : {}),
    note: "Nothing was deleted. The person now sees a green line with an Undo button. Confirm in one short sentence.",
  };
}

// ---- Budget changes ---------------------------------------------------------------

const budgetChangeSchema = z.object({
  id: z.uuid(),
  undo_token: z.uuid().nullable(),
  previous_amount: z.coerce.number().int().nullable(),
});

async function setBudgetTool(c: Context, a: Args<"set_budget">) {
  if (a.category_id) await usableCategory(c, a.category_id, "expense");
  const amount = toMinorIn(a.amount, DEFAULT_CURRENCY);
  const done = allowChange(c, `budget:${JSON.stringify([a.category_id ?? null, amount])}`);

  const { data, error } = await createClient().rpc("assistant_set_budget", {
    p_category: a.category_id ?? null,
    p_amount: amount,
    p_currency: DEFAULT_CURRENCY,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = budgetChangeSchema.parse(data);

  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const [rows, cats] = await Promise.all([budgetRows(c, currentMonthKey()), categories(c)]);
  const saved = rows.find((b) => b.id === result.id);
  if (!saved) {
    throw new ToolError(
      "The change was sent but could not be confirmed. Check with list_budgets before telling the person it worked.",
    );
  }
  const line = budgetLine(saved, categoryNames(cats));
  const label = a.category_id ? line.category : "overall";
  c.onChange?.({
    label: `Set ${label} budget to ${line.limit}`,
    detail:
      result.previous_amount === null
        ? "New monthly budget"
        : `Was ${money(result.previous_amount)} · monthly`,
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    budget: line,
    ...(result.previous_amount !== null ? { previous_limit: money(result.previous_amount) } : {}),
    note: "It applies to every month. The person now sees a green line with an Undo button. Confirm in one short sentence.",
  };
}

async function removeBudgetTool(c: Context, a: Args<"remove_budget">) {
  if (a.category_id) await usableCategory(c, a.category_id, "expense");
  const done = allowChange(c, `unbudget:${a.category_id ?? "overall"}`);

  const { data, error } = await createClient().rpc("assistant_remove_budget", {
    p_category: a.category_id ?? null,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = budgetChangeSchema.parse(data);

  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const name = a.category_id ? categoryNames(await categories(c))(a.category_id) : "overall";
  const was = result.previous_amount === null ? null : money(result.previous_amount);
  c.onChange?.({
    label: `Removed ${name} budget`,
    ...(was ? { detail: `Was ${was} · monthly` } : {}),
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    removed: true,
    budget: name,
    ...(was ? { previous_limit: was } : {}),
    note: "No transactions were touched. The person now sees a green line with an Undo button. Confirm in one short sentence.",
  };
}

// ---- Bills ------------------------------------------------------------------------

const bills = (c: Context) => c.queryClient.fetchQuery({ ...recurringQuery(), staleTime: 0 });

const MAX_BILLS_LISTED = 30;

const billResultSchema = z.object({
  id: z.uuid(),
  undo_token: z.uuid().nullable(),
  paid_for: z.string().optional(),
  skipped: z.string().optional(),
});

async function billNames(c: Context) {
  const [accountList, cats] = await Promise.all([accounts(c), categories(c)]);
  const accountName = new Map(accountList.map((a) => [a.id, a.name]));
  const category = categoryNames(cats);
  return { account: (id: string) => accountName.get(id) ?? "Unknown", category };
}
type BillNames = Awaited<ReturnType<typeof billNames>>;

function billStatus(r: RecurringRule) {
  if (isEnded(r)) return "ended";
  if (r.paused) return "paused";
  if (needsAttention(r)) return "due, waiting to be paid";
  if (r.autoPost && r.nextDue <= todayKey()) return "due, posts by itself when the app is opened";
  return "active";
}

function billLine(r: RecurringRule, n: BillNames) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    amount: money(r.amount, r.currency),
    schedule: scheduleLabel(r),
    next_due: r.nextDue,
    ...(isEnded(r) ? {} : { due: dueStatus(r.nextDue).label }),
    account: n.account(r.accountId),
    ...(r.categoryId ? { category: n.category(r.categoryId) } : {}),
    auto_post: r.autoPost,
    ...(r.endDate ? { ends: r.endDate } : {}),
    status: billStatus(r),
    about_per_month: money(monthlyEquivalent(r), r.currency),
  };
}

async function listBills(c: Context) {
  const [rules, names] = await Promise.all([bills(c), billNames(c)]);
  const perMonth = (kind: RecurringRule["kind"]) => {
    const totals = new Map<string, number>();
    for (const r of rules.filter((x) => x.kind === kind && !x.paused && !isEnded(x))) {
      totals.set(r.currency, (totals.get(r.currency) ?? 0) + monthlyEquivalent(r));
    }
    return [...totals].map(([currency, total]) => money(total, currency));
  };
  if (rules.length === 0) return { bills: [], note: "No bills are set up." };
  return {
    bills: rules.slice(0, MAX_BILLS_LISTED).map((r) => billLine(r, names)),
    ...(rules.length > MAX_BILLS_LISTED ? { more_not_shown: rules.length - MAX_BILLS_LISTED } : {}),
    live_bills_per_month: { expenses: perMonth("expense"), income: perMonth("income") },
    note: "The per-month figures are averages: weekly and yearly bills are spread over a month. Paused and ended bills are left out of them.",
  };
}

// The bill as saved, found again after the change so what is said matches the database.
async function savedBill(c: Context, id: string) {
  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const saved = (await bills(c)).find((r) => r.id === id);
  if (!saved) throw notConfirmed("list_bills");
  return saved;
}

async function existingBill(c: Context, id: string) {
  const bill = (await bills(c)).find((r) => r.id === id);
  if (!bill) throw new ToolError("No bill has that id. Call list_bills.");
  return bill;
}

async function createBillTool(c: Context, a: Args<"create_bill">) {
  const account = await openAccount(c, a.account_id);
  if (a.category_id) await usableCategory(c, a.category_id, a.kind);
  const name = a.name.trim();
  const amount = toMinorIn(a.amount, account.currency);
  const every = a.repeat_every ?? 1;
  dayParts(a.first_due);
  if (a.first_due < todayKey()) {
    throw new ToolError(
      "The first due date is in the past. Use today or a later date. If a payment already happened, record it as a transaction instead.",
    );
  }
  if (a.end_date) {
    dayParts(a.end_date);
    if (a.end_date < a.first_due) throw new ToolError("The end date is before the first due date.");
  }
  const done = allowChange(
    c,
    `bill:${JSON.stringify([name.toLowerCase(), a.kind, amount, a.account_id, a.frequency, every, a.first_due])}`,
  );

  const id = crypto.randomUUID();
  const { data, error } = await createClient().rpc("assistant_create_bill", {
    p_id: id,
    p_kind: a.kind,
    p_name: name,
    p_amount: amount,
    p_account: a.account_id,
    p_category: a.category_id ?? null,
    p_frequency: a.frequency,
    p_every: every,
    p_first_due: a.first_due,
    p_end: a.end_date ?? null,
    p_auto: a.auto_post ?? false,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = billResultSchema.parse(data);

  const saved = await savedBill(c, id);
  const line = billLine(saved, await billNames(c));
  c.onChange?.({
    label: `Added bill: ${saved.name}`,
    detail: `${line.amount} · ${line.schedule} · next ${dayLabel(saved.nextDue)}`,
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    bill: line,
    note: saved.autoPost
      ? "It will be recorded by itself when the app is opened on or after the due day. The person now sees a green line with an Undo button. Confirm in one short sentence."
      : "Nothing has been recorded yet; the person marks it paid when it falls due. The person now sees a green line with an Undo button. Confirm in one short sentence.",
  };
}

async function updateBillTool(c: Context, a: Args<"update_bill">) {
  const bill = await existingBill(c, a.bill_id);
  const patch: Record<string, unknown> = {};
  const parts: string[] = [];

  const name = a.name?.trim();
  if (name !== undefined && name !== bill.name) patch.name = name;
  if (a.amount !== undefined) {
    const amount = toMinorIn(a.amount, bill.currency);
    if (amount !== bill.amount) {
      patch.amount = amount;
      parts.push(`Amount was ${money(bill.amount, bill.currency)}`);
    }
  }
  if (a.account_id !== undefined && a.account_id !== bill.accountId) {
    const account = await openAccount(c, a.account_id);
    if (account.currency !== bill.currency) {
      throw new ToolError(`That account uses ${account.currency} but this bill is in ${bill.currency}.`);
    }
    patch.account_id = a.account_id;
  }
  if (a.category_id !== undefined && a.category_id !== bill.categoryId) {
    if (a.category_id) await usableCategory(c, a.category_id, bill.kind);
    patch.category_id = a.category_id;
  }
  if (a.end_date !== undefined && a.end_date !== bill.endDate) {
    if (a.end_date) {
      dayParts(a.end_date);
      if (a.end_date < bill.nextDue) throw new ToolError("The end date is before the next due date.");
    }
    patch.end_date = a.end_date;
    parts.push(a.end_date ? `Ends ${dayLabel(a.end_date)}` : "No end date");
  }
  if (a.auto_post !== undefined && a.auto_post !== bill.autoPost) {
    patch.auto_post = a.auto_post;
    parts.push(a.auto_post ? "Records itself when due" : "You mark it paid");
  }
  if (a.paused !== undefined && a.paused !== bill.paused) patch.paused = a.paused;

  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new ToolError(
      Object.values(a).filter((v) => v !== undefined).length <= 1
        ? "Nothing to change. Say what to change on the bill."
        : "Nothing would change: the bill is already like that.",
    );
  }
  const done = allowChange(c, `bill-update:${JSON.stringify([a.bill_id, patch])}`);

  const { data, error } = await createClient().rpc("assistant_update_bill", {
    p_id: a.bill_id,
    p_patch: patch,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = billResultSchema.parse(data);

  const saved = await savedBill(c, a.bill_id);
  const line = billLine(saved, await billNames(c));
  const label =
    keys.length === 1 && keys[0] === "paused"
      ? `${saved.paused ? "Paused" : "Resumed"} ${saved.name}`
      : keys.length === 1 && keys[0] === "name"
        ? `Renamed ${bill.name} to ${saved.name}`
        : `Updated ${saved.name}`;
  c.onChange?.({
    label,
    ...(parts.length ? { detail: parts.join(" · ") } : {}),
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    bill: line,
    ...(patch.auto_post === true
      ? { note: "It will now be recorded by itself when the app is opened on or after the due day. Say so." }
      : {
          note: "Nothing was deleted or recorded. The person now sees a green line with an Undo button. Confirm in one short sentence.",
        }),
  };
}

async function payBillTool(c: Context, a: Args<"pay_bill">) {
  const bill = await existingBill(c, a.bill_id);
  const amount = a.amount === undefined ? null : toMinorIn(a.amount, bill.currency);
  const done = allowChange(c, `bill-pay:${JSON.stringify([a.bill_id, bill.nextDue, amount])}`);

  const { data, error } = await createClient().rpc("assistant_pay_bill", {
    p_id: a.bill_id,
    p_amount: amount,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = billResultSchema.parse(data);

  const saved = await savedBill(c, a.bill_id);
  if (saved.nextDue === bill.nextDue) throw notConfirmed("list_bills");
  const names = await billNames(c);
  const verb = bill.kind === "income" ? "received" : "paid";
  const recorded = money(amount ?? bill.amount, bill.currency);
  c.onChange?.({
    label: `Marked ${bill.name} as ${verb}`,
    detail: `${recorded} · ${names.account(bill.accountId)} · next due ${dayLabel(saved.nextDue)}`,
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    [verb]: recorded,
    for_due_date: result.paid_for ?? bill.nextDue,
    bill: billLine(saved, names),
    note: `It was recorded as ${bill.kind === "income" ? "income" : "an expense"} dated today and the bill moved on. The person now sees a green line with an Undo button. Confirm in one short sentence.`,
  };
}

async function skipBillTool(c: Context, a: Args<"skip_bill">) {
  const bill = await existingBill(c, a.bill_id);
  const done = allowChange(c, `bill-skip:${JSON.stringify([a.bill_id, bill.nextDue])}`);

  const { data, error } = await createClient().rpc("assistant_skip_bill", { p_id: a.bill_id });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = billResultSchema.parse(data);

  const saved = await savedBill(c, a.bill_id);
  if (saved.nextDue === bill.nextDue) throw notConfirmed("list_bills");
  c.onChange?.({
    label: `Skipped ${bill.name} for ${dayLabel(bill.nextDue)}`,
    detail: `Next due ${dayLabel(saved.nextDue)}`,
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    skipped: bill.nextDue,
    bill: billLine(saved, await billNames(c)),
    note: "Nothing was recorded. The person now sees a green line with an Undo button. Confirm in one short sentence.",
  };
}

// ---- Transfers --------------------------------------------------------------------

async function transferMoneyTool(c: Context, a: Args<"transfer_money">) {
  const [from, to] = [await openAccount(c, a.from_account_id), await openAccount(c, a.to_account_id)];
  if (from.id === to.id) throw new ToolError("Those are the same account. Pick two different accounts.");
  const sameCurrency = from.currency === to.currency;
  if (sameCurrency && a.amount_received !== undefined) {
    throw new ToolError("amount_received is only for accounts in different currencies. Leave it out.");
  }
  if (!sameCurrency && a.amount_received === undefined) {
    throw new ToolError(
      `${from.name} uses ${from.currency} but ${to.name} uses ${to.currency}. Ask how much arrives in ${to.currency}; don't guess a rate.`,
    );
  }
  if (a.fee_category_id) await usableCategory(c, a.fee_category_id, "expense");
  const dateKey = a.date ?? todayKey();
  checkDate(dateKey, a.allow_future);
  const amountOut = toMinorIn(a.amount, from.currency);
  const amountIn = a.amount_received === undefined ? null : toMinorIn(a.amount_received, to.currency);
  const fee = a.fee === undefined ? null : toMinorIn(a.fee, from.currency);
  const done = allowChange(c, `transfer:${JSON.stringify([from.id, to.id, amountOut, amountIn, fee, dateKey])}`);

  const id = crypto.randomUUID();
  const { data, error } = await createClient().rpc("assistant_create_transfer", {
    p_group_id: id,
    p_from: from.id,
    p_to: to.id,
    p_amount_out: amountOut,
    p_amount_in: amountIn,
    p_occurred_at: dateKeyToIso(dateKey),
    p_note: a.note ?? null,
    p_fee: fee,
    p_fee_category: a.fee_category_id ?? null,
  });
  if (error) throw new ToolError(changeMessage(error));
  done();
  const result = changeResultSchema.parse(data);

  await c.queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
  const { data: saved, error: readError } = await createClient()
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("transfer_group_id", id)
    .is("deleted_at", null);
  const sides = readError || !saved ? [] : (saved as Parameters<typeof toTransaction>[0][]).map(toTransaction);
  const outSide = sides.find((t) => t.type === "transfer_out");
  const inSide = sides.find((t) => t.type === "transfer_in");
  if (!outSide || !inSide) throw notConfirmed("find_transactions");

  const after = await accounts(c);
  const balanceOf = (account: { id: string; currency: string }) => {
    const row = after.find((x) => x.id === account.id);
    return row ? money(row.balance, row.currency) : "unknown";
  };
  const sent = money(outSide.amount, outSide.currency);
  const received = money(inSide.amount, inSide.currency);
  c.onChange?.({
    label: `Moved ${sent} from ${from.name} to ${to.name}`,
    detail: [
      sameCurrency ? null : `${to.name} gets ${received}`,
      fee ? `Fee ${money(fee, from.currency)}` : null,
      dayLabel(dateKey),
      a.note ?? null,
    ]
      .filter(Boolean)
      .join(" · "),
    ...(result.undo_token ? { undoTokens: [result.undo_token] } : {}),
  });
  return {
    saved: true,
    moved: sent,
    ...(sameCurrency ? {} : { received }),
    ...(fee ? { fee: money(fee, from.currency) } : {}),
    from: { account: from.name, balance_now: balanceOf(from) },
    to: { account: to.name, balance_now: balanceOf(to) },
    date: dateKey,
    note: "This is not spending or income. The person now sees a green line with an Undo button. Confirm in one short sentence, with the new balances if useful.",
  };
}

// ---- Charts -----------------------------------------------------------------------
// The database adds everything up and these builders only arrange its figures, so a
// chart can't hold a number the model made up. The model chooses which chart.

// The summary function returns at most 40 groups, so long ranges are read in windows.
const SUMMARY_WINDOW_DAYS = 40;

async function daySummary(from: string, to: string, type: string): Promise<Summary> {
  const windows: [string, string][] = [];
  for (let start = from; start <= to; start = shiftDays(start, SUMMARY_WINDOW_DAYS)) {
    const end = shiftDays(start, SUMMARY_WINDOW_DAYS - 1);
    windows.push([start, end < to ? end : to]);
  }
  const parts = await Promise.all(windows.map(([a, b]) => runSummary(a, b, type, "day")));
  return {
    total: parts.reduce((n, p) => n + p.total, 0),
    count: parts.reduce((n, p) => n + p.count, 0),
    group_count: parts.reduce((n, p) => n + p.group_count, 0),
    groups: parts.flatMap((p) => p.groups),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (month: string) => `${month}-${pad(monthDays(month))}`;
const rangeLabel = (from: string, to: string) => `${chartDay(from)} – ${chartDay(to)}`;

function startedMonth(month: string) {
  dayParts(`${month}-01`);
  if (month > todayKey().slice(0, 7)) throw new ToolError("That month hasn't started yet.");
  return month;
}

// The range a chart covers: from+to, a month, or (when given) a rolling number of days.
function chartPeriod(a: Args<"show_chart">, rolling?: number) {
  if ((a.from === undefined) !== (a.to === undefined)) throw new ToolError("Give both from and to, or neither.");
  if (a.from && a.to) {
    checkRange(a.from, a.to);
    return { from: a.from, to: a.to, month: null as string | null, label: rangeLabel(a.from, a.to) };
  }
  const today = todayKey();
  if (rolling && !a.month) {
    const from = shiftDays(today, -(rolling - 1));
    return { from, to: today, month: null as string | null, label: rangeLabel(from, today) };
  }
  const month = startedMonth(a.month ?? today.slice(0, 7));
  const to = month === today.slice(0, 7) ? today : lastDayOf(month);
  return { from: `${month}-01`, to, month: month as string | null, label: monthName(month, true) };
}

// The last few months, ending at the chosen one.
function chartMonths(a: Args<"show_chart">) {
  const end = startedMonth(a.month ?? todayKey().slice(0, 7));
  const months = monthsEndingAt(end, a.months ?? 6);
  return {
    months,
    from: `${months[0]}-01`,
    to: lastDayOf(end),
    label: `${monthName(months[0], true)} – ${monthName(end, true)}`,
  };
}

type Built = ChartSpec | { empty: string };

async function buildChart(c: Context, a: Args<"show_chart">): Promise<Built> {
  const type = a.type ?? "expense";
  const spending = type === "expense";
  const head = (title: string, subtitle?: string) => ({ title, subtitle, currency: DEFAULT_CURRENCY });
  const today = todayKey();
  const thisMonth = today.slice(0, 7);

  switch (a.chart) {
    case "donut":
    case "treemap":
    case "bubbles":
    case "bars": {
      const p = chartPeriod(a);
      const summary = await runSummary(p.from, p.to, type, a.group_by ?? "category");
      const by = a.group_by && a.group_by !== "category" ? ` by ${a.group_by}` : "";
      return buildParts(
        a.chart,
        head(`${spending ? "Where your money went" : "Where your income came from"}${by}`, p.label),
        summary,
      );
    }
    case "trend": {
      const p = chartPeriod(a);
      const length = daysBetween(p.from, p.to) + 1;
      if (length < 2) throw new ToolError("A trend needs at least two days.");
      const bucket = length <= SUMMARY_WINDOW_DAYS ? "day" : length <= 266 ? "week" : "month";
      if (length > 3 * 366) throw new ToolError("That range is too long for a trend. Use 3 years or less.");
      const prevTo = shiftDays(p.from, -1);
      const prevFrom = shiftDays(prevTo, -(length - 1));
      const [now, before] = await Promise.all([
        runSummary(p.from, p.to, type, bucket),
        runSummary(prevFrom, prevTo, type, bucket),
      ]);
      const word = { day: "Daily", week: "Weekly", month: "Monthly" }[bucket];
      return buildTrend(
        head(`${word} ${spending ? "spending" : "income"}`, `${p.label}, against the ${length} days before`),
        bucket,
        p,
        now,
        { from: prevFrom, to: prevTo, summary: before },
      );
    }
    case "pace": {
      const month = startedMonth(a.month ?? thisMonth);
      const through = month === thisMonth ? Number(today.slice(8)) : monthDays(month);
      const before = shiftMonth(month, -1);
      const [now, prev] = await Promise.all([
        runSummary(`${month}-01`, `${month}-${pad(through)}`, type, "day"),
        runSummary(`${before}-01`, lastDayOf(before), type, "day"),
      ]);
      return buildPace(
        head(`${monthName(month)} against ${monthName(before)}`, "Running total by day"),
        month,
        through,
        now,
        prev,
      );
    }
    case "calendar": {
      const month = startedMonth(a.month ?? thisMonth);
      const through = month === thisMonth ? Number(today.slice(8)) : monthDays(month);
      const summary = await runSummary(`${month}-01`, `${month}-${pad(through)}`, type, "day");
      return buildCalendar(
        head(`Your ${monthName(month)}, day by day`, spending ? "Darker means more spent" : "Darker means more received"),
        month,
        through,
        summary,
      );
    }
    case "weekday": {
      const p = chartPeriod(a, 84);
      const length = daysBetween(p.from, p.to) + 1;
      if (length < 14) throw new ToolError("Use at least two weeks to compare weekdays.");
      if (length > 366) throw new ToolError("Use a year or less for weekdays.");
      const summary = await daySummary(p.from, p.to, type);
      return buildWeekday(head("Which days you spend most", `Average per weekday, ${p.label}`), p, summary);
    }
    case "punchcard": {
      const p = chartPeriod(a, 98);
      const from = daysBetween(p.from, p.to) > 97 ? shiftDays(p.to, -97) : p.from;
      const summary = await daySummary(from, p.to, type);
      return buildPunchcard(head("Week by week", "Bigger dot, bigger day"), { from, to: p.to }, summary);
    }
    case "income_vs_spending":
    case "net_by_month": {
      const span = chartMonths(a);
      const [expense, income] = await Promise.all([
        runSummary(span.from, span.to, "expense", "month"),
        runSummary(span.from, span.to, "income", "month"),
      ]);
      const net = a.chart === "net_by_month";
      return buildMonths(
        head(net ? "What you kept each month" : "Income and spending", net ? `Income minus spending, ${span.label}` : span.label),
        net ? "net" : "columns",
        span.months,
        expense,
        income,
      );
    }
    case "stacked_months": {
      const span = chartMonths(a);
      const [overall, ...perMonth] = await Promise.all([
        runSummary(span.from, span.to, "expense", "category"),
        ...span.months.map((m) => runSummary(`${m}-01`, lastDayOf(m), "expense", "category")),
      ]);
      return buildStacked(head("What each month went on", span.label), span.months, overall, perMonth);
    }
    case "waterfall":
    case "flow": {
      const p = chartPeriod(a);
      const [income, expense] = await Promise.all([
        runSummary(p.from, p.to, "income", "category"),
        runSummary(p.from, p.to, "expense", "category"),
      ]);
      if (income.total <= 0) return { empty: "No income was recorded in that period, so there is no flow to draw." };
      if (expense.total <= 0) return { empty: "No spending was recorded in that period, so there is nothing to split." };
      const title = a.chart === "flow" ? "Where your income flowed" : "From income to what's left";
      return buildCashflow(head(title, p.label), a.chart, income.total, expense);
    }
    case "radar":
    case "dumbbell": {
      const p = chartPeriod(a);
      const length = daysBetween(p.from, p.to) + 1;
      let prevFrom: string;
      let prevTo: string;
      let labels = { current: "This period", previous: "Before" };
      let title = "This period against the one before";
      if (p.month) {
        const before = shiftMonth(p.month, -1);
        prevFrom = `${before}-01`;
        prevTo = shiftDays(prevFrom, Math.min(length, monthDays(before)) - 1);
        labels = { current: monthName(p.month), previous: monthName(before) };
        title = `${monthName(p.month)} against ${monthName(before)}`;
      } else {
        prevTo = shiftDays(p.from, -1);
        prevFrom = shiftDays(prevTo, -(length - 1));
      }
      const [now, before] = await Promise.all([
        runSummary(p.from, p.to, "expense", "category"),
        runSummary(prevFrom, prevTo, "expense", "category"),
      ]);
      const built = buildCompare(
        head(title, a.chart === "radar" ? "Spending by category" : "What changed, by category"),
        a.chart,
        labels,
        now,
        before,
      );
      if (built.kind === "compare" && built.rows.length < 3) {
        return {
          empty:
            "Fewer than three categories have spending across these two periods, so there is nothing to compare. Use summarize_spending instead.",
        };
      }
      return built;
    }
    case "budgets": {
      const month = startedMonth(a.month ?? thisMonth);
      const [rows, cats] = await Promise.all([budgetRows(c, `${month}-01`), categories(c)]);
      if (rows.length === 0) return { empty: "No budgets are set, so there are no rings to draw." };
      const name = categoryNames(cats);
      return buildBudgets(
        head("Your budgets", monthName(month, true)),
        rows.map((b) => ({
          label: b.categoryId ? name(b.categoryId) : "All spending",
          spent: b.spent,
          limit: b.amount,
          status: budgetStatus(b.spent, b.amount),
        })),
      );
    }
    case "balances": {
      const open = (await accounts(c)).filter((x) => !x.archivedAt && x.currency === DEFAULT_CURRENCY);
      if (open.length === 0) return { empty: "There are no open accounts to chart." };
      return buildBalances(
        head("Your accounts"),
        open.map((x) => ({ label: x.name, amount: x.balance, type: ACCOUNT_TYPE_LABELS[x.type] })),
      );
    }
    case "savings": {
      const p = chartPeriod(a);
      const [income, expense] = await Promise.all([
        runSummary(p.from, p.to, "income", "category"),
        runSummary(p.from, p.to, "expense", "category"),
      ]);
      return buildGauge(head("How much you kept", p.label), income.total, expense.total);
    }
    case "bills": {
      const ahead = a.days ?? 30;
      const to = shiftDays(today, ahead);
      const due = (await bills(c)).filter(
        (r) => r.kind === "expense" && !r.paused && !isEnded(r) && r.nextDue >= today && r.nextDue <= to,
      );
      if (due.length === 0) return { empty: `No bills fall due in the next ${ahead} days.` };
      return buildTimeline(
        head("Bills coming up", `Next ${ahead} days · the next payment of each bill`),
        { from: today, to },
        due.map((r) => ({ label: r.name, date: r.nextDue, amount: r.amount, auto: r.autoPost })),
      );
    }
  }
}

async function showChartTool(c: Context, a: Args<"show_chart">) {
  const state = (c.charts ??= { count: 0 });
  if (state.count >= MAX_CHARTS_PER_QUESTION) {
    throw new ToolError(
      `That's already ${MAX_CHARTS_PER_QUESTION} charts in a row. Stop, say what they show, and ask which one to look at next.`,
    );
  }
  const built = await buildChart(c, a);
  if ("empty" in built) return { drawn: false, note: `${built.empty} Tell the person plainly; no chart was shown.` };
  if (chartIsEmpty(built)) {
    return {
      drawn: false,
      note: "There is nothing in that period to chart. Tell the person plainly; no chart was shown.",
    };
  }
  const checked = chartSpecSchema.safeParse(built);
  if (!checked.success) {
    throw new ToolError("That chart can't be drawn for this request. Try another chart or a different period.");
  }

  state.count += 1;
  c.onChart?.(checked.data);
  return {
    drawn: true,
    chart: a.chart,
    title: checked.data.title,
    facts: describeChart(checked.data, money),
    note: "The person now sees the chart, with a table view. Don't read the figures back: comment on one or two things that stand out, in a sentence or two.",
  };
}

async function setMyNameTool(c: Context, { name }: Args<"set_my_name">) {
  let saved: string | null;
  try {
    saved = await saveDisplayName(name);
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : "Couldn't save the name.");
  }
  c.queryClient.setQueryData(profileNameKey, saved);
  return {
    saved: true,
    name: saved,
    note: "Saved. Say so in a few words. Don't make a fuss about it.",
  };
}

// ---- Running one -----------------------------------------------------------------

const RUNNERS: { [N in ToolName]: (c: Context, args: Args<N>) => Promise<unknown> } = {
  get_overview: getOverview,
  list_accounts: listAccounts,
  list_categories: listCategories,
  find_transactions: findTransactions,
  summarize_spending: summarizeSpending,
  show_chart: showChartTool,
  list_budgets: listBudgets,
  set_budget: setBudgetTool,
  remove_budget: removeBudgetTool,
  create_account: createAccountTool,
  update_account: updateAccountTool,
  create_category: createCategoryTool,
  update_category: updateCategoryTool,
  list_bills: listBills,
  create_bill: createBillTool,
  update_bill: updateBillTool,
  pay_bill: payBillTool,
  skip_bill: skipBillTool,
  transfer_money: transferMoneyTool,
  add_transaction: addTransactionTool,
  propose_transactions: proposeTransactionsTool,
  update_transaction: updateTransactionTool,
  delete_transactions: deleteTransactionsTool,
  set_my_name: setMyNameTool,
};

/**
 * Runs one tool call and returns the text to hand back to the model. Whatever
 * goes wrong comes back as a readable error rather than an exception, so the
 * model can correct itself or explain.
 */
export async function runTool(c: ToolContext, name: string, rawArguments: string): Promise<string> {
  const fail = (message: string) => JSON.stringify({ error: message });
  if (!isToolName(name)) return fail(`There is no tool called ${name}.`);

  let input: unknown;
  try {
    input = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return fail("The arguments were not valid JSON.");
  }
  const parsed = TOOLS[name].args.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`Bad input${issue.path.length ? ` for ${issue.path.join(".")}` : ""}: ${issue.message}`);
  }

  try {
    const run = RUNNERS[name] as (c: Context, args: unknown) => Promise<unknown>;
    const text = JSON.stringify(await run(c, parsed.data));
    return text.length > MAX_RESULT_CHARS
      ? fail("That returned too much. Narrow it down, or ask for fewer rows.")
      : text;
  } catch (error) {
    return fail(error instanceof ToolError ? error.message : "That lookup failed. Try again.");
  }
}
