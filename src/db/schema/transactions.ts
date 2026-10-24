import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownerPolicies, timestamps, userIdColumn } from "./_shared";
import { accounts } from "./accounts";
import { categories } from "./categories";

export const TRANSACTION_TYPES = [
  "expense",
  "income",
  "transfer_out",
  "transfer_in",
] as const;

// Amounts are always positive; the sign comes from `type`. A transfer is two
// rows sharing a transfer_group_id (one transfer_out, one transfer_in).
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdColumn(),
    accountId: uuid("account_id").notNull(),
    type: text("type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    categoryId: uuid("category_id"),
    // Lets the category foreign key also check that the category's kind
    // (income/expense) matches the transaction's type.
    categoryKind: text("category_kind").generatedAlwaysAs(
      sql`case when type = 'income' then 'income' when type = 'expense' then 'expense' end`,
    ),
    payee: text("payee"),
    note: text("note"),
    status: text("status").notNull().default("cleared"),
    transferGroupId: uuid("transfer_group_id"),
    source: text("source").notNull().default("manual"),
    idempotencyKey: text("idempotency_key"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // Same user and same currency as the account.
    foreignKey({
      name: "transactions_account_fk",
      columns: [t.accountId, t.userId, t.currency],
      foreignColumns: [accounts.id, accounts.userId, accounts.currency],
    }).onDelete("restrict"),
    foreignKey({
      name: "transactions_category_fk",
      columns: [t.categoryId, t.userId, t.categoryKind],
      foreignColumns: [categories.id, categories.userId, categories.kind],
    }).onDelete("restrict"),
    check(
      "transactions_type_chk",
      sql`${t.type} in ('expense','income','transfer_out','transfer_in')`,
    ),
    check(
      "transactions_amount_chk",
      sql`${t.amount} > 0 and ${t.amount} <= 99999999999999`,
    ),
    check("transactions_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "transactions_status_chk",
      sql`${t.status} in ('pending','cleared','reconciled')`,
    ),
    check(
      "transactions_source_chk",
      sql`${t.source} in ('manual','import','recurring','assistant')`,
    ),
    check(
      "transactions_transfer_group_chk",
      sql`(${t.type} in ('transfer_out','transfer_in')) = (${t.transferGroupId} is not null)`,
    ),
    check(
      "transactions_transfer_no_category_chk",
      sql`${t.type} not in ('transfer_out','transfer_in') or ${t.categoryId} is null`,
    ),
    check("transactions_payee_chk", sql`char_length(${t.payee}) <= 120`),
    check("transactions_note_chk", sql`char_length(${t.note}) <= 500`),
    uniqueIndex("transactions_user_idempotency_uq")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index("transactions_user_occurred_idx").on(t.userId, t.occurredAt.desc()),
    index("transactions_user_account_occurred_idx").on(
      t.userId,
      t.accountId,
      t.occurredAt,
    ),
    index("transactions_user_category_occurred_idx").on(
      t.userId,
      t.categoryId,
      t.occurredAt,
    ),
    index("transactions_transfer_group_idx")
      .on(t.transferGroupId)
      .where(sql`${t.transferGroupId} is not null`),
    ...ownerPolicies("transactions", t.userId),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
