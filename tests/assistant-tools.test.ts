import { randomUUID } from "node:crypto";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CASH = randomUUID();
const FOOD = randomUUID();
const GROCERIES = randomUUID();
const SALARY = randomUUID();

const tables: Record<string, unknown[]> = {
  accounts: [
    { id: CASH, name: "Cash", type: "cash", currency: "GHS", opening_balance: 10000, sort_order: 0, archived_at: null },
    { id: randomUUID(), name: "Old card", type: "bank", currency: "GHS", opening_balance: 0, sort_order: 1, archived_at: "2026-01-01" },
  ],
  account_balances: [{ account_id: CASH, balance: 50000, transaction_count: 3 }],
  categories: [
    { id: FOOD, name: "Food & Dining", kind: "expense", parent_id: null, icon: null, color: null, sort_order: 0, archived_at: null },
    { id: GROCERIES, name: "Groceries", kind: "expense", parent_id: FOOD, icon: null, color: null, sort_order: 1, archived_at: null },
    { id: SALARY, name: "Salary", kind: "income", parent_id: null, icon: null, color: null, sort_order: 2, archived_at: null },
  ],
  transactions: [],
  recurring_rules: [],
};

// Records how a query was built so tests can check what was asked of the database.
let calls: { method: string; args: unknown[] }[] = [];
let transactionCount: number | null = null;
const rpcs: { name: string; args: Record<string, unknown> }[] = [];
let rpcResult: (args: Record<string, unknown>) => unknown = () => ({});
let rpcError: { code: string; message: string } | null = null;

function builder(table: string) {
  const wanted: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    maybeSingle: async () => ({
      data: (tables[table] as Record<string, unknown>[]).find((row) => Object.entries(wanted).every(([k, v]) => row[k] === v)) ?? null,
      error: null,
    }),
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: tables[table],
        error: null,
        count: table === "transactions" ? (transactionCount ?? tables[table].length) : null,
      }),
  };
  b.eq = (...args: unknown[]) => {
    wanted[args[0] as string] = args[1];
    if (table === "transactions") calls.push({ method: "eq", args });
    return b;
  };
  for (const method of ["select", "order", "is", "in", "gte", "lt", "lte", "or", "limit"]) {
    b[method] = (...args: unknown[]) => {
      if (table === "transactions") calls.push({ method, args });
      return b;
    };
  }
  return b;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: builder,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      return { data: rpcResult(args), error: null };
    },
  }),
}));

import { localDateKey, todayKey } from "@/lib/dates";
import { addDaysKey } from "@/lib/ledger/recurring";
import { addConfirmed } from "@/lib/assistant/changes";
import { runTool } from "@/lib/assistant/tools";
import type { Proposal } from "@/lib/assistant/types";

const run = (name: string, args: unknown = {}) =>
  runTool({ queryClient: new QueryClient() }, name, JSON.stringify(args)).then((text) => JSON.parse(text));

beforeEach(() => {
  calls = [];
  rpcs.length = 0;
  rpcError = null;
  transactionCount = null;
  tables.transactions = [];
});

const tx = (o: Record<string, unknown>) => ({
  id: randomUUID(),
  account_id: CASH,
  type: "expense",
  amount: 4500,
  currency: "GHS",
  occurred_at: "2026-10-03T10:00:00.000Z",
  category_id: GROCERIES,
  payee: "Chop Bar",
  note: null,
  transfer_group_id: null,
  deleted_at: null,
  ...o,
});

describe("lookups", () => {
  it("lists live accounts with formatted balances", async () => {
    const { accounts } = await run("list_accounts");
    expect(accounts).toEqual([
      {
        id: CASH,
        name: "Cash",
        type: "Cash",
        opening_balance: expect.stringMatching(/100\.00$/),
        balance: expect.stringMatching(/500\.00$/),
      },
    ]);
  });

  it("lists categories, naming parents and filtering by kind", async () => {
    const { categories } = await run("list_categories", { kind: "expense" });
    expect(categories.map((c: { name: string; parent?: string }) => [c.name, c.parent])).toEqual([
      ["Food & Dining", undefined],
      ["Groceries", "Food & Dining"],
    ]);
  });
});

describe("find_transactions", () => {
  it("returns formatted rows with totals when every match is shown", async () => {
    tables.transactions = [tx({}), tx({ type: "income", amount: 100000, category_id: SALARY, payee: "Employer" })];
    const result = await run("find_transactions", { text: "bar" });
    expect(result.matches).toBe(2);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-10-03",
      type: "expense",
      category: "Food & Dining › Groceries",
      account: "Cash",
      payee: "Chop Bar",
    });
    expect(result.transactions[0].amount).toMatch(/45\.00$/);
    expect(result.totals.spent).toMatch(/45\.00$/);
    expect(result.totals.income).toMatch(/1,000\.00$/);
  });

  it("leaves totals out and says so when more rows match than are shown", async () => {
    tables.transactions = [tx({})];
    transactionCount = 120;
    const result = await run("find_transactions", { limit: 1 });
    expect(result.totals).toBeUndefined();
    expect(result.note).toMatch(/summarize_spending/);
    expect(result.matches).toBe(120);
  });

  it("turns days, amounts and a parent category into the right filters", async () => {
    await run("find_transactions", {
      from: "2026-10-01",
      to: "2026-10-31",
      category_id: FOOD,
      min_amount: 20,
      max_amount: 45.5,
    });
    const used = (method: string) => calls.filter((c) => c.method === method).map((c) => c.args);
    // A parent category also covers its subcategories.
    expect(used("in")).toEqual([["category_id", expect.arrayContaining([FOOD, GROCERIES])]]);
    expect(used("gte")).toContainEqual(["amount", 2000]);
    expect(used("lte")).toEqual([["amount", 4550]]);
    // The end day is inclusive, so the cut-off is the start of the next day.
    const lt = used("lt")[0] as [string, string];
    expect(new Date(lt[1]).getDate()).toBe(1);
    expect(new Date(lt[1]).getMonth()).toBe(10);
  });

  it("gives readable errors for ids and dates it can't use", async () => {
    expect((await run("find_transactions", { category_id: randomUUID() })).error).toMatch(/list_categories/);
    expect((await run("find_transactions", { account_id: randomUUID() })).error).toMatch(/list_accounts/);
    expect((await run("find_transactions", { from: "2026-02-30" })).error).toMatch(/not a real date/);
    expect((await run("find_transactions", { from: "2026-10-31", to: "2026-10-01" })).error).toMatch(/Swap/);
    expect((await run("find_transactions", { min_amount: 50, max_amount: 10 })).error).toMatch(/Swap/);
  });
});

describe("summarize_spending", () => {
  const summary = (total: number, groups: unknown[], extra = {}) => ({
    total,
    count: 5,
    group_count: groups.length,
    groups,
    ...extra,
  });

  it("formats the database's totals and adds each group's share", async () => {
    rpcResult = () =>
      summary(10000, [
        { id: FOOD, label: "Food & Dining", amount: 7500, count: 4 },
        { id: null, label: "Uncategorised", amount: 2500, count: 1 },
      ]);
    const result = await run("summarize_spending", { from: "2026-10-01", to: "2026-10-31" });
    expect(rpcs[0]).toEqual({
      name: "spending_summary",
      args: { p_from: "2026-10-01", p_to: "2026-10-31", p_type: "expense", p_group: "category" },
    });
    expect(result.total).toMatch(/100\.00$/);
    expect(result.groups[0]).toMatchObject({ id: FOOD, name: "Food & Dining", share: "75%" });
    expect(result.groups[1].id).toBeUndefined();
  });

  it("compares with the period of equal length just before, in the tool and not the model", async () => {
    rpcResult = (args) => (args.p_from === "2026-10-01" ? summary(12000, []) : summary(10000, []));
    const result = await run("summarize_spending", {
      from: "2026-10-01",
      to: "2026-10-31",
      compare_to_previous: true,
    });
    // 31 days before 1 Oct is 31 Aug to 30 Sep.
    expect(rpcs[1].args).toMatchObject({ p_from: "2026-08-31", p_to: "2026-09-30" });
    expect(result.previous_period.change).toBe("up 20%");
  });

  it("leaves shares out for time series and reports groups that were cut off", async () => {
    rpcResult = () => summary(300, [{ id: null, label: "2026-10", amount: 300, count: 1 }], { group_count: 60 });
    const result = await run("summarize_spending", { from: "2026-01-01", to: "2026-10-31", group_by: "month" });
    expect(result.groups[0].share).toBeUndefined();
    expect(result.more_groups_not_shown).toBe(59);
  });

  it("rejects ranges that make no sense", async () => {
    expect((await run("summarize_spending", { from: "2026-10-31", to: "2026-10-01" })).error).toMatch(/Swap/);
    expect((await run("summarize_spending", { from: "2000-01-01", to: "2026-10-01" })).error).toMatch(/too long/);
    expect(rpcs).toHaveLength(0);
  });
});

describe("get_overview", () => {
  it("pulls the month, accounts and budgets together with formatted amounts", async () => {
    rpcResult = (args) =>
      "p_month" in args && args.p_month === "2026-10-01" && rpcs.at(-1)?.name === "monthly_report"
        ? {
            month: "2026-10-01",
            currency: "GHS",
            income: 500000,
            expense: 120000,
            count: 14,
            prev_income: 500000,
            prev_expense: 100000,
            categories: [{ category_id: FOOD, name: "Food & Dining", icon: null, color: null, amount: 80000, count: 9 }],
            daily: [],
            trend: [],
          }
        : [{ budget_id: randomUUID(), category_id: FOOD, amount: 70000, currency: "GHS", spent: 80000 }];
    const result = await run("get_overview", { month: "2026-10" });
    expect(result.month).toBe("2026-10");
    expect(result.spent).toMatch(/1,200\.00$/);
    expect(result.left_over).toMatch(/3,800\.00$/);
    expect(result.spending_vs_last_month).toBe("up 20%");
    expect(result.income_vs_last_month).toBe("about the same");
    expect(result.accounts).toBe(1);
    // Only the month still under way gets the part-month warning.
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    expect((await run("get_overview", { month: "2020-01" })).caution).toBeUndefined();
    expect((await run("get_overview", { month: thisMonth })).caution).toMatch(/isn't over/);
    expect(result.budgets[0]).toMatchObject({
      category: "Food & Dining",
      status: "over",
      remaining: expect.stringMatching(/^over by .*100\.00$/),
    });
  });
});

describe("running a tool", () => {
  it("answers bad calls with an error the model can read, never a crash", async () => {
    expect((await run("rm_rf")).error).toMatch(/no tool called/);
    expect((await runTool({ queryClient: new QueryClient() }, "list_accounts", "{nope")) ).toContain("not valid JSON");
    expect((await run("summarize_spending", { from: "yesterday", to: "today" })).error).toMatch(/Bad input for from/);
    expect((await run("find_transactions", { limit: 500 })).error).toMatch(/Bad input for limit/);
  });

  it("treats empty arguments as none", async () => {
    const text = await runTool({ queryClient: new QueryClient() }, "list_accounts", "");
    expect(JSON.parse(text).accounts).toHaveLength(1);
  });
});

describe("changes", () => {
  const TOKEN = randomUUID();
  const notes: { label: string; detail?: string; undoTokens?: string[] }[] = [];
  const context = () => ({ queryClient: new QueryClient(), onChange: (n: (typeof notes)[number]) => notes.push(n), changes: undefined });
  const change = (name: string, args: unknown, c = context()) =>
    runTool(c, name, JSON.stringify(args)).then((text) => JSON.parse(text));
  const yesterday = localDateKey(new Date(Date.now() - 86_400_000));
  const tomorrow = localDateKey(new Date(Date.now() + 86_400_000));

  beforeEach(() => {
    notes.length = 0;
    // The database "saves" the row, so the read-back can find it.
    rpcResult = (args) => {
      if ("p_account" in args) {
        tables.transactions.push(tx({ id: args.p_id, amount: args.p_amount, payee: args.p_payee, category_id: args.p_category }));
      }
      return { id: args.p_id, undo_token: TOKEN };
    };
  });

  const add = { type: "expense", amount: 45, account_id: CASH, category_id: GROCERIES, payee: "Chop Bar" };

  it("adds an entry, reads it back, and tells the screen with an undo token", async () => {
    const result = await change("add_transaction", { ...add, date: yesterday });
    expect(rpcs[0].name).toBe("assistant_add_transaction");
    expect(rpcs[0].args).toMatchObject({
      p_account: CASH,
      p_type: "expense",
      p_amount: 4500,
      p_category: GROCERIES,
      p_payee: "Chop Bar",
      p_note: null,
    });
    // A past day is saved as noon that day so it can't slip to another date.
    expect(new Date(rpcs[0].args.p_occurred_at as string).getHours()).toBe(12);
    expect(result.saved).toBe(true);
    expect(result.transaction.amount).toMatch(/45\.00$/);
    expect(notes).toEqual([
      {
        label: expect.stringMatching(/^Added .*45\.00 expense$/),
        detail: expect.stringContaining("Chop Bar · Food & Dining › Groceries · Cash"),
        undoTokens: [TOKEN],
      },
    ]);
  });

  it("checks everything before it writes", async () => {
    const bad = async (args: Record<string, unknown>) => (await change("add_transaction", { ...add, ...args })).error as string;
    expect(await bad({ account_id: randomUUID() })).toMatch(/list_accounts/);
    expect(await bad({ category_id: randomUUID() })).toMatch(/list_categories/);
    expect(await bad({ category_id: SALARY })).toMatch(/income category but this entry is expense/);
    expect(await bad({ amount: 12.345 })).toMatch(/decimal places/);
    expect(await bad({ amount: -5 })).toMatch(/Bad input for amount/);
    expect(await bad({ date: "2026-02-30" })).toMatch(/not a real date/);
    expect(await bad({ date: tomorrow })).toMatch(/future/);
    expect(await bad({ date: "1980-01-01" })).toMatch(/too far back/);
    expect(rpcs).toHaveLength(0);
    expect(notes).toHaveLength(0);
    // The person can ask for a future date on purpose.
    expect((await change("add_transaction", { ...add, date: tomorrow, allow_future: true })).saved).toBe(true);
  });

  it("won't use an archived account", async () => {
    const archived = (tables.accounts[1] as { id: string }).id;
    expect((await change("add_transaction", { ...add, account_id: archived })).error).toMatch(/No open account/);
  });

  it("shows the database's own message when it refuses", async () => {
    rpcError = { code: "P0002", message: "That account was not found." };
    expect((await change("add_transaction", add)).error).toBe("That account was not found.");
    rpcError = { code: "23503", message: "violates foreign key" };
    expect((await change("add_transaction", add)).error).toBe("That account or category can't be used for this entry.");
    expect(notes).toHaveLength(0);
  });

  it("blocks an exact repeat and stops after five changes in one question", async () => {
    const c = context();
    expect((await change("add_transaction", add, c)).saved).toBe(true);
    expect((await change("add_transaction", add, c)).error).toMatch(/already made/);
    for (let amount = 1; amount < 5; amount++) {
      expect((await change("add_transaction", { ...add, amount }, c)).saved).toBe(true);
    }
    expect((await change("add_transaction", { ...add, amount: 99 }, c)).error).toMatch(/5 changes in a row/);
    expect(rpcs).toHaveLength(5);
  });

  describe("update_transaction", () => {
    const existing = () => tx({});
    const update = (id: string, args: Record<string, unknown>) => change("update_transaction", { transaction_id: id, ...args });

    it("sends only what changes and reads the entry back", async () => {
      const row = existing();
      tables.transactions = [row];
      const result = await update(row.id, { amount: 50, category_id: null, payee: "KFC" });
      expect(rpcs[0]).toEqual({
        name: "assistant_update_transaction",
        args: { p_id: row.id, p_patch: { amount: 5000, category_id: null, payee: "KFC" } },
      });
      expect(result.saved).toBe(true);
      expect(notes[0].label).toMatch(/^Updated /);
      expect(notes[0].undoTokens).toEqual([TOKEN]);
    });

    it("keeps the time when the day is unchanged", async () => {
      const row = existing();
      tables.transactions = [row];
      await update(row.id, { date: localDateKey(row.occurred_at), note: "x" });
      expect(rpcs[0].args.p_patch).toEqual({ note: "x" });
    });

    it("refuses what it can't or shouldn't change", async () => {
      const row = existing();
      const transfer = tx({ type: "transfer_out", category_id: null });
      tables.transactions = [row, transfer];
      expect((await update(randomUUID(), { amount: 1 })).error).toMatch(/find_transactions/);
      expect((await update(transfer.id, { amount: 1 })).error).toMatch(/Transfers/);
      expect((await update(row.id, { category_id: SALARY })).error).toMatch(/income category/);
      expect((await update(row.id, { date: tomorrow })).error).toMatch(/future/);
      expect((await update(row.id, {})).error).toMatch(/Nothing would change/);
      expect(rpcs).toHaveLength(0);
    });
  });
});

describe("delete_transactions", () => {
  const proposals: { action: string; rows: { id: string; title: string; detail: string; amount: string }[] }[] = [];
  const del = (ids: string[]) =>
    runTool(
      { queryClient: new QueryClient(), onProposal: (p) => proposals.push(p) },
      "delete_transactions",
      JSON.stringify({ transaction_ids: ids }),
    ).then((text) => JSON.parse(text));

  beforeEach(() => {
    proposals.length = 0;
  });

  it("only lays out a card: nothing is deleted and the model is told so", async () => {
    const a = tx({ payee: "Uber", amount: 2800 });
    const b = tx({ type: "income", amount: 100000, category_id: SALARY, payee: null });
    tables.transactions = [a, b];
    const result = await del([a.id, b.id, a.id]);
    expect(result.awaiting_confirmation).toBe(true);
    expect(result.note).toMatch(/NOTHING HAS BEEN DELETED/);
    expect(rpcs).toHaveLength(0);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].rows.map((r) => [r.title, r.amount])).toEqual([
      ["Uber", expect.stringMatching(/^−.*28\.00$/)],
      ["Salary", expect.stringMatching(/^\+.*1,000\.00$/)],
    ]);
  });

  it("refuses unknown ids and transfers, without showing a card", async () => {
    const transfer = tx({ type: "transfer_out", category_id: null });
    tables.transactions = [];
    expect((await del([randomUUID()])).error).toMatch(/find_transactions/);
    tables.transactions = [transfer];
    expect((await del([transfer.id])).error).toMatch(/Transfers/);
    expect(proposals).toHaveLength(0);
  });
});

describe("budgets", () => {
  const TOKEN = randomUUID();
  const BUDGET = randomUUID();
  const notes: { label: string; detail?: string; undoTokens?: string[] }[] = [];
  const context = () => ({ queryClient: new QueryClient(), onChange: (n: (typeof notes)[number]) => notes.push(n) });
  const budget = (name: string, args: unknown, c = context()) =>
    runTool(c, name, JSON.stringify(args)).then((text) => JSON.parse(text));
  let stored: { amount: number; category_id: string | null } | null;
  let previous: number | null;

  beforeEach(() => {
    notes.length = 0;
    previous = null;
    stored = null;
    rpcResult = (args) => {
      const name = rpcs.at(-1)?.name;
      if (name === "budget_progress") {
        return stored ? [{ budget_id: BUDGET, category_id: stored.category_id, amount: stored.amount, currency: "GHS", spent: 20000 }] : [];
      }
      if (name === "assistant_set_budget") {
        stored = { amount: args.p_amount as number, category_id: args.p_category as string | null };
      }
      return { id: BUDGET, undo_token: TOKEN, previous_amount: previous };
    };
  });

  it("lists budgets with spent, remaining and status, and says when there are none", async () => {
    const empty = await budget("list_budgets", {}); expect(empty.note).toBe("No budgets are set.");
    stored = { amount: 50000, category_id: FOOD };
    const result = await budget("list_budgets", { month: "2026-10" });
    expect(result.month).toBe("2026-10");
    expect(result.budgets[0]).toMatchObject({
      category_id: FOOD,
      category: "Food & Dining",
      limit: expect.stringMatching(/500\.00$/),
      spent: expect.stringMatching(/200\.00$/),
      remaining: expect.stringMatching(/300\.00$/),
    });
  });

  it("sets a budget, reads it back and gives the screen an undo token", async () => {
    const result = await budget("set_budget", { category_id: FOOD, amount: 500 });
    expect(rpcs.find((r) => r.name === "assistant_set_budget")?.args).toEqual({
      p_category: FOOD,
      p_amount: 50000,
      p_currency: "GHS",
    });
    expect(result.saved).toBe(true);
    expect(result.budget.limit).toMatch(/500\.00$/);
    expect(notes).toEqual([
      { label: expect.stringMatching(/^Set Food & Dining budget to .*500\.00$/), detail: "New monthly budget", undoTokens: [TOKEN] },
    ]);
  });

  it("sets the overall budget when no category is given, and mentions the old limit on a change", async () => {
    previous = 40000;
    const result = await budget("set_budget", { amount: 3000 });
    expect(rpcs.find((r) => r.name === "assistant_set_budget")?.args.p_category).toBeNull();
    expect(result.previous_limit).toMatch(/400\.00$/);
    expect(notes[0].label).toMatch(/^Set overall budget to .*3,000\.00$/);
    expect(notes[0].detail).toMatch(/^Was .*400\.00 · monthly$/);
  });

  it("checks the category before it writes", async () => {
    expect((await budget("set_budget", { category_id: SALARY, amount: 500 })).error).toMatch(/income category but this entry is expense/);
    expect((await budget("set_budget", { category_id: randomUUID(), amount: 500 })).error).toMatch(/list_categories/);
    expect((await budget("set_budget", { category_id: FOOD, amount: 12.345 })).error).toMatch(/decimal places/);
    expect((await budget("set_budget", { category_id: FOOD, amount: 0 })).error).toMatch(/Bad input for amount/);
    expect(rpcs.filter((r) => r.name === "assistant_set_budget")).toHaveLength(0);
  });

  it("removes a budget, naming the old limit, and shows the database's own refusal", async () => {
    previous = 50000;
    const result = await budget("remove_budget", { category_id: FOOD });
    expect(result).toMatchObject({ removed: true, budget: "Food & Dining", previous_limit: expect.stringMatching(/500\.00$/) });
    expect(notes[0]).toEqual({ label: "Removed Food & Dining budget", detail: expect.stringMatching(/^Was .*500\.00/), undoTokens: [TOKEN] });

    rpcError = { code: "P0002", message: "There is no budget set for that." };
    expect((await budget("remove_budget", { category_id: GROCERIES })).error).toBe("There is no budget set for that.");
  });

  it("counts toward the five-changes limit and blocks exact repeats", async () => {
    const c = context();
    expect((await budget("set_budget", { category_id: FOOD, amount: 500 }, c)).saved).toBe(true);
    expect((await budget("set_budget", { category_id: FOOD, amount: 500 }, c)).error).toMatch(/already made/);
  });
});

describe("accounts and categories", () => {
  const TOKEN = randomUUID();
  const notes: { label: string; detail?: string; undoTokens?: string[] }[] = [];
  const context = () => ({ queryClient: new QueryClient(), onChange: (n: (typeof notes)[number]) => notes.push(n) });
  const act = (name: string, args: unknown, c = context()) =>
    runTool(c, name, JSON.stringify(args)).then((text) => JSON.parse(text));
  const OLD_CARD = (tables.accounts[1] as { id: string }).id;
  let originalAccounts: unknown[];
  let originalCategories: unknown[];
  let extra: { active_bills?: number; open_subcategories?: number };

  beforeEach(() => {
    notes.length = 0;
    extra = {};
    originalAccounts = tables.accounts;
    originalCategories = tables.categories;
    tables.accounts = originalAccounts.map((a) => ({ ...(a as object) }));
    tables.categories = originalCategories.map((c) => ({ ...(c as object) }));
    // The database "saves" the row so the read-back can find it.
    rpcResult = (args) => {
      const name = rpcs.at(-1)?.name;
      if (name === "assistant_create_account") {
        tables.accounts.push({
          id: args.p_id, name: args.p_name, type: args.p_type, currency: "GHS",
          opening_balance: args.p_opening, sort_order: 9, archived_at: null,
        });
        return { id: args.p_id, undo_token: TOKEN };
      }
      if (name === "assistant_update_account" || name === "assistant_update_category") {
        const table = name === "assistant_update_account" ? tables.accounts : tables.categories;
        const row = (table as Record<string, unknown>[]).find((a) => a.id === args.p_id)!;
        const patch = args.p_patch as { name?: string; archived?: boolean; opening_balance?: number };
        if (patch.name !== undefined) row.name = patch.name;
        if (patch.opening_balance !== undefined) row.opening_balance = patch.opening_balance;
        if (patch.archived !== undefined) row.archived_at = patch.archived ? "2026-10-23" : null;
        return { id: args.p_id, undo_token: TOKEN, ...extra };
      }
      if (name === "assistant_create_category") {
        tables.categories.push({
          id: args.p_id, name: args.p_name, kind: args.p_kind, parent_id: args.p_parent,
          icon: null, color: null, sort_order: 9, archived_at: null,
        });
        return { id: args.p_id, undo_token: TOKEN };
      }
      return {};
    };
  });

  afterEach(() => {
    tables.accounts = originalAccounts;
    tables.categories = originalCategories;
  });

  it("lists archived accounts and categories only when asked", async () => {
    expect((await act("list_accounts", {})).accounts).toHaveLength(1);
    const all = (await act("list_accounts", { include_archived: true })).accounts;
    expect(all).toHaveLength(2);
    expect(all.find((a: { id: string }) => a.id === OLD_CARD)).toMatchObject({ name: "Old card", archived: true });
    tables.categories.push({ id: randomUUID(), name: "Old stuff", kind: "expense", parent_id: null, icon: null, color: null, sort_order: 5, archived_at: "2026-01-01" });
    expect((await act("list_categories", {})).categories).toHaveLength(3);
    expect((await act("list_categories", { include_archived: true })).categories).toHaveLength(4);
  });

  it("creates an account with an opening balance and gives the screen an undo token", async () => {
    const result = await act("create_account", { name: "  Susu  ", type: "savings", opening_balance: 250.5 });
    expect(rpcs[0]).toEqual({
      name: "assistant_create_account",
      args: { p_id: expect.any(String), p_name: "Susu", p_type: "savings", p_currency: "GHS", p_opening: 25050 },
    });
    expect(result.saved).toBe(true);
    expect(result.account).toMatchObject({ name: "Susu", type: "Savings" });
    expect(notes).toEqual([
      { label: "Created Susu account", detail: expect.stringMatching(/^Savings · starts at .*250\.50$/), undoTokens: [TOKEN] },
    ]);
  });

  it("allows a negative opening balance for money owed, and checks the input", async () => {
    await act("create_account", { name: "Visa", type: "credit_card", opening_balance: -120 });
    expect(rpcs[0].args.p_opening).toBe(-12000);
    expect((await act("create_account", { name: "X", type: "crypto" })).error).toMatch(/Bad input for type/);
    expect((await act("create_account", { name: "", type: "cash" })).error).toMatch(/Bad input for name/);
    expect((await act("create_account", { name: "Y", type: "cash", opening_balance: 1.234 })).error).toMatch(/decimal places/);
    expect(rpcs).toHaveLength(1);
  });

  it("renames and archives accounts, warning about money left in them and live bills", async () => {
    const cash = (tables.accounts[0] as { id: string }).id;
    const renamed = await act("update_account", { account_id: cash, name: "Wallet" });
    expect(renamed.account.name).toBe("Wallet");
    expect(notes[0].label).toBe("Renamed Cash to Wallet");

    extra = { active_bills: 2 };
    const archived = await act("update_account", { account_id: cash, archived: true });
    expect(archived.account.archived).toBe(true);
    expect(archived.warning).toMatch(/still holds .*500\.00/);
    expect(archived.bills_still_using_it).toBe(2);
    expect(notes[1]).toEqual({ label: "Archived Wallet", detail: expect.stringMatching(/History kept · balance .*500\.00$/), undoTokens: [TOKEN] });
  });

  it("shows opening balances and changes one, sending whole minor units only when it differs", async () => {
    const cash = tables.accounts[0] as { id: string };
    expect((await act("list_accounts", {})).accounts[0]).toMatchObject({ name: "Cash", opening_balance: expect.stringMatching(/100\.00$/) });

    const changed = await act("update_account", { account_id: cash.id, opening_balance: 250.5 });
    expect(rpcs[0]).toEqual({ name: "assistant_update_account", args: { p_id: cash.id, p_patch: { opening_balance: 25050 } } });
    expect(changed.account.opening_balance).toMatch(/250\.50$/);
    expect(notes[0]).toEqual({
      label: "Changed Cash opening balance",
      detail: expect.stringMatching(/^Opening balance .*250\.50 · balance now /),
      undoTokens: [TOKEN],
    });

    rpcs.length = 0;
    // Same value again is a no-op; a name plus a new balance goes in one patch.
    expect((await act("update_account", { account_id: cash.id, opening_balance: 250.5 })).error).toMatch(/already like that/);
    expect((await act("update_account", { account_id: cash.id, opening_balance: 1.234 })).error).toMatch(/decimal places/);
    expect(rpcs).toHaveLength(0);
    await act("update_account", { account_id: cash.id, name: "Wallet", opening_balance: -20 });
    expect(rpcs[0].args.p_patch).toEqual({ name: "Wallet", opening_balance: -2000 });
  });

  it("restores an archived account and refuses no-op or unknown changes", async () => {
    const restored = await act("update_account", { account_id: OLD_CARD, archived: false });
    expect(restored.account.archived).toBe(false);
    expect(notes[0].label).toBe("Restored Old card");
    rpcs.length = 0;
    expect((await act("update_account", { account_id: OLD_CARD, archived: false })).error).toMatch(/already like that/);
    expect((await act("update_account", { account_id: OLD_CARD })).error).toMatch(/Nothing to change/);
    expect((await act("update_account", { account_id: randomUUID(), name: "Z" })).error).toMatch(/list_accounts/);
    expect(rpcs).toHaveLength(0);
  });

  it("creates categories and subcategories after checking the parent", async () => {
    const top = await act("create_category", { name: "Pets", kind: "expense" });
    expect(top.category).toMatchObject({ name: "Pets", kind: "expense" });
    expect(notes[0]).toEqual({ label: "Created expense category Pets", undoTokens: [TOKEN] });

    const sub = await act("create_category", { name: "Vet", kind: "expense", parent_id: FOOD });
    expect(sub.category.path).toBe("Food & Dining › Vet");
    expect(rpcs.at(-1)?.args).toMatchObject({ p_kind: "expense", p_parent: FOOD });

    rpcs.length = 0;
    expect((await act("create_category", { name: "Bonus", kind: "income", parent_id: FOOD })).error).toMatch(/expense category but this one is income/);
    expect((await act("create_category", { name: "Deep", kind: "expense", parent_id: GROCERIES })).error).toMatch(/two levels/);
    expect((await act("create_category", { name: "Lost", kind: "expense", parent_id: randomUUID() })).error).toMatch(/list_categories/);
    expect(rpcs).toHaveLength(0);
  });

  it("renames, archives and restores categories, noting subcategories left open", async () => {
    const renamed = await act("update_category", { category_id: GROCERIES, name: "Supermarket" });
    expect(renamed.category.name).toBe("Supermarket");
    expect(notes[0].label).toBe("Renamed Groceries to Supermarket");

    extra = { open_subcategories: 1 };
    const archived = await act("update_category", { category_id: FOOD, archived: true });
    expect(archived.open_subcategories).toBe(1);
    expect(notes[1]).toEqual({ label: "Archived Food & Dining", detail: "Past entries keep it", undoTokens: [TOKEN] });

    const restored = await act("update_category", { category_id: FOOD, archived: false });
    expect(restored.category.archived).toBe(false);
    expect(notes[2].label).toBe("Restored Food & Dining");
  });

  it("shows the database message when it refuses, and counts toward the five-changes limit", async () => {
    rpcError = { code: "P0001", message: "You already have an account with that name." };
    expect((await act("create_account", { name: "Cash", type: "cash" })).error).toBe("You already have an account with that name.");
    expect(notes).toHaveLength(0);
    rpcError = null;

    const c = context();
    for (let i = 1; i <= 5; i++) {
      expect((await act("create_category", { name: `Cat ${i}`, kind: "expense" }, c)).saved).toBe(true);
    }
    expect((await act("create_category", { name: "Cat 6", kind: "expense" }, c)).error).toMatch(/5 changes in a row/);
  });
});

describe("bills", () => {
  const TOKEN = randomUUID();
  const notes: { label: string; detail?: string; undoTokens?: string[] }[] = [];
  const context = () => ({ queryClient: new QueryClient(), onChange: (n: (typeof notes)[number]) => notes.push(n) });
  const act = (name: string, args: unknown, c = context()) =>
    runTool(c, name, JSON.stringify(args)).then((text) => JSON.parse(text));
  const today = todayKey();
  const RENT = randomUUID();
  const GYM = randomUUID();
  const OLD = randomUUID();
  const WAGES = randomUUID();
  const USD = randomUUID();
  let originalAccounts: unknown[];

  const rule = (o: Record<string, unknown>) => ({
    id: randomUUID(),
    kind: "expense",
    name: "Bill",
    amount: 10000,
    currency: "GHS",
    account_id: CASH,
    category_id: null,
    frequency: "monthly",
    repeat_every: 1,
    anchor_day: 15,
    next_due: addDaysKey(today, 10),
    end_date: null,
    auto_post: false,
    paused_at: null,
    ...o,
  });
  const find = (id: unknown) => (tables.recurring_rules as Record<string, unknown>[]).find((r) => r.id === id)!;

  beforeEach(() => {
    notes.length = 0;
    originalAccounts = tables.accounts;
    tables.accounts = [
      ...originalAccounts,
      { id: USD, name: "Dollars", type: "bank", currency: "USD", opening_balance: 0, sort_order: 5, archived_at: null },
    ];
    tables.recurring_rules = [
      rule({ id: RENT, name: "Rent", amount: 120000, category_id: FOOD, next_due: addDaysKey(today, 3), anchor_day: 20 }),
      rule({ id: GYM, name: "Gym", amount: 8000, paused_at: "2026-09-01T00:00:00Z" }),
      rule({ id: OLD, name: "Old phone plan", amount: 5000, next_due: addDaysKey(today, 40), end_date: addDaysKey(today, 5) }),
      rule({ id: WAGES, kind: "income", name: "Wages", amount: 500000, category_id: SALARY, next_due: addDaysKey(today, -2) }),
    ];
    rpcResult = (args) => {
      const name = rpcs.at(-1)?.name;
      if (name === "assistant_create_bill") {
        tables.recurring_rules.push(
          rule({
            id: args.p_id, kind: args.p_kind, name: args.p_name, amount: args.p_amount, account_id: args.p_account,
            category_id: args.p_category, frequency: args.p_frequency, repeat_every: args.p_every,
            next_due: args.p_first_due, end_date: args.p_end, auto_post: args.p_auto,
            anchor_day: Number(String(args.p_first_due).slice(8)),
          }),
        );
        return { id: args.p_id, undo_token: TOKEN };
      }
      const row = find(args.p_id);
      if (name === "assistant_update_bill") {
        const patch = args.p_patch as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) {
          if (k === "paused") row.paused_at = v ? "2026-10-23T00:00:00Z" : null;
          else row[k] = v;
        }
        return { id: args.p_id, undo_token: TOKEN };
      }
      const due = row.next_due as string;
      row.next_due = addDaysKey(due, 30);
      return name === "assistant_pay_bill"
        ? { id: args.p_id, undo_token: TOKEN, transaction_id: randomUUID(), paid_for: due }
        : { id: args.p_id, undo_token: TOKEN, skipped: due };
    };
  });

  afterEach(() => {
    tables.accounts = originalAccounts;
    tables.recurring_rules = [];
  });

  it("lists bills with what is due, their status, and per-month figures that leave out paused and ended ones", async () => {
    const result = await act("list_bills", {});
    const byName = Object.fromEntries(result.bills.map((b: { name: string }) => [b.name, b]));
    expect(byName.Rent).toMatchObject({
      id: RENT,
      kind: "expense",
      schedule: "Monthly, on the 20th",
      account: "Cash",
      category: "Food & Dining",
      status: "active",
      due: "Due in 3 days",
    });
    expect(byName.Rent.amount).toMatch(/1,200\.00$/);
    expect(byName.Gym.status).toBe("paused");
    expect(byName["Old phone plan"].status).toBe("ended");
    expect(byName["Old phone plan"].due).toBeUndefined();
    expect(byName.Wages).toMatchObject({ status: "due, waiting to be paid", kind: "income" });
    expect(result.live_bills_per_month.expenses).toEqual([expect.stringMatching(/1,200\.00$/)]);
    expect(result.live_bills_per_month.income).toEqual([expect.stringMatching(/5,000\.00$/)]);
  });

  it("says so when there are no bills", async () => {
    tables.recurring_rules = [];
    expect(await act("list_bills", {})).toEqual({ bills: [], note: "No bills are set up." });
  });

  it("adds a bill, reads it back and hands the screen an undo token", async () => {
    const first = addDaysKey(today, 6);
    const result = await act("create_bill", {
      name: "  Netflix ",
      kind: "expense",
      amount: 79.99,
      account_id: CASH,
      category_id: FOOD,
      frequency: "monthly",
      first_due: first,
    });
    expect(rpcs[0]).toEqual({
      name: "assistant_create_bill",
      args: {
        p_id: expect.any(String),
        p_kind: "expense",
        p_name: "Netflix",
        p_amount: 7999,
        p_account: CASH,
        p_category: FOOD,
        p_frequency: "monthly",
        p_every: 1,
        p_first_due: first,
        p_end: null,
        p_auto: false,
      },
    });
    expect(result.saved).toBe(true);
    expect(result.bill).toMatchObject({ name: "Netflix", status: "active", auto_post: false });
    expect(result.note).toMatch(/Nothing has been recorded yet/);
    expect(notes).toEqual([
      { label: "Added bill: Netflix", detail: expect.stringMatching(/79\.99 · Monthly, on the \d+(st|nd|rd|th) · next /), undoTokens: [TOKEN] },
    ]);
  });

  it("says plainly when a bill will record itself", async () => {
    const result = await act("create_bill", {
      name: "Salary", kind: "income", amount: 3000, account_id: CASH, category_id: SALARY,
      frequency: "monthly", first_due: today, auto_post: true,
    });
    expect(rpcs[0].args).toMatchObject({ p_kind: "income", p_auto: true });
    expect(result.note).toMatch(/recorded by itself/);
  });

  it("checks a bill's details before saving anything", async () => {
    const base = { name: "X", kind: "expense", amount: 10, account_id: CASH, frequency: "monthly", first_due: today };
    expect((await act("create_bill", { ...base, first_due: addDaysKey(today, -1) })).error).toMatch(/in the past/);
    expect((await act("create_bill", { ...base, end_date: addDaysKey(today, -3) })).error).toMatch(/end date is before/);
    expect((await act("create_bill", { ...base, category_id: SALARY })).error).toMatch(/income category/);
    expect((await act("create_bill", { ...base, account_id: (originalAccounts[1] as { id: string }).id })).error).toMatch(/list_accounts/);
    expect((await act("create_bill", { ...base, amount: 10.123 })).error).toMatch(/decimal places/);
    expect((await act("create_bill", { ...base, first_due: "2026-02-30" })).error).toMatch(/not a real date/);
    expect((await act("create_bill", { ...base, frequency: "daily" })).error).toMatch(/Bad input/);
    expect(rpcs).toHaveLength(0);
  });

  it("pauses and resumes a bill", async () => {
    const paused = await act("update_bill", { bill_id: RENT, paused: true });
    expect(rpcs[0]).toEqual({ name: "assistant_update_bill", args: { p_id: RENT, p_patch: { paused: true } } });
    expect(paused.bill.status).toBe("paused");
    expect(notes[0]).toEqual({ label: "Paused Rent", undoTokens: [TOKEN] });

    await act("update_bill", { bill_id: GYM, paused: false });
    expect(notes[1].label).toBe("Resumed Gym");
  });

  it("changes the amount, name, end date and auto-post, sending only what differs", async () => {
    const renamed = await act("update_bill", { bill_id: RENT, name: "House rent", amount: 1300, auto_post: true });
    expect(rpcs[0].args.p_patch).toEqual({ name: "House rent", amount: 130000, auto_post: true });
    expect(renamed.note).toMatch(/recorded by itself/);
    expect(notes[0].label).toBe("Updated House rent");
    expect(notes[0].detail).toMatch(/Amount was .*1,200\.00 · Records itself when due/);

    await act("update_bill", { bill_id: RENT, end_date: addDaysKey(today, 300) });
    expect(notes[1].detail).toMatch(/^Ends /);
    await act("update_bill", { bill_id: RENT, end_date: null });
    expect(notes[2].detail).toBe("No end date");
    expect(find(RENT).end_date).toBeNull();

    await act("update_bill", { bill_id: RENT, category_id: null });
    expect(find(RENT).category_id).toBeNull();
  });

  it("refuses changes that do nothing or don't fit, without calling the database", async () => {
    expect((await act("update_bill", { bill_id: RENT })).error).toMatch(/Nothing to change/);
    expect((await act("update_bill", { bill_id: RENT, name: "Rent", amount: 1200 })).error).toMatch(/already like that/);
    expect((await act("update_bill", { bill_id: randomUUID(), name: "Z" })).error).toMatch(/list_bills/);
    expect((await act("update_bill", { bill_id: RENT, end_date: addDaysKey(today, 1) })).error).toMatch(/before the next due date/);
    expect((await act("update_bill", { bill_id: RENT, account_id: USD })).error).toMatch(/uses USD/);
    expect((await act("update_bill", { bill_id: RENT, category_id: SALARY })).error).toMatch(/income category/);
    expect((await act("update_bill", { bill_id: RENT, frequency: "weekly" })).error).toMatch(/Nothing to change/);
    expect(rpcs).toHaveLength(0);
  });

  it("marks a bill as paid, then shows when it is due next", async () => {
    const due = find(RENT).next_due as string;
    const result = await act("pay_bill", { bill_id: RENT });
    expect(rpcs[0]).toEqual({ name: "assistant_pay_bill", args: { p_id: RENT, p_amount: null } });
    expect(result.paid).toMatch(/1,200\.00$/);
    expect(result.for_due_date).toBe(due);
    expect(result.bill.next_due).toBe(addDaysKey(due, 30));
    expect(notes).toEqual([
      { label: "Marked Rent as paid", detail: expect.stringMatching(/1,200\.00 · Cash · next due /), undoTokens: [TOKEN] },
    ]);
  });

  it("records the amount actually paid, and says received for income", async () => {
    const result = await act("pay_bill", { bill_id: RENT, amount: 1150.5 });
    expect(rpcs[0].args.p_amount).toBe(115050);
    expect(result.paid).toMatch(/1,150\.50$/);

    const wages = await act("pay_bill", { bill_id: WAGES });
    expect(wages.received).toMatch(/5,000\.00$/);
    expect(notes[1].label).toBe("Marked Wages as received");
  });

  it("shows the database's reason when a bill can't be paid or skipped", async () => {
    rpcError = { code: "P0001", message: "That bill is paused. Resume it first." };
    expect((await act("pay_bill", { bill_id: GYM })).error).toBe("That bill is paused. Resume it first.");
    expect((await act("skip_bill", { bill_id: GYM })).error).toBe("That bill is paused. Resume it first.");
    expect(notes).toHaveLength(0);
    expect((await act("pay_bill", { bill_id: randomUUID() })).error).toMatch(/list_bills/);
  });

  it("skips an occurrence without recording anything", async () => {
    const due = find(RENT).next_due as string;
    const result = await act("skip_bill", { bill_id: RENT });
    expect(rpcs[0]).toEqual({ name: "assistant_skip_bill", args: { p_id: RENT } });
    expect(result.skipped).toBe(due);
    expect(result.note).toMatch(/Nothing was recorded/);
    expect(notes[0]).toEqual({
      label: expect.stringMatching(/^Skipped Rent for /),
      detail: expect.stringMatching(/^Next due /),
      undoTokens: [TOKEN],
    });
  });

  it("counts bill changes toward the five-changes limit", async () => {
    const c = context();
    for (let i = 0; i < 5; i++) {
      const id = (tables.recurring_rules as { id: string }[])[0].id;
      expect((await act("skip_bill", { bill_id: id }, c)).saved).toBe(true);
    }
    expect((await act("skip_bill", { bill_id: RENT }, c)).error).toMatch(/5 changes in a row/);
  });
});

describe("transfers", () => {
  const TOKEN = randomUUID();
  const SAVINGS = randomUUID();
  const USD = randomUUID();
  const OLD_CARD = (tables.accounts[1] as { id: string }).id;
  const notes: { label: string; detail?: string; undoTokens?: string[] }[] = [];
  const context = () => ({ queryClient: new QueryClient(), onChange: (n: (typeof notes)[number]) => notes.push(n) });
  const act = (args: unknown, c = context()) =>
    runTool(c, "transfer_money", JSON.stringify(args)).then((text) => JSON.parse(text));
  let originalAccounts: unknown[];
  let originalBalances: unknown[];
  let saveSides = true;

  beforeEach(() => {
    notes.length = 0;
    saveSides = true;
    originalAccounts = tables.accounts;
    originalBalances = tables.account_balances;
    tables.accounts = [
      ...originalAccounts,
      { id: SAVINGS, name: "Savings", type: "savings", currency: "GHS", opening_balance: 0, sort_order: 3, archived_at: null },
      { id: USD, name: "Dollars", type: "bank", currency: "USD", opening_balance: 0, sort_order: 4, archived_at: null },
    ];
    tables.account_balances = [
      ...originalBalances,
      { account_id: SAVINGS, balance: 30000, transaction_count: 1 },
      { account_id: USD, balance: 10000, transaction_count: 1 },
    ];
    rpcResult = (args) => {
      if (saveSides) {
        const side = (type: string, account: unknown, amount: unknown) => ({
          id: randomUUID(), account_id: account, type, amount, currency: account === USD ? "USD" : "GHS",
          occurred_at: args.p_occurred_at, category_id: null, payee: null, note: args.p_note,
          transfer_group_id: args.p_group_id, deleted_at: null,
        });
        tables.transactions.push(
          side("transfer_out", args.p_from, args.p_amount_out),
          side("transfer_in", args.p_to, args.p_amount_in ?? args.p_amount_out),
        );
      }
      return { id: args.p_group_id, undo_token: TOKEN };
    };
  });

  afterEach(() => {
    tables.accounts = originalAccounts;
    tables.account_balances = originalBalances;
  });

  it("moves money between two accounts, reads it back and gives the screen an undo token", async () => {
    const result = await act({ from_account_id: CASH, to_account_id: SAVINGS, amount: 200, note: "Rainy day" });
    expect(rpcs[0]).toEqual({
      name: "assistant_create_transfer",
      args: {
        p_group_id: expect.any(String),
        p_from: CASH,
        p_to: SAVINGS,
        p_amount_out: 20000,
        p_amount_in: null,
        p_occurred_at: expect.any(String),
        p_note: "Rainy day",
        p_fee: null,
        p_fee_category: null,
      },
    });
    expect(result).toMatchObject({ saved: true, date: todayKey() });
    expect(result.moved).toMatch(/200\.00$/);
    expect(result.received).toBeUndefined();
    expect(result.from).toMatchObject({ account: "Cash", balance_now: expect.stringMatching(/500\.00$/) });
    expect(result.to).toMatchObject({ account: "Savings", balance_now: expect.stringMatching(/300\.00$/) });
    expect(notes).toEqual([
      {
        label: expect.stringMatching(/^Moved .*200\.00 from Cash to Savings$/),
        detail: expect.stringMatching(/Rainy day$/),
        undoTokens: [TOKEN],
      },
    ]);
  });

  it("takes a fee from the sending account", async () => {
    const result = await act({ from_account_id: CASH, to_account_id: SAVINGS, amount: 100, fee: 1.5, fee_category_id: FOOD });
    expect(rpcs[0].args).toMatchObject({ p_fee: 150, p_fee_category: FOOD });
    expect(result.fee).toMatch(/1\.50$/);
    expect(notes[0].detail).toMatch(/^Fee .*1\.50/);
  });

  it("needs the amount received when the currencies differ, and never guesses a rate", async () => {
    expect((await act({ from_account_id: CASH, to_account_id: USD, amount: 600 })).error).toMatch(/Ask how much arrives in USD/);
    expect(rpcs).toHaveLength(0);

    const result = await act({ from_account_id: CASH, to_account_id: USD, amount: 600, amount_received: 40 });
    expect(rpcs[0].args).toMatchObject({ p_amount_out: 60000, p_amount_in: 4000 });
    expect(result.received).toMatch(/40\.00$/);
    expect(notes[0].detail).toMatch(/^Dollars gets .*40\.00/);
  });

  it("checks the accounts, amounts and date before saving anything", async () => {
    const base = { from_account_id: CASH, to_account_id: SAVINGS, amount: 50 };
    expect((await act({ ...base, to_account_id: CASH })).error).toMatch(/same account/);
    expect((await act({ ...base, to_account_id: OLD_CARD })).error).toMatch(/list_accounts/);
    expect((await act({ ...base, from_account_id: randomUUID() })).error).toMatch(/list_accounts/);
    expect((await act({ ...base, amount_received: 50 })).error).toMatch(/different currencies/);
    expect((await act({ ...base, fee: 1, fee_category_id: SALARY })).error).toMatch(/income category/);
    expect((await act({ ...base, amount: 10.123 })).error).toMatch(/decimal places/);
    expect((await act({ ...base, date: "2099-01-01" })).error).toMatch(/future/);
    expect((await act({ ...base, amount: -5 })).error).toMatch(/Bad input/);
    expect(rpcs).toHaveLength(0);
  });

  it("shows the database's reason, and won't make the exact same transfer twice in a row", async () => {
    rpcError = { code: "P0001", message: "One of those accounts was not found, or it is archived." };
    expect((await act({ from_account_id: CASH, to_account_id: SAVINGS, amount: 5 })).error).toBe(
      "One of those accounts was not found, or it is archived.",
    );
    rpcError = null;
    expect(notes).toHaveLength(0);

    const c = context();
    expect((await act({ from_account_id: CASH, to_account_id: SAVINGS, amount: 5 }, c)).saved).toBe(true);
    expect((await act({ from_account_id: CASH, to_account_id: SAVINGS, amount: 5 }, c)).error).toMatch(/already made/);
  });

  it("says so when it can't confirm the transfer was saved", async () => {
    saveSides = false;
    expect((await act({ from_account_id: CASH, to_account_id: SAVINGS, amount: 5 })).error).toMatch(/could not be confirmed/);
    expect(notes).toHaveLength(0);
  });
});

describe("show_chart", () => {
  const specs: { kind: string; [key: string]: unknown }[] = [];
  const context = () => ({
    queryClient: new QueryClient(),
    onChart: (spec: (typeof specs)[number]) => specs.push(spec),
  });
  const draw = (args: unknown, c = context()) =>
    runTool(c, "show_chart", JSON.stringify(args)).then((text) => JSON.parse(text));
  const group = (label: string, amount: number, id: string | null = null) => ({ id, label, amount, count: 2 });
  const summary = (groups: ReturnType<typeof group>[]) => ({
    total: groups.reduce((s, g) => s + g.amount, 0),
    count: groups.length * 2,
    group_count: groups.length,
    groups,
  });
  const thisMonth = todayKey().slice(0, 7);

  beforeEach(() => {
    specs.length = 0;
  });

  it("builds a donut from the database's totals and tells the model the facts", async () => {
    rpcResult = () => summary([group("Food", 75000, FOOD), group("Transport", 25000)]);
    const result = await draw({ chart: "donut", from: "2026-10-01", to: "2026-10-31" });
    expect(rpcs[0]).toEqual({
      name: "spending_summary",
      args: { p_from: "2026-10-01", p_to: "2026-10-31", p_type: "expense", p_group: "category" },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      kind: "parts",
      shape: "donut",
      total: 100000,
      title: "Where your money went",
      currency: "GHS",
    });
    expect(result.drawn).toBe(true);
    expect(result.facts[0]).toMatch(/1,000\.00/);
    expect(result.facts.join(" ")).toMatch(/Food: .*750\.00 \(75%\)/);
  });

  it("draws nothing, and says so, when there is nothing in the period", async () => {
    rpcResult = () => summary([]);
    const result = await draw({ chart: "treemap" });
    expect(result.drawn).toBe(false);
    expect(result.note).toMatch(/nothing/i);
    expect(specs).toHaveLength(0);
  });

  it("stops after three charts in one question", async () => {
    rpcResult = () => summary([group("Food", 75000, FOOD)]);
    const c = context();
    for (let i = 0; i < 3; i++) expect((await draw({ chart: "bars" }, c)).drawn).toBe(true);
    expect((await draw({ chart: "bars" }, c)).error).toMatch(/3 charts/);
    expect(specs).toHaveLength(3);
  });

  it("reads long ranges in windows because the summary returns at most 40 groups", async () => {
    rpcResult = () => summary([group("2026-09-02", 5000)]);
    await draw({ chart: "weekday", from: "2026-07-01", to: "2026-09-30" });
    expect(rpcs.length).toBe(3);
    for (const call of rpcs) {
      expect(call.args.p_group).toBe("day");
      const days = (Date.parse(call.args.p_to as string) - Date.parse(call.args.p_from as string)) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(40);
    }
    expect(specs[0].kind).toBe("weekday");
  });

  it("picks days, weeks or months for a trend by how long the range is", async () => {
    rpcResult = () => summary([group("2026-09-02", 5000)]);
    const bucketFor = async (from: string, to: string) => {
      rpcs.length = 0;
      await draw({ chart: "trend", from, to });
      return rpcs[0].args.p_group;
    };
    expect(await bucketFor("2026-09-01", "2026-09-20")).toBe("day");
    expect(await bucketFor("2026-06-01", "2026-09-30")).toBe("week");
    expect(await bucketFor("2025-01-01", "2026-09-30")).toBe("month");
  });

  it("refuses months that haven't started and a half-given range", async () => {
    expect((await draw({ chart: "calendar", month: "2099-01" })).error).toMatch(/hasn't started/);
    expect((await draw({ chart: "donut", from: "2026-10-01" })).error).toMatch(/both from and to/);
    expect(specs).toHaveLength(0);
  });

  it("won't draw a flow with no income, or a comparison with too few categories", async () => {
    rpcResult = (args) => (args.p_type === "income" ? summary([]) : summary([group("Food", 75000, FOOD)]));
    expect((await draw({ chart: "flow" })).drawn).toBe(false);
    rpcResult = () => summary([group("Food", 75000, FOOD)]);
    const compare = await draw({ chart: "radar" });
    expect(compare.drawn).toBe(false);
    expect(compare.note).toMatch(/three categories/);
  });

  it("compares a month with the same days of the month before", async () => {
    rpcResult = () => summary([group("A", 1000, "a"), group("B", 2000, "b"), group("C", 3000, "c")]);
    await draw({ chart: "dumbbell", month: "2026-03" });
    expect(rpcs[0].args).toMatchObject({ p_from: "2026-03-01", p_to: "2026-03-31" });
    // February has 28 days, so the earlier side stops there.
    expect(rpcs[1].args).toMatchObject({ p_from: "2026-02-01", p_to: "2026-02-28" });
    expect(specs[0]).toMatchObject({ kind: "compare", currentLabel: "Mar", previousLabel: "Feb" });
  });

  it("draws months of income and spending from the database's monthly sums", async () => {
    rpcResult = (args) =>
      args.p_type === "income"
        ? summary([group("2026-09", 500000), group("2026-10", 500000)])
        : summary([group("2026-09", 300000), group("2026-10", 350000)]);
    const result = await draw({ chart: "net_by_month", month: "2026-10", months: 2 });
    expect(rpcs.every((r) => r.args.p_group === "month")).toBe(true);
    expect(specs[0]).toMatchObject({
      kind: "months",
      shape: "net",
      points: [
        { label: "Sep", income: 500000, expense: 300000 },
        { label: "Oct", income: 500000, expense: 350000 },
      ],
    });
    expect(result.facts.join(" ")).toMatch(/Best month: Sep/);
  });

  it("draws budgets and balances from the person's own rows", async () => {
    rpcResult = () => [{ budget_id: randomUUID(), category_id: FOOD, amount: 70000, currency: "GHS", spent: 80000 }];
    const budgets = await draw({ chart: "budgets", month: thisMonth });
    expect(specs[0]).toMatchObject({
      kind: "budgets",
      rows: [{ label: "Food & Dining", spent: 80000, limit: 70000, status: "over" }],
    });
    expect(budgets.facts[0]).toMatch(/over/);

    const balances = await draw({ chart: "balances" });
    expect(specs[1]).toMatchObject({ kind: "balances", rows: [{ label: "Cash", amount: 50000, type: "Cash" }] });
    expect(balances.drawn).toBe(true);
  });

  it("puts only live bills that fall due soon on the timeline", async () => {
    const today = todayKey();
    const bill = (o: Record<string, unknown>) => ({
      id: randomUUID(),
      kind: "expense",
      name: "Bill",
      amount: 10000,
      currency: "GHS",
      account_id: CASH,
      category_id: null,
      frequency: "monthly",
      repeat_every: 1,
      anchor_day: 15,
      next_due: addDaysKey(today, 5),
      end_date: null,
      auto_post: false,
      paused_at: null,
      ...o,
    });
    tables.recurring_rules = [
      bill({ name: "Rent" }),
      bill({ name: "Paused", paused_at: "2026-09-01T00:00:00Z" }),
      bill({ name: "Far off", next_due: addDaysKey(today, 60) }),
      bill({ name: "Wages", kind: "income" }),
    ];
    const result = await draw({ chart: "bills" });
    expect(specs[0]).toMatchObject({ kind: "timeline", items: [{ label: "Rent", amount: 10000 }] });
    expect(result.facts[0]).toMatch(/1 bill worth/);

    tables.recurring_rules = [];
    expect((await draw({ chart: "bills" })).drawn).toBe(false);
  });
});

describe("propose_transactions and addConfirmed", () => {
  const proposals: Proposal[] = [];
  const context = () => ({ queryClient: new QueryClient(), onProposal: (p: Proposal) => proposals.push(p) });
  const propose = (entries: unknown[], c = context()) =>
    runTool(c, "propose_transactions", JSON.stringify({ entries })).then((text) => JSON.parse(text));
  const entry = (o: Record<string, unknown> = {}) => ({
    type: "expense",
    amount: 12.5,
    account_id: CASH,
    category_id: GROCERIES,
    payee: "Melcom",
    ...o,
  });

  beforeEach(() => {
    proposals.length = 0;
  });

  it("lines the entries up on a card and saves nothing", async () => {
    const result = await propose([entry(), entry({ amount: 40, payee: "Shoprite" }), entry({ type: "income", category_id: SALARY, payee: "Employer", amount: 1000 })]);
    expect(rpcs).toHaveLength(0);
    expect(result).toMatchObject({ awaiting_confirmation: true, would_add: 3 });
    expect(result.note).toMatch(/NOTHING HAS BEEN ADDED/);
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal.action).toBe("add");
    if (proposal.action !== "add") return;
    expect(proposal.entries[0]).toMatchObject({ type: "expense", amount: 1250, accountId: CASH, categoryId: GROCERIES, payee: "Melcom" });
    expect(proposal.entries[0].date).toBe(todayKey());
    expect(proposal.rows[0]).toMatchObject({ title: "Melcom", amount: expect.stringMatching(/^−.*12\.50$/) });
    expect(proposal.rows[2].amount).toMatch(/^\+.*1,000\.00$/);
    // The totals on the card come from code, not the model.
    expect(proposal.summary).toMatch(/Spending .*52\.50 · Income .*1,000\.00/);
  });

  it("names the entry that is wrong, and shows no card", async () => {
    expect((await propose([entry(), entry({ account_id: randomUUID() })])).error).toMatch(/^Entry 2: no open account/);
    expect((await propose([entry({ category_id: SALARY }), entry()])).error).toMatch(/^Entry 1: that is an income category/);
    expect((await propose([entry(), entry({ amount: 1.234 })])).error).toMatch(/^Entry 2: .*decimal/);
    expect((await propose([entry(), entry({ date: addDaysKey(todayKey(), 3) })])).error).toMatch(/^Entry 2: .*future/);
    expect((await propose([entry()])).error).toMatch(/Bad input/);
    expect(proposals).toHaveLength(0);
  });

  it("allows one card per question", async () => {
    const c = context();
    expect((await propose([entry(), entry()], c)).awaiting_confirmation).toBe(true);
    expect((await propose([entry(), entry()], c)).error).toMatch(/already on screen/);
    expect(proposals).toHaveLength(1);
  });

  it("saves the card's entries one by one through the same database function", async () => {
    rpcResult = () => ({ id: randomUUID(), undo_token: randomUUID() });
    const result = await propose([entry(), entry({ amount: 40, date: "2026-10-02" })]);
    const proposal = proposals[0];
    if (proposal.action !== "add") throw new Error("expected an add card");
    expect(result.would_add).toBe(2);

    const done = await addConfirmed(proposal.entries, new QueryClient());
    expect(done.count).toBe(2);
    expect(done.undoTokens).toHaveLength(2);
    expect(done.failure).toBeNull();
    expect(rpcs.map((r) => r.name)).toEqual(["assistant_add_transaction", "assistant_add_transaction"]);
    expect(rpcs[0].args).toMatchObject({ p_account: CASH, p_type: "expense", p_amount: 1250, p_category: GROCERIES, p_payee: "Melcom" });
    expect(rpcs[1].args).toMatchObject({ p_amount: 4000 });
  });

  it("stops at the first failure and reports how far it got", async () => {
    let n = 0;
    rpcResult = () => ({ id: randomUUID(), undo_token: randomUUID() });
    const original = rpcs.push.bind(rpcs);
    rpcs.push = (...items) => {
      n += 1;
      if (n === 2) rpcError = { code: "P0001", message: "That account is archived." };
      return original(...items);
    };
    try {
      const entries = Array.from({ length: 3 }, () => ({
        type: "expense" as const,
        amount: 1000,
        accountId: CASH,
        categoryId: null,
        payee: null,
        note: null,
        date: "2026-10-02",
      }));
      const done = await addConfirmed(entries, new QueryClient());
      expect(done.count).toBe(1);
      expect(done.undoTokens).toHaveLength(1);
      expect(done.failure).toBe("That account is archived.");
      expect(rpcs).toHaveLength(2);
    } finally {
      delete (rpcs as { push?: unknown }).push;
    }
  });
});
