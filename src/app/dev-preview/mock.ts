import { QueryClient } from "@tanstack/react-query";
import { currentMonthKey, daysInMonthKey, localDateKey, shiftMonthKey } from "@/lib/dates";
import type { BudgetProgress, MonthlyReport } from "@/lib/ledger/reports";
import type {
  AccountWithBalance,
  Category,
  LedgerTransaction,
  RecurringRule,
} from "@/lib/ledger/types";
import { ledgerKeys, recurringSyncKey } from "@/lib/queries";

// Made-up data for looking at the signed-in screens without signing in. Only
// the dev-preview pages use it, and they 404 in production.

const CUR = "GHS";

const accounts: AccountWithBalance[] = [
  ["acc-cash", "Cash", "cash", 41250, 38],
  ["acc-momo", "MTN MoMo", "mobile_money", 128540, 71],
  ["acc-gcb", "GCB Bank", "bank", 845020, 52],
  ["acc-susu", "Susu savings", "savings", 520000, 12],
].map(([id, name, type, balance, count], i) => ({
  id: id as string,
  name: name as string,
  type: type as AccountWithBalance["type"],
  currency: CUR,
  openingBalance: 0,
  sortOrder: i,
  archivedAt: null,
  balance: balance as number,
  transactionCount: count as number,
}));
accounts.push({
  id: "acc-old",
  name: "Old Ecobank",
  type: "bank",
  currency: CUR,
  openingBalance: 0,
  sortOrder: 9,
  archivedAt: "2026-01-10T09:00:00.000Z",
  balance: 0,
  transactionCount: 4,
});

type CatSeed = [id: string, name: string, kind: "expense" | "income", icon: string, color: string, parent?: string];
const categorySeeds: CatSeed[] = [
  ["food", "Food & Dining", "expense", "utensils", "#e8590c"],
  ["lunch", "Lunch", "expense", "coffee", "#e8590c", "food"],
  ["groceries", "Groceries", "expense", "basket", "#0ca678"],
  ["transport", "Transport", "expense", "bus", "#1c7ed6"],
  ["bills", "Bills & Utilities", "expense", "receipt", "#7048e8"],
  ["airtime", "Airtime & Data", "expense", "phone", "#0c8599"],
  ["rent", "Rent", "expense", "house", "#3b5bdb"],
  ["health", "Health", "expense", "heart", "#e03131"],
  ["shopping", "Shopping", "expense", "bag", "#d6336c"],
  ["fun", "Entertainment", "expense", "film", "#f08c00"],
  ["salary", "Salary", "income", "briefcase", "#0ca678"],
  ["business", "Business income", "income", "store", "#0c8599"],
  ["gifts", "Gifts received", "income", "gift", "#d6336c"],
];
const categories: Category[] = categorySeeds.map(([id, name, kind, icon, color, parent], i) => ({
  id,
  name,
  kind,
  parentId: parent ?? null,
  icon,
  color,
  sortOrder: i,
  archivedAt: null,
}));

function at(daysAgo: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

type TxSeed = [days: number, h: number, m: number, type: LedgerTransaction["type"], amount: number, account: string, category: string | null, payee: string | null, note?: string];
const txSeeds: TxSeed[] = [
  [0, 8, 14, "expense", 1200, "acc-momo", "transport", "Trotro to Circle"],
  [0, 12, 40, "expense", 3500, "acc-cash", "lunch", "Auntie Ama's waakye"],
  [1, 19, 5, "expense", 28750, "acc-gcb", "groceries", "Melcom", "Weekly shop"],
  [1, 7, 50, "expense", 1500, "acc-momo", "airtime", "MTN data bundle"],
  [2, 9, 30, "income", 250000, "acc-gcb", "salary", "Acme Ltd", "October pay"],
  [3, 18, 20, "expense", 6400, "acc-momo", "fun", "Silverbird Cinemas"],
  [3, 13, 10, "expense", 4200, "acc-cash", "lunch", "Chop bar"],
  [4, 10, 0, "expense", 18000, "acc-gcb", "bills", "ECG prepaid"],
  [5, 16, 45, "expense", 9500, "acc-momo", "shopping", "Makola market"],
  [6, 11, 15, "income", 45000, "acc-momo", "business", "Kofi", "Logo design"],
  [6, 8, 30, "expense", 2000, "acc-cash", "transport", "Bolt"],
  [7, 14, 0, "expense", 12000, "acc-gcb", "health", "Pharmacy"],
  [8, 9, 0, "expense", 150000, "acc-gcb", "rent", "Landlord", "Quarter rent"],
  [9, 17, 20, "income", 8000, "acc-cash", "gifts", "Auntie Esi"],
  [9, 12, 5, "expense", 3000, "acc-cash", "lunch", "Street food"],
];
const transactions: LedgerTransaction[] = txSeeds.map(
  ([days, h, m, type, amount, accountId, categoryId, payee, note], i) => ({
    id: `tx-${i}`,
    accountId,
    type,
    amount,
    currency: CUR,
    occurredAt: at(days, h, m),
    categoryId,
    payee,
    note: note ?? null,
    transferGroupId: null,
    deletedAt: null,
  }),
);
transactions.splice(
  4,
  0,
  {
    id: "tx-t1",
    accountId: "acc-gcb",
    type: "transfer_out",
    amount: 50000,
    currency: CUR,
    occurredAt: at(2, 10, 5),
    categoryId: null,
    payee: null,
    note: "To savings",
    transferGroupId: "tg-1",
    deletedAt: null,
  },
  {
    id: "tx-t2",
    accountId: "acc-susu",
    type: "transfer_in",
    amount: 50000,
    currency: CUR,
    occurredAt: at(2, 10, 5),
    categoryId: null,
    payee: null,
    note: "To savings",
    transferGroupId: "tg-1",
    deletedAt: null,
  },
);

// A small deterministic wobble so every month looks a little different.
function wobble(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const CATEGORY_SPEND: [string, number][] = [
  ["food", 61000],
  ["groceries", 74000],
  ["transport", 43500],
  ["bills", 38000],
  ["rent", 150000],
  ["airtime", 12500],
  ["shopping", 22000],
  ["fun", 6400],
];

function reportFor(month: string, offset: number): MonthlyReport {
  const days = daysInMonthKey(month);
  const isCurrent = offset === 0;
  const elapsed = isCurrent ? Math.min(new Date().getDate(), days) : days;
  const scale = isCurrent ? 1 : 0.8 + wobble(offset * 7) * 0.5;

  const cats = CATEGORY_SPEND.map(([id, amount]) => {
    const c = categories.find((x) => x.id === id)!;
    return {
      category_id: id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      amount: Math.round(amount * scale),
      count: 3 + Math.round(wobble(offset + id.length) * 8),
    };
  }).sort((a, b) => b.amount - a.amount);
  const expense = cats.reduce((sum, c) => sum + c.amount, 0);
  const income = isCurrent ? 303000 : Math.round((250000 + wobble(offset * 3) * 90000) / 1000) * 1000;

  const daily = Array.from({ length: days }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    const amount =
      i < elapsed && wobble(i + offset * 31) > 0.28
        ? Math.round((expense / elapsed) * (0.2 + wobble(i * 5 + offset) * 2.1))
        : 0;
    return { day: `${month.slice(0, 8)}${day}`, amount };
  });

  const trend = Array.from({ length: 6 }, (_, i) => {
    const back = 5 - i;
    const key = shiftMonthKey(month, -back);
    const live = back === 0;
    return {
      month: key,
      income: live ? income : Math.round((240000 + wobble(back + offset) * 110000) / 1000) * 1000,
      expense: live ? expense : Math.round((300000 + wobble(back * 4 + offset) * 150000) / 100) * 100,
    };
  });

  return {
    month,
    currency: CUR,
    income,
    expense,
    count: cats.reduce((sum, c) => sum + c.count, 0),
    prev_income: Math.round(income * 0.91),
    prev_expense: Math.round(expense * 1.12),
    categories: cats,
    daily,
    trend,
  };
}

const BUDGETS: [string | null, number, number][] = [
  [null, 500000, 0],
  ["food", 80000, 61000],
  ["transport", 40000, 43500],
  ["airtime", 15000, 12500],
  ["shopping", 60000, 22000],
];

function budgetsFor(offset: number): BudgetProgress[] {
  return BUDGETS.map(([categoryId, amount, spent], i) => ({
    id: `bud-${i}`,
    categoryId,
    amount,
    spent:
      categoryId === null
        ? reportFor(currentMonthKey(), 0).expense
        : offset === 0
          ? spent
          : Math.round(spent * (0.6 + wobble(offset + i) * 0.7)),
    currency: CUR,
  }));
}

function dayKeyFromToday(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDateKey(d);
}

type RuleSeed = [
  name: string,
  kind: "expense" | "income",
  amount: number,
  account: string,
  category: string,
  frequency: RecurringRule["frequency"],
  every: number,
  dueIn: number,
  auto: boolean,
  extra?: Partial<RecurringRule>,
];
const ruleSeeds: RuleSeed[] = [
  ["ECG prepaid", "expense", 18000, "acc-gcb", "bills", "monthly", 1, -2, false],
  ["Netflix", "expense", 7900, "acc-momo", "fun", "monthly", 1, 0, false],
  ["Salary", "income", 250000, "acc-gcb", "salary", "monthly", 1, 4, true],
  ["Rent", "expense", 150000, "acc-gcb", "rent", "monthly", 3, 9, false],
  ["Gym", "expense", 12000, "acc-cash", "health", "weekly", 1, 11, true],
  ["Domain name", "expense", 14500, "acc-gcb", "bills", "yearly", 1, 120, true],
  ["Old gym", "expense", 9000, "acc-cash", "health", "monthly", 1, 20, false, { paused: true }],
];
const recurringRules: RecurringRule[] = ruleSeeds.map(
  ([name, kind, amount, accountId, categoryId, frequency, repeatEvery, dueIn, autoPost, extra], i) => {
    const nextDue = dayKeyFromToday(dueIn);
    return {
      id: `rule-${i}`,
      kind,
      name,
      amount,
      currency: CUR,
      accountId,
      categoryId,
      frequency,
      repeatEvery,
      anchorDay: Number(nextDue.slice(8)),
      nextDue,
      endDate: null,
      autoPost,
      paused: false,
      ...extra,
    };
  },
);

// A client with everything already cached and nothing allowed to refetch, so no
// request ever reaches the database.
export function createMockClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
      },
    },
  });

  client.setQueryData(ledgerKeys.accounts(), accounts);
  client.setQueryData(ledgerKeys.categories(), categories);
  client.setQueryData(ledgerKeys.transactions({}), transactions);
  client.setQueryData(ledgerKeys.recurring(), recurringRules);
  // Nothing was due, so the app's "post due items" call has nothing to do.
  client.setQueryData(recurringSyncKey, 0);

  const now = currentMonthKey();
  for (let offset = 0; offset <= 6; offset++) {
    const month = shiftMonthKey(now, -offset);
    client.setQueryData(ledgerKeys.report(month), reportFor(month, offset));
    client.setQueryData(ledgerKeys.budgets(month), budgetsFor(offset));
  }
  return client;
}
