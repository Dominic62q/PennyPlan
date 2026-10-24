import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownerPolicies, timestamps, userIdColumn } from "./_shared";
import { categories } from "./categories";

// A monthly spending limit. No category means the overall budget for the month.
// Spending against a category budget includes its subcategories.
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdColumn(),
    categoryId: uuid("category_id"),
    // Lets the foreign key below insist the category is an expense category.
    categoryKind: text("category_kind").notNull().default("expense"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("GHS"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "budgets_category_fk",
      columns: [t.categoryId, t.userId, t.categoryKind],
      foreignColumns: [categories.id, categories.userId, categories.kind],
    }).onDelete("cascade"),
    uniqueIndex("budgets_user_category_uq").on(
      t.userId,
      sql`coalesce(${t.categoryId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    check("budgets_kind_chk", sql`${t.categoryKind} = 'expense'`),
    check(
      "budgets_amount_chk",
      sql`${t.amount} > 0 and ${t.amount} <= 99999999999999`,
    ),
    check("budgets_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    ...ownerPolicies("budgets", t.userId),
  ],
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
