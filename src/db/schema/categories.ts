import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { logoCheck, logoColumns } from "./_logo";
import { ownerPolicies, timestamps, userIdColumn } from "./_shared";

// Two levels (category > subcategory), separate trees for income and expense.
// The two-level rule is enforced by a trigger in the custom migration.
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdColumn(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    parentId: uuid("parent_id"),
    icon: text("icon"),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...logoColumns(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("categories_id_user_kind_uq").on(t.id, t.userId, t.kind),
    // A subcategory must belong to the same user and the same kind as its parent.
    foreignKey({
      name: "categories_parent_fk",
      columns: [t.parentId, t.userId, t.kind],
      foreignColumns: [t.id, t.userId, t.kind],
    }).onDelete("restrict"),
    uniqueIndex("categories_user_kind_parent_name_uq").on(
      t.userId,
      t.kind,
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    check("categories_name_chk", sql`char_length(btrim(${t.name})) between 1 and 60`),
    check("categories_kind_chk", sql`${t.kind} in ('income','expense')`),
    logoCheck("categories_logo_chk", t.logo),
    ...ownerPolicies("categories", t.userId),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
