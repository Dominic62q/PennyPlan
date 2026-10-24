import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownerPolicies, timestamps, userIdColumn } from "./_shared";

export const ACCOUNT_TYPES = [
  "cash",
  "bank",
  "savings",
  "credit_card",
  "mobile_money",
  "investment",
  "loan",
] as const;

// The balance is never stored: it is opening_balance plus the sum of the
// account's transactions (see the account_balances view).
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdColumn(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    currency: text("currency").notNull().default("GHS"),
    openingBalance: bigint("opening_balance", { mode: "number" })
      .notNull()
      .default(0),
    openingDate: date("opening_date").notNull().default(sql`current_date`),
    sortOrder: integer("sort_order").notNull().default(0),
    creditLimit: bigint("credit_limit", { mode: "number" }),
    statementDay: smallint("statement_day"),
    dueDay: smallint("due_day"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // Lets child rows prove they belong to the same user and currency.
    unique("accounts_id_user_currency_uq").on(t.id, t.userId, t.currency),
    uniqueIndex("accounts_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    check("accounts_name_chk", sql`char_length(btrim(${t.name})) between 1 and 60`),
    check(
      "accounts_type_chk",
      sql`${t.type} in ('cash','bank','savings','credit_card','mobile_money','investment','loan')`,
    ),
    check("accounts_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "accounts_opening_balance_chk",
      sql`abs(${t.openingBalance}) <= 99999999999999`,
    ),
    check("accounts_statement_day_chk", sql`${t.statementDay} between 1 and 31`),
    check("accounts_due_day_chk", sql`${t.dueDay} between 1 and 31`),
    ...ownerPolicies("accounts", t.userId),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
