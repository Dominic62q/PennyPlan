import { sql } from "drizzle-orm";
import {
  check,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

// One row per signed-in person. Created by the on_auth_user_created trigger
// (see the custom migration), so the app rarely inserts into it directly.
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    baseCurrency: text("base_currency").notNull().default("GHS"),
    locale: text("locale").notNull().default("en-GH"),
    timezone: text("timezone").notNull().default("Africa/Accra"),
    // 0 = Sunday ... 6 = Saturday; Monday by default.
    weekStart: smallint("week_start").notNull().default(1),
    // Day the budget month starts on; capped at 28 so every month has it.
    monthStartDay: smallint("month_start_day").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("profiles_base_currency_chk", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`),
    check("profiles_week_start_chk", sql`${t.weekStart} between 0 and 6`),
    check(
      "profiles_month_start_day_chk",
      sql`${t.monthStartDay} between 1 and 28`,
    ),
    pgPolicy("profiles_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy("profiles_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy("profiles_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    // No delete policy: a profile is removed only by deleting the auth user.
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
