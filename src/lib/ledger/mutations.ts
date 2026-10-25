import { createClient } from "@/lib/supabase/client";
import {
  accountEditSchema,
  accountInputSchema,
  budgetInputSchema,
  categoryInputSchema,
  categoryPatchSchema,
  nameSchema,
  recurringInputSchema,
  transactionInputSchema,
  transactionPatchSchema,
  transferInputSchema,
  type AccountEdit,
  type AccountInput,
  type BudgetInput,
  type CategoryInput,
  type CategoryPatch,
  type RecurringInput,
  type TransactionInput,
  type TransactionPatch,
  type TransferInput,
} from "./schemas";

// Every function validates first, then writes. The database enforces the same
// rules again, so a bug here can never save a bad row.

function firstIssue(error: { issues: { message: string }[] }) {
  return new Error(error.issues[0]?.message ?? "Check the details and try again");
}

// Turns raw database errors into text a person can act on.
export function friendlyDbError(error: { message?: string; code?: string }) {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (text.includes("23505") || text.includes("duplicate")) {
    return "That name is already used.";
  }
  if (text.includes("23503") || text.includes("foreign key")) {
    return "That account or category can't be used for this entry.";
  }
  if (text.includes("23514") || text.includes("check")) {
    return "Check the details and try again.";
  }
  if (text.includes("jwt") || text.includes("not signed in")) {
    return "You've been signed out. Sign in again.";
  }
  return "Something went wrong. Please try again.";
}

function check(error: { message?: string; code?: string } | null) {
  if (error) throw new Error(friendlyDbError(error));
}

// ---- Transactions ----------------------------------------------------------

export async function addTransaction(input: TransactionInput) {
  const parsed = transactionInputSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const t = parsed.data;

  const { error } = await createClient()
    .from("transactions")
    .insert({
      id: t.id,
      account_id: t.accountId,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      occurred_at: t.occurredAt,
      category_id: t.categoryId,
      payee: t.payee,
      note: t.note,
      // Retrying the same add (flaky signal) lands on the same row.
      idempotency_key: t.id,
    });
  // 23505 on a retry means the first attempt already saved it.
  if (error && error.code !== "23505") check(error);
  return t.id;
}

export async function updateTransaction(id: string, patch: TransactionPatch) {
  const parsed = transactionPatchSchema.safeParse(patch);
  if (!parsed.success) throw firstIssue(parsed.error);
  const p = parsed.data;

  const row: Record<string, unknown> = {};
  if (p.accountId !== undefined) row.account_id = p.accountId;
  if (p.currency !== undefined) row.currency = p.currency;
  if (p.type !== undefined) row.type = p.type;
  if (p.amount !== undefined) row.amount = p.amount;
  if (p.occurredAt !== undefined) row.occurred_at = p.occurredAt;
  if (p.categoryId !== undefined) row.category_id = p.categoryId;
  if (p.payee !== undefined) row.payee = p.payee;
  if (p.note !== undefined) row.note = p.note;
  if (Object.keys(row).length === 0) return;

  const { error } = await createClient()
    .from("transactions")
    .update(row)
    .eq("id", id)
    .is("transfer_group_id", null);
  check(error);
}

// Soft delete: the row stays, hidden everywhere, so Undo is one update.
export async function setTransactionDeleted(
  tx: { id: string; transferGroupId: string | null },
  deleted: boolean,
) {
  const supabase = createClient();
  if (tx.transferGroupId) {
    const { error } = await supabase.rpc("set_transfer_deleted", {
      p_group_id: tx.transferGroupId,
      p_deleted: deleted,
    });
    check(error);
    return;
  }
  const { error } = await supabase
    .from("transactions")
    .update({ deleted_at: deleted ? new Date().toISOString() : null })
    .eq("id", tx.id);
  check(error);
}

export async function addTransfer(input: TransferInput) {
  const parsed = transferInputSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const t = parsed.data;

  const { error } = await createClient().rpc("create_transfer", {
    p_group_id: t.groupId,
    p_from_account: t.fromAccountId,
    p_to_account: t.toAccountId,
    p_amount_out: t.amountOut,
    p_amount_in: t.amountIn,
    p_occurred_at: t.occurredAt,
    p_note: t.note,
    p_fee: t.fee,
    p_fee_category: t.feeCategoryId,
    p_source: "manual",
  });
  check(error);
  return t.groupId;
}

// ---- Accounts --------------------------------------------------------------

export async function addAccount(input: AccountInput) {
  const parsed = accountInputSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const a = parsed.data;

  const { error } = await createClient().from("accounts").insert({
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    opening_balance: a.openingBalance,
  });
  check(error);
  return a.id;
}

export async function renameAccount(id: string, name: string) {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) throw firstIssue(parsed.error);
  const { error } = await createClient()
    .from("accounts")
    .update({ name: parsed.data })
    .eq("id", id);
  check(error);
}

// The name and the opening balance (what the account held before its first entry).
// The balance shown is the opening balance plus every entry, so changing it moves
// the balance by the difference without adding an entry.
export async function updateAccountDetails(id: string, input: AccountEdit) {
  const parsed = accountEditSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const { error } = await createClient()
    .from("accounts")
    .update({ name: parsed.data.name, opening_balance: parsed.data.openingBalance })
    .eq("id", id);
  check(error);
}

// Archived accounts keep their history but leave the pickers.
export async function setAccountArchived(id: string, archived: boolean) {
  const { error } = await createClient()
    .from("accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  check(error);
}

// ---- Categories ------------------------------------------------------------

export async function addCategory(input: CategoryInput) {
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const c = parsed.data;

  const { error } = await createClient().from("categories").insert({
    id: c.id,
    name: c.name,
    kind: c.kind,
    parent_id: c.parentId,
    icon: c.icon,
    color: c.color,
  });
  check(error);
  return c.id;
}

// Adds several at once (the "suggested categories" picker) in one request, so
// all land or none do. Callers leave out names that already exist.
export async function addCategories(inputs: CategoryInput[]) {
  const rows = inputs.map((input) => {
    const parsed = categoryInputSchema.safeParse(input);
    if (!parsed.success) throw firstIssue(parsed.error);
    const c = parsed.data;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      parent_id: c.parentId,
      icon: c.icon,
      color: c.color,
    };
  });
  if (rows.length === 0) return;
  const { error } = await createClient().from("categories").insert(rows);
  check(error);
}

export async function updateCategory(id: string, patch: CategoryPatch) {
  const parsed = categoryPatchSchema.safeParse(patch);
  if (!parsed.success) throw firstIssue(parsed.error);
  const row: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) row.name = parsed.data.name;
  if (patch.icon !== undefined) row.icon = parsed.data.icon;
  if (patch.color !== undefined) row.color = parsed.data.color;
  if (Object.keys(row).length === 0) return;
  const { error } = await createClient().from("categories").update(row).eq("id", id);
  check(error);
}

// ---- Budgets ---------------------------------------------------------------

// Sets (or changes) a monthly budget. A null category is the overall budget.
export async function saveBudget(input: BudgetInput) {
  const parsed = budgetInputSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const { error } = await createClient().rpc("set_budget", {
    p_category: parsed.data.categoryId,
    p_amount: parsed.data.amount,
  });
  check(error);
}

export async function removeBudget(id: string) {
  const { error } = await createClient().from("budgets").delete().eq("id", id);
  check(error);
}

export async function renameCategory(id: string, name: string) {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) throw firstIssue(parsed.error);
  const { error } = await createClient()
    .from("categories")
    .update({ name: parsed.data })
    .eq("id", id);
  check(error);
}

export async function setCategoryArchived(id: string, archived: boolean) {
  const { error } = await createClient()
    .from("categories")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  check(error);
}

// ---- Recurring and bills -----------------------------------------------------

function recurringRow(input: RecurringInput) {
  const parsed = recurringInputSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);
  const r = parsed.data;
  return {
    id: r.id,
    row: {
      kind: r.kind,
      name: r.name,
      amount: r.amount,
      currency: r.currency,
      account_id: r.accountId,
      category_id: r.categoryId,
      frequency: r.frequency,
      repeat_every: r.repeatEvery,
      anchor_day: r.anchorDay ?? Number(r.nextDue.slice(8, 10)),
      next_due: r.nextDue,
      end_date: r.endDate,
      auto_post: r.autoPost,
    },
  };
}

export async function addRecurring(input: RecurringInput) {
  const { id, row } = recurringRow(input);
  const { error } = await createClient().from("recurring_rules").insert({ id, ...row });
  // 23505 on a retry means the first attempt already saved it.
  if (error && error.code !== "23505") check(error);
  return id;
}

export async function updateRecurring(input: RecurringInput) {
  const { id, row } = recurringRow(input);
  const { error } = await createClient().from("recurring_rules").update(row).eq("id", id);
  check(error);
}

export async function setRecurringPaused(id: string, paused: boolean) {
  const { error } = await createClient()
    .from("recurring_rules")
    .update({ paused_at: paused ? new Date().toISOString() : null })
    .eq("id", id);
  check(error);
}

// Stops the rule. Entries it already made stay in the history.
export async function removeRecurring(id: string) {
  const { error } = await createClient().from("recurring_rules").delete().eq("id", id);
  check(error);
}

// Records the bill as paid (for the usual amount, or what was actually paid)
// and moves the rule to its next date. A second tap for the same date does
// nothing.
export async function payRecurring(id: string, due: string, amount?: number) {
  const { error } = await createClient().rpc("pay_recurring", {
    p_rule: id,
    p_due: due,
    ...(amount === undefined ? {} : { p_amount: amount }),
  });
  check(error);
}

export async function skipRecurring(id: string, due: string) {
  const { error } = await createClient().rpc("skip_recurring", { p_rule: id, p_due: due });
  check(error);
}
