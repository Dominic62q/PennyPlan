import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { logoCheck, logoColumns } from "./_logo";
import { ownerPolicies, timestamps, userIdColumn } from "./_shared";
import { accounts } from "./accounts";
import { categories } from "./categories";

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "yearly"] as const;

// Something that comes round again: rent, a subscription, salary. `next_due` is
// the next occurrence not yet dealt with. Auto-post rules turn into real
// transactions by themselves once due; the rest wait for a tap on "Paid".
export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdColumn(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    accountId: uuid("account_id").notNull(),
    categoryId: uuid("category_id"),
    // Lets the category foreign key insist the category matches the kind.
    categoryKind: text("category_kind").generatedAlwaysAs(sql`kind`),
    frequency: text("frequency").notNull(),
    // Every 2 weeks, every 3 months, and so on.
    repeatEvery: smallint("repeat_every").notNull().default(1),
    // The day of the month the schedule is built around, so a rule set for the
    // 31st lands on the last day of shorter months and then returns to the 31st.
    anchorDay: smallint("anchor_day").notNull(),
    nextDue: date("next_due", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    autoPost: boolean("auto_post").notNull().default(false),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    ...logoColumns(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "recurring_rules_account_fk",
      columns: [t.accountId, t.userId, t.currency],
      foreignColumns: [accounts.id, accounts.userId, accounts.currency],
    }).onDelete("restrict"),
    foreignKey({
      name: "recurring_rules_category_fk",
      columns: [t.categoryId, t.userId, t.categoryKind],
      foreignColumns: [categories.id, categories.userId, categories.kind],
    }).onDelete("restrict"),
    check("recurring_rules_kind_chk", sql`${t.kind} in ('expense','income')`),
    check(
      "recurring_rules_name_chk",
      sql`char_length(btrim(${t.name})) between 1 and 60`,
    ),
    check(
      "recurring_rules_amount_chk",
      sql`${t.amount} > 0 and ${t.amount} <= 99999999999999`,
    ),
    check("recurring_rules_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "recurring_rules_frequency_chk",
      sql`${t.frequency} in ('weekly','monthly','yearly')`,
    ),
    check(
      "recurring_rules_every_chk",
      sql`${t.repeatEvery} between 1 and 12`,
    ),
    check(
      "recurring_rules_anchor_chk",
      sql`${t.anchorDay} between 1 and 31`,
    ),
    logoCheck("recurring_rules_logo_chk", t.logo),
    index("recurring_rules_user_due_idx").on(t.userId, t.nextDue),
    ...ownerPolicies("recurring_rules", t.userId),
  ],
);

export type RecurringRule = typeof recurringRules.$inferSelect;
export type NewRecurringRule = typeof recurringRules.$inferInsert;
