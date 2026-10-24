import type { QueryClient } from "@tanstack/react-query";
import { AssistantError } from "@/lib/assistant/client";
import type { Extraction } from "@/lib/assistant/extract";
import type { NewEntry, Review, ReviewRow } from "@/lib/assistant/types";
import { localDateKey, todayKey } from "@/lib/dates";
import { minorToInput, minorUnitDigits, parseMoney } from "@/lib/money";
import { accountsQuery, categoriesQuery, TRANSACTION_COLUMNS, toTransaction } from "@/lib/queries";
import { createClient } from "@/lib/supabase/client";
import type { AccountWithBalance, Category } from "@/lib/ledger/types";


// Turns what the model read into an editable review, and the review back into
// entries once the person accepts. Every figure on the way is checked in code;
// the model only reads the document.

const NOTE_MAX = 500;
const PAYEE_MAX = 120;

const toMinor = (amount: number, currency: string) => Math.round(amount * 10 ** minorUnitDigits(currency));

export const duplicateKey = (accountId: string, type: string, amount: number, date: string) =>
  `${accountId}|${type}|${amount}|${date}`;

type Open = Pick<AccountWithBalance, "id" | "currency" | "archivedAt">;

/** The account a document most likely belongs to: first open one in its currency. */
export function pickAccount<T extends Open>(accounts: T[], currency: string | null): T | null {
  const open = accounts.filter((a) => !a.archivedAt);
  return open.find((a) => a.currency === currency) ?? open[0] ?? null;
}

function receiptNote(extraction: Extract<Extraction, { kind: "receipt" }>, currency: string) {
  const fmt = (n: number) => minorToInput(toMinor(n, currency), currency);
  const parts = extraction.items.map((i) => `${i.name} ${fmt(i.amount)}`);
  if (extraction.tax) parts.push(`Tax ${fmt(extraction.tax)}`);
  const text = parts.join(", ");
  if (!text) return null;
  return text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1)}…` : text;
}

export type ReviewInputs = {
  accounts: Open[];
  categories: Pick<Category, "id" | "kind" | "archivedAt">[];
  // payee (lower case) by kind -> the category it was last filed under
  remembered: Map<string, string>;
  today: string;
};

export const rememberedKey = (type: string, payee: string) => `${type}:${payee.trim().toLowerCase()}`;

export function makeReview(extraction: Extraction, skipped: number, inputs: ReviewInputs): Review {
  const account = pickAccount(inputs.accounts, extraction.currency);
  if (!account) throw new AssistantError("Add an account first, then I can file this for you.");

  const kindOf = new Map(inputs.categories.filter((c) => !c.archivedAt).map((c) => [c.id, c.kind]));
  const categoryFor = (type: "expense" | "income", payee: string) => {
    const id = inputs.remembered.get(rememberedKey(type, payee));
    return id && kindOf.get(id) === type ? id : null;
  };
  const amountText = (n: number) => minorToInput(toMinor(n, account.currency), account.currency);
  const warnings: string[] = [];
  if (skipped > 0) warnings.push(`${skipped} line${skipped === 1 ? "" : "s"} couldn't be read and left out.`);

  if (extraction.kind === "receipt") {
    const itemsMinor = extraction.items.reduce((n, i) => n + toMinor(i.amount, account.currency), 0);
    const taxMinor = extraction.tax ? toMinor(extraction.tax, account.currency) : 0;
    const totalMinor = extraction.total ? toMinor(extraction.total, account.currency) : null;
    if (totalMinor === null) {
      warnings.push("There was no total on it, so I used the items. Check the amount.");
    } else if (itemsMinor > 0 && itemsMinor !== totalMinor && itemsMinor + taxMinor !== totalMinor) {
      warnings.push("The items add up differently to the total. Check the amount.");
    }
    const payee = extraction.merchant ?? "";
    const row: ReviewRow = {
      id: crypto.randomUUID(),
      include: true,
      type: "expense",
      date: extraction.date ?? inputs.today,
      payee,
      amount: minorToInput(totalMinor ?? itemsMinor, account.currency),
      categoryId: categoryFor("expense", payee),
      duplicate: false,
    };
    return {
      status: "pending",
      source: "receipt",
      accountId: account.id,
      currency: extraction.currency,
      rows: [row],
      note: receiptNote(extraction, account.currency),
      warnings,
    };
  }

  const rows: ReviewRow[] = extraction.rows.map((r) => {
    const type = r.direction === "credit" ? "income" : "expense";
    return {
      id: crypto.randomUUID(),
      include: true,
      type,
      date: r.date,
      payee: r.description,
      amount: amountText(r.amount),
      categoryId: categoryFor(type, r.description),
      duplicate: false,
    };
  });
  return {
    status: "pending",
    source: "statement",
    accountId: account.id,
    currency: extraction.currency,
    rows,
    note: null,
    warnings,
  };
}

/** Marks rows already in the account (same day, kind and amount) and leaves them unticked. */
export function markDuplicates(rows: ReviewRow[], accountId: string, currency: string, existing: Set<string>) {
  return rows.map((row) => {
    const amount = parseMoney(row.amount, currency);
    const duplicate = amount !== null && existing.has(duplicateKey(accountId, row.type, amount, row.date));
    return { ...row, duplicate, include: duplicate ? false : row.include };
  });
}

/** The entries to save, or the first thing wrong with the ticked lines. */
export function reviewEntries(
  review: Pick<Review, "accountId" | "rows" | "note" | "source">,
  currency: string,
  today = todayKey(),
): { entries: NewEntry[] } | { error: string } {
  const entries: NewEntry[] = [];
  for (const [i, row] of review.rows.entries()) {
    if (!row.include) continue;
    // "Line 3: check the amount." on a statement, "Check the amount." on a receipt.
    const say = (message: string) => ({
      error: review.rows.length > 1 ? `Line ${i + 1}: ${message}` : `${message[0].toUpperCase()}${message.slice(1)}`,
    });
    const amount = parseMoney(row.amount, currency);
    if (!amount) return say("check the amount.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date < "2000-01-01") return say("check the date.");
    if (row.date > today) return say("that date is in the future. Fix the date.");
    entries.push({
      type: row.type,
      amount,
      accountId: review.accountId,
      categoryId: row.categoryId,
      payee: row.payee.trim().slice(0, PAYEE_MAX) || null,
      note: review.source === "receipt" ? review.note : null,
      date: row.date,
    });
  }
  return entries.length > 0 ? { entries } : { error: "Tick at least one line to add." };
}

// ---- Looking things up -------------------------------------------------------------

async function existingKeys(rows: ReviewRow[], accountId: string) {
  const dates = rows.map((r) => r.date).sort();
  if (dates.length === 0) return new Set<string>();
  const [fy, fm, fd] = dates[0].split("-").map(Number);
  const [ty, tm, td] = dates[dates.length - 1].split("-").map(Number);
  const { data, error } = await createClient()
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .gte("occurred_at", new Date(fy, fm - 1, fd).toISOString())
    .lt("occurred_at", new Date(ty, tm - 1, td + 1).toISOString())
    .limit(2_000);
  if (error) throw new AssistantError("I couldn't check for duplicates. Try again.");
  return new Set(
    (data as Parameters<typeof toTransaction>[0][])
      .map(toTransaction)
      .map((t) => duplicateKey(t.accountId, t.type, t.amount, localDateKey(t.occurredAt))),
  );
}

async function rememberedCategories() {
  const { data } = await createClient()
    .from("transactions")
    .select("type, payee, category_id")
    .is("deleted_at", null)
    .not("category_id", "is", null)
    .not("payee", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(400);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ type: string; payee: string; category_id: string }>) {
    const key = rememberedKey(r.type, r.payee);
    if (!map.has(key)) map.set(key, r.category_id);
  }
  return map;
}

/** Everything the card needs, ready to show: the reading, the best account, duplicates marked. */
export async function buildReview(extraction: Extraction, skipped: number, queryClient: QueryClient) {
  const [accounts, categories, remembered] = await Promise.all([
    queryClient.fetchQuery({ ...accountsQuery(), staleTime: 0 }),
    queryClient.fetchQuery({ ...categoriesQuery(), staleTime: 0 }),
    rememberedCategories(),
  ]);
  const review = makeReview(extraction, skipped, { accounts, categories, remembered, today: todayKey() });
  return { ...review, rows: await recheckDuplicates(review, queryClient) };
}

/** Re-marks duplicates, for when the person picks another account. */
export async function recheckDuplicates(
  review: Pick<Review, "accountId" | "rows">,
  queryClient: QueryClient,
): Promise<ReviewRow[]> {
  const accounts = await queryClient.fetchQuery({ ...accountsQuery(), staleTime: 0 });
  const account = accounts.find((a) => a.id === review.accountId);
  if (!account) return review.rows;
  const existing = await existingKeys(review.rows, account.id);
  // A row the person already unticked stays unticked; a new match gets unticked.
  return markDuplicates(
    review.rows.map((r) => ({ ...r, include: r.duplicate ? true : r.include })),
    account.id,
    account.currency,
    existing,
  );
}
