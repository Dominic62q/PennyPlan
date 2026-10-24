// Client-side shapes of ledger rows. Money is always integer minor units.

export const ACCOUNT_TYPES = [
  "cash",
  "bank",
  "savings",
  "credit_card",
  "mobile_money",
  "investment",
  "loan",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "Cash",
  bank: "Bank",
  savings: "Savings",
  credit_card: "Credit card",
  mobile_money: "Mobile money",
  investment: "Investment",
  loan: "Loan",
};

export const TRANSACTION_TYPES = [
  "expense",
  "income",
  "transfer_out",
  "transfer_in",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type CategoryKind = "income" | "expense";

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: number;
  sortOrder: number;
  archivedAt: string | null;
};

export type AccountWithBalance = Account & {
  balance: number;
  transactionCount: number;
};

export type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  archivedAt: string | null;
};

export type LedgerTransaction = {
  id: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  currency: string;
  occurredAt: string;
  categoryId: string | null;
  payee: string | null;
  note: string | null;
  transferGroupId: string | null;
  deletedAt: string | null;
};

export type TransactionFilters = {
  accountId?: string;
  categoryId?: string;
  type?: "expense" | "income" | "transfer";
  // Matches payee or note.
  search?: string;
  // ISO timestamps, inclusive start and exclusive end.
  from?: string;
  to?: string;
  includeDeleted?: boolean;
};

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

// Rent, a subscription, salary: something that comes round again. `nextDue`
// is a calendar day ("2026-10-31") and the first occurrence not yet dealt with.
export type RecurringRule = {
  id: string;
  kind: CategoryKind;
  name: string;
  amount: number;
  currency: string;
  accountId: string;
  categoryId: string | null;
  frequency: RecurringFrequency;
  repeatEvery: number;
  anchorDay: number;
  nextDue: string;
  endDate: string | null;
  // Turns into a real transaction by itself when due. Otherwise it waits for
  // a tap on "Paid".
  autoPost: boolean;
  paused: boolean;
};

// Signed effect of a row on its account balance.
export function signedAmount(t: Pick<LedgerTransaction, "type" | "amount">) {
  return t.type === "income" || t.type === "transfer_in" ? t.amount : -t.amount;
}
