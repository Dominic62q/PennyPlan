import { queryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { parseLogo } from "@/lib/ledger/logo";
import {
  budgetProgressRowSchema,
  monthlyReportSchema,
  type BudgetProgress,
  type MonthlyReport,
} from "@/lib/ledger/reports";
import type {
  Account,
  AccountWithBalance,
  Category,
  LedgerTransaction,
  RecurringRule,
  TransactionFilters,
} from "@/lib/ledger/types";

// Every screen (and later the assistant) reads the ledger through these, so a
// change made in one place shows up everywhere after one invalidation.
export const ledgerKeys = {
  all: ["ledger"] as const,
  accounts: () => [...ledgerKeys.all, "accounts"] as const,
  categories: () => [...ledgerKeys.all, "categories"] as const,
  transactions: (filters: TransactionFilters = {}) =>
    [...ledgerKeys.all, "transactions", filters] as const,
  budgets: (month: string) => [...ledgerKeys.all, "budgets", month] as const,
  report: (month: string) => [...ledgerKeys.all, "report", month] as const,
  recurring: () => [...ledgerKeys.all, "recurring"] as const,
};

// Outside the ledger prefix on purpose: posting due items refreshes the ledger,
// and that must not trigger the posting again.
export const recurringSyncKey = ["recurring-sync"] as const;

type AccountRow = {
  id: string;
  name: string;
  type: Account["type"];
  currency: string;
  opening_balance: number;
  sort_order: number;
  archived_at: string | null;
};
type BalanceRow = {
  account_id: string;
  balance: number;
  transaction_count: number;
};
type CategoryRow = {
  id: string;
  name: string;
  kind: Category["kind"];
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  logo: unknown;
  logo_checked_at: string | null;
  sort_order: number;
  archived_at: string | null;
};
type TransactionRow = {
  id: string;
  account_id: string;
  type: LedgerTransaction["type"];
  amount: number;
  currency: string;
  occurred_at: string;
  category_id: string | null;
  payee: string | null;
  note: string | null;
  transfer_group_id: string | null;
  deleted_at: string | null;
};

export const TRANSACTION_COLUMNS =
  "id, account_id, type, amount, currency, occurred_at, category_id, payee, note, transfer_group_id, deleted_at";

export function toTransaction(r: TransactionRow): LedgerTransaction {
  return {
    id: r.id,
    accountId: r.account_id,
    type: r.type,
    amount: Number(r.amount),
    currency: r.currency,
    occurredAt: r.occurred_at,
    categoryId: r.category_id,
    payee: r.payee,
    note: r.note,
    transferGroupId: r.transfer_group_id,
    deletedAt: r.deleted_at,
  };
}

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Something went wrong");
}

export const accountsQuery = () =>
  queryOptions({
    queryKey: ledgerKeys.accounts(),
    queryFn: async (): Promise<AccountWithBalance[]> => {
      const supabase = createClient();
      const [accounts, balances] = await Promise.all([
        supabase
          .from("accounts")
          .select(
            "id, name, type, currency, opening_balance, sort_order, archived_at",
          )
          .order("sort_order")
          .order("created_at"),
        supabase
          .from("account_balances")
          .select("account_id, balance, transaction_count"),
      ]);
      if (accounts.error) fail(accounts.error);
      if (balances.error) fail(balances.error);

      const byAccount = new Map(
        (balances.data as BalanceRow[]).map((b) => [b.account_id, b]),
      );
      return (accounts.data as AccountRow[]).map((a) => {
        const b = byAccount.get(a.id);
        return {
          id: a.id,
          name: a.name,
          type: a.type,
          currency: a.currency,
          openingBalance: Number(a.opening_balance),
          sortOrder: a.sort_order,
          archivedAt: a.archived_at,
          balance: Number(b?.balance ?? a.opening_balance),
          transactionCount: b?.transaction_count ?? 0,
        };
      });
    },
  });

export const categoriesQuery = () =>
  queryOptions({
    queryKey: ledgerKeys.categories(),
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await createClient()
        .from("categories")
        .select("id, name, kind, parent_id, icon, color, logo, logo_checked_at, sort_order, archived_at")
        .order("sort_order")
        .order("name");
      if (error) fail(error);
      return (data as CategoryRow[]).map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        parentId: c.parent_id,
        icon: c.icon,
        color: c.color,
        logo: parseLogo(c.logo),
        logoChecked: c.logo_checked_at !== null,
        sortOrder: c.sort_order,
        archivedAt: c.archived_at,
      }));
    },
  });

export const transactionQuery = (id: string) =>
  queryOptions({
    queryKey: [...ledgerKeys.all, "transaction", id] as const,
    queryFn: async (): Promise<LedgerTransaction | null> => {
      const { data, error } = await createClient()
        .from("transactions")
        .select(TRANSACTION_COLUMNS)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) fail(error);
      return data ? toTransaction(data as TransactionRow) : null;
    },
  });

export const PAGE_SIZE = 200;

// Newest first. Soft-deleted rows are left out unless asked for.
export const transactionsQuery = (filters: TransactionFilters = {}) =>
  queryOptions({
    queryKey: ledgerKeys.transactions(filters),
    queryFn: async (): Promise<LedgerTransaction[]> => {
      let q = createClient()
        .from("transactions")
        .select(TRANSACTION_COLUMNS)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (!filters.includeDeleted) q = q.is("deleted_at", null);
      if (filters.accountId) q = q.eq("account_id", filters.accountId);
      if (filters.categoryId) q = q.eq("category_id", filters.categoryId);
      if (filters.type === "transfer") {
        q = q.in("type", ["transfer_in", "transfer_out"]);
      } else if (filters.type) {
        q = q.eq("type", filters.type);
      }
      if (filters.from) q = q.gte("occurred_at", filters.from);
      if (filters.to) q = q.lt("occurred_at", filters.to);

      const term = filters.search?.trim().replace(/[%,()*_\\]/g, " ").trim();
      if (term) q = q.or(`payee.ilike.%${term}%,note.ilike.%${term}%`);

      const { data, error } = await q;
      if (error) fail(error);
      return (data as TransactionRow[]).map(toTransaction);
    },
  });

// Budgets for a month with what has been spent against each, worked out by the
// database from live transactions.
export const budgetsQuery = (month: string) =>
  queryOptions({
    queryKey: ledgerKeys.budgets(month),
    queryFn: async (): Promise<BudgetProgress[]> => {
      const { data, error } = await createClient().rpc("budget_progress", {
        p_month: month,
      });
      if (error) fail(error);
      return budgetProgressRowSchema
        .array()
        .parse(data)
        .map((r) => ({
          id: r.budget_id,
          categoryId: r.category_id,
          amount: r.amount,
          spent: r.spent,
          currency: r.currency,
        }));
    },
  });

export const monthlyReportQuery = (month: string) =>
  queryOptions({
    queryKey: ledgerKeys.report(month),
    queryFn: async (): Promise<MonthlyReport> => {
      const { data, error } = await createClient().rpc("monthly_report", {
        p_month: month,
      });
      if (error) fail(error);
      return monthlyReportSchema.parse(data);
    },
  });

type RecurringRow = {
  id: string;
  kind: RecurringRule["kind"];
  name: string;
  amount: number;
  currency: string;
  account_id: string;
  category_id: string | null;
  frequency: RecurringRule["frequency"];
  repeat_every: number;
  anchor_day: number;
  next_due: string;
  end_date: string | null;
  auto_post: boolean;
  paused_at: string | null;
  logo: unknown;
  logo_checked_at: string | null;
};

// Every recurring rule, soonest due first.
export const recurringQuery = () =>
  queryOptions({
    queryKey: ledgerKeys.recurring(),
    queryFn: async (): Promise<RecurringRule[]> => {
      const { data, error } = await createClient()
        .from("recurring_rules")
        .select(
          "id, kind, name, amount, currency, account_id, category_id, frequency, repeat_every, anchor_day, next_due, end_date, auto_post, paused_at, logo, logo_checked_at",
        )
        .order("next_due")
        .order("name");
      if (error) fail(error);
      return (data as RecurringRow[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        amount: Number(r.amount),
        currency: r.currency,
        accountId: r.account_id,
        categoryId: r.category_id,
        frequency: r.frequency,
        repeatEvery: r.repeat_every,
        anchorDay: r.anchor_day,
        nextDue: r.next_due,
        endDate: r.end_date,
        autoPost: r.auto_post,
        paused: r.paused_at !== null,
        logo: parseLogo(r.logo),
        logoChecked: r.logo_checked_at !== null,
      }));
    },
  });

// Turns auto-post rules that have fallen due into real transactions. Runs when
// the app opens and when it comes back to the front; resolves to how many were
// added.
export const recurringSyncQuery = () =>
  queryOptions({
    queryKey: recurringSyncKey,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await createClient().rpc("post_due_recurring");
      if (error) fail(error);
      return Number(data ?? 0);
    },
  });
